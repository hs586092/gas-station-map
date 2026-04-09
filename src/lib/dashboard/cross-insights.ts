import { supabase } from "@/lib/supabase";

function dowFromDateStr(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
const DOW_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const mean = (a: number[]) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;

export async function getCrossInsights(id: string, options?: { compact?: boolean }): Promise<any> {
  const compact = options?.compact ?? false;

  const [salesRes, cwRes, weatherRes, oilRes] = await Promise.all([
    supabase.from("sales_data")
      .select("date, gasoline_volume, diesel_volume, gasoline_count, diesel_count")
      .eq("station_id", id).order("date", { ascending: true }),
    supabase.from("carwash_daily")
      .select("date, total_count, breakdown")
      .eq("station_id", id).order("date", { ascending: true }),
    supabase.from("weather_daily")
      .select("date, precipitation_mm, temp_max, temp_min")
      .order("date", { ascending: true }),
    supabase.from("oil_prices")
      .select("date, brent").not("brent", "is", null)
      .order("date", { ascending: true }),
  ]);

  // ── Maps ──
  type SalesDay = { vol: number; cnt: number; dow: number };
  const salesMap = new Map<string, SalesDay>();
  for (const s of salesRes.data || []) {
    const vol = (Number(s.gasoline_volume) || 0) + (Number(s.diesel_volume) || 0);
    const cnt = (Number(s.gasoline_count) || 0) + (Number(s.diesel_count) || 0);
    if (vol > 0) salesMap.set(s.date, { vol, cnt, dow: dowFromDateStr(s.date) });
  }

  const cwMap = new Map<string, { count: number; breakdown: Record<string, number> }>();
  for (const c of cwRes.data || []) {
    cwMap.set(c.date, { count: c.total_count, breakdown: (c.breakdown || {}) as Record<string, number> });
  }

  type WeatherDay = { precip: number; tempAvg: number | null };
  const weatherMap = new Map<string, WeatherDay>();
  for (const w of weatherRes.data || []) {
    const tMax = w.temp_max != null ? Number(w.temp_max) : null;
    const tMin = w.temp_min != null ? Number(w.temp_min) : null;
    weatherMap.set(w.date, {
      precip: Number(w.precipitation_mm) || 0,
      tempAvg: tMax != null && tMin != null ? (tMax + tMin) / 2 : null,
    });
  }

  const oilMap = new Map<string, number>();
  for (const o of oilRes.data || []) oilMap.set(o.date, Number(o.brent));

  // 교집합 날짜 (sales + carwash + weather)
  const allDates = [...salesMap.keys()]
    .filter(d => cwMap.has(d) && weatherMap.has(d))
    .sort();

  // ════════════════════════════════════════
  // 분석 1: 날씨 × 세차 × 주유 3중 교차
  // ════════════════════════════════════════
  type IntensityKey = "dry" | "light" | "heavy";
  const getIntensity = (p: number): IntensityKey => p < 1 ? "dry" : p < 5 ? "light" : "heavy";

  // 당일 효과
  const sameDayBuckets: Record<IntensityKey, { fuel: number[]; cw: number[]; conv: number[] }> = {
    dry: { fuel: [], cw: [], conv: [] }, light: { fuel: [], cw: [], conv: [] }, heavy: { fuel: [], cw: [], conv: [] },
  };
  for (const d of allDates) {
    const s = salesMap.get(d)!;
    const c = cwMap.get(d)!;
    const w = weatherMap.get(d)!;
    const key = getIntensity(w.precip);
    sameDayBuckets[key].fuel.push(s.cnt);
    sameDayBuckets[key].cw.push(c.count);
    if (s.cnt > 0) sameDayBuckets[key].conv.push(c.count / s.cnt * 100);
  }

  const sameDay = (["dry", "light", "heavy"] as IntensityKey[]).map(k => ({
    intensity: k,
    label: k === "dry" ? "맑음" : k === "light" ? "약한비" : "강한비",
    fuelCount: Math.round(mean(sameDayBuckets[k].fuel)),
    carwashCount: Math.round(mean(sameDayBuckets[k].cw)),
    conversionPct: sameDayBuckets[k].conv.length ? +mean(sameDayBuckets[k].conv).toFixed(1) : null,
    n: sameDayBuckets[k].fuel.length,
  }));

  // lag-1 효과 (어제 날씨 → 오늘 주유/세차)
  const nextDayBuckets: Record<IntensityKey, { fuel: number[]; cw: number[]; conv: number[] }> = {
    dry: { fuel: [], cw: [], conv: [] }, light: { fuel: [], cw: [], conv: [] }, heavy: { fuel: [], cw: [], conv: [] },
  };
  for (let i = 0; i < allDates.length - 1; i++) {
    const yesterday = allDates[i];
    const today = allDates[i + 1];
    const w = weatherMap.get(yesterday)!;
    const s = salesMap.get(today)!;
    const c = cwMap.get(today)!;
    const key = getIntensity(w.precip);
    nextDayBuckets[key].fuel.push(s.cnt);
    nextDayBuckets[key].cw.push(c.count);
    if (s.cnt > 0) nextDayBuckets[key].conv.push(c.count / s.cnt * 100);
  }

  const nextDay = (["dry", "light", "heavy"] as IntensityKey[]).map(k => ({
    prevIntensity: k,
    label: k === "dry" ? "맑은 다음날" : k === "light" ? "약한비 다음날" : "강한비 다음날",
    fuelCount: Math.round(mean(nextDayBuckets[k].fuel)),
    carwashCount: Math.round(mean(nextDayBuckets[k].cw)),
    conversionPct: nextDayBuckets[k].conv.length ? +mean(nextDayBuckets[k].conv).toFixed(1) : null,
    n: nextDayBuckets[k].fuel.length,
  }));

  // 세차 드리븐 주유 판정: 비 다음날 전환율이 맑은 다음날보다 높으면 true
  const dryNextConv = nextDay.find(d => d.prevIntensity === "dry")?.conversionPct ?? 0;
  const heavyNextConv = nextDay.find(d => d.prevIntensity === "heavy")?.conversionPct ?? 0;
  const lightNextConv = nextDay.find(d => d.prevIntensity === "light")?.conversionPct ?? 0;
  const carwashDrivenFuel = (heavyNextConv > dryNextConv + 2) || (lightNextConv > dryNextConv + 2);

  // 기온대별 (10도 미만 vs 이상)
  const tempBuckets: Record<string, { cw: number[]; fuel: number[] }> = {
    cold: { cw: [], fuel: [] }, mild: { cw: [], fuel: [] },
  };
  for (const d of allDates) {
    const w = weatherMap.get(d)!;
    const s = salesMap.get(d)!;
    const c = cwMap.get(d)!;
    if (w.tempAvg == null) continue;
    const key = w.tempAvg < 10 ? "cold" : "mild";
    tempBuckets[key].cw.push(c.count);
    tempBuckets[key].fuel.push(s.cnt);
  }
  const tempBand = [
    { band: "cold", label: "<10°C", carwashAvg: Math.round(mean(tempBuckets.cold.cw)), fuelAvg: Math.round(mean(tempBuckets.cold.fuel)), n: tempBuckets.cold.cw.length },
    { band: "mild", label: "≥10°C", carwashAvg: Math.round(mean(tempBuckets.mild.cw)), fuelAvg: Math.round(mean(tempBuckets.mild.fuel)), n: tempBuckets.mild.cw.length },
  ];

  let weatherTripleInsight = "";
  if (carwashDrivenFuel) {
    const convDiff = Math.max(heavyNextConv, lightNextConv) - dryNextConv;
    weatherTripleInsight = `비 다음날 전환율 +${convDiff.toFixed(1)}%p → 세차 목적 방문이 주유를 견인`;
  } else {
    weatherTripleInsight = "세차와 주유는 독립적 — 비 다음날 전환율 변화 없음";
  }

  const weatherTriple = { sameDay, nextDay, tempBand, carwashDrivenFuel, insight: weatherTripleInsight };

  // ════════════════════════════════════════
  // 분석 2: 경쟁사 연쇄 (데이터 축적 중)
  // ════════════════════════════════════════
  const competitorCascade = {
    dataStatus: "accumulating" as const,
    daysCollected: 22,
    daysNeeded: 60,
    insight: "경쟁사 가격 데이터 축적 중 (22/60일) — 5월 중순부터 분석 가능",
  };

  // ════════════════════════════════════════
  // 분석 3: 요일 × 세차 프로파일
  // ════════════════════════════════════════
  const dowBuckets: Record<number, { premium: number[]; conv: number[]; fuelPerTxn: number[]; cwCount: number[]; fuelCount: number[] }> = {};
  for (let i = 0; i < 7; i++) dowBuckets[i] = { premium: [], conv: [], fuelPerTxn: [], cwCount: [], fuelCount: [] };

  for (const d of allDates) {
    const s = salesMap.get(d)!;
    const c = cwMap.get(d)!;
    const dow = s.dow;
    const bd = c.breakdown;

    // 프리미엄 비율
    let prem = 0;
    for (const [label, cnt] of Object.entries(bd)) {
      if (["7000원", "8000원", "9000원", "10000원"].includes(label)) prem += cnt;
    }
    const premPct = c.count > 0 ? (prem / c.count) * 100 : 0;
    dowBuckets[dow].premium.push(premPct);
    dowBuckets[dow].cwCount.push(c.count);
    dowBuckets[dow].fuelCount.push(s.cnt);
    if (s.cnt > 0) {
      dowBuckets[dow].conv.push(c.count / s.cnt * 100);
      dowBuckets[dow].fuelPerTxn.push(s.vol / s.cnt);
    }
  }

  const dowProfile = Object.entries(dowBuckets).map(([dow, b]) => ({
    dow: Number(dow),
    label: DOW_LABELS[Number(dow)],
    premiumPct: b.premium.length ? +mean(b.premium).toFixed(1) : 0,
    conversionPct: b.conv.length ? +mean(b.conv).toFixed(1) : 0,
    fuelPerTxn: b.fuelPerTxn.length ? +mean(b.fuelPerTxn).toFixed(1) : 0,
    avgCarwash: Math.round(mean(b.cwCount)),
    avgFuel: Math.round(mean(b.fuelCount)),
    n: b.premium.length,
  }));

  // ════════════════════════════════════════
  // 분석 4: 유사 사례 매칭
  // ════════════════════════════════════════
  const todayStr = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const todayDow = dowFromDateStr(todayStr);

  // 오늘 유가 방향
  const oilDates = [...oilMap.keys()].sort();
  let oilDirection: "rising" | "falling" | "flat" = "flat";
  if (oilDates.length >= 7) {
    const recent = oilMap.get(oilDates[oilDates.length - 1])!;
    const week = oilMap.get(oilDates[Math.max(0, oilDates.length - 6)])!;
    const diff = recent - week;
    oilDirection = diff > 2 ? "rising" : diff < -2 ? "falling" : "flat";
  }

  // 오늘 날씨
  const todayWeather = weatherMap.get(todayStr);
  const todayIntensity = todayWeather ? getIntensity(todayWeather.precip) : "dry";
  const todayTemp = todayWeather?.tempAvg;
  const todayTempBand = todayTemp != null ? (todayTemp < 10 ? "cold" : "mild") : null;

  // 유사 조건 매칭: 같은 요일 ± 날씨유사 ± 유가방향
  type SimilarDay = { date: string; fuelCount: number; carwashCount: number; conversionPct: number; matchScore: number; conditions: string };
  const candidates: SimilarDay[] = [];

  for (const d of allDates) {
    if (d === todayStr) continue;
    const s = salesMap.get(d)!;
    const c = cwMap.get(d)!;
    const w = weatherMap.get(d)!;

    let score = 0;
    const conds: string[] = [];

    // 요일 매칭
    if (s.dow === todayDow) { score += 3; conds.push(DOW_LABELS[s.dow]); }
    else if (Math.abs(s.dow - todayDow) <= 1 || Math.abs(s.dow - todayDow) === 6) { score += 1; conds.push(DOW_LABELS[s.dow]); }
    else continue; // 요일이 너무 다르면 제외

    // 날씨 매칭
    const intensity = getIntensity(w.precip);
    if (intensity === todayIntensity) { score += 2; }
    conds.push(intensity === "dry" ? "맑음" : intensity === "light" ? "약한비" : "강한비");

    // 기온 매칭
    if (w.tempAvg != null && todayTempBand) {
      const band = w.tempAvg < 10 ? "cold" : "mild";
      if (band === todayTempBand) score += 1;
    }

    // 유가 방향 매칭
    const dIdx = oilDates.indexOf(d);
    if (dIdx >= 5) {
      const dRecent = oilMap.get(oilDates[dIdx]) ?? oilMap.get(oilDates[dIdx - 1]);
      const dWeek = oilMap.get(oilDates[Math.max(0, dIdx - 5)]);
      if (dRecent != null && dWeek != null) {
        const dDiff = dRecent - dWeek;
        const dDir = dDiff > 2 ? "rising" : dDiff < -2 ? "falling" : "flat";
        if (dDir === oilDirection) { score += 2; conds.push(`유가${dDir === "rising" ? "↑" : dDir === "falling" ? "↓" : "→"}`); }
      }
    }

    if (score >= 4 && s.cnt > 0) {
      candidates.push({
        date: d,
        fuelCount: s.cnt,
        carwashCount: c.count,
        conversionPct: +(c.count / s.cnt * 100).toFixed(1),
        matchScore: score,
        conditions: conds.join(" · "),
      });
    }
  }

  candidates.sort((a, b) => b.matchScore - a.matchScore);
  const topMatches = candidates.slice(0, 7);

  const similarDays = {
    todayConditions: {
      dow: todayDow,
      dowLabel: DOW_LABELS[todayDow],
      oilDirection,
      weather: todayIntensity,
      tempBand: todayTempBand,
    },
    matches: topMatches,
    avgFuelCount: topMatches.length ? Math.round(mean(topMatches.map(m => m.fuelCount))) : null,
    avgCarwashCount: topMatches.length ? Math.round(mean(topMatches.map(m => m.carwashCount))) : null,
    avgConversionPct: topMatches.length ? +mean(topMatches.map(m => m.conversionPct)).toFixed(1) : null,
    confidence: topMatches.length >= 5 ? "high" : topMatches.length >= 3 ? "medium" : "low",
    insight: topMatches.length >= 3
      ? `유사 조건 ${topMatches.length}일 평균: 주유 ${Math.round(mean(topMatches.map(m => m.fuelCount)))}대, 세차 ${Math.round(mean(topMatches.map(m => m.carwashCount)))}대, 전환율 ${mean(topMatches.map(m => m.conversionPct)).toFixed(1)}%`
      : "유사 사례 부족 — 데이터 축적 필요",
  };

  // ════════════════════════════════════════
  // 응답
  // ════════════════════════════════════════
  if (compact) {
    return {
      weatherTriple: {
        carwashDrivenFuel: weatherTriple.carwashDrivenFuel,
        insight: weatherTriple.insight,
        heavySameDay: sameDay.find(d => d.intensity === "heavy"),
        heavyNextDay: nextDay.find(d => d.prevIntensity === "heavy"),
      },
      competitorCascade,
      dowHighlight: {
        bestConversionDay: [...dowProfile].sort((a, b) => b.conversionPct - a.conversionPct)[0],
        bestPremiumDay: [...dowProfile].sort((a, b) => b.premiumPct - a.premiumPct)[0],
      },
      similarDays: {
        count: topMatches.length,
        avgFuelCount: similarDays.avgFuelCount,
        avgCarwashCount: similarDays.avgCarwashCount,
        avgConversionPct: similarDays.avgConversionPct,
        confidence: similarDays.confidence,
        insight: similarDays.insight,
      },
    };
  }

  return {
    weatherTriple,
    competitorCascade,
    dowProfile,
    similarDays,
    dataRange: { from: allDates[0], to: allDates[allDates.length - 1], totalDays: allDates.length },
  };
}
