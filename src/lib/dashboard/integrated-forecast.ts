import { supabase } from "@/lib/supabase";

/**
 * 통합 판매량 예측 모델
 *
 * 기존 날씨-only 모델에서 다변수 모델로 확장:
 *   예상판매량 = 요일기저 + 날씨보정 + 내가격효과 + 경쟁사가격차효과 + 교차항
 *
 * 모든 계수는 과거 데이터에서 자동 계산 (하드코딩 없음).
 * 표본 부족 시 해당 변수는 0으로 fallback, 배지로 표시.
 */

// 유종 비율 계산 윈도우 — 14일 고정.
// 근거: 주중/주말 양쪽 샘플 확보 + 단기 변화 감지 사이 균형. 현수 결정.
const FUEL_RATIO_WINDOW_DAYS = 14;

// 비율 계산 최소 샘플 수. 미만이면 breakdown 반환 안 함 (graceful fallback).
const FUEL_RATIO_MIN_SAMPLES = 5;

// ── 유틸리티 ──

function dowFromDateStr(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const mean = (arr: number[]) => arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── 타입 ──

export interface VariableContribution {
  name: string;
  label: string;
  value: number;           // 보정량 (L)
  pct: number;             // 보정률 (%)
  n: number;               // 표본 수
  reliable: boolean;       // n >= threshold
  badge: string;           // "n=22 (축적 중)" or "n=133 (신뢰)"
  method: "measured" | "estimated" | "fallback";
}

export interface IntegratedForecast {
  date: string;
  dow: number;
  dowLabel: string;

  // 최종 예측
  expectedVolume: number;
  expectedCount: number;
  confidence: "high" | "medium" | "low";
  explanation: string;

  // 유종별 분리 (샘플 부족 시 undefined — UI graceful fallback)
  fuelTypeBreakdown?: {
    gasolineVolume: number;
    gasolineCount: number;
    dieselVolume: number;
    dieselCount: number;
    gasolineRatio: number;
    dieselRatio: number;
    sampleDays: number;
    windowDays: number;
  };

  // 변수 분해
  baseline: number;           // 요일 기저
  baselineCount: number;
  contributions: VariableContribution[];

  // 비교
  diffVsDryPct: number;       // 맑은날 대비 차이%
  weatherOnly: number;        // 날씨-only 모델 예측 (비교용)

  // 메타
  modelVersion: string;
  totalDataDays: number;
}

export interface IntegratedForecastResult {
  forecast: IntegratedForecast | null;
  // 오차 분해용 계수 (forecast-review에서 사용)
  coefficients: {
    weatherResid: Record<string, number>;
    weatherResidCount: Record<string, number>;
    myPriceElasticity: { perWon: number; n: number; reliable: boolean } | null;
    compGapElasticity: { perWon: number; n: number; reliable: boolean } | null;
    interactions: {
      rainWeekend: { coeff: number; n: number; reliable: boolean } | null;
      rainCompDrop: { coeff: number; n: number; reliable: boolean } | null;
    };
    dowMean: Record<number, number>;
    dowMeanCount: Record<number, number>;
    overallMean: number;
  };
}

// ── 데이터 수집 ──

interface DayRecord {
  date: string;
  dow: number;
  isWeekend: boolean;
  totalVol: number;
  totalCnt: number;
  intensity: "dry" | "light" | "heavy";
  precip: number;
  myGasolinePrice: number | null;
  myPriceChange: number | null;     // vs 전일
  avgCompPrice: number | null;
  compGap: number | null;           // 내 가격 - 경쟁사 평균
  compDropped: boolean;             // 경쟁사 중 1곳 이상 인하 여부
}

export async function getIntegratedForecast(
  id: string,
  weatherForecast?: { today?: any; tomorrow?: any } | null
): Promise<IntegratedForecastResult> {
  const DOW_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

  // ── 1. 데이터 수집 (병렬) ──
  const [salesRes, weatherRes, stationRes] = await Promise.all([
    supabase
      .from("sales_data")
      .select("date, gasoline_volume, gasoline_count, diesel_volume, diesel_count")
      .eq("station_id", id)
      .order("date", { ascending: true }),
    supabase
      .from("weather_daily")
      .select("date, precipitation_mm")
      .order("date", { ascending: true }),
    supabase
      .from("stations")
      .select("lat, lng")
      .eq("id", id)
      .single(),
  ]);

  if (salesRes.error || !salesRes.data || salesRes.data.length < 30) {
    return emptyResult();
  }

  const weatherMap = new Map<string, number>();
  for (const w of weatherRes.data ?? []) {
    weatherMap.set(w.date, Number(w.precipitation_mm) || 0);
  }

  // ── 2. 내 가격 히스토리 ──
  const { data: myPrices } = await supabase
    .from("price_history")
    .select("gasoline_price, collected_at")
    .eq("station_id", id)
    .not("gasoline_price", "is", null)
    .order("collected_at", { ascending: true });

  const priceByDate = new Map<string, number>();
  for (const p of myPrices ?? []) {
    priceByDate.set(p.collected_at.slice(0, 10), p.gasoline_price);
  }

  // ── 3. 경쟁사 가격 히스토리 ──
  let compPriceByDate = new Map<string, number>();   // date → 경쟁사 평균 가격
  let compDropByDate = new Map<string, boolean>();    // date → 경쟁사 인하 여부

  if (stationRes.data) {
    const RADIUS = 5;
    const latD = RADIUS / 111;
    const lngD = RADIUS / 88;
    const baseLat = stationRes.data.lat;
    const baseLng = stationRes.data.lng;

    const { data: nearbyStations } = await supabase
      .from("stations")
      .select("id, lat, lng")
      .gte("lat", baseLat - latD).lte("lat", baseLat + latD)
      .gte("lng", baseLng - lngD).lte("lng", baseLng + lngD)
      .neq("id", id);

    const nearbyIds = (nearbyStations ?? [])
      .filter((s) => haversineKm(baseLat, baseLng, s.lat, s.lng) <= RADIUS)
      .map((s) => s.id);

    if (nearbyIds.length > 0) {
      const { data: compPrices } = await supabase
        .from("price_history")
        .select("station_id, gasoline_price, collected_at")
        .in("station_id", nearbyIds)
        .not("gasoline_price", "is", null)
        .order("collected_at", { ascending: true });

      // 날짜별 경쟁사 평균 가격 계산
      const dateCompPrices = new Map<string, number[]>();
      for (const p of compPrices ?? []) {
        const date = p.collected_at.slice(0, 10);
        if (!dateCompPrices.has(date)) dateCompPrices.set(date, []);
        dateCompPrices.get(date)!.push(p.gasoline_price);
      }
      for (const [date, prices] of dateCompPrices) {
        compPriceByDate.set(date, mean(prices));
      }

      // 날짜별 경쟁사 인하 여부 (전일 대비)
      const sortedDates = [...dateCompPrices.keys()].sort();
      for (let i = 1; i < sortedDates.length; i++) {
        const prevAvg = compPriceByDate.get(sortedDates[i - 1]);
        const currAvg = compPriceByDate.get(sortedDates[i]);
        if (prevAvg != null && currAvg != null) {
          compDropByDate.set(sortedDates[i], currAvg < prevAvg - 3); // 3원 이상 하락 시
        }
      }
    }
  }

  // ── 4. 일별 레코드 구축 ──
  const days: DayRecord[] = [];
  const salesDates = salesRes.data.map((s) => s.date).sort();

  for (let i = 0; i < salesRes.data.length; i++) {
    const s = salesRes.data[i];
    const gVol = Number(s.gasoline_volume) || 0;
    const dVol = Number(s.diesel_volume) || 0;
    if (gVol === 0 && dVol === 0) continue;

    const precip = weatherMap.get(s.date) ?? 0;
    const intensity: "dry" | "light" | "heavy" =
      precip < 1 ? "dry" : precip < 5 ? "light" : "heavy";
    const dow = dowFromDateStr(s.date);
    const myPrice = priceByDate.get(s.date) ?? null;

    // 전일 가격
    const prevDate = i > 0 ? salesRes.data[i - 1].date : null;
    const prevPrice = prevDate ? (priceByDate.get(prevDate) ?? null) : null;
    const myPriceChange = myPrice != null && prevPrice != null ? myPrice - prevPrice : null;

    const compAvg = compPriceByDate.get(s.date) ?? null;
    const compGap = myPrice != null && compAvg != null ? myPrice - compAvg : null;
    const compDropped = compDropByDate.get(s.date) ?? false;

    days.push({
      date: s.date,
      dow,
      isWeekend: dow === 0 || dow === 6,
      totalVol: gVol + dVol,
      totalCnt: (Number(s.gasoline_count) || 0) + (Number(s.diesel_count) || 0),
      intensity,
      precip,
      myGasolinePrice: myPrice,
      myPriceChange,
      avgCompPrice: compAvg,
      compGap,
      compDropped,
    });
  }

  if (days.length < 30) return emptyResult();

  // ── 5. 계수 계산 ──

  const overallMean = mean(days.map((d) => d.totalVol));

  // 5a. 요일 기저
  const dowMean: Record<number, number> = {};
  const dowMeanCount: Record<number, number> = {};
  for (let d = 0; d < 7; d++) {
    const arr = days.filter((r) => r.dow === d);
    dowMean[d] = arr.length > 0 ? mean(arr.map((r) => r.totalVol)) : overallMean;
    dowMeanCount[d] = arr.length > 0 ? mean(arr.map((r) => r.totalCnt)) : mean(days.map((r) => r.totalCnt));
  }

  // 5b. 날씨 잔차 (요일 효과 제거)
  const weatherResid: Record<string, number> = {};
  const weatherResidCount: Record<string, number> = {};
  for (const key of ["dry", "light", "heavy"] as const) {
    const arr = days.filter((d) => d.intensity === key);
    weatherResid[key] = arr.length > 0 ? mean(arr.map((d) => d.totalVol - dowMean[d.dow])) : 0;
    weatherResidCount[key] = arr.length > 0 ? mean(arr.map((d) => d.totalCnt - dowMeanCount[d.dow])) : 0;
  }

  // 5c. 내 가격 탄성도 (요일+날씨 제거 후 잔차 vs 가격변동)
  // 가격 변동이 있는 날만 추출, 잔차 = totalVol - dowMean - weatherResid
  const priceChangeDays = days.filter((d) => d.myPriceChange != null && d.myPriceChange !== 0);
  let myPriceElasticity: { perWon: number; n: number; reliable: boolean } | null = null;

  if (priceChangeDays.length >= 3) {
    // 가격 변동 1원당 판매량 변화 (L)
    const residuals = priceChangeDays.map((d) => {
      const resid = d.totalVol - dowMean[d.dow] - weatherResid[d.intensity];
      return { priceChange: d.myPriceChange!, residual: resid };
    });

    // 가중 평균: 가격변동원당 잔차 변화
    let sumWeighted = 0, sumWeight = 0;
    for (const r of residuals) {
      sumWeighted += r.residual * Math.sign(r.priceChange);
      sumWeight += Math.abs(r.priceChange);
    }
    const perWon = sumWeight > 0 ? sumWeighted / sumWeight : 0;
    myPriceElasticity = {
      perWon,
      n: priceChangeDays.length,
      reliable: priceChangeDays.length >= 10,
    };
  }

  // 5d. 경쟁사 가격차 탄성도 (compGap vs 잔차)
  // 경쟁사 가격차(gap)가 변한 날: gap이 있는 날의 잔차 vs gap의 관계
  const gapDays = days.filter((d) => d.compGap != null);
  let compGapElasticity: { perWon: number; n: number; reliable: boolean } | null = null;

  if (gapDays.length >= 10) {
    // gap이 커질수록 (내가 비쌀수록) 판매 감소 → 음의 상관
    const meanGap = mean(gapDays.map((d) => d.compGap!));
    const residuals = gapDays.map((d) => ({
      gapDelta: d.compGap! - meanGap,
      volResid: d.totalVol - dowMean[d.dow] - weatherResid[d.intensity],
    }));

    // 단순 회귀: volResid = β × gapDelta
    let sumXY = 0, sumXX = 0;
    for (const r of residuals) {
      sumXY += r.gapDelta * r.volResid;
      sumXX += r.gapDelta ** 2;
    }
    const perWon = sumXX > 0 ? sumXY / sumXX : 0;
    compGapElasticity = {
      perWon,
      n: gapDays.length,
      reliable: gapDays.length >= 60,
    };
  }

  // 5e. 교차항: 비 × 주말
  const rainWeekendDays = days.filter((d) => d.intensity !== "dry" && d.isWeekend);
  const rainWeekdayDays = days.filter((d) => d.intensity !== "dry" && !d.isWeekend);
  const dryWeekendDays = days.filter((d) => d.intensity === "dry" && d.isWeekend);

  let rainWeekendInteraction: { coeff: number; n: number; reliable: boolean } | null = null;
  if (rainWeekendDays.length >= 3 && rainWeekdayDays.length >= 3 && dryWeekendDays.length >= 3) {
    // 교차항 = (비+주말 잔차) - (비 잔차) - (주말 잔차)
    const rainResid = mean(
      days.filter((d) => d.intensity !== "dry")
        .map((d) => d.totalVol - dowMean[d.dow] - weatherResid[d.intensity])
    );
    const weekendResid = mean(
      days.filter((d) => d.isWeekend)
        .map((d) => d.totalVol - dowMean[d.dow])
    );
    const rainWeekendResid = mean(
      rainWeekendDays.map((d) => d.totalVol - dowMean[d.dow] - weatherResid[d.intensity])
    );
    // 교차항 효과 = 비+주말 잔차 - 비-only 잔차 (주말 효과는 이미 dowMean에 포함)
    const coeff = rainWeekendResid - rainResid;
    rainWeekendInteraction = {
      coeff,
      n: rainWeekendDays.length,
      reliable: rainWeekendDays.length >= 5,
    };
  }

  // 5f. 교차항: 비 × 경쟁사 인하
  const rainCompDropDays = days.filter((d) => d.intensity !== "dry" && d.compDropped);
  let rainCompDropInteraction: { coeff: number; n: number; reliable: boolean } | null = null;

  if (rainCompDropDays.length >= 3) {
    const rainOnlyResid = mean(
      days.filter((d) => d.intensity !== "dry" && !d.compDropped)
        .map((d) => d.totalVol - dowMean[d.dow] - weatherResid[d.intensity])
    );
    const rainCompResid = mean(
      rainCompDropDays.map((d) => d.totalVol - dowMean[d.dow] - weatherResid[d.intensity])
    );
    const coeff = rainCompResid - rainOnlyResid;
    rainCompDropInteraction = {
      coeff,
      n: rainCompDropDays.length,
      reliable: rainCompDropDays.length >= 5,
    };
  }

  // ── 6. 오늘 예측 생성 ──
  const coefficients: IntegratedForecastResult["coefficients"] = {
    weatherResid,
    weatherResidCount,
    myPriceElasticity,
    compGapElasticity,
    interactions: {
      rainWeekend: rainWeekendInteraction,
      rainCompDrop: rainCompDropInteraction,
    },
    dowMean,
    dowMeanCount,
    overallMean,
  };

  if (!weatherForecast?.today) {
    return { forecast: null, coefficients };
  }

  try {
    const wx = weatherForecast;
    const todayPrecip = wx.today?.precipSum ?? 0;
    const intensity: "dry" | "light" | "heavy" =
      todayPrecip < 1 ? "dry" : todayPrecip < 5 ? "light" : "heavy";
    const todayDate = wx.today?.date || new Date().toISOString().slice(0, 10);
    const dow = dowFromDateStr(todayDate);
    const isWeekend = dow === 0 || dow === 6;

    // 각 변수의 기여도 계산
    const contributions: VariableContribution[] = [];

    // (a) 날씨 보정
    const weatherEffect = weatherResid[intensity];
    const weatherCountEffect = weatherResidCount[intensity];
    const intensityN = days.filter((d) => d.intensity === intensity).length;
    contributions.push({
      name: "weather",
      label: intensity === "dry" ? "건조" : intensity === "light" ? "약한 비" : "본격 비",
      value: Math.round(weatherEffect),
      pct: overallMean > 0 ? +((weatherEffect / overallMean) * 100).toFixed(1) : 0,
      n: intensityN,
      reliable: intensityN >= 10,
      badge: makeBadge(intensityN, 30),
      method: intensityN >= 10 ? "measured" : intensityN >= 3 ? "estimated" : "fallback",
    });

    // (b) 내 가격 변동 효과
    // 오늘의 가격 변동 = 오늘 가격 - 어제 가격
    const latestPrice = getLatestPrice(days);
    const yesterdayPrice = getYesterdayPrice(days);
    const todayPriceChange = latestPrice != null && yesterdayPrice != null
      ? latestPrice - yesterdayPrice : 0;

    let myPriceEffect = 0;
    if (todayPriceChange !== 0 && myPriceElasticity) {
      myPriceEffect = myPriceElasticity.perWon * todayPriceChange;
    }
    contributions.push({
      name: "my_price",
      label: todayPriceChange !== 0
        ? `내 가격 ${todayPriceChange > 0 ? "+" : ""}${todayPriceChange}원`
        : "내 가격 변동 없음",
      value: Math.round(myPriceEffect),
      pct: overallMean > 0 ? +((myPriceEffect / overallMean) * 100).toFixed(1) : 0,
      n: myPriceElasticity?.n ?? 0,
      reliable: myPriceElasticity?.reliable ?? false,
      badge: makeBadge(myPriceElasticity?.n ?? 0, 10),
      method: myPriceElasticity ? (myPriceElasticity.reliable ? "measured" : "estimated") : "fallback",
    });

    // (c) 경쟁사 가격차 효과
    const latestCompGap = getLatestCompGap(days);
    const meanCompGap = gapDays.length > 0 ? mean(gapDays.map((d) => d.compGap!)) : null;

    let compGapEffect = 0;
    if (latestCompGap != null && meanCompGap != null && compGapElasticity) {
      compGapEffect = compGapElasticity.perWon * (latestCompGap - meanCompGap);
    }
    contributions.push({
      name: "comp_gap",
      label: latestCompGap != null
        ? `경쟁사 대비 ${latestCompGap > 0 ? "+" : ""}${Math.round(latestCompGap)}원`
        : "경쟁사 데이터 없음",
      value: Math.round(compGapEffect),
      pct: overallMean > 0 ? +((compGapEffect / overallMean) * 100).toFixed(1) : 0,
      n: compGapElasticity?.n ?? 0,
      reliable: compGapElasticity?.reliable ?? false,
      badge: makeBadge(compGapElasticity?.n ?? 0, 60),
      method: compGapElasticity ? (compGapElasticity.reliable ? "measured" : "estimated") : "fallback",
    });

    // (d) 교차항: 비 × 주말
    let rainWeekendEffect = 0;
    if (intensity !== "dry" && isWeekend && rainWeekendInteraction && rainWeekendInteraction.n >= 3) {
      rainWeekendEffect = rainWeekendInteraction.coeff;
    }
    if (intensity !== "dry" && isWeekend) {
      contributions.push({
        name: "rain_weekend",
        label: "비 × 주말 교차",
        value: Math.round(rainWeekendEffect),
        pct: overallMean > 0 ? +((rainWeekendEffect / overallMean) * 100).toFixed(1) : 0,
        n: rainWeekendInteraction?.n ?? 0,
        reliable: rainWeekendInteraction?.reliable ?? false,
        badge: makeBadge(rainWeekendInteraction?.n ?? 0, 5),
        method: rainWeekendInteraction && rainWeekendInteraction.n >= 3 ? "estimated" : "fallback",
      });
    }

    // (e) 교차항: 비 × 경쟁사 인하
    const isCompDropping = compDropByDate.get(todayDate) ?? false;
    let rainCompDropEffect = 0;
    if (intensity !== "dry" && isCompDropping && rainCompDropInteraction && rainCompDropInteraction.n >= 3) {
      rainCompDropEffect = rainCompDropInteraction.coeff;
    }
    if (intensity !== "dry" && isCompDropping) {
      contributions.push({
        name: "rain_comp_drop",
        label: "비 × 경쟁사 인하 교차",
        value: Math.round(rainCompDropEffect),
        pct: overallMean > 0 ? +((rainCompDropEffect / overallMean) * 100).toFixed(1) : 0,
        n: rainCompDropInteraction?.n ?? 0,
        reliable: rainCompDropInteraction?.reliable ?? false,
        badge: makeBadge(rainCompDropInteraction?.n ?? 0, 5),
        method: rainCompDropInteraction && rainCompDropInteraction.n >= 3 ? "estimated" : "fallback",
      });
    }

    // ── 7. 최종 합산 ──
    const baseline = dowMean[dow];
    const baselineCount = dowMeanCount[dow];
    const totalContrib = contributions.reduce((s, c) => s + c.value, 0);
    const expectedVolume = Math.round(baseline + totalContrib);
    const expectedCount = Math.round(baselineCount + weatherCountEffect);

    // 날씨-only 모델 (비교용)
    const weatherOnlyExpected = Math.round(dowMean[dow] + weatherResid[intensity]);

    // 맑은날 대비 비교
    const dryExpected = dowMean[dow] + weatherResid.dry;
    const diffVsDryPct = dryExpected > 0 ? +((expectedVolume - dryExpected) / dryExpected * 100).toFixed(1) : 0;

    // 신뢰도: 기여 변수 중 reliable 비율 + 표본 수
    const reliableCount = contributions.filter((c) => c.reliable).length;
    const totalVars = contributions.length;
    const confidence: "high" | "medium" | "low" =
      reliableCount >= totalVars * 0.7 && intensityN >= 30 ? "high"
      : reliableCount >= totalVars * 0.4 && intensityN >= 10 ? "medium"
      : "low";

    // 설명 문자열
    const intensityLabels = { dry: "건조", light: "약한 비", heavy: "본격 비" };
    const activeContribs = contributions.filter((c) => Math.abs(c.value) >= 10);
    const contribDesc = activeContribs.length > 0
      ? activeContribs.map((c) => `${c.label} ${c.value >= 0 ? "+" : ""}${c.value}L`).join(", ")
      : "보정 미미";
    const explanation = `${intensityLabels[intensity]} ${DOW_NAMES[dow]}요일 · ${contribDesc}`;

    // ── 유종 비율 분리 (최근 FUEL_RATIO_WINDOW_DAYS 일) ──
    // 통합 예측에 비율 곱해서 휘발유/경유 분배. 반올림은 차감 계산으로
    // 합계 = 통합값 일관성 보장.
    let fuelTypeBreakdown: IntegratedForecast["fuelTypeBreakdown"];
    const recentSales = salesRes.data.slice(-FUEL_RATIO_WINDOW_DAYS);
    let sumG = 0, sumD = 0, sumGC = 0, sumDC = 0;
    let sampleDays = 0;
    for (const s of recentSales) {
      const gv = Number(s.gasoline_volume) || 0;
      const dv = Number(s.diesel_volume) || 0;
      if (gv === 0 && dv === 0) continue;
      sumG += gv;
      sumD += dv;
      sumGC += Number(s.gasoline_count) || 0;
      sumDC += Number(s.diesel_count) || 0;
      sampleDays += 1;
    }

    const totalVolSum = sumG + sumD;
    const totalCntSum = sumGC + sumDC;
    if (sampleDays >= FUEL_RATIO_MIN_SAMPLES && totalVolSum > 0) {
      const gasolineRatio = sumG / totalVolSum;
      const dieselRatio = 1 - gasolineRatio;
      // 차감 계산: 휘발유 = round(total × ratio), 경유 = total - 휘발유
      const gasolineVolume = Math.round(expectedVolume * gasolineRatio);
      const dieselVolume = expectedVolume - gasolineVolume;
      // count는 별도 비율 (카운트 기준)이 더 정확하지만 명세상 동일 비율 유지.
      // 단, count 전용 비율이 totalCntSum>0 이면 더 정확하므로 count는 count 비율로.
      const gasolineCountRatio = totalCntSum > 0 ? sumGC / totalCntSum : gasolineRatio;
      const gasolineCount = Math.round(expectedCount * gasolineCountRatio);
      const dieselCount = expectedCount - gasolineCount;

      // graceful fallback 조건: 음수면 breakdown 숨김
      if (gasolineVolume >= 0 && dieselVolume >= 0 && gasolineCount >= 0 && dieselCount >= 0) {
        fuelTypeBreakdown = {
          gasolineVolume,
          gasolineCount,
          dieselVolume,
          dieselCount,
          gasolineRatio: +gasolineRatio.toFixed(4),
          dieselRatio: +dieselRatio.toFixed(4),
          sampleDays,
          windowDays: FUEL_RATIO_WINDOW_DAYS,
        };
      }
    }

    const forecast: IntegratedForecast = {
      date: todayDate,
      dow,
      dowLabel: DOW_NAMES[dow],
      expectedVolume,
      expectedCount,
      confidence,
      explanation,
      fuelTypeBreakdown,
      baseline: Math.round(baseline),
      baselineCount: Math.round(baselineCount),
      contributions,
      diffVsDryPct,
      weatherOnly: weatherOnlyExpected,
      modelVersion: "integrated-v1",
      totalDataDays: days.length,
    };

    // forecast_history에 통합 모델 예측값 저장 (fire-and-forget)
    supabase
      .from("forecast_history")
      .upsert(
        {
          station_id: id,
          forecast_date: todayDate,
          predicted_volume: expectedVolume,
          predicted_count: expectedCount,
          weather_intensity: intensity,
          day_of_week: dow,
          confidence,
        },
        { onConflict: "station_id,forecast_date", ignoreDuplicates: false }
      )
      .then(() => {});

    return { forecast, coefficients };
  } catch {
    return { forecast: null, coefficients };
  }
}

// ── 헬퍼 ──

function makeBadge(n: number, threshold: number): string {
  if (n === 0) return "데이터 없음";
  if (n < threshold) return `n=${n} (축적 중)`;
  return `n=${n} (신뢰)`;
}

function getLatestPrice(days: DayRecord[]): number | null {
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].myGasolinePrice != null) return days[i].myGasolinePrice;
  }
  return null;
}

function getYesterdayPrice(days: DayRecord[]): number | null {
  for (let i = days.length - 2; i >= 0; i--) {
    if (days[i].myGasolinePrice != null) return days[i].myGasolinePrice;
  }
  return null;
}

function getLatestCompGap(days: DayRecord[]): number | null {
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].compGap != null) return days[i].compGap;
  }
  return null;
}

function emptyResult(): IntegratedForecastResult {
  return {
    forecast: null,
    coefficients: {
      weatherResid: { dry: 0, light: 0, heavy: 0 },
      weatherResidCount: { dry: 0, light: 0, heavy: 0 },
      myPriceElasticity: null,
      compGapElasticity: null,
      interactions: { rainWeekend: null, rainCompDrop: null },
      dowMean: {},
      dowMeanCount: {},
      overallMean: 0,
    },
  };
}
