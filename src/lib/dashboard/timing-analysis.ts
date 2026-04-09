import { supabase } from "@/lib/supabase";

const KEY_COMP_KEYWORDS = ["덕풍주유소", "풍산주유소", "만남의광장주유소", "베스트원주유소"];
const OIL_EVENT_THRESHOLD = 2; // ±$2 이상이면 유가 이벤트
const REACTION_WINDOW_DAYS = 14; // 유가 이벤트 후 14일 내 반응 탐색
const MIN_PRICE_CHANGE = 5; // ±5원 이상이면 가격 변경

export async function getTimingAnalysis(id: string): Promise<any> {
  // ── 1. 유가 데이터 ──
  const { data: oilRaw } = await supabase
    .from("oil_prices")
    .select("date, brent")
    .not("brent", "is", null)
    .order("date", { ascending: true });

  if (!oilRaw || oilRaw.length < 7) {
    return null;
  }

  // ── 2. 유가 이벤트 감지 (주간 변동 ±$2) ──
  interface OilEvent {
    date: string;
    direction: "up" | "down";
    brentChange: number;
    brentPrice: number;
  }

  const oilEvents: OilEvent[] = [];
  for (let i = 5; i < oilRaw.length; i++) {
    const current = oilRaw[i].brent;
    const weekAgo = oilRaw[Math.max(0, i - 5)].brent;
    if (!current || !weekAgo) continue;

    const change = +(current - weekAgo).toFixed(2);
    if (Math.abs(change) >= OIL_EVENT_THRESHOLD) {
      // 같은 방향 이벤트가 연속이면 첫 번째만 (7일 내 중복 방지)
      const lastEvent = oilEvents[oilEvents.length - 1];
      if (lastEvent) {
        const daysDiff = (new Date(oilRaw[i].date).getTime() - new Date(lastEvent.date).getTime()) / 86400000;
        if (daysDiff < 7 && (change > 0) === (lastEvent.brentChange > 0)) continue;
      }
      oilEvents.push({
        date: oilRaw[i].date,
        direction: change > 0 ? "up" : "down",
        brentChange: change,
        brentPrice: current,
      });
    }
  }

  // ── 3. 주요 경쟁사 매칭 ──
  const { data: keyCompStations } = await supabase
    .from("stations")
    .select("id, name")
    .or(KEY_COMP_KEYWORDS.map((kw) => `name.ilike.%${kw}%`).join(","));

  const filteredKeyComp: Array<{ id: string; name: string }> = [];
  if (keyCompStations) {
    for (const kw of KEY_COMP_KEYWORDS) {
      const candidates = keyCompStations.filter((s) => s.name.includes(kw));
      if (candidates.length > 0) {
        const exact = candidates.find((s) => s.name === kw);
        filteredKeyComp.push(exact || candidates.sort((a, b) => a.name.length - b.name.length)[0]);
      }
    }
  }

  // ── 4. price_history (내 주유소 + 경쟁사) ──
  const allStationIds = [id, ...filteredKeyComp.map((c) => c.id)];
  const { data: priceRaw } = await supabase
    .from("price_history")
    .select("station_id, gasoline_price, collected_at")
    .in("station_id", allStationIds)
    .not("gasoline_price", "is", null)
    .order("collected_at", { ascending: true });

  // station별 날짜→가격 맵
  const priceByStationDate = new Map<string, Map<string, number>>();
  if (priceRaw) {
    for (const r of priceRaw) {
      const date = r.collected_at.slice(0, 10);
      if (!priceByStationDate.has(r.station_id)) priceByStationDate.set(r.station_id, new Map());
      priceByStationDate.get(r.station_id)!.set(date, r.gasoline_price!);
    }
  }

  // ── 5. sales_data ──
  const { data: salesRaw } = await supabase
    .from("sales_data")
    .select("date, gasoline_volume")
    .eq("station_id", id)
    .not("gasoline_volume", "is", null)
    .order("date", { ascending: true });

  const salesByDate = new Map<string, number>();
  if (salesRaw) {
    for (const s of salesRaw) salesByDate.set(s.date, Number(s.gasoline_volume) || 0);
  }

  // ── 6. 가격 변경일 감지 헬퍼 ──
  function findPriceChangeAfter(stationId: string, afterDate: string, direction: "up" | "down"): { date: string; change: number } | null {
    const priceMap = priceByStationDate.get(stationId);
    if (!priceMap) return null;

    const dates = [...priceMap.keys()].sort();
    const windowEnd = new Date(new Date(afterDate).getTime() + REACTION_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);

    let prevPrice: number | null = null;
    for (const d of dates) {
      const price = priceMap.get(d)!;
      if (d <= afterDate) { prevPrice = price; continue; }
      if (d > windowEnd) break;
      if (prevPrice != null) {
        const change = price - prevPrice;
        if (Math.abs(change) >= MIN_PRICE_CHANGE) {
          // 방향 일치 확인 (유가 상승 → 인상, 유가 하락 → 인하)
          if ((direction === "up" && change > 0) || (direction === "down" && change < 0)) {
            return { date: d, change };
          }
        }
      }
      prevPrice = price;
    }
    return null;
  }

  // ── 7. 판매량 전후 비교 헬퍼 ──
  function getSalesImpact(reactionDate: string): { beforeAvg: number; afterAvg: number; changeRate: number } | null {
    const allDates = [...salesByDate.keys()].sort();
    const idx = allDates.indexOf(reactionDate);
    if (idx < 0) {
      // 정확한 날짜가 없으면 가장 가까운 날짜 찾기
      const closest = allDates.find((d) => d >= reactionDate);
      if (!closest) return null;
      const closestIdx = allDates.indexOf(closest);
      if (closestIdx < 3) return null;
      const before = allDates.slice(closestIdx - 3, closestIdx).map((d) => salesByDate.get(d) || 0);
      const after = allDates.slice(closestIdx, closestIdx + 3).map((d) => salesByDate.get(d) || 0);
      if (before.length < 2 || after.length < 2) return null;
      const beforeAvg = Math.round(before.reduce((a, b) => a + b, 0) / before.length);
      const afterAvg = Math.round(after.reduce((a, b) => a + b, 0) / after.length);
      if (beforeAvg === 0) return null;
      return { beforeAvg, afterAvg, changeRate: Math.round(((afterAvg - beforeAvg) / beforeAvg) * 1000) / 10 };
    }

    if (idx < 3) return null;
    const before = allDates.slice(idx - 3, idx).map((d) => salesByDate.get(d) || 0);
    const after = allDates.slice(idx, idx + 3).map((d) => salesByDate.get(d) || 0);
    if (before.length < 2 || after.length < 2) return null;
    const beforeAvg = Math.round(before.reduce((a, b) => a + b, 0) / before.length);
    const afterAvg = Math.round(after.reduce((a, b) => a + b, 0) / after.length);
    if (beforeAvg === 0) return null;
    return { beforeAvg, afterAvg, changeRate: Math.round(((afterAvg - beforeAvg) / beforeAvg) * 1000) / 10 };
  }

  // ── 8. 이벤트별 교차 분석 ──
  interface EventAnalysis {
    date: string;
    direction: "up" | "down";
    brentChange: number;
    brentPrice: number;
    competitorReactions: Array<{
      name: string;
      reactionDate: string | null;
      daysToReact: number | null;
      priceChange: number | null;
    }>;
    myReaction: {
      reactionDate: string | null;
      daysToReact: number | null;
      priceChange: number | null;
    };
    salesImpact: { beforeAvg: number; afterAvg: number; changeRate: number } | null;
  }

  const analyzedEvents: EventAnalysis[] = [];

  for (const ev of oilEvents) {
    // 경쟁사 반응
    const compReactions = filteredKeyComp.map((comp) => {
      const reaction = findPriceChangeAfter(comp.id, ev.date, ev.direction);
      return {
        name: comp.name,
        reactionDate: reaction?.date ?? null,
        daysToReact: reaction ? Math.round((new Date(reaction.date).getTime() - new Date(ev.date).getTime()) / 86400000) : null,
        priceChange: reaction?.change ?? null,
      };
    });

    // 내 반응
    const myReaction = findPriceChangeAfter(id, ev.date, ev.direction);
    const myAnalysis = {
      reactionDate: myReaction?.date ?? null,
      daysToReact: myReaction ? Math.round((new Date(myReaction.date).getTime() - new Date(ev.date).getTime()) / 86400000) : null,
      priceChange: myReaction?.change ?? null,
    };

    // 판매량 영향 (내 반응일 기준)
    const salesImpact = myReaction ? getSalesImpact(myReaction.date) : null;

    analyzedEvents.push({
      ...ev,
      competitorReactions: compReactions,
      myReaction: myAnalysis,
      salesImpact,
    });
  }

  // ── 9. 경쟁사별 반응 속도 요약 ──
  const competitorSpeed = filteredKeyComp.map((comp) => {
    const reactions = analyzedEvents
      .flatMap((ev) => ev.competitorReactions)
      .filter((r) => r.name === comp.name && r.daysToReact != null);
    const avgDays = reactions.length > 0
      ? Math.round((reactions.reduce((s, r) => s + r.daysToReact!, 0) / reactions.length) * 10) / 10
      : null;
    return { name: comp.name, avgDaysToReact: avgDays, reactionCount: reactions.length };
  });

  competitorSpeed.sort((a, b) => (a.avgDaysToReact ?? 999) - (b.avgDaysToReact ?? 999));
  competitorSpeed.forEach((c, i) => Object.assign(c, { rank: i + 1 }));

  // ── 10. 타이밍 영향 분석 ──
  // 경쟁사 첫 반응일보다 내가 빨랐는지/늦었는지
  let timingImpact: {
    earlyResponse: { avgSalesChange: number; count: number };
    lateResponse: { avgSalesChange: number; count: number };
    optimalDays: number | null;
  } | null = null;

  const earlyImpacts: number[] = [];
  const lateImpacts: number[] = [];

  for (const ev of analyzedEvents) {
    if (!ev.myReaction.daysToReact || !ev.salesImpact) continue;

    const compFirstReaction = ev.competitorReactions
      .filter((r) => r.daysToReact != null)
      .sort((a, b) => a.daysToReact! - b.daysToReact!)[0];

    if (!compFirstReaction?.daysToReact) continue;

    if (ev.myReaction.daysToReact <= compFirstReaction.daysToReact) {
      earlyImpacts.push(ev.salesImpact.changeRate);
    } else {
      lateImpacts.push(ev.salesImpact.changeRate);
    }
  }

  if (earlyImpacts.length + lateImpacts.length >= 2) {
    const avgEarly = earlyImpacts.length > 0
      ? Math.round((earlyImpacts.reduce((a, b) => a + b, 0) / earlyImpacts.length) * 10) / 10
      : 0;
    const avgLate = lateImpacts.length > 0
      ? Math.round((lateImpacts.reduce((a, b) => a + b, 0) / lateImpacts.length) * 10) / 10
      : 0;

    // 최적 반응 일수: 가장 빠른 경쟁사 평균 반응일 기준
    const fastestComp = competitorSpeed.find((c) => c.avgDaysToReact != null);
    const optimalDays = fastestComp?.avgDaysToReact
      ? Math.ceil(fastestComp.avgDaysToReact)
      : null;

    timingImpact = {
      earlyResponse: { avgSalesChange: avgEarly, count: earlyImpacts.length },
      lateResponse: { avgSalesChange: avgLate, count: lateImpacts.length },
      optimalDays,
    };
  }

  // ── 11. 현재 상황 판단 ──
  let currentSituation = {
    pendingReaction: false,
    message: "현재 긴급한 가격 대응이 필요하지 않습니다.",
    urgency: "none" as "high" | "medium" | "low" | "none",
  };

  // 최근 경쟁사 가격 변경 중 내가 아직 안 따라간 것이 있는지
  if (analyzedEvents.length > 0) {
    const latestEvent = analyzedEvents[analyzedEvents.length - 1];
    const recentCompReactions = latestEvent.competitorReactions.filter((r) => r.reactionDate != null);

    if (recentCompReactions.length > 0 && !latestEvent.myReaction.reactionDate) {
      const firstComp = recentCompReactions.sort((a, b) => a.daysToReact! - b.daysToReact!)[0];
      const daysSinceComp = Math.round((Date.now() - new Date(firstComp.reactionDate!).getTime()) / 86400000);
      const optimal = timingImpact?.optimalDays ?? 3;
      const remaining = optimal - daysSinceComp;

      if (remaining <= 0) {
        currentSituation = {
          pendingReaction: true,
          message: `${firstComp.name}이(가) ${daysSinceComp}일 전 ${latestEvent.direction === "up" ? "인상" : "인하"}. 최적 대응 시점이 지났습니다. 빠른 검토 필요.`,
          urgency: "high",
        };
      } else if (remaining <= 1) {
        currentSituation = {
          pendingReaction: true,
          message: `${firstComp.name}이(가) ${daysSinceComp}일 전 ${latestEvent.direction === "up" ? "인상" : "인하"}. 과거 패턴상 ${optimal}일 내 대응 권장 — 오늘이 마지막 날.`,
          urgency: "high",
        };
      } else if (remaining <= 3) {
        currentSituation = {
          pendingReaction: true,
          message: `${firstComp.name}이(가) ${daysSinceComp}일 전 ${latestEvent.direction === "up" ? "인상" : "인하"}. ${remaining}일 이내 대응 검토.`,
          urgency: "medium",
        };
      }
    }
  }

  // 유가 이벤트 발생 후 아직 아무도 반응 안 한 경우
  if (oilEvents.length > 0 && currentSituation.urgency === "none") {
    const latestOil = oilEvents[oilEvents.length - 1];
    const daysSinceOil = Math.round((Date.now() - new Date(latestOil.date).getTime()) / 86400000);
    if (daysSinceOil <= REACTION_WINDOW_DAYS) {
      const fastestAvg = competitorSpeed.find((c) => c.avgDaysToReact != null)?.avgDaysToReact;
      if (fastestAvg && daysSinceOil < fastestAvg) {
        currentSituation = {
          pendingReaction: false,
          message: `${latestOil.date.slice(5)} Brent ${latestOil.brentChange > 0 ? "+" : ""}$${latestOil.brentChange.toFixed(1)} 변동. 경쟁사 반응 대기 중 (평균 ${fastestAvg}일 소요).`,
          urgency: "low",
        };
      }
    }
  }

  // 데이터 범위
  const priceHistoryDates = priceRaw ? priceRaw.map((r) => r.collected_at.slice(0, 10)) : [];
  const from = priceHistoryDates.length > 0 ? priceHistoryDates[0] : "";
  const to = priceHistoryDates.length > 0 ? priceHistoryDates[priceHistoryDates.length - 1] : "";

  return {
    oilEvents: analyzedEvents.reverse(), // 최신순
    competitorSpeed,
    timingImpact,
    currentSituation,
    dataStatus: {
      totalEvents: analyzedEvents.length,
      minRequired: 3,
      isReliable: analyzedEvents.length >= 5,
      dataRange: { from, to },
    },
  };
}
