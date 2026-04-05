import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * GET /api/stations/[id]/weather-sales-analysis
 *
 * sales_data ∩ weather_daily 교집합으로 다차원 분석을 수행한다.
 *
 * 분석 기준 (탐색 결과 기반):
 *  - 강수 강도 3단계: dry (<1mm) / light (1~5mm) / heavy (≥5mm)
 *    → WMO 코드 그룹 대신 precipitation_mm 실측치 사용 (drizzle와 rain 구분이 운영상 중요)
 *  - 요일 효과 먼저 분리 (요일 효과 > 날씨 효과이므로 가법 모델 필수)
 *  - 건당 주유량 분해 (비 오는 날은 "건수만" 줄고 건당은 그대로)
 *  - 기온 구간 분석은 보류 (여름 표본 부재)
 *
 * 반환:
 *  - byIntensity: 강수강도 3단계 요약 (n, 평균판매량, 건수, 건당, baseline 대비 Δ%)
 *  - weatherEffect: 요일 효과 제거 후 잔차 기반 날씨 순효과
 *  - heatmap: 요일(7) × 강수강도(3) = 21셀 (관측값)
 *  - additiveHeatmap: 가법 모델로 예측한 21셀 기대치
 *  - perTxnDecomposition: 건수 vs 건당 분해
 *  - correlation: 강수량·기온 × 판매량 Pearson r
 *  - todayForecast: 오늘 예상 판매량 (날씨 기반)
 *  - tTest: Welch's t-test (유의함 여부만)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // ── 데이터 수집 ──
  const [salesRes, weatherRes] = await Promise.all([
    supabase
      .from("sales_data")
      .select("date, gasoline_volume, gasoline_count, diesel_volume, diesel_count")
      .eq("station_id", id)
      .order("date", { ascending: true }),
    supabase
      .from("weather_daily")
      .select("date, weather_code, temp_max, temp_min, precipitation_mm")
      .order("date", { ascending: true }),
  ]);

  if (salesRes.error || !salesRes.data) {
    return NextResponse.json({ error: "판매 데이터를 가져올 수 없습니다." }, { status: 500 });
  }
  if (weatherRes.error || !weatherRes.data) {
    return NextResponse.json({ error: "날씨 데이터를 가져올 수 없습니다." }, { status: 500 });
  }

  const weatherMap = new Map(weatherRes.data.map((w) => [w.date, w]));

  type Joined = {
    date: string;
    dow: number;
    totalVol: number;
    totalCnt: number;
    perTxn: number | null;
    intensity: "dry" | "light" | "heavy";
    weatherCode: number | null;
    precip: number;
    tempAvg: number | null;
  };

  const joined: Joined[] = [];
  for (const s of salesRes.data) {
    const w = weatherMap.get(s.date);
    if (!w) continue;
    const gVol = Number(s.gasoline_volume) || 0;
    const dVol = Number(s.diesel_volume) || 0;
    const gCnt = Number(s.gasoline_count) || 0;
    const dCnt = Number(s.diesel_count) || 0;
    if (gVol === 0 && dVol === 0) continue;

    const totalVol = gVol + dVol;
    const totalCnt = gCnt + dCnt;
    const precip = Number(w.precipitation_mm) || 0;
    const intensity: Joined["intensity"] =
      precip < 1 ? "dry" : precip < 5 ? "light" : "heavy";

    const tMax = w.temp_max != null ? Number(w.temp_max) : null;
    const tMin = w.temp_min != null ? Number(w.temp_min) : null;
    const tempAvg = tMax != null && tMin != null ? (tMax + tMin) / 2 : null;

    joined.push({
      date: s.date,
      dow: new Date(s.date + "T00:00:00+09:00").getDay(),
      totalVol,
      totalCnt,
      perTxn: totalCnt > 0 ? totalVol / totalCnt : null,
      intensity,
      weatherCode: w.weather_code,
      precip,
      tempAvg,
    });
  }

  if (joined.length < 30) {
    return NextResponse.json(
      { error: "교집합 데이터가 부족합니다.", overlap: joined.length },
      { status: 404 }
    );
  }

  // ── 통계 유틸 ──
  const mean = (arr: number[]) => (arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length);
  const std = (arr: number[]) => {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1));
  };

  const baseline = {
    volume: mean(joined.map((d) => d.totalVol)),
    count: mean(joined.map((d) => d.totalCnt)),
    perTxn: mean(joined.map((d) => d.perTxn).filter((x): x is number => x != null)),
  };

  // ── 요일별 평균 (가법 모델의 요일 축) ──
  const dowMean: Record<number, number> = {};
  for (let dow = 0; dow < 7; dow++) {
    const arr = joined.filter((d) => d.dow === dow).map((d) => d.totalVol);
    dowMean[dow] = arr.length > 0 ? mean(arr) : baseline.volume;
  }

  // ── [1] byIntensity: 강수강도 3단계 집계 ──
  const intensityLabels: Record<Joined["intensity"], string> = {
    dry: "건조", light: "약한 비", heavy: "본격 비",
  };
  const byIntensity = (["dry", "light", "heavy"] as const).map((key) => {
    const arr = joined.filter((d) => d.intensity === key);
    const volArr = arr.map((d) => d.totalVol);
    const cntArr = arr.map((d) => d.totalCnt);
    const ptArr = arr.map((d) => d.perTxn).filter((x): x is number => x != null);
    const volMean = mean(volArr);
    const cntMean = mean(cntArr);
    const ptMean = mean(ptArr);
    // 요일 효과 제거 후 잔차 평균
    const residuals = arr.map((d) => d.totalVol - dowMean[d.dow]);
    const adjustedMean = mean(residuals);
    return {
      key,
      label: intensityLabels[key],
      n: arr.length,
      volumeMean: Math.round(volMean),
      countMean: Math.round(cntMean),
      perTxnMean: +ptMean.toFixed(1),
      volumeDiffPct: baseline.volume > 0 ? +((volMean - baseline.volume) / baseline.volume * 100).toFixed(1) : 0,
      countDiffPct: baseline.count > 0 ? +((cntMean - baseline.count) / baseline.count * 100).toFixed(1) : 0,
      perTxnDiffPct: baseline.perTxn > 0 ? +((ptMean - baseline.perTxn) / baseline.perTxn * 100).toFixed(1) : 0,
      // 요일 보정 순효과 (%)
      adjustedDiffPct: baseline.volume > 0 ? +(adjustedMean / baseline.volume * 100).toFixed(1) : 0,
    };
  });

  // ── [2] Welch's t-test: 건조일 vs 본격비 ──
  const dryArr = joined.filter((d) => d.intensity === "dry").map((d) => d.totalVol);
  const heavyArr = joined.filter((d) => d.intensity === "heavy").map((d) => d.totalVol);
  let tTest: { tStat: number; significant: boolean; label: "유의함" | "참고용" } | null = null;
  if (heavyArr.length >= 3 && dryArr.length >= 3) {
    const dryMean = mean(dryArr);
    const heavyMean = mean(heavyArr);
    const dryVar = std(dryArr) ** 2;
    const heavyVar = std(heavyArr) ** 2;
    const denom = Math.sqrt(dryVar / dryArr.length + heavyVar / heavyArr.length);
    const tStat = denom > 0 ? (heavyMean - dryMean) / denom : 0;
    const significant = Math.abs(tStat) > 1.96;
    tTest = {
      tStat: +tStat.toFixed(2),
      significant,
      label: significant ? "유의함" : "참고용",
    };
  }

  // ── [3] heatmap: 요일 × 강수강도 관측 히트맵 ──
  const intensityKeys = ["dry", "light", "heavy"] as const;
  const heatmap = [];
  for (let dow = 0; dow < 7; dow++) {
    for (const intensity of intensityKeys) {
      const cell = joined.filter((d) => d.dow === dow && d.intensity === intensity);
      const volumeMean = cell.length > 0 ? mean(cell.map((d) => d.totalVol)) : null;
      heatmap.push({
        dow,
        intensity,
        n: cell.length,
        volumeMean: volumeMean != null ? Math.round(volumeMean) : null,
        volumeDiffPct: volumeMean != null && baseline.volume > 0
          ? +((volumeMean - baseline.volume) / baseline.volume * 100).toFixed(1)
          : null,
      });
    }
  }

  // ── [4] additiveHeatmap: 가법 모델 기대치 ──
  // expected(dow, intensity) = dowMean[dow] + weatherEffect[intensity]
  // weatherEffect[intensity] = mean(residual) where residual = v - dowMean[dow]
  const weatherEffectResid: Record<string, number> = {};
  for (const key of intensityKeys) {
    const arr = joined.filter((d) => d.intensity === key);
    weatherEffectResid[key] = arr.length > 0
      ? mean(arr.map((d) => d.totalVol - dowMean[d.dow]))
      : 0;
  }
  const additiveHeatmap = [];
  for (let dow = 0; dow < 7; dow++) {
    for (const intensity of intensityKeys) {
      const expected = dowMean[dow] + weatherEffectResid[intensity];
      additiveHeatmap.push({
        dow,
        intensity,
        expectedVolume: Math.round(expected),
        diffPct: baseline.volume > 0 ? +((expected - baseline.volume) / baseline.volume * 100).toFixed(1) : 0,
      });
    }
  }

  // ── [5] perTxnDecomposition ──
  const dryJoined = joined.filter((d) => d.intensity === "dry");
  const heavyJoined = joined.filter((d) => d.intensity === "heavy");
  const decomp = {
    dry: {
      n: dryJoined.length,
      count: Math.round(mean(dryJoined.map((d) => d.totalCnt))),
      perTxn: +mean(dryJoined.map((d) => d.perTxn).filter((x): x is number => x != null)).toFixed(1),
    },
    heavy: {
      n: heavyJoined.length,
      count: heavyJoined.length > 0 ? Math.round(mean(heavyJoined.map((d) => d.totalCnt))) : null,
      perTxn: heavyJoined.length > 0
        ? +mean(heavyJoined.map((d) => d.perTxn).filter((x): x is number => x != null)).toFixed(1)
        : null,
    },
    countDiffPct: null as number | null,
    perTxnDiffPct: null as number | null,
  };
  if (heavyJoined.length > 0 && decomp.dry.count > 0) {
    decomp.countDiffPct = +(((decomp.heavy.count! - decomp.dry.count) / decomp.dry.count) * 100).toFixed(1);
  }
  if (heavyJoined.length > 0 && decomp.dry.perTxn > 0 && decomp.heavy.perTxn != null) {
    decomp.perTxnDiffPct = +(((decomp.heavy.perTxn - decomp.dry.perTxn) / decomp.dry.perTxn) * 100).toFixed(1);
  }

  // ── [6] correlation ──
  function pearson(xs: number[], ys: number[]) {
    const n = xs.length;
    if (n < 3) return 0;
    const mx = mean(xs);
    const my = mean(ys);
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      dx += (xs[i] - mx) ** 2;
      dy += (ys[i] - my) ** 2;
    }
    return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
  }
  const withTemp = joined.filter((d) => d.tempAvg != null) as (Joined & { tempAvg: number })[];
  const correlation = {
    precipVsVolume: +pearson(joined.map((d) => d.precip), joined.map((d) => d.totalVol)).toFixed(3),
    tempVsVolume: withTemp.length > 0
      ? +pearson(withTemp.map((d) => d.tempAvg), withTemp.map((d) => d.totalVol)).toFixed(3)
      : 0,
  };

  // ── [7] todayForecast ──
  // 오늘 날짜의 요일 + 오늘 예보 precipSum 으로 강수강도 분류 → 가법 모델로 예상 판매량 계산
  let todayForecast: {
    date: string;
    dow: number;
    intensity: "dry" | "light" | "heavy";
    intensityLabel: string;
    expectedVolume: number;
    baselineForDow: number;
    diffVsDryPct: number;
    confidence: "high" | "medium" | "low";
    explanation: string;
  } | null = null;

  try {
    const baseUrl = request.nextUrl.origin;
    const wxRes = await fetch(`${baseUrl}/api/weather`, { next: { revalidate: 600 } });
    if (wxRes.ok) {
      const wx = await wxRes.json();
      const todayPrecip = wx.today?.precipSum ?? 0;
      const intensity: "dry" | "light" | "heavy" =
        todayPrecip < 1 ? "dry" : todayPrecip < 5 ? "light" : "heavy";
      const todayDate = wx.today?.date || new Date().toISOString().slice(0, 10);
      const dow = new Date(todayDate + "T00:00:00+09:00").getDay();

      const expected = dowMean[dow] + weatherEffectResid[intensity];
      const dryExpected = dowMean[dow] + weatherEffectResid.dry;
      const diffVsDry = dryExpected > 0 ? ((expected - dryExpected) / dryExpected) * 100 : 0;

      // confidence: 해당 intensity의 n 기준
      const intensityN = byIntensity.find((b) => b.key === intensity)?.n ?? 0;
      const confidence: "high" | "medium" | "low" =
        intensityN >= 30 ? "high" : intensityN >= 10 ? "medium" : "low";

      const dowNames = ["일", "월", "화", "수", "목", "금", "토"];
      const explanation =
        intensity === "dry"
          ? `${dowNames[dow]}요일 건조일 기준`
          : `${intensityLabels[intensity]} ${dowNames[dow]}요일 · 건조일 대비 ${diffVsDry >= 0 ? "+" : ""}${diffVsDry.toFixed(1)}%`;

      todayForecast = {
        date: todayDate,
        dow,
        intensity,
        intensityLabel: intensityLabels[intensity],
        expectedVolume: Math.round(expected),
        baselineForDow: Math.round(dowMean[dow]),
        diffVsDryPct: +diffVsDry.toFixed(1),
        confidence,
        explanation,
      };
    }
  } catch {
    // weather API 실패 시 forecast 생략
  }

  return NextResponse.json(
    {
      dataRange: {
        from: joined[0].date,
        to: joined[joined.length - 1].date,
        days: joined.length,
      },
      baseline: {
        volume: Math.round(baseline.volume),
        count: Math.round(baseline.count),
        perTxn: +baseline.perTxn.toFixed(1),
      },
      dowMean: Object.fromEntries(Object.entries(dowMean).map(([k, v]) => [k, Math.round(v)])),
      byIntensity,
      tTest,
      heatmap,
      additiveHeatmap,
      perTxnDecomposition: decomp,
      correlation,
      todayForecast,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600",
      },
    }
  );
}
