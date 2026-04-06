import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * GET /api/stations/[id]/forecast-review
 *
 * 어제의 판매량 예측 vs 실제를 비교하고, 오차 원인을 분석한다.
 * - forecast_history에서 예측값
 * - sales_data에서 실제값
 * - price_history + weather_daily에서 오차 원인
 */

// ── Haversine ──
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // ── 1. forecast_history에서 최근 30일 예측 가져오기 ──
  const thirtyAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
  const { data: forecasts, error: fcErr } = await supabase
    .from("forecast_history")
    .select("*")
    .eq("station_id", id)
    .gte("forecast_date", thirtyAgo)
    .order("forecast_date", { ascending: false });

  if (fcErr || !forecasts || forecasts.length === 0) {
    return NextResponse.json(
      {
        status: "no_data",
        message: "예측 데이터 축적 중 — 내일부터 복기 시작",
        yesterday: null,
        accuracy: null,
        history: [],
      },
      { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=300" } }
    );
  }

  // ── 2. sales_data에서 같은 기간 실제값 가져오기 ──
  const { data: salesRows } = await supabase
    .from("sales_data")
    .select("date, gasoline_volume, diesel_volume, gasoline_count, diesel_count")
    .eq("station_id", id)
    .gte("date", thirtyAgo)
    .order("date", { ascending: false });

  const salesMap = new Map<string, number>();
  const countMap = new Map<string, number>();
  for (const s of salesRows ?? []) {
    const vol = (Number(s.gasoline_volume) || 0) + (Number(s.diesel_volume) || 0);
    const cnt = (Number(s.gasoline_count) || 0) + (Number(s.diesel_count) || 0);
    salesMap.set(s.date, vol);
    countMap.set(s.date, cnt);
  }

  // ── 3. forecast_history에 actual_volume + actual_count 업데이트 (lazy) ──
  // actual_volume이 0이거나 null인 경우 모두 재업데이트 (동기화 전에 0으로 기록된 케이스 보정)
  for (const fc of forecasts) {
    if (!salesMap.has(fc.forecast_date)) continue;
    const salesVol = salesMap.get(fc.forecast_date)!;
    const salesCnt = countMap.get(fc.forecast_date) ?? 0;

    const volMismatch = fc.actual_volume == null || (fc.actual_volume === 0 && salesVol > 0);
    const cntMismatch = fc.actual_count == null || (fc.actual_count === 0 && salesCnt > 0);

    if (volMismatch || cntMismatch) {
      const updates: Record<string, number> = {};
      if (volMismatch) {
        fc.actual_volume = salesVol;
        updates.actual_volume = salesVol;
      }
      if (cntMismatch) {
        fc.actual_count = salesCnt;
        updates.actual_count = salesCnt;
      }
      supabase
        .from("forecast_history")
        .update(updates)
        .eq("id", fc.id)
        .then(() => {});
    }
  }

  // ── 4. 어제 복기 데이터 ──
  const yesterdayStr = new Date(Date.now() - 86400000).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const yesterdayFc = forecasts.find((f) => f.forecast_date === yesterdayStr);

  type Cause = {
    type: string;
    icon: string;
    message: string;
    impactL: number;
    impactPct: number;
    primary?: boolean;
  };

  let yesterday: {
    date: string;
    predicted: number;
    actual: number | null;
    error: number | null;
    errorPct: number | null;
    predictedCount: number | null;
    actualCount: number | null;
    countErrorPct: number | null;
    causes: Cause[];
    errorBreakdown: string | null;
  } | null = null;

  if (yesterdayFc) {
    const actual = yesterdayFc.actual_volume != null ? Number(yesterdayFc.actual_volume) : null;
    const predicted = Number(yesterdayFc.predicted_volume);
    const error = actual != null ? actual - predicted : null;
    const errorPct = actual != null && predicted > 0 ? +((error! / predicted) * 100).toFixed(1) : null;

    const predictedCount = yesterdayFc.predicted_count != null ? Number(yesterdayFc.predicted_count) : null;
    const actualCount = yesterdayFc.actual_count != null ? Number(yesterdayFc.actual_count) : null;
    const countErrorPct = predictedCount != null && actualCount != null && predictedCount > 0
      ? +(((actualCount - predictedCount) / predictedCount) * 100).toFixed(1) : null;

    // ── 5. 오차 요인 분해 ──
    const causes: Cause[] = [];
    const ydow = new Date(yesterdayStr + "T00:00:00+09:00").getDay();
    const dowNames = ["일", "월", "화", "수", "목", "금", "토"];

    // 5-pre. 요일별·날씨별 기준 데이터 (sales_data + weather_daily 교집합)
    const allSalesRes = await supabase
      .from("sales_data")
      .select("date, gasoline_volume, diesel_volume")
      .eq("station_id", id)
      .not("gasoline_volume", "is", null)
      .order("date", { ascending: true });

    const allWeatherRes = await supabase
      .from("weather_daily")
      .select("date, precipitation_mm")
      .order("date", { ascending: true });

    const weatherByDate = new Map<string, number>();
    for (const w of allWeatherRes.data ?? []) {
      weatherByDate.set(w.date, Number(w.precipitation_mm) || 0);
    }

    type DayRow = { date: string; dow: number; vol: number; intensity: "dry" | "light" | "heavy" };
    const allDays: DayRow[] = [];
    for (const s of allSalesRes.data ?? []) {
      const gVol = Number(s.gasoline_volume) || 0;
      const dVol = Number(s.diesel_volume) || 0;
      if (gVol === 0 && dVol === 0) continue;
      const precip = weatherByDate.get(s.date);
      const intensity: DayRow["intensity"] =
        precip == null || precip < 1 ? "dry" : precip < 5 ? "light" : "heavy";
      allDays.push({
        date: s.date,
        dow: new Date(s.date + "T00:00:00+09:00").getDay(),
        vol: gVol + dVol,
        intensity,
      });
    }

    const mean = (arr: number[]) => arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
    const overallMean = mean(allDays.map((d) => d.vol));

    // 요일별 평균
    const dowMeans: Record<number, number> = {};
    for (let d = 0; d < 7; d++) {
      const arr = allDays.filter((r) => r.dow === d).map((r) => r.vol);
      dowMeans[d] = arr.length > 0 ? mean(arr) : overallMean;
    }

    // 날씨 강도별 잔차 평균 (요일 효과 제거 후)
    const weatherResid: Record<string, number> = {};
    for (const key of ["dry", "light", "heavy"] as const) {
      const arr = allDays.filter((r) => r.intensity === key);
      weatherResid[key] = arr.length > 0 ? mean(arr.map((r) => r.vol - dowMeans[r.dow])) : 0;
    }

    // 5a. 요일 효과 (해당 요일 평균 vs 전체 평균)
    const dowEffect = dowMeans[ydow] - overallMean;
    const sameDowDays = allDays.filter((r) => r.dow === ydow).map((r) => r.vol);
    const sameDowMean = mean(sameDowDays);
    const dowDiffVsActual = actual != null ? actual - sameDowMean : null;
    {
      const pct = overallMean > 0 ? +((dowEffect / overallMean) * 100).toFixed(1) : 0;
      const direction = dowEffect >= 0 ? "많은" : "적은";
      let msg = `${dowNames[ydow]}요일 평균 ${Math.round(sameDowMean).toLocaleString()}L (전체 대비 ${pct >= 0 ? "+" : ""}${pct}%)`;
      if (dowDiffVsActual != null) {
        const vsDir = dowDiffVsActual >= 0 ? "많았음" : "적었음";
        msg += ` · 실제는 평소 ${dowNames[ydow]}요일보다 ${Math.abs(Math.round(dowDiffVsActual)).toLocaleString()}L ${vsDir}`;
      }
      causes.push({
        type: "weekday",
        icon: "📅",
        message: msg,
        impactL: Math.round(dowEffect),
        impactPct: pct,
      });
    }

    // 5b. 날씨 효과
    const dayBefore = new Date(Date.now() - 2 * 86400000).toISOString().split("T")[0];
    const { data: actualWeather } = await supabase
      .from("weather_daily")
      .select("precipitation_mm, temp_max, temp_min")
      .eq("date", yesterdayStr)
      .single();

    const labels: Record<string, string> = { dry: "맑음", light: "약한 비", heavy: "본격 비" };
    if (actualWeather) {
      const actualPrecip = Number(actualWeather.precipitation_mm) || 0;
      const actualIntensity: string =
        actualPrecip < 1 ? "dry" : actualPrecip < 5 ? "light" : "heavy";
      const weatherImpact = weatherResid[actualIntensity] ?? 0;
      const pct = overallMean > 0 ? +((weatherImpact / overallMean) * 100).toFixed(1) : 0;

      let msg = `실제 날씨: ${labels[actualIntensity]}`;
      if (yesterdayFc.weather_intensity && actualIntensity !== yesterdayFc.weather_intensity) {
        msg += ` (예보는 ${labels[yesterdayFc.weather_intensity]})`;
      }
      if (Math.abs(pct) >= 0.5) {
        msg += ` → 판매 ${pct >= 0 ? "+" : ""}${pct}% 영향`;
      }

      causes.push({
        type: "weather",
        icon: "🌦️",
        message: msg,
        impactL: Math.round(weatherImpact),
        impactPct: pct,
      });
    }

    // 5c. 내 가격 변동
    const { data: myPrices } = await supabase
      .from("price_history")
      .select("gasoline_price, collected_at")
      .eq("station_id", id)
      .gte("collected_at", dayBefore)
      .lte("collected_at", yesterdayStr + "T23:59:59")
      .not("gasoline_price", "is", null)
      .order("collected_at", { ascending: true });

    const myPriceMap = new Map<string, number>();
    for (const p of myPrices ?? []) {
      myPriceMap.set(p.collected_at.slice(0, 10), p.gasoline_price);
    }
    const myYesterday = myPriceMap.get(yesterdayStr);
    const myDayBefore = myPriceMap.get(dayBefore);
    let myPriceImpactL = 0;
    if (myYesterday && myDayBefore && myYesterday !== myDayBefore) {
      const diff = myYesterday - myDayBefore;
      // 가격 탄력성: 10원 변동당 약 -2% (경험적 추정)
      const elasticityPct = -(diff / 10) * 2;
      myPriceImpactL = Math.round((elasticityPct / 100) * overallMean);
      causes.push({
        type: "my_price",
        icon: diff > 0 ? "🔴" : "🔵",
        message: `내 가격 ${diff > 0 ? "+" : ""}${diff}원 변동 → 추정 ${elasticityPct >= 0 ? "+" : ""}${elasticityPct.toFixed(1)}%`,
        impactL: myPriceImpactL,
        impactPct: +elasticityPct.toFixed(1),
      });
    }

    // 5d. 경쟁사 가격 변동
    const { data: baseStation } = await supabase
      .from("stations")
      .select("lat, lng")
      .eq("id", id)
      .single();

    let compImpactL = 0;
    if (baseStation) {
      const RADIUS = 5;
      const latD = RADIUS / 111;
      const lngD = RADIUS / 88;
      const { data: compPrices } = await supabase
        .from("price_history")
        .select("station_id, station_name, gasoline_price, collected_at")
        .neq("station_id", id)
        .not("gasoline_price", "is", null)
        .gte("collected_at", dayBefore)
        .lte("collected_at", yesterdayStr + "T23:59:59")
        .order("collected_at", { ascending: true });

      const { data: nearbyStations } = await supabase
        .from("stations")
        .select("id, name, lat, lng")
        .gte("lat", baseStation.lat - latD)
        .lte("lat", baseStation.lat + latD)
        .gte("lng", baseStation.lng - lngD)
        .lte("lng", baseStation.lng + lngD)
        .neq("id", id);

      const nearbyIds = new Set(
        (nearbyStations ?? [])
          .filter((s) => haversineKm(baseStation.lat, baseStation.lng, s.lat, s.lng) <= RADIUS)
          .map((s) => s.id)
      );
      const nearbyNameMap = new Map((nearbyStations ?? []).map((s) => [s.id, s.name]));

      const compByStation = new Map<string, Map<string, number>>();
      for (const p of compPrices ?? []) {
        if (!nearbyIds.has(p.station_id)) continue;
        if (!compByStation.has(p.station_id)) compByStation.set(p.station_id, new Map());
        compByStation.get(p.station_id)!.set(p.collected_at.slice(0, 10), p.gasoline_price);
      }

      const bigChanges: Array<{ name: string; diff: number }> = [];
      for (const [sid, dateMap] of compByStation) {
        const y = dateMap.get(yesterdayStr);
        const db = dateMap.get(dayBefore);
        if (y && db && y !== db) {
          bigChanges.push({ name: nearbyNameMap.get(sid) ?? sid, diff: y - db });
        }
      }

      if (bigChanges.length > 0) {
        bigChanges.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
        // 경쟁사 인하 → 내 고객 이탈 추정 (10원 인하당 약 -1.5%)
        const topChanges = bigChanges.slice(0, 3);
        const avgCompDiff = mean(topChanges.map((c) => c.diff));
        const compElastPct = (avgCompDiff / 10) * 1.5;
        compImpactL = Math.round((compElastPct / 100) * overallMean);
        const names = topChanges.map((c) => `${c.name} ${c.diff > 0 ? "+" : ""}${c.diff}원`).join(", ");
        causes.push({
          type: "competitor_price",
          icon: avgCompDiff < 0 ? "🔴" : "🟡",
          message: `경쟁사 변동: ${names} → 추정 ${compElastPct >= 0 ? "+" : ""}${compElastPct.toFixed(1)}%`,
          impactL: compImpactL,
          impactPct: +compElastPct.toFixed(1),
        });
      }
    }

    // 5e. 잔차 (설명되지 않는 오차)
    if (error != null) {
      const explainedL = causes.reduce((sum, c) => sum + c.impactL, 0);
      // 요일·날씨 효과는 예측에 이미 반영되어 있으므로, 잔차 = 실제 오차 - (가격 요인들)
      const priceFactorsL = myPriceImpactL + compImpactL;
      const residualL = error - priceFactorsL;
      // 요일·날씨는 "설명 요인"으로 표시하되, 잔차는 가격 변동 외 나머지
      const residualPct = predicted > 0 ? +((residualL / predicted) * 100).toFixed(1) : 0;
      if (Math.abs(residualL) > 50) {
        causes.push({
          type: "residual",
          icon: "❓",
          message: `기타 요인 (교통·이벤트 등) ${residualL >= 0 ? "+" : ""}${Math.round(residualL).toLocaleString()}L`,
          impactL: Math.round(residualL),
          impactPct: residualPct,
        });
      }
    }

    // 가장 큰 원인 표시 (impactL 절대값 기준)
    if (causes.length > 0 && error != null && Math.abs(error) > 100) {
      const sorted = [...causes].sort((a, b) => Math.abs(b.impactL) - Math.abs(a.impactL));
      const primary = causes.find((c) => c === sorted[0]);
      if (primary) primary.primary = true;
    }

    // errorBreakdown 요약 문자열
    let errorBreakdown: string | null = null;
    if (error != null) {
      const parts = causes
        .filter((c) => Math.abs(c.impactL) >= 50)
        .sort((a, b) => Math.abs(b.impactL) - Math.abs(a.impactL))
        .map((c) => {
          const label = { weekday: "요일", weather: "날씨", my_price: "내 가격", competitor_price: "경쟁사", residual: "기타" }[c.type] ?? c.type;
          return `${label} ${c.impactL >= 0 ? "+" : ""}${c.impactL.toLocaleString()}L`;
        });
      if (parts.length > 0) {
        errorBreakdown = `오차 ${error >= 0 ? "+" : ""}${Math.round(error).toLocaleString()}L 분해: ${parts.join(" / ")}`;
      }
    }

    yesterday = {
      date: yesterdayStr,
      predicted,
      actual,
      error,
      errorPct,
      predictedCount,
      actualCount,
      countErrorPct,
      causes,
      errorBreakdown,
    };
  }

  // ── 6. 정확도 추적 (7일 / 30일) ──
  const completed = forecasts.filter(
    (f) => f.actual_volume != null && f.predicted_volume != null
  );

  function calcAccuracy(items: typeof completed) {
    if (items.length === 0) return null;
    const errors = items.map((f) => {
      const pred = Number(f.predicted_volume);
      const act = Number(f.actual_volume);
      return pred > 0 ? Math.abs((act - pred) / pred) * 100 : 0;
    });
    const avgError = errors.reduce((a, b) => a + b, 0) / errors.length;
    return { avgErrorPct: +avgError.toFixed(1), accuracy: +(100 - avgError).toFixed(1), count: items.length };
  }

  const recent7 = completed.slice(0, 7);
  const recent30 = completed;

  const acc7 = calcAccuracy(recent7);
  const acc30 = calcAccuracy(recent30);

  // 추세: 최근 3일 vs 이전 4일 평균 오차 비교
  let trend: "improving" | "declining" | "stable" | null = null;
  if (recent7.length >= 5) {
    const first3 = calcAccuracy(recent7.slice(0, 3));
    const last4 = calcAccuracy(recent7.slice(3));
    if (first3 && last4) {
      const diff = first3.avgErrorPct - last4.avgErrorPct;
      trend = diff < -2 ? "improving" : diff > 2 ? "declining" : "stable";
    }
  }

  // ── 7. 히스토리 (차트용) ──
  const history = completed.map((f) => ({
    date: f.forecast_date,
    predicted: Number(f.predicted_volume),
    actual: Number(f.actual_volume),
    errorPct: Number(f.predicted_volume) > 0
      ? +(((Number(f.actual_volume) - Number(f.predicted_volume)) / Number(f.predicted_volume)) * 100).toFixed(1)
      : 0,
  })).reverse();

  return NextResponse.json(
    {
      status: yesterday ? "ready" : "no_yesterday",
      yesterday,
      accuracy: {
        days7: acc7,
        days30: acc30,
        trend,
      },
      history,
    },
    { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=300" } }
  );
}
