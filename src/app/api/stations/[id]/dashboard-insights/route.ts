import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // ── 1. 기준 주유소 ──
  const { data: base, error: baseError } = await supabase
    .from("stations")
    .select("id, name, brand, lat, lng, gasoline_price, diesel_price")
    .eq("id", id)
    .single();

  if (baseError || !base || !base.lat || !base.lng) {
    return NextResponse.json({ error: "주유소를 찾을 수 없습니다." }, { status: 404 });
  }

  // ── 2. 경쟁사 목록 (5km) ──
  const RADIUS_KM = 5;
  const latD = RADIUS_KM / 111;
  const lngD = RADIUS_KM / 88;

  const { data: candidates } = await supabase
    .from("stations")
    .select("id, name, brand, lat, lng, gasoline_price, diesel_price")
    .gte("lat", base.lat - latD)
    .lte("lat", base.lat + latD)
    .gte("lng", base.lng - lngD)
    .lte("lng", base.lng + lngD)
    .neq("id", id);

  const competitors = (candidates || [])
    .map((s) => ({ ...s, distance_km: Math.round(haversineKm(base.lat, base.lng, s.lat, s.lng) * 100) / 100 }))
    .filter((s) => s.distance_km <= RADIUS_KM)
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, 30);

  const allIds = [id, ...competitors.map((c) => c.id)];

  // ── 3. price_history 최근 3일 (어제 순위 + 변동 감지) ──
  const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
  const { data: recentHistory } = await supabase
    .from("price_history")
    .select("station_id, gasoline_price, diesel_price, collected_at")
    .in("station_id", allIds)
    .gte("collected_at", threeDaysAgo)
    .order("collected_at", { ascending: false });

  // 날짜별로 분리
  type PH = { station_id: string; gasoline_price: number | null; diesel_price: number | null; collected_at: string };
  const byDate = new Map<string, PH[]>();
  for (const row of recentHistory || []) {
    const date = row.collected_at.slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(row);
  }
  const dates = [...byDate.keys()].sort().reverse(); // 최신순
  const todayDate = dates[0] || null;
  const yesterdayDate = dates[1] || null;

  // ── 4. 오늘/어제 순위 계산 ──
  function calcRank(dateRows: PH[] | undefined, stationId: string, fuel: "gasoline_price" | "diesel_price") {
    if (!dateRows) return null;
    const seen = new Map<string, number>();
    for (const r of dateRows) {
      const p = r[fuel];
      if (p != null && p > 0 && !seen.has(r.station_id)) seen.set(r.station_id, p);
    }
    const myPrice = seen.get(stationId);
    if (!myPrice) return null;
    const sorted = [...seen.values()].sort((a, b) => a - b);
    return { rank: sorted.indexOf(myPrice) + 1, total: sorted.length, price: myPrice };
  }

  const todayGasRank = calcRank(byDate.get(todayDate!), id, "gasoline_price");
  const yesterdayGasRank = calcRank(byDate.get(yesterdayDate!), id, "gasoline_price");
  const todayDieselRank = calcRank(byDate.get(todayDate!), id, "diesel_price");
  const yesterdayDieselRank = calcRank(byDate.get(yesterdayDate!), id, "diesel_price");

  // 순위 변동 원인 분석
  let rankChangeReason = "";
  let rankChangeCount = 0;
  if (todayGasRank && yesterdayGasRank) {
    const diff = todayGasRank.rank - yesterdayGasRank.rank;
    if (diff > 0) {
      // 순위 하락 → 경쟁사 중 가격 인하한 곳 수
      const todayRows = byDate.get(todayDate!) || [];
      const ydayRows = byDate.get(yesterdayDate!) || [];
      const ydayMap = new Map<string, number>();
      for (const r of ydayRows) {
        if (r.gasoline_price && !ydayMap.has(r.station_id)) ydayMap.set(r.station_id, r.gasoline_price);
      }
      let lowerCount = 0;
      const todaySeen = new Set<string>();
      for (const r of todayRows) {
        if (r.station_id === id || todaySeen.has(r.station_id)) continue;
        todaySeen.add(r.station_id);
        const ydayP = ydayMap.get(r.station_id);
        if (r.gasoline_price && ydayP && r.gasoline_price < ydayP) lowerCount++;
      }
      rankChangeCount = lowerCount;
      rankChangeReason = lowerCount > 0
        ? `경쟁사 ${lowerCount}곳이 인하해서 순위 하락`
        : `경쟁사 가격 변동으로 순위 변동`;
    } else if (diff < 0) {
      const todayRows = byDate.get(todayDate!) || [];
      const ydayRows = byDate.get(yesterdayDate!) || [];
      const ydayMap = new Map<string, number>();
      for (const r of ydayRows) {
        if (r.gasoline_price && !ydayMap.has(r.station_id)) ydayMap.set(r.station_id, r.gasoline_price);
      }
      let higherCount = 0;
      const todaySeen = new Set<string>();
      for (const r of todayRows) {
        if (r.station_id === id || todaySeen.has(r.station_id)) continue;
        todaySeen.add(r.station_id);
        const ydayP = ydayMap.get(r.station_id);
        if (r.gasoline_price && ydayP && r.gasoline_price > ydayP) higherCount++;
      }
      rankChangeCount = higherCount;
      rankChangeReason = higherCount > 0
        ? `경쟁사 ${higherCount}곳이 인상해서 순위 상승`
        : `경쟁사 가격 변동으로 순위 변동`;
    }
  }

  // ── 5. 경쟁사 행동 패턴 분석 ──
  let risingCount = 0;
  let fallingCount = 0;
  let stableCount = 0;
  const todayRows = byDate.get(todayDate!) || [];
  const ydayRows = byDate.get(yesterdayDate!) || [];
  const ydayPriceMap = new Map<string, { g: number | null; d: number | null }>();
  for (const r of ydayRows) {
    if (!ydayPriceMap.has(r.station_id)) {
      ydayPriceMap.set(r.station_id, { g: r.gasoline_price, d: r.diesel_price });
    }
  }
  const todaySeen = new Set<string>();
  for (const r of todayRows) {
    if (r.station_id === id || todaySeen.has(r.station_id)) continue;
    todaySeen.add(r.station_id);
    const yp = ydayPriceMap.get(r.station_id);
    if (!yp) { stableCount++; continue; }
    const gDiff = (r.gasoline_price && yp.g) ? r.gasoline_price - yp.g : 0;
    const dDiff = (r.diesel_price && yp.d) ? r.diesel_price - yp.d : 0;
    const maxDiff = Math.abs(gDiff) > Math.abs(dDiff) ? gDiff : dDiff;
    if (maxDiff > 0) risingCount++;
    else if (maxDiff < 0) fallingCount++;
    else stableCount++;
  }
  const totalComp = risingCount + fallingCount + stableCount;
  let competitorAction: "rising" | "falling" | "mixed" | "stable" = "stable";
  let competitorMessage = "경쟁사 가격 안정";
  if (totalComp > 0) {
    if (risingCount > 0 && fallingCount === 0) {
      competitorAction = "rising";
      competitorMessage = risingCount >= 3
        ? `경쟁사 ${risingCount}곳 일제히 인상 → 시장 전체 인상 추세`
        : `경쟁사 ${risingCount}곳 인상`;
    } else if (fallingCount > 0 && risingCount === 0) {
      competitorAction = "falling";
      competitorMessage = fallingCount >= 3
        ? `경쟁사 ${fallingCount}곳 일제히 인하 → 가격 인하 추세`
        : `경쟁사 ${fallingCount}곳 인하`;
    } else if (risingCount > 0 && fallingCount > 0) {
      competitorAction = "mixed";
      competitorMessage = `인상 ${risingCount}곳, 인하 ${fallingCount}곳 — 혼조세`;
    } else {
      competitorAction = "stable";
      competitorMessage = "오늘 경쟁사 가격 변동 없음";
    }
  }

  // ── 6. 7일 + 18일 가격 변동 이력 분석 ──
  const eighteenDaysAgo = new Date(Date.now() - 18 * 86400000).toISOString();
  const { data: fullHistory } = await supabase
    .from("price_history")
    .select("station_id, gasoline_price, collected_at")
    .in("station_id", competitors.map((c) => c.id))
    .gte("collected_at", eighteenDaysAgo)
    .not("gasoline_price", "is", null)
    .order("collected_at", { ascending: true });

  const compChangeMap = new Map<string, { firstChangeDate: string | null; changeCount: number }>();
  // 7일 추세용 데이터
  const sevenDaysAgoStr = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  let weekRisingCount = 0;
  let weekFallingCount = 0;
  let weekStableCount = 0;

  if (fullHistory) {
    const byStation = new Map<string, Array<{ price: number; date: string }>>();
    for (const r of fullHistory) {
      if (!byStation.has(r.station_id)) byStation.set(r.station_id, []);
      byStation.get(r.station_id)!.push({ price: r.gasoline_price!, date: r.collected_at.slice(0, 10) });
    }
    for (const [sid, rows] of byStation) {
      let firstChange: string | null = null;
      let count = 0;
      // 7일 내 변동 집계
      let weekUp = 0, weekDown = 0;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i].price !== rows[i - 1].price) {
          count++;
          if (!firstChange) firstChange = rows[i].date;
          if (rows[i].date >= sevenDaysAgoStr) {
            if (rows[i].price > rows[i - 1].price) weekUp++;
            else weekDown++;
          }
        }
      }
      compChangeMap.set(sid, { firstChangeDate: firstChange, changeCount: count });
      if (weekUp > weekDown) weekRisingCount++;
      else if (weekDown > weekUp) weekFallingCount++;
      else if (weekUp === 0 && weekDown === 0) weekStableCount++;
      else weekStableCount++; // equal up/down = net stable
    }
  }

  // 7일 추세 메시지
  let weeklyTrendMessage = "";
  let weeklyTrendAction: "rising" | "falling" | "mixed" | "stable" = "stable";
  const weekChanged = weekRisingCount + weekFallingCount;
  if (weekChanged === 0) {
    weeklyTrendAction = "stable";
    weeklyTrendMessage = "이번 주 경쟁사 가격 변동 없음. 시장 안정.";
  } else if (weekRisingCount > 0 && weekFallingCount === 0) {
    weeklyTrendAction = "rising";
    weeklyTrendMessage = `이번 주 경쟁사 ${weekRisingCount}곳 인상 (인하 0건) → 시장 전체 인상 흐름`;
  } else if (weekFallingCount > 0 && weekRisingCount === 0) {
    weeklyTrendAction = "falling";
    weeklyTrendMessage = `이번 주 경쟁사 ${weekFallingCount}곳 인하 (인상 0건) → 인하 압력`;
  } else {
    weeklyTrendAction = "mixed";
    weeklyTrendMessage = `이번 주 인상 ${weekRisingCount}곳, 인하 ${weekFallingCount}곳 — 방향성 탐색 중`;
  }

  // 가장 많이 변경한 경쟁사 = "빠르게 반응하는 경쟁사"
  let fastestResponder: { name: string; changeCount: number } | null = null;
  let slowestResponder: { name: string; changeCount: number } | null = null;
  for (const comp of competitors) {
    const info = compChangeMap.get(comp.id);
    if (!info) continue;
    if (!fastestResponder || info.changeCount > fastestResponder.changeCount) {
      fastestResponder = { name: comp.name, changeCount: info.changeCount };
    }
    if (!slowestResponder || (info.changeCount < slowestResponder.changeCount && info.changeCount > 0)) {
      slowestResponder = { name: comp.name, changeCount: info.changeCount };
    }
  }

  // ── 7. 국제유가 1주 추세 ──
  const { data: recentOil } = await supabase
    .from("oil_prices")
    .select("date, brent, wti")
    .not("brent", "is", null)
    .order("date", { ascending: false })
    .limit(10);

  let oilWeekTrend: "rising" | "falling" | "flat" = "flat";
  let oilWeekMessage = "";
  let brentWeekChange = 0;
  if (recentOil && recentOil.length >= 5) {
    const latest = recentOil[0].brent;
    const weekAgo = recentOil[Math.min(4, recentOil.length - 1)].brent;
    if (latest && weekAgo) {
      brentWeekChange = +(latest - weekAgo).toFixed(2);
      if (brentWeekChange >= 1) {
        oilWeekTrend = "rising";
        oilWeekMessage = `최근 1주 Brent +$${brentWeekChange.toFixed(1)} 상승세 → 2주 후 소매가 인상 압력 예상`;
      } else if (brentWeekChange <= -1) {
        oilWeekTrend = "falling";
        oilWeekMessage = `최근 1주 Brent $${Math.abs(brentWeekChange).toFixed(1)} 하락세 → 2주 후 소매가 인하 압력 예상`;
      } else {
        oilWeekTrend = "flat";
        oilWeekMessage = "최근 1주 유가 보합세 → 소매가 큰 변동 없을 전망";
      }
    }
  }

  // ── 8. 유가 반영 상태 (기존 로직 재활용) ──
  const { data: oilRecent } = await supabase
    .from("oil_prices").select("date, brent").not("brent", "is", null)
    .order("date", { ascending: false }).limit(1);

  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 16);
  const twelveAgo = new Date();
  twelveAgo.setDate(twelveAgo.getDate() - 12);

  const { data: oilOld } = await supabase
    .from("oil_prices").select("date, brent").not("brent", "is", null)
    .gte("date", fourteenDaysAgo.toISOString().split("T")[0])
    .lte("date", twelveAgo.toISOString().split("T")[0])
    .order("date", { ascending: false }).limit(1);

  let oilDirection: "up" | "down" | "flat" = "flat";
  let brent2wChange = 0;
  let myPriceChange: number | null = null;
  let reflectionStatus = "flat";

  if (oilRecent?.[0]?.brent && oilOld?.[0]?.brent) {
    brent2wChange = +(oilRecent[0].brent - oilOld[0].brent).toFixed(2);
    if (brent2wChange >= 2) oilDirection = "up";
    else if (brent2wChange <= -2) oilDirection = "down";

    const histCutoff = new Date();
    histCutoff.setDate(histCutoff.getDate() - 16);
    const { data: myHist } = await supabase
      .from("price_history")
      .select("gasoline_price, collected_at")
      .eq("station_id", id)
      .gte("collected_at", histCutoff.toISOString())
      .not("gasoline_price", "is", null)
      .order("collected_at", { ascending: true });

    if (myHist && myHist.length >= 2) {
      const oldest = myHist[0].gasoline_price;
      const newest = myHist[myHist.length - 1].gasoline_price;
      if (oldest && newest) myPriceChange = newest - oldest;
    }

    if (oilDirection === "up") {
      reflectionStatus = (myPriceChange !== null && myPriceChange >= 10) ? "reflected" : "not_reflected";
    } else if (oilDirection === "down") {
      reflectionStatus = (myPriceChange !== null && myPriceChange <= -10) ? "reflected" : "not_reflected";
    } else {
      reflectionStatus = "flat";
    }
  }

  // ── 8.5. 유가→소매가 반영 비율 (과거 90일 기반) ──
  let oilToRetailRatio: { avgWonPerDollar: number; minWon: number; maxWon: number; sampleCount: number } | null = null;
  {
    const ninetyAgo = new Date(Date.now() - 90 * 86400000).toISOString().split("T")[0];
    const { data: oilHist90 } = await supabase
      .from("oil_prices").select("date, brent").not("brent", "is", null)
      .gte("date", ninetyAgo).order("date", { ascending: true });
    const { data: myHist90 } = await supabase
      .from("price_history").select("gasoline_price, collected_at")
      .eq("station_id", id).not("gasoline_price", "is", null)
      .gte("collected_at", ninetyAgo).order("collected_at", { ascending: true });

    if (oilHist90 && oilHist90.length >= 14 && myHist90 && myHist90.length >= 14) {
      // 2주 윈도우로 슬라이딩하며 유가 변동 → 소매가 변동 비율 수집
      const oilByDate = new Map<string, number>();
      for (const o of oilHist90) oilByDate.set(o.date, o.brent);
      const retailByDate = new Map<string, number>();
      for (const r of myHist90) {
        const d = r.collected_at.slice(0, 10);
        retailByDate.set(d, r.gasoline_price);
      }

      const ratios: number[] = [];
      const oilDates = oilHist90.map(o => o.date);
      for (let i = 14; i < oilDates.length; i++) {
        const dateNow = oilDates[i];
        const date2wAgo = oilDates[i - 14];
        const brentNow = oilByDate.get(dateNow);
        const brent2w = oilByDate.get(date2wAgo);
        const retailNow = retailByDate.get(dateNow);
        const retail2w = retailByDate.get(date2wAgo);
        if (brentNow && brent2w && retailNow && retail2w) {
          const oilDelta = brentNow - brent2w;
          if (Math.abs(oilDelta) >= 1) { // 최소 $1 변동 시만 유효
            const retailDelta = retailNow - retail2w;
            ratios.push(retailDelta / oilDelta);
          }
        }
      }
      if (ratios.length >= 3) {
        const avg = Math.round(ratios.reduce((a, b) => a + b, 0) / ratios.length);
        const sorted = [...ratios].sort((a, b) => a - b);
        const p25 = Math.round(sorted[Math.floor(sorted.length * 0.25)]);
        const p75 = Math.round(sorted[Math.floor(sorted.length * 0.75)]);
        oilToRetailRatio = { avgWonPerDollar: avg, minWon: p25, maxWon: p75, sampleCount: ratios.length };
      }
    }
  }

  // ── 9. 내 포지션 판단 ──
  const allGasPrices = [base.gasoline_price, ...competitors.map((c) => c.gasoline_price)]
    .filter((p): p is number => p != null && p > 0);
  const avgGas = allGasPrices.length > 0
    ? Math.round(allGasPrices.reduce((a, b) => a + b, 0) / allGasPrices.length)
    : null;
  let myPosition: "cheap" | "average" | "expensive" = "average";
  if (base.gasoline_price && avgGas) {
    const diff = base.gasoline_price - avgGas;
    if (diff <= -20) myPosition = "cheap";
    else if (diff >= 20) myPosition = "expensive";
  }

  // ── 10. 종합 추천 생성 (구체적 금액 포함) ──
  let recommendation = "";
  let recommendationType: "hold" | "raise" | "lower" | "watch" = "hold";
  let suggestedRange: { min: number; max: number } | null = null;

  // 금액 범위 계산 보조
  const priceDiffFromAvg = (base.gasoline_price && avgGas) ? base.gasoline_price - avgGas : 0;
  const absAvgDiff = Math.abs(priceDiffFromAvg);

  if (oilDirection === "up" && competitorAction === "rising" && reflectionStatus === "not_reflected") {
    const lo = Math.max(10, Math.round(absAvgDiff * 0.5));
    const hi = Math.max(lo + 10, Math.round(absAvgDiff * 0.8));
    suggestedRange = { min: lo, max: hi };
    recommendation = `유가 상승 + 경쟁사 ${risingCount}곳 인상. ${lo}~${hi}원 인상 검토 시점입니다 (경쟁사 평균 ${avgGas?.toLocaleString()}원).`;
    recommendationType = "raise";
  } else if (oilDirection === "up" && competitorAction === "rising" && reflectionStatus === "reflected") {
    recommendation = `이미 유가 상승분 +${myPriceChange}원 반영 완료. 현 가격 유지가 적절합니다.`;
    recommendationType = "hold";
  } else if (oilDirection === "up" && (competitorAction === "mixed" || competitorAction === "stable") && myPosition === "cheap") {
    suggestedRange = { min: 10, max: Math.min(absAvgDiff, 30) };
    recommendation = `유가 상승 중, 평균보다 ${absAvgDiff}원 저렴. 10~${Math.min(absAvgDiff, 30)}원 소폭 인상 여지 있음.`;
    recommendationType = "watch";
  } else if (oilDirection === "up" && competitorAction === "stable") {
    recommendation = `유가 상승 중이나 경쟁사 관망. 이번 주 추세(인상 ${weekRisingCount}건)를 감안하면 시장 동향 주시 권장.`;
    recommendationType = "watch";
  } else if (oilDirection === "down" && competitorAction === "falling" && reflectionStatus === "not_reflected") {
    const lo = 10;
    const hi = Math.max(20, Math.round(absAvgDiff * 0.5));
    suggestedRange = { min: lo, max: hi };
    recommendation = `유가 하락 + 경쟁사 ${fallingCount}곳 인하 시작. ${lo}~${hi}원 선제 인하로 고객 확보 기회.`;
    recommendationType = "lower";
  } else if (oilDirection === "down" && competitorAction === "falling" && reflectionStatus === "reflected") {
    recommendation = `유가 하락분 이미 반영. 현 가격 유지가 적절합니다.`;
    recommendationType = "hold";
  } else if (oilDirection === "down" && competitorAction === "stable" && myPosition === "expensive") {
    suggestedRange = { min: 10, max: Math.min(absAvgDiff, 40) };
    recommendation = `유가 하락 중, 평균보다 ${absAvgDiff}원 비쌈. ${suggestedRange.min}~${suggestedRange.max}원 인하 검토 권장.`;
    recommendationType = "lower";
  } else if (oilDirection === "down" && competitorAction === "stable" && myPosition === "cheap") {
    recommendation = `유가 하락 중이나 이미 저렴한 편. 현 가격 유지가 적절합니다.`;
    recommendationType = "hold";
  } else if (oilDirection === "flat" && competitorAction === "rising") {
    if (myPosition === "cheap" || myPosition === "average") {
      suggestedRange = { min: 10, max: Math.min(30, absAvgDiff + 20) };
      recommendation = `유가 보합이나 경쟁사 ${risingCount}곳 인상. ${suggestedRange.min}~${suggestedRange.max}원 인상 여지 (평균 ${avgGas?.toLocaleString()}원).`;
      recommendationType = "raise";
    } else {
      recommendation = `유가 보합, 경쟁사 인상 중. 이미 평균 이상이므로 현 가격 유지 적절.`;
      recommendationType = "hold";
    }
  } else if (oilDirection === "flat" && competitorAction === "stable") {
    recommendation = `유가 보합, 경쟁사 안정. 현 상태 유지 권장.`;
    recommendationType = "hold";
  } else if (competitorAction === "mixed") {
    // 혼조세이지만 7일 추세로 방향성 판단
    if (weeklyTrendAction === "rising" && risingCount > fallingCount) {
      if (myPosition === "cheap" || myPosition === "average") {
        suggestedRange = { min: 10, max: Math.min(30, absAvgDiff + 20) };
        recommendation = `오늘 혼조세이나 이번 주 ${weekRisingCount}곳 인상 → 시장 인상 흐름. ${suggestedRange.min}~${suggestedRange.max}원 인상 검토 가능 (평균 ${avgGas?.toLocaleString()}원).`;
        recommendationType = "raise";
      } else {
        recommendation = `오늘 혼조세이나 이번 주 인상 흐름. 이미 평균 이상이므로 현 가격 유지 적절.`;
        recommendationType = "hold";
      }
    } else if (weeklyTrendAction === "falling" && fallingCount > risingCount) {
      suggestedRange = { min: 10, max: 20 };
      recommendation = `오늘 혼조세이나 이번 주 ${weekFallingCount}곳 인하 → 인하 추세. ${suggestedRange.min}~${suggestedRange.max}원 인하 검토 가능.`;
      recommendationType = "lower";
    } else {
      const majorDir = risingCount > fallingCount ? "인상" : "인하";
      const majorCount = Math.max(risingCount, fallingCount);
      recommendation = `경쟁사 혼조세(인상 ${risingCount}, 인하 ${fallingCount}). ${majorDir} ${majorCount}곳이 우세 — 1~2일 추이 확인 후 대응 권장.`;
      recommendationType = "watch";
    }
  } else {
    recommendation = `시장 큰 변화 없음. 현 가격 유지 권장.`;
    recommendationType = "hold";
  }

  // ── 11. 유가→경쟁사→내 가격 스토리 ──
  let oilStory = "";
  const absChange = Math.abs(brent2wChange).toFixed(1);
  if (oilDirection === "up") {
    oilStory = `2주 전 Brent +$${absChange}`;
    if (risingCount > 0) oilStory += ` → 이번 주 경쟁사 ${risingCount}곳 반영 시작`;
    if (reflectionStatus === "reflected" && myPriceChange !== null) {
      oilStory += ` → 당신은 이미 +${myPriceChange}원 반영 완료. 추가 인상 불필요.`;
    } else if (reflectionStatus === "not_reflected") {
      oilStory += ` → 당신은 아직 미반영. 인상 검토 시점.`;
    }
  } else if (oilDirection === "down") {
    oilStory = `2주 전 Brent -$${absChange}`;
    if (fallingCount > 0) oilStory += ` → 이번 주 경쟁사 ${fallingCount}곳 인하 시작`;
    if (reflectionStatus === "reflected" && myPriceChange !== null) {
      oilStory += ` → 당신은 이미 ${myPriceChange}원 반영 완료.`;
    } else if (reflectionStatus === "not_reflected") {
      oilStory += ` → 당신은 아직 미반영. 인하 검토 필요.`;
    }
  } else {
    oilStory = "최근 2주 유가 변동 적음. 소매가 큰 변동 없을 전망.";
  }

  // ── 12. 적정가 인사이트 (경쟁사 동향 교차 분석) ──
  let benchmarkInsight = "";
  if (avgGas && base.gasoline_price) {
    const diff = base.gasoline_price - avgGas;
    const absDiff = Math.abs(diff);

    if (diff <= -20) {
      // 저렴한 편
      if (competitorAction === "rising" || weeklyTrendAction === "rising") {
        benchmarkInsight = `평균보다 ${absDiff}원 저렴한데, 경쟁사가 인상 중이므로 현재 가격이 상대적으로 더 저렴해지는 중. ${Math.min(absDiff, 30)}~${Math.min(absDiff + 10, 50)}원 인상 여지.`;
      } else if (competitorAction === "falling") {
        benchmarkInsight = `평균보다 ${absDiff}원 저렴. 경쟁사도 인하 중이라 가격 우위가 줄어들 수 있음. 현 가격 유지로 차별화 권장.`;
      } else {
        benchmarkInsight = `평균보다 ${absDiff}원 저렴. 가격 경쟁력 확보 중.`;
      }
    } else if (diff >= 20) {
      // 비싼 편
      if (competitorAction === "rising") {
        benchmarkInsight = `평균보다 ${diff}원 비싸지만, 경쟁사도 인상 중이라 격차 줄어드는 중. 현 가격 유지 가능.`;
      } else if (competitorAction === "falling" || weeklyTrendAction === "falling") {
        benchmarkInsight = `평균보다 ${diff}원 비싼데, 경쟁사 인하 추세로 격차 더 벌어지는 중. ${Math.min(diff, 30)}~${Math.min(diff + 10, 50)}원 인하 검토 필요.`;
      } else {
        benchmarkInsight = `평균보다 ${diff}원 비싼 편. 시장 안정기이므로 서비스 차별화로 프리미엄 유지 가능.`;
      }
    } else {
      // 평균 수준
      if (competitorAction === "rising" || weeklyTrendAction === "rising") {
        const weekNote = weeklyTrendAction === "rising" ? ` (이번 주 ${weekRisingCount}곳 인상)` : "";
        benchmarkInsight = `평균 수준이지만, 경쟁사 인상으로 현재 가격이 상대적으로 저렴해지는 중${weekNote}. 소폭 인상 여지 있음.`;
      } else if (competitorAction === "falling" || weeklyTrendAction === "falling") {
        const weekNote = weeklyTrendAction === "falling" ? ` (이번 주 ${weekFallingCount}곳 인하)` : "";
        benchmarkInsight = `평균 수준이지만, 경쟁사 인하로 현재 가격이 상대적으로 비싸지는 중${weekNote}. 인하 압력 감안 필요.`;
      } else {
        benchmarkInsight = `평균 수준 유지 중. 시장 안정기 — 가격 포지션 양호.`;
      }
    }
  }

  // ── 13. 경쟁사 프로파일링 (18일 price_history 기반) ──
  type CompProfile = {
    id: string; name: string; brand: string; distance_km: number;
    type: "leader" | "follower" | "steady" | "unknown";
    typeLabel: string;
    changeCount: number;
    avgChangeSize: number;
    currentPrice: number | null;
  };

  const competitorProfiles: CompProfile[] = [];
  if (fullHistory) {
    const byStation = new Map<string, Array<{ price: number; date: string }>>();
    for (const r of fullHistory) {
      if (!byStation.has(r.station_id)) byStation.set(r.station_id, []);
      const arr = byStation.get(r.station_id)!;
      if (arr.length === 0 || arr[arr.length - 1].date !== r.collected_at.slice(0, 10)) {
        arr.push({ price: r.gasoline_price!, date: r.collected_at.slice(0, 10) });
      }
    }

    for (const comp of competitors) {
      const rows = byStation.get(comp.id);
      if (!rows || rows.length < 3) {
        competitorProfiles.push({
          id: comp.id, name: comp.name, brand: comp.brand, distance_km: comp.distance_km,
          type: "unknown", typeLabel: "데이터 부족", changeCount: 0, avgChangeSize: 0,
          currentPrice: comp.gasoline_price,
        });
        continue;
      }

      let changes = 0;
      let totalChangeSize = 0;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i].price !== rows[i - 1].price) {
          changes++;
          totalChangeSize += Math.abs(rows[i].price - rows[i - 1].price);
        }
      }
      const avgSize = changes > 0 ? Math.round(totalChangeSize / changes) : 0;

      let type: CompProfile["type"] = "steady";
      let typeLabel = "안정형 — 가격 변동 적음";
      if (changes >= 5) {
        type = "leader";
        typeLabel = "선제 반응형 — 시장 변화에 빠르게 대응";
      } else if (changes >= 3) {
        type = "follower";
        typeLabel = "추종형 — 주변 변화 후 따라감";
      }

      competitorProfiles.push({
        id: comp.id, name: comp.name, brand: comp.brand, distance_km: comp.distance_km,
        type, typeLabel, changeCount: changes, avgChangeSize: avgSize,
        currentPrice: comp.gasoline_price,
      });
    }
  }

  // ── 14. 상관관계 기반 인사이트 (correlation API 로직 내장) ──
  // 내 가격 히스토리 delta
  const myFullHistory = fullHistory
    ? fullHistory.filter((r) => false) // fullHistory는 경쟁사만이므로 별도 조회
    : [];

  const { data: myHistFull } = await supabase
    .from("price_history")
    .select("gasoline_price, collected_at")
    .eq("station_id", id)
    .gte("collected_at", eighteenDaysAgo)
    .not("gasoline_price", "is", null)
    .order("collected_at", { ascending: true });

  type DayPrice = { date: string; price: number };
  const myDailyPrices: DayPrice[] = [];
  if (myHistFull) {
    for (const r of myHistFull) {
      const date = r.collected_at.slice(0, 10);
      if (myDailyPrices.length === 0 || myDailyPrices[myDailyPrices.length - 1].date !== date) {
        myDailyPrices.push({ date, price: r.gasoline_price! });
      }
    }
  }

  // delta 계산
  const myDeltas = new Map<string, number>();
  for (let i = 1; i < myDailyPrices.length; i++) {
    myDeltas.set(myDailyPrices[i].date, myDailyPrices[i].price - myDailyPrices[i - 1].price);
  }

  // 경쟁사별 상관계수 (상위 5개만)
  type CorrInsight = {
    id: string; name: string; brand: string; correlation: number;
    label: string; insight: string;
  };
  const correlationInsights: CorrInsight[] = [];

  if (fullHistory && myDeltas.size >= 3) {
    const byStation = new Map<string, DayPrice[]>();
    for (const r of fullHistory) {
      if (!byStation.has(r.station_id)) byStation.set(r.station_id, []);
      const arr = byStation.get(r.station_id)!;
      const date = r.collected_at.slice(0, 10);
      if (arr.length === 0 || arr[arr.length - 1].date !== date) {
        arr.push({ date, price: r.gasoline_price! });
      }
    }

    for (const comp of competitors.slice(0, 15)) {
      const compPrices = byStation.get(comp.id);
      if (!compPrices || compPrices.length < 3) continue;

      const compDeltas = new Map<string, number>();
      for (let i = 1; i < compPrices.length; i++) {
        compDeltas.set(compPrices[i].date, compPrices[i].price - compPrices[i - 1].price);
      }

      // 공통 날짜 delta
      const commonDates: string[] = [];
      for (const d of myDeltas.keys()) {
        if (compDeltas.has(d)) commonDates.push(d);
      }
      if (commonDates.length < 3) continue;

      const xs = commonDates.map((d) => myDeltas.get(d)!);
      const ys = commonDates.map((d) => compDeltas.get(d)!);

      // Pearson
      const n = xs.length;
      const sumX = xs.reduce((a, b) => a + b, 0);
      const sumY = ys.reduce((a, b) => a + b, 0);
      const sumXY = xs.reduce((a, b, i) => a + b * ys[i], 0);
      const sumX2 = xs.reduce((a, b) => a + b * b, 0);
      const sumY2 = ys.reduce((a, b) => a + b * b, 0);
      const denom = Math.sqrt((n * sumX2 - sumX ** 2) * (n * sumY2 - sumY ** 2));
      if (denom === 0) continue;
      const r = Math.round(((n * sumXY - sumX * sumY) / denom) * 100) / 100;

      let label = "";
      let insight = "";
      if (r >= 0.7) {
        label = "높은 연동";
        insight = "당신이 가격을 바꾸면 함께 움직이는 경향. 인상 시 따라올 가능성 높음.";
      } else if (r >= 0.3) {
        label = "보통 연동";
        insight = "부분적으로 연동. 가격 변경 시 일부 반응할 수 있음.";
      } else if (r >= -0.3) {
        label = "독립적";
        insight = "독자적 가격 정책. 당신의 가격 변경에 영향받지 않는 편.";
      } else {
        label = "역방향";
        insight = "당신과 반대로 움직이는 경향. 당신이 올리면 내릴 수 있음.";
      }

      correlationInsights.push({ id: comp.id, name: comp.name, brand: comp.brand, correlation: r, label, insight });
    }

    correlationInsights.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
  }

  return NextResponse.json(
    {
      // 순위 변동
      rankChange: {
        gasoline: {
          today: todayGasRank,
          yesterday: yesterdayGasRank,
          diff: todayGasRank && yesterdayGasRank ? todayGasRank.rank - yesterdayGasRank.rank : null,
        },
        diesel: {
          today: todayDieselRank,
          yesterday: yesterdayDieselRank,
          diff: todayDieselRank && yesterdayDieselRank ? todayDieselRank.rank - yesterdayDieselRank.rank : null,
        },
        reason: rankChangeReason,
        causeCount: rankChangeCount,
      },
      // 경쟁사 행동 패턴
      competitorPattern: {
        action: competitorAction,
        message: competitorMessage,
        risingCount,
        fallingCount,
        stableCount,
        fastestResponder,
        slowestResponder,
      },
      // 유가 1주 추세
      oilWeekTrend: {
        trend: oilWeekTrend,
        message: oilWeekMessage,
        brentWeekChange,
      },
      // 7일 추세
      weeklyTrend: {
        action: weeklyTrendAction,
        message: weeklyTrendMessage,
        risingCount: weekRisingCount,
        fallingCount: weekFallingCount,
        stableCount: weekStableCount,
      },
      // 유가→경쟁사→내 가격 스토리
      oilStory,
      // 적정가 인사이트
      benchmarkInsight,
      myPosition,
      avgPrice: avgGas,
      // 경쟁사 프로파일링
      competitorProfiles: competitorProfiles
        .filter((p) => p.type !== "unknown")
        .sort((a, b) => b.changeCount - a.changeCount)
        .slice(0, 8),
      // 상관관계 인사이트
      correlationInsights: correlationInsights.slice(0, 5),
      // 종합 추천
      recommendation: {
        message: recommendation,
        type: recommendationType,
        suggestedRange,
      },
      // 유가→소매가 반영 비율
      oilToRetailRatio,
      // 브리핑 상세용 raw 데이터
      briefingFactors: {
        oil: {
          latestBrent: recentOil?.[0]?.brent ?? null,
          latestWti: recentOil?.[0]?.wti ?? null,
          brent2wChange,
          oilDirection,
          reflectionStatus,
          myPriceChange,
        },
        position: {
          myPrice: base.gasoline_price,
          avgPrice: avgGas,
          priceDiff: priceDiffFromAvg,
        },
      },
    },
    { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=300" } }
  );
}
