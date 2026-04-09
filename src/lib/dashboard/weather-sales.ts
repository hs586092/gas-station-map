import { supabase } from "@/lib/supabase";

function dowFromDateStr(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const mean = (arr: number[]) => (arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length);
const std = (arr: number[]) => {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1));
};

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

/**
 * 날씨-매출 다차원 분석
 *
 * sales_data ∩ weather_daily 교집합으로 다차원 분석을 수행한다.
 *
 * 분석 기준 (탐색 결과 기반):
 *  - 강수 강도 3단계: dry (<1mm) / light (1~5mm) / heavy (>=5mm)
 *  - 요일 효과 먼저 분리 (요일 효과 > 날씨 효과이므로 가법 모델 필수)
 *  - 건당 주유량 분해 (비 오는 날은 "건수만" 줄고 건당은 그대로)
 *  - 기온 구간 분석은 보류 (여름 표본 부재)
 *
 * @param id - station_id
 * @param weatherForecast - optional weather forecast ({ today?: any; tomorrow?: any })
 * @returns analysis data object, or null if insufficient data
 */
export async function getWeatherSales(
  id: string,
  weatherForecast?: { today?: any; tomorrow?: any } | null
): Promise<any> {
  // -- 데이터 수집 --
  const [salesRes, weatherRes, carwashRes] = await Promise.all([
    supabase
      .from("sales_data")
      .select("date, gasoline_volume, gasoline_count, diesel_volume, diesel_count")
      .eq("station_id", id)
      .order("date", { ascending: true }),
    supabase
      .from("weather_daily")
      .select("date, weather_code, temp_max, temp_min, precipitation_mm")
      .order("date", { ascending: true }),
    supabase
      .from("carwash_daily")
      .select("date, total_count")
      .eq("station_id", id)
      .order("date", { ascending: true }),
  ]);

  if (salesRes.error || !salesRes.data) return null;
  if (weatherRes.error || !weatherRes.data) return null;

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
      dow: dowFromDateStr(s.date),
      totalVol,
      totalCnt,
      perTxn: totalCnt > 0 ? totalVol / totalCnt : null,
      intensity,
      weatherCode: w.weather_code,
      precip,
      tempAvg,
    });
  }

  if (joined.length < 30) return null;

  const baseline = {
    volume: mean(joined.map((d) => d.totalVol)),
    count: mean(joined.map((d) => d.totalCnt)),
    perTxn: mean(joined.map((d) => d.perTxn).filter((x): x is number => x != null)),
  };

  // -- 요일별 평균 (가법 모델의 요일 축) --
  const dowMean: Record<number, number> = {};
  const dowMeanCount: Record<number, number> = {};
  for (let dow = 0; dow < 7; dow++) {
    const arr = joined.filter((d) => d.dow === dow);
    dowMean[dow] = arr.length > 0 ? mean(arr.map((d) => d.totalVol)) : baseline.volume;
    dowMeanCount[dow] = arr.length > 0 ? mean(arr.map((d) => d.totalCnt)) : baseline.count;
  }

  // -- [1] byIntensity: 강수강도 3단계 집계 --
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
    const residuals = arr.map((d) => d.totalVol - dowMean[d.dow]);
    const adjustedMean = mean(residuals);
    const countResiduals = arr.map((d) => d.totalCnt - dowMeanCount[d.dow]);
    const adjustedCountMean = mean(countResiduals);
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
      adjustedDiffPct: baseline.volume > 0 ? +(adjustedMean / baseline.volume * 100).toFixed(1) : 0,
      adjustedCountDiffPct: baseline.count > 0 ? +(adjustedCountMean / baseline.count * 100).toFixed(1) : 0,
    };
  });

  // -- [2] Welch's t-test: 건조일 vs 본격비 --
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

  // -- [3] heatmap: 요일 x 강수강도 관측 히트맵 --
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

  // -- [4] additiveHeatmap: 가법 모델 기대치 --
  const weatherEffectResid: Record<string, number> = {};
  const weatherEffectResidCount: Record<string, number> = {};
  for (const key of intensityKeys) {
    const arr = joined.filter((d) => d.intensity === key);
    weatherEffectResid[key] = arr.length > 0
      ? mean(arr.map((d) => d.totalVol - dowMean[d.dow]))
      : 0;
    weatherEffectResidCount[key] = arr.length > 0
      ? mean(arr.map((d) => d.totalCnt - dowMeanCount[d.dow]))
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

  // -- [5] perTxnDecomposition --
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

  // -- [6] correlation --
  const withTemp = joined.filter((d) => d.tempAvg != null) as (Joined & { tempAvg: number })[];
  const correlation = {
    precipVsVolume: +pearson(joined.map((d) => d.precip), joined.map((d) => d.totalVol)).toFixed(3),
    tempVsVolume: withTemp.length > 0
      ? +pearson(withTemp.map((d) => d.tempAvg), withTemp.map((d) => d.totalVol)).toFixed(3)
      : 0,
  };

  // -- [6.5] 세차 x 날씨 분석 (비 다음날 세차 증가율) --
  const carwashMap = new Map<string, number>();
  for (const c of carwashRes.data || []) {
    carwashMap.set(c.date, c.total_count);
  }

  const carwashLag1Pairs: { precip: number; cwNext: number }[] = [];
  const carwashSameDayPairs: { precip: number; cw: number }[] = [];

  const sortedDates = joined.map((d) => d.date).sort();
  for (let i = 0; i < sortedDates.length - 1; i++) {
    const today = sortedDates[i];
    const tomorrow = sortedDates[i + 1];
    const todayJ = joined.find((d) => d.date === today);
    const cwToday = carwashMap.get(today);
    const cwTomorrow = carwashMap.get(tomorrow);

    if (todayJ && cwTomorrow != null) {
      carwashLag1Pairs.push({ precip: todayJ.precip, cwNext: cwTomorrow });
    }
    if (todayJ && cwToday != null) {
      carwashSameDayPairs.push({ precip: todayJ.precip, cw: cwToday });
    }
  }

  const cwByIntensity: Record<string, { counts: number[]; label: string }> = {
    dry: { counts: [], label: "맑은 다음날" },
    light: { counts: [], label: "약한비 다음날" },
    heavy: { counts: [], label: "강한비 다음날" },
  };
  for (const p of carwashLag1Pairs) {
    const key = p.precip < 1 ? "dry" : p.precip < 5 ? "light" : "heavy";
    cwByIntensity[key].counts.push(p.cwNext);
  }

  const cwBaselineAvg = carwashLag1Pairs.length > 0
    ? carwashLag1Pairs.reduce((s, p) => s + p.cwNext, 0) / carwashLag1Pairs.length
    : 0;

  const carwashWeather = {
    lag1Correlation: carwashLag1Pairs.length >= 3
      ? +pearson(carwashLag1Pairs.map((p) => p.precip), carwashLag1Pairs.map((p) => p.cwNext)).toFixed(3)
      : null,
    sameDayCorrelation: carwashSameDayPairs.length >= 3
      ? +pearson(carwashSameDayPairs.map((p) => p.precip), carwashSameDayPairs.map((p) => p.cw)).toFixed(3)
      : null,
    byIntensity: Object.entries(cwByIntensity).map(([key, v]) => ({
      key,
      label: v.label,
      n: v.counts.length,
      avgCount: v.counts.length > 0 ? Math.round(mean(v.counts)) : null,
      diffPct: v.counts.length > 0 && cwBaselineAvg > 0
        ? +(((mean(v.counts) - cwBaselineAvg) / cwBaselineAvg) * 100).toFixed(1)
        : null,
    })),
    totalDays: carwashLag1Pairs.length,
  };

  // -- [7] todayForecast --
  let todayForecast: {
    date: string;
    dow: number;
    intensity: "dry" | "light" | "heavy";
    intensityLabel: string;
    expectedVolume: number;
    expectedCount: number;
    baselineForDow: number;
    diffVsDryPct: number;
    confidence: "high" | "medium" | "low";
    explanation: string;
  } | null = null;

  if (weatherForecast?.today) {
    try {
      const wx = weatherForecast;
      const todayPrecip = wx.today?.precipSum ?? 0;
      const intensity: "dry" | "light" | "heavy" =
        todayPrecip < 1 ? "dry" : todayPrecip < 5 ? "light" : "heavy";
      const todayDate = wx.today?.date || new Date().toISOString().slice(0, 10);
      const dow = dowFromDateStr(todayDate);

      const expected = dowMean[dow] + weatherEffectResid[intensity];
      const expectedCount = dowMeanCount[dow] + weatherEffectResidCount[intensity];
      const dryExpected = dowMean[dow] + weatherEffectResid.dry;
      const diffVsDry = dryExpected > 0 ? ((expected - dryExpected) / dryExpected) * 100 : 0;

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
        expectedCount: Math.round(expectedCount),
        baselineForDow: Math.round(dowMean[dow]),
        diffVsDryPct: +diffVsDry.toFixed(1),
        confidence,
        explanation,
      };

      // forecast_history에 예측값 자동 저장 (upsert, fire-and-forget)
      supabase
        .from("forecast_history")
        .upsert(
          {
            station_id: id,
            forecast_date: todayDate,
            predicted_volume: Math.round(expected),
            predicted_count: Math.round(expectedCount),
            weather_intensity: intensity,
            day_of_week: dow,
            confidence,
          },
          { onConflict: "station_id,forecast_date", ignoreDuplicates: false }
        )
        .then(() => {});
    } catch {
      // weather forecast processing failed, skip todayForecast
    }
  }

  return {
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
    carwashWeather,
    todayForecast,
  };
}
