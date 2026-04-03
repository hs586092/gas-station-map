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

  // ── 6. 가장 먼저/늦게 반영한 경쟁사 (최근 18일 기준) ──
  const eighteenDaysAgo = new Date(Date.now() - 18 * 86400000).toISOString();
  const { data: fullHistory } = await supabase
    .from("price_history")
    .select("station_id, gasoline_price, collected_at")
    .in("station_id", competitors.map((c) => c.id))
    .gte("collected_at", eighteenDaysAgo)
    .not("gasoline_price", "is", null)
    .order("collected_at", { ascending: true });

  const compChangeMap = new Map<string, { firstChangeDate: string | null; changeCount: number }>();
  if (fullHistory) {
    const byStation = new Map<string, Array<{ price: number; date: string }>>();
    for (const r of fullHistory) {
      if (!byStation.has(r.station_id)) byStation.set(r.station_id, []);
      byStation.get(r.station_id)!.push({ price: r.gasoline_price!, date: r.collected_at.slice(0, 10) });
    }
    for (const [sid, rows] of byStation) {
      let firstChange: string | null = null;
      let count = 0;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i].price !== rows[i - 1].price) {
          count++;
          if (!firstChange) firstChange = rows[i].date;
        }
      }
      compChangeMap.set(sid, { firstChangeDate: firstChange, changeCount: count });
    }
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

  // ── 10. 종합 추천 생성 ──
  let recommendation = "";
  let recommendationType: "hold" | "raise" | "lower" | "watch" = "hold";

  if (oilDirection === "up" && competitorAction === "rising" && reflectionStatus === "not_reflected") {
    recommendation = "유가 상승 + 경쟁사 인상 추세입니다. 인상 검토 시점입니다.";
    recommendationType = "raise";
  } else if (oilDirection === "up" && competitorAction === "rising" && reflectionStatus === "reflected") {
    recommendation = "이미 유가 상승분을 반영했습니다. 현 가격 유지가 적절합니다.";
    recommendationType = "hold";
  } else if (oilDirection === "up" && competitorAction === "stable" && myPosition === "cheap") {
    recommendation = "유가 상승 중이나 경쟁사는 관망 중. 가격 유지로 경쟁력 확보 중입니다.";
    recommendationType = "watch";
  } else if (oilDirection === "up" && competitorAction === "stable") {
    recommendation = "유가 상승 중, 경쟁사 아직 미반영. 시장 동향 주시 후 대응 권장합니다.";
    recommendationType = "watch";
  } else if (oilDirection === "down" && competitorAction === "falling" && reflectionStatus === "not_reflected") {
    recommendation = "유가 하락 + 경쟁사 인하 시작. 선제 인하로 고객 확보 기회입니다.";
    recommendationType = "lower";
  } else if (oilDirection === "down" && competitorAction === "falling" && reflectionStatus === "reflected") {
    recommendation = "유가 하락분 이미 반영. 현 가격 유지가 적절합니다.";
    recommendationType = "hold";
  } else if (oilDirection === "down" && competitorAction === "stable" && myPosition === "expensive") {
    recommendation = "유가 하락 중, 가격이 높은 편입니다. 인하 검토를 권장합니다.";
    recommendationType = "lower";
  } else if (oilDirection === "down" && competitorAction === "stable" && myPosition === "cheap") {
    recommendation = "유가 하락 중이나 이미 저렴한 편. 현 가격 유지가 적절합니다.";
    recommendationType = "hold";
  } else if (oilDirection === "flat" && competitorAction === "rising" && myPosition === "cheap") {
    recommendation = "유가 보합 중 경쟁사 인상. 소폭 인상 여지가 있습니다.";
    recommendationType = "raise";
  } else if (oilDirection === "flat" && competitorAction === "stable") {
    recommendation = "유가 보합, 경쟁사 안정. 현 상태 유지를 권장합니다.";
    recommendationType = "hold";
  } else if (competitorAction === "mixed") {
    recommendation = "경쟁사 가격이 혼조세입니다. 시장 동향을 1~2일 더 관찰 후 대응 권장합니다.";
    recommendationType = "watch";
  } else {
    recommendation = "현 가격 유지를 권장합니다. 시장 상황에 큰 변화가 없습니다.";
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

  // ── 12. 적정가 인사이트 메시지 ──
  let benchmarkInsight = "";
  if (avgGas && base.gasoline_price) {
    const diff = base.gasoline_price - avgGas;
    if (diff <= -20) {
      if (competitorAction === "rising") {
        benchmarkInsight = `평균보다 ${Math.abs(diff)}원 저렴. 경쟁사 인상 추세를 감안하면 ${Math.min(Math.abs(diff), 30)}~${Math.min(Math.abs(diff) + 10, 50)}원 인상 여지 있음.`;
      } else {
        benchmarkInsight = `평균보다 ${Math.abs(diff)}원 저렴. 현 가격으로 경쟁력 유지 중.`;
      }
    } else if (diff >= 20) {
      if (competitorAction === "falling") {
        benchmarkInsight = `평균보다 ${diff}원 비싼 편. 경쟁사 인하 추세를 감안하면 인하 검토 필요.`;
      } else {
        benchmarkInsight = `평균보다 ${diff}원 비싼 편. 서비스 차별화로 가격 프리미엄 유지 가능.`;
      }
    } else {
      benchmarkInsight = `평균 수준 가격 유지 중. 안정적인 포지션.`;
    }
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
      // 유가→경쟁사→내 가격 스토리
      oilStory,
      // 적정가 인사이트
      benchmarkInsight,
      myPosition,
      // 종합 추천
      recommendation: {
        message: recommendation,
        type: recommendationType,
      },
    },
    { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=300" } }
  );
}
