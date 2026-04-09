import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

function dowFromDateStr(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const DOW_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * GET /api/stations/[id]/carwash-summary
 *
 * 세차장 일별 데이터 종합 요약:
 * - 오늘 예상 세차 대수/매출 (요일+날씨 기반)
 * - 어제 실적 + 전주 같은 요일 대비
 * - 종류별 비율
 * - 날씨 인사이트
 * - 30일 추이, 요일별 평균, 날씨별 분석 (상세 페이지용)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const compact = request.nextUrl.searchParams.get("compact") === "1";

  // ── 1. carwash_daily + weather_daily + forecast_history + sales_data 병렬 조회 ──
  const [cwRes, weatherRes, wxForecastRes, fcRes, salesCountRes] = await Promise.all([
    supabase
      .from("carwash_daily")
      .select("date, total_count, total_revenue, breakdown, payment_breakdown")
      .eq("station_id", id)
      .order("date", { ascending: false })
      .limit(90),
    supabase
      .from("weather_daily")
      .select("date, precipitation_mm")
      .order("date", { ascending: false })
      .limit(90),
    fetch(`${request.nextUrl.origin}/api/weather`, { next: { revalidate: 600 } }).then(r => r.ok ? r.json() : null).catch(() => null),
    supabase
      .from("forecast_history")
      .select("id, forecast_date, predicted_carwash, actual_carwash")
      .eq("station_id", id)
      .order("forecast_date", { ascending: false })
      .limit(30),
    supabase
      .from("sales_data")
      .select("date, gasoline_count, diesel_count")
      .eq("station_id", id)
      .order("date", { ascending: false })
      .limit(10),
  ]);

  if (!cwRes.data || cwRes.data.length === 0) {
    return NextResponse.json({ error: "세차 데이터 없음" }, { status: 404 });
  }

  const days = cwRes.data; // desc order
  const weatherMap = new Map<string, number>();
  for (const w of weatherRes.data || []) {
    weatherMap.set(w.date, Number(w.precipitation_mm) || 0);
  }

  // ── 2. 어제 실적 ──
  const todayStr = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const yesterdayStr = new Date(Date.now() - 86400000).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

  const yesterday = days.find(d => d.date === yesterdayStr);
  const todayDow = dowFromDateStr(todayStr);
  const yesterdayDow = dowFromDateStr(yesterdayStr);

  // 전주 같은 요일
  const lastWeekSameDay = days.find(d => {
    const diff = (new Date(yesterdayStr).getTime() - new Date(d.date).getTime()) / 86400000;
    return diff >= 6 && diff <= 8 && dowFromDateStr(d.date) === yesterdayDow;
  });

  let yesterdayVsLastWeek: number | null = null;
  if (yesterday && lastWeekSameDay && lastWeekSameDay.total_count > 0) {
    yesterdayVsLastWeek = +((
      (yesterday.total_count - lastWeekSameDay.total_count) / lastWeekSameDay.total_count
    ) * 100).toFixed(1);
  }

  // ── 3. 종류별 비율 (어제 기준) ──
  const breakdown = (yesterday?.breakdown || {}) as Record<string, number>;
  const totalYesterday = yesterday?.total_count || 0;

  let basicCount = 0;
  let premiumCount = 0;
  let taxiCount = 0;
  let freeCount = 0;
  let otherCount = 0;

  for (const [label, cnt] of Object.entries(breakdown)) {
    if (label === "5000원" || label === "6000원") basicCount += cnt;
    else if (label === "7000원" || label === "8000원" || label === "9000원" || label === "10000원") premiumCount += cnt;
    else if (label === "택시") taxiCount += cnt;
    else if (label === "무료") freeCount += cnt;
    else otherCount += cnt;
  }

  const typeRatio = totalYesterday > 0 ? {
    basic: { count: basicCount, pct: +(basicCount / totalYesterday * 100).toFixed(1) },
    premium: { count: premiumCount, pct: +(premiumCount / totalYesterday * 100).toFixed(1) },
    taxi: { count: taxiCount, pct: +(taxiCount / totalYesterday * 100).toFixed(1) },
    free: { count: freeCount, pct: +(freeCount / totalYesterday * 100).toFixed(1) },
    other: { count: otherCount, pct: +(otherCount / totalYesterday * 100).toFixed(1) },
  } : null;

  // ── 4. 요일별 평균 (예측용) ──
  const dowGroups: Record<number, { counts: number[]; revenues: number[] }> = {};
  for (let i = 0; i < 7; i++) dowGroups[i] = { counts: [], revenues: [] };

  for (const d of days) {
    const dow = dowFromDateStr(d.date);
    dowGroups[dow].counts.push(d.total_count);
    dowGroups[dow].revenues.push(d.total_revenue);
  }

  const dowStats = Object.entries(dowGroups).map(([dow, g]) => ({
    dow: Number(dow),
    label: DOW_LABELS[Number(dow)],
    avgCount: g.counts.length > 0 ? Math.round(g.counts.reduce((a, b) => a + b, 0) / g.counts.length) : 0,
    avgRevenue: g.revenues.length > 0 ? Math.round(g.revenues.reduce((a, b) => a + b, 0) / g.revenues.length) : 0,
    n: g.counts.length,
  }));

  // ── 5. 오늘 예상 (요일 기반 + 날씨 보정) ──
  const todayDowStats = dowStats.find(d => d.dow === todayDow);
  let expectedCount = todayDowStats?.avgCount ?? 0;
  let expectedRevenue = todayDowStats?.avgRevenue ?? 0;
  let weatherAdjustment: string | null = null;

  // 날씨 보정: 비 예보 시 당일 세차 감소
  const wxToday = wxForecastRes?.today;
  if (wxToday) {
    const todayPrecip = wxToday.precipSum ?? 0;
    if (todayPrecip >= 5) {
      // 강한비: 과거 강한비 날 vs 맑은 날 비율 적용
      const rainyDays = days.filter(d => (weatherMap.get(d.date) ?? 0) >= 5);
      const dryDays = days.filter(d => (weatherMap.get(d.date) ?? 0) < 1);
      if (rainyDays.length >= 3 && dryDays.length >= 3) {
        const rainyAvg = rainyDays.reduce((s, d) => s + d.total_count, 0) / rainyDays.length;
        const dryAvg = dryDays.reduce((s, d) => s + d.total_count, 0) / dryDays.length;
        const ratio = dryAvg > 0 ? rainyAvg / dryAvg : 1;
        expectedCount = Math.round(expectedCount * ratio);
        expectedRevenue = Math.round(expectedRevenue * ratio);
        const pctDiff = Math.round((ratio - 1) * 100);
        weatherAdjustment = `비 예보 → 세차 ${pctDiff}% 보정`;
      }
    } else if (todayPrecip >= 1) {
      const lightDays = days.filter(d => { const p = weatherMap.get(d.date) ?? 0; return p >= 1 && p < 5; });
      const dryDays = days.filter(d => (weatherMap.get(d.date) ?? 0) < 1);
      if (lightDays.length >= 3 && dryDays.length >= 3) {
        const lightAvg = lightDays.reduce((s, d) => s + d.total_count, 0) / lightDays.length;
        const dryAvg = dryDays.reduce((s, d) => s + d.total_count, 0) / dryDays.length;
        const ratio = dryAvg > 0 ? lightAvg / dryAvg : 1;
        expectedCount = Math.round(expectedCount * ratio);
        expectedRevenue = Math.round(expectedRevenue * ratio);
        const pctDiff = Math.round((ratio - 1) * 100);
        weatherAdjustment = `약한 비 → 세차 ${pctDiff}% 보정`;
      }
    }
  }

  // ── 6. 날씨 인사이트 (내일 비 → 모레 세차 증가) ──
  let weatherInsight: string | null = null;
  const wxTomorrow = wxForecastRes?.tomorrow;
  if (wxTomorrow) {
    const tmrPrecip = wxTomorrow.precipSum ?? 0;
    const tmrProbMax = wxTomorrow.precipProbMax ?? 0;

    // 비 다음날 세차 증가율 계산
    const sortedDays = [...days].sort((a, b) => a.date.localeCompare(b.date));
    const lag1After: number[] = [];
    const lag1Normal: number[] = [];

    for (let i = 0; i < sortedDays.length - 1; i++) {
      const precip = weatherMap.get(sortedDays[i].date) ?? 0;
      const nextCount = sortedDays[i + 1].total_count;
      if (precip >= 5) lag1After.push(nextCount);
      else if (precip < 1) lag1Normal.push(nextCount);
    }

    if (tmrPrecip >= 5 || tmrProbMax >= 60) {
      if (lag1After.length >= 3 && lag1Normal.length >= 3) {
        const afterAvg = lag1After.reduce((a, b) => a + b, 0) / lag1After.length;
        const normalAvg = lag1Normal.reduce((a, b) => a + b, 0) / lag1Normal.length;
        const pct = normalAvg > 0 ? Math.round(((afterAvg - normalAvg) / normalAvg) * 100) : 0;
        if (pct > 5) {
          weatherInsight = `내일 비 예보 → 모레 세차 +${pct}% 예상 (과거 ${lag1After.length}회 기준)`;
        } else {
          weatherInsight = `내일 비 예보 — 모레 세차 수요 주시`;
        }
      } else {
        weatherInsight = `내일 비 예보 — 모레 세차 수요 주시`;
      }
    } else if (tmrPrecip < 1 && tmrProbMax < 30) {
      weatherInsight = "내일 맑음 — 세차 수요 평년 수준 예상";
    }
  }

  // ── 7. forecast_history lazy-sync + 어제 복기 ──
  const forecasts = fcRes.data || [];
  const cwMap = new Map(days.map(d => [d.date, d.total_count]));

  // lazy-sync: actual_carwash가 null이면 carwash_daily에서 채우기
  for (const fc of forecasts) {
    const actual = cwMap.get(fc.forecast_date);
    if (actual != null && fc.actual_carwash == null) {
      fc.actual_carwash = actual;
      await supabase
        .from("forecast_history")
        .update({ actual_carwash: actual })
        .eq("id", fc.id);
    }
  }

  // 어제 복기
  const yesterdayFc = forecasts.find(f => f.forecast_date === yesterdayStr);
  let review: {
    predicted: number;
    actual: number | null;
    errorPct: number | null;
  } | null = null;

  if (yesterdayFc?.predicted_carwash != null) {
    const pred = Number(yesterdayFc.predicted_carwash);
    const act = yesterdayFc.actual_carwash != null ? Number(yesterdayFc.actual_carwash) : null;
    const errorPct = act != null && pred > 0 ? +(((act - pred) / pred) * 100).toFixed(1) : null;
    review = { predicted: pred, actual: act, errorPct };
  }

  // 7일 평균 정확도
  const completed = forecasts.filter(f => f.predicted_carwash != null && f.actual_carwash != null);
  const recent7 = completed.slice(0, 7);
  let accuracy7: { avgErrorPct: number; accuracy: number; count: number } | null = null;
  if (recent7.length > 0) {
    const errors = recent7.map(f => {
      const pred = Number(f.predicted_carwash);
      const act = Number(f.actual_carwash);
      return pred > 0 ? Math.abs((act - pred) / pred) * 100 : 0;
    });
    const avgErr = +(errors.reduce((a, b) => a + b, 0) / errors.length).toFixed(1);
    accuracy7 = { avgErrorPct: avgErr, accuracy: +(100 - avgErr).toFixed(1), count: recent7.length };
  }

  // ── 8. 오늘 예측 forecast_history에 저장 (upsert) ──
  if (expectedCount > 0) {
    supabase
      .from("forecast_history")
      .upsert({
        station_id: id,
        forecast_date: todayStr,
        predicted_carwash: expectedCount,
      }, { onConflict: "station_id,forecast_date", ignoreDuplicates: false })
      .then(() => {});
  }

  // ── 9. 세차 전환율 (어제 주유 대수 대비 세차 대수) ──
  const salesYesterday = (salesCountRes.data || []).find(s => s.date === yesterdayStr);
  const fuelCount = salesYesterday
    ? (Number(salesYesterday.gasoline_count) || 0) + (Number(salesYesterday.diesel_count) || 0)
    : null;
  const conversionRate = fuelCount && fuelCount > 0 && yesterday
    ? { fuelCount, carwashCount: yesterday.total_count, pct: +(yesterday.total_count / fuelCount * 100).toFixed(1) }
    : null;

  // ── compact 모드 (대시보드 카드) ──
  if (compact) {
    return NextResponse.json({
      today: {
        expectedCount,
        expectedRevenue,
        dow: todayDow,
        dowLabel: DOW_LABELS[todayDow],
        weatherAdjustment,
      },
      yesterday: yesterday ? {
        date: yesterdayStr,
        count: yesterday.total_count,
        revenue: yesterday.total_revenue,
        vsLastWeekPct: yesterdayVsLastWeek,
      } : null,
      typeRatio,
      weatherInsight,
      review,
      accuracy7,
      conversionRate,
    }, {
      headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=300" },
    });
  }

  // ── 7. 상세 모드: 30일 추이 + 요일 + 날씨별 ──
  const last30 = days.slice(0, 30).reverse();

  // 날씨별 세차 (당일)
  const byWeather: Record<string, number[]> = { dry: [], light: [], heavy: [] };
  for (const d of days) {
    const p = weatherMap.get(d.date) ?? 0;
    const key = p < 1 ? "dry" : p < 5 ? "light" : "heavy";
    byWeather[key].push(d.total_count);
  }
  const mean = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const weatherStats = [
    { key: "dry", label: "맑음 (<1mm)", avgCount: Math.round(mean(byWeather.dry)), n: byWeather.dry.length },
    { key: "light", label: "약한비 (1~5mm)", avgCount: Math.round(mean(byWeather.light)), n: byWeather.light.length },
    { key: "heavy", label: "강한비 (≥5mm)", avgCount: Math.round(mean(byWeather.heavy)), n: byWeather.heavy.length },
  ];

  // 비 다음날 세차
  const sortedAll = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const lag1Stats: Record<string, number[]> = { dry: [], light: [], heavy: [] };
  for (let i = 0; i < sortedAll.length - 1; i++) {
    const p = weatherMap.get(sortedAll[i].date) ?? 0;
    const key = p < 1 ? "dry" : p < 5 ? "light" : "heavy";
    lag1Stats[key].push(sortedAll[i + 1].total_count);
  }
  const lagWeatherStats = [
    { key: "dry", label: "맑은 다음날", avgCount: Math.round(mean(lag1Stats.dry)), n: lag1Stats.dry.length },
    { key: "light", label: "약한비 다음날", avgCount: Math.round(mean(lag1Stats.light)), n: lag1Stats.light.length },
    { key: "heavy", label: "강한비 다음날", avgCount: Math.round(mean(lag1Stats.heavy)), n: lag1Stats.heavy.length },
  ];

  // 종류별 매출 추이 (최근 30일)
  const typeBreakdownTrend = last30.map(d => {
    const bd = (d.breakdown || {}) as Record<string, number>;
    let basic = 0, premium = 0, taxi = 0, free = 0;
    for (const [label, cnt] of Object.entries(bd)) {
      if (label === "5000원" || label === "6000원") basic += cnt;
      else if (["7000원","8000원","9000원","10000원"].includes(label)) premium += cnt;
      else if (label === "택시") taxi += cnt;
      else if (label === "무료") free += cnt;
    }
    return { date: d.date, basic, premium, taxi, free, total: d.total_count };
  });

  // 주유 대수 조회 (상관관계 산점도용)
  const { data: salesRows } = await supabase
    .from("sales_data")
    .select("date, gasoline_count, diesel_count")
    .eq("station_id", id)
    .order("date", { ascending: false })
    .limit(90);

  const salesCountMap = new Map<string, number>();
  for (const s of salesRows || []) {
    salesCountMap.set(s.date, (Number(s.gasoline_count) || 0) + (Number(s.diesel_count) || 0));
  }

  const scatterData = days
    .filter(d => salesCountMap.has(d.date) && d.total_count > 0)
    .map(d => ({
      date: d.date,
      fuelCount: salesCountMap.get(d.date)!,
      carwashCount: d.total_count,
    }));

  return NextResponse.json({
    today: {
      expectedCount,
      expectedRevenue,
      dow: todayDow,
      dowLabel: DOW_LABELS[todayDow],
      weatherAdjustment,
    },
    yesterday: yesterday ? {
      date: yesterdayStr,
      count: yesterday.total_count,
      revenue: yesterday.total_revenue,
      vsLastWeekPct: yesterdayVsLastWeek,
    } : null,
    typeRatio,
    weatherInsight,
    dowStats,
    weatherStats,
    lagWeatherStats,
    trend: last30.map(d => ({ date: d.date, count: d.total_count, revenue: d.total_revenue })),
    typeBreakdownTrend,
    scatterData,
    dataRange: { from: days[days.length - 1].date, to: days[0].date, totalDays: days.length },
  }, {
    headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=300" },
  });
}
