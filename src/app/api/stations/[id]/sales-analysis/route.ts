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

  // ── 1. 판매 데이터 (전체) ──
  const { data: salesRaw } = await supabase
    .from("sales_data")
    .select("date, gasoline_volume, gasoline_count, gasoline_amount, diesel_volume, diesel_count")
    .eq("station_id", id)
    .order("date", { ascending: true });

  if (!salesRaw || salesRaw.length === 0) {
    return NextResponse.json({ error: "판매 데이터가 없습니다." }, { status: 404 });
  }

  // ── 2. price_history (해당 주유소만) ──
  const { data: priceRaw } = await supabase
    .from("price_history")
    .select("gasoline_price, diesel_price, collected_at")
    .eq("station_id", id)
    .not("gasoline_price", "is", null)
    .order("collected_at", { ascending: true });

  // price_history를 날짜별 맵으로 (마지막 값 기준)
  const priceByDate = new Map<string, { gasoline: number; diesel: number | null }>();
  if (priceRaw) {
    for (const r of priceRaw) {
      const date = r.collected_at.slice(0, 10);
      priceByDate.set(date, { gasoline: r.gasoline_price!, diesel: r.diesel_price });
    }
  }

  // ── 3. 일별 데이터 구성 (판매 단가 추정 포함) ──
  interface DayData {
    date: string;
    gasoline_volume: number;
    diesel_volume: number;
    gasoline_count: number;
    diesel_count: number;
    gasoline_amount: number;
    gasoline_price: number | null;    // price_history 기준
    gasoline_unit_price: number | null; // 실효 단가 (amount/volume)
    price_source: "price_history" | "sales_unit_price" | null;
  }

  const days: DayData[] = [];
  for (const s of salesRaw) {
    // 판매 데이터가 전부 null인 행(미래 날짜 등) 건너뛰기
    if (s.gasoline_volume == null && s.diesel_volume == null) continue;

    const gVol = Number(s.gasoline_volume) || 0;
    const dVol = Number(s.diesel_volume) || 0;
    const gAmt = Number(s.gasoline_amount) || 0;
    const gCount = Number(s.gasoline_count) || 0;
    const dCount = Number(s.diesel_count) || 0;

    const unitPrice = gVol > 0 ? Math.round(gAmt / gVol) : null;
    const ph = priceByDate.get(s.date);

    days.push({
      date: s.date,
      gasoline_volume: gVol,
      diesel_volume: dVol,
      gasoline_count: gCount,
      diesel_count: dCount,
      gasoline_amount: gAmt,
      gasoline_price: ph?.gasoline ?? null,
      gasoline_unit_price: unitPrice,
      price_source: ph ? "price_history" : unitPrice ? "sales_unit_price" : null,
    });
  }

  // ── 4. 가격 변경 이벤트 감지 ──
  // 가격 소스: price_history 우선, 없으면 실효 단가
  function getPrice(d: DayData): number | null {
    return d.gasoline_price ?? d.gasoline_unit_price;
  }

  interface PriceEvent {
    date: string;
    fuel: "gasoline";
    priceBefore: number;
    priceAfter: number;
    priceChange: number;
    volumeBefore3d: number;
    volumeAfter3d: number;
    volumeChangeRate: number;
    volumeAfter7d: number | null;
    recoveryRate: number | null;
    priceSource: "price_history" | "sales_unit_price";
    elasticity: number | null;
  }

  const events: PriceEvent[] = [];
  const MIN_PRICE_CHANGE = 5; // 5원 이상만 이벤트로 인정

  for (let i = 1; i < days.length; i++) {
    const prev = getPrice(days[i - 1]);
    const curr = getPrice(days[i]);
    if (prev == null || curr == null) continue;

    const change = curr - prev;
    if (Math.abs(change) < MIN_PRICE_CHANGE) continue;

    // 변경 전 3일 평균 판매량
    const before3 = days.slice(Math.max(0, i - 3), i);
    const after3 = days.slice(i, Math.min(days.length, i + 3));
    const after7 = days.slice(i, Math.min(days.length, i + 7));

    if (before3.length === 0 || after3.length === 0) continue;

    const avgBefore = before3.reduce((s, d) => s + d.gasoline_volume, 0) / before3.length;
    const avgAfter = after3.reduce((s, d) => s + d.gasoline_volume, 0) / after3.length;
    const avgAfter7 = after7.length >= 5
      ? after7.reduce((s, d) => s + d.gasoline_volume, 0) / after7.length
      : null;

    if (avgBefore === 0) continue;

    const volChangeRate = ((avgAfter - avgBefore) / avgBefore) * 100;
    const recoveryRate = avgAfter7 != null && avgBefore > 0
      ? ((avgAfter7 - avgBefore) / avgBefore) * 100
      : null;

    // 탄력성: 판매량 변화율 / 가격 변화율
    const priceChangeRate = (change / prev) * 100;
    const elasticity = priceChangeRate !== 0
      ? Math.round((volChangeRate / priceChangeRate) * 100) / 100
      : null;

    events.push({
      date: days[i].date,
      fuel: "gasoline",
      priceBefore: prev,
      priceAfter: curr,
      priceChange: change,
      volumeBefore3d: Math.round(avgBefore),
      volumeAfter3d: Math.round(avgAfter),
      volumeChangeRate: Math.round(volChangeRate * 10) / 10,
      volumeAfter7d: avgAfter7 != null ? Math.round(avgAfter7) : null,
      recoveryRate: recoveryRate != null ? Math.round(recoveryRate * 10) / 10 : null,
      priceSource: days[i].price_source === "price_history" ? "price_history" : "sales_unit_price",
      elasticity,
    });
  }

  // ── 5. 요약 통계 ──
  const last30 = days.slice(-30);
  const avg30Gas = last30.length > 0
    ? Math.round(last30.reduce((s, d) => s + d.gasoline_volume, 0) / last30.length)
    : 0;
  const avg30Diesel = last30.length > 0
    ? Math.round(last30.reduce((s, d) => s + d.diesel_volume, 0) / last30.length)
    : 0;

  // 평균 탄력성 (이벤트 5개 이상)
  const validElasticities = events
    .filter((e) => e.elasticity != null)
    .map((e) => e.elasticity!);
  const avgElasticity = validElasticities.length >= 3
    ? Math.round((validElasticities.reduce((s, v) => s + v, 0) / validElasticities.length) * 100) / 100
    : null;

  let elasticityLabel: "민감" | "보통" | "둔감" | "데이터 부족" = "데이터 부족";
  if (avgElasticity != null) {
    const abs = Math.abs(avgElasticity);
    if (abs > 3) elasticityLabel = "민감";
    else if (abs > 1) elasticityLabel = "보통";
    else elasticityLabel = "둔감";
  }

  // ── 6. 요일별 패턴 ──
  const dayLabels = ["일", "월", "화", "수", "목", "금", "토"];
  const weekdayBuckets: { gasoline: number[]; diesel: number[] }[] =
    Array.from({ length: 7 }, () => ({ gasoline: [], diesel: [] }));

  for (const d of days) {
    const dow = new Date(d.date + "T00:00:00+09:00").getDay();
    weekdayBuckets[dow].gasoline.push(d.gasoline_volume);
    weekdayBuckets[dow].diesel.push(d.diesel_volume);
  }

  const weekdayPattern = weekdayBuckets.map((b, i) => ({
    day: i,
    dayLabel: dayLabels[i],
    avgGasoline: b.gasoline.length > 0
      ? Math.round(b.gasoline.reduce((s, v) => s + v, 0) / b.gasoline.length)
      : 0,
    avgDiesel: b.diesel.length > 0
      ? Math.round(b.diesel.reduce((s, v) => s + v, 0) / b.diesel.length)
      : 0,
  }));

  // ── 7. 차트용 일별 데이터 (최근 90일) ──
  const dailySales = days.slice(-90).map((d) => {
    const ph = priceByDate.get(d.date);
    return {
      date: d.date,
      gasoline_volume: d.gasoline_volume,
      diesel_volume: d.diesel_volume,
      gasoline_price: d.gasoline_price ?? d.gasoline_unit_price,
      diesel_price: ph?.diesel ?? null,
      gasoline_count: d.gasoline_count,
      diesel_count: d.diesel_count,
    };
  });

  // 이벤트 날짜 셋 (차트에 세로선 표시용)
  const eventDates = events.map((e) => e.date);

  // ── 8. 경쟁사 가격 차이 vs 판매량 분석 ──
  // 기준 주유소 좌표로 경쟁사 목록 확보
  const { data: base } = await supabase
    .from("stations")
    .select("lat, lng")
    .eq("id", id)
    .single();

  interface CompGapPoint {
    date: string;
    myPrice: number;
    compAvg: number;
    gap: number;             // 내 가격 - 경쟁사 평균
    gasoline_volume: number;
  }

  interface GapBucket {
    label: string;
    range: string;
    avgVolume: number;
    count: number;
  }

  let competitorGap: {
    points: CompGapPoint[];
    buckets: GapBucket[];
    totalDays: number;
    insight: string;
  } = { points: [], buckets: [], totalDays: 0, insight: "" };

  if (base?.lat && base?.lng) {
    const RADIUS_KM = 5;
    const latD = RADIUS_KM / 111;
    const lngD = RADIUS_KM / 88;

    const { data: candidates } = await supabase
      .from("stations")
      .select("id, lat, lng")
      .gte("lat", base.lat - latD)
      .lte("lat", base.lat + latD)
      .gte("lng", base.lng - lngD)
      .lte("lng", base.lng + lngD)
      .neq("id", id);

    const compIds = (candidates || [])
      .filter((s) => s.lat && s.lng && haversineKm(base.lat, base.lng, s.lat, s.lng) <= RADIUS_KM)
      .map((s) => s.id);

    if (compIds.length > 0) {
      // 경쟁사 price_history (price_history가 있는 기간만)
      const { data: compPriceRaw } = await supabase
        .from("price_history")
        .select("station_id, gasoline_price, collected_at")
        .in("station_id", compIds)
        .not("gasoline_price", "is", null)
        .order("collected_at", { ascending: true });

      // 경쟁사 일별 평균 가격 맵
      const compDayPrices = new Map<string, number[]>();
      if (compPriceRaw) {
        for (const r of compPriceRaw) {
          const date = r.collected_at.slice(0, 10);
          if (!compDayPrices.has(date)) compDayPrices.set(date, []);
          // 같은 station_id의 같은 날짜 중복 방지 (마지막 값)
          const arr = compDayPrices.get(date)!;
          arr.push(r.gasoline_price!);
        }
      }

      // 경쟁사 날짜별로 station 중복 제거 후 평균
      const compAvgByDate = new Map<string, number>();
      if (compPriceRaw) {
        const byDateStation = new Map<string, Map<string, number>>();
        for (const r of compPriceRaw) {
          const date = r.collected_at.slice(0, 10);
          if (!byDateStation.has(date)) byDateStation.set(date, new Map());
          byDateStation.get(date)!.set(r.station_id, r.gasoline_price!);
        }
        for (const [date, stationMap] of byDateStation) {
          const prices = [...stationMap.values()];
          if (prices.length >= 2) { // 최소 2곳 이상
            compAvgByDate.set(date, Math.round(prices.reduce((a, b) => a + b, 0) / prices.length));
          }
        }
      }

      // 내 가격 + 경쟁사 평균 + 판매량 결합
      const points: CompGapPoint[] = [];
      const salesByDate = new Map(days.map((d) => [d.date, d]));

      for (const [date, compAvg] of compAvgByDate) {
        const myDay = salesByDate.get(date);
        const myPh = priceByDate.get(date);
        if (!myDay || !myPh) continue;

        const myPrice = myPh.gasoline;
        const gap = myPrice - compAvg;

        points.push({
          date,
          myPrice,
          compAvg,
          gap,
          gasoline_volume: myDay.gasoline_volume,
        });
      }

      points.sort((a, b) => a.date.localeCompare(b.date));

      // 가격 차이 구간별 평균 판매량
      const bucketDefs = [
        { label: "내가 많이 쌈", range: "-30원 이하", min: -Infinity, max: -30 },
        { label: "내가 약간 쌈", range: "-30 ~ -10원", min: -30, max: -10 },
        { label: "비슷한 수준", range: "-10 ~ +10원", min: -10, max: 10 },
        { label: "내가 약간 비쌈", range: "+10 ~ +30원", min: 10, max: 30 },
        { label: "내가 많이 비쌈", range: "+30원 이상", min: 30, max: Infinity },
      ];

      const buckets: GapBucket[] = bucketDefs.map((def) => {
        const matching = points.filter((p) => p.gap > def.min && p.gap <= def.max);
        // 첫 구간: gap <= -30 (min: -Infinity)
        const adjusted = def.min === -Infinity
          ? points.filter((p) => p.gap <= def.max)
          : matching;
        return {
          label: def.label,
          range: def.range,
          avgVolume: adjusted.length > 0
            ? Math.round(adjusted.reduce((s, p) => s + p.gasoline_volume, 0) / adjusted.length)
            : 0,
          count: adjusted.length,
        };
      });

      // 인사이트 생성
      const cheapBucket = buckets[0].count + buckets[1].count > 0
        ? Math.round((buckets[0].avgVolume * buckets[0].count + buckets[1].avgVolume * buckets[1].count) / (buckets[0].count + buckets[1].count))
        : 0;
      const expBucket = buckets[3].count + buckets[4].count > 0
        ? Math.round((buckets[3].avgVolume * buckets[3].count + buckets[4].avgVolume * buckets[4].count) / (buckets[3].count + buckets[4].count))
        : 0;
      const similarBucket = buckets[2].avgVolume;

      let insight = "";
      if (cheapBucket > 0 && expBucket > 0 && similarBucket > 0) {
        const diffPct = cheapBucket > 0 ? Math.round(((cheapBucket - expBucket) / expBucket) * 100) : 0;
        insight = `경쟁사보다 저렴할 때 평균 ${cheapBucket.toLocaleString()}L, 비쌀 때 ${expBucket.toLocaleString()}L로 약 ${Math.abs(diffPct)}% 차이가 있습니다.`;
      } else if (points.length > 0) {
        insight = `${points.length}일간의 데이터를 수집 중입니다. 더 많은 데이터가 쌓이면 정확한 분석이 가능합니다.`;
      }

      competitorGap = { points, buckets, totalDays: points.length, insight };
    }
  }

  // ── 9. 주요 경쟁사 4곳 개별 가격 차이 vs 판매량 분석 ──
  // DB에 법인명 접두사가 붙어있을 수 있으므로 (유)풍산주유소 등 ilike으로 매칭
  const KEY_COMP_KEYWORDS = ["덕풍주유소", "풍산주유소", "만남의광장주유소", "베스트원주유소"];

  const { data: keyCompStations } = await supabase
    .from("stations")
    .select("id, name")
    .or(KEY_COMP_KEYWORDS.map((kw) => `name.ilike.%${kw}%`).join(","));

  // ilike 결과에서 키워드별 가장 정확한 매칭 1개만 선택
  // 정확 일치 우선, 그다음 이름이 짧은 것 (접두사만 다른 경우)
  const filteredKeyComp: Array<{ id: string; name: string }> = [];
  if (keyCompStations) {
    for (const kw of KEY_COMP_KEYWORDS) {
      const candidates = keyCompStations.filter((s) => s.name.includes(kw));
      if (candidates.length > 0) {
        // 정확 일치 우선, 아니면 이름이 가장 짧은 것
        const exact = candidates.find((s) => s.name === kw);
        filteredKeyComp.push(exact || candidates.sort((a, b) => a.name.length - b.name.length)[0]);
      }
    }
  }

  interface KeyCompPoint {
    date: string;
    gap: number;
    gasoline_volume: number;
  }

  interface KeyCompAnalysis {
    stationId: string;
    name: string;
    points: KeyCompPoint[];
    buckets: Array<{ range: string; avgVolume: number; count: number }>;
    correlation: number | null;
    totalDays: number;
  }

  const keyCompetitorAnalysis: {
    competitors: KeyCompAnalysis[];
    insight: string;
    totalDays: number;
  } = { competitors: [], insight: "", totalDays: 0 };

  if (filteredKeyComp.length > 0) {
    const keyCompIds = filteredKeyComp.map((s) => s.id);

    // 주요 경쟁사 price_history
    const { data: keyCompPriceRaw } = await supabase
      .from("price_history")
      .select("station_id, gasoline_price, collected_at")
      .in("station_id", keyCompIds)
      .not("gasoline_price", "is", null)
      .order("collected_at", { ascending: true });

    // 경쟁사별 날짜→가격 맵 (마지막 값)
    const compPriceByDateStation = new Map<string, Map<string, number>>();
    if (keyCompPriceRaw) {
      for (const r of keyCompPriceRaw) {
        const date = r.collected_at.slice(0, 10);
        if (!compPriceByDateStation.has(r.station_id)) compPriceByDateStation.set(r.station_id, new Map());
        compPriceByDateStation.get(r.station_id)!.set(date, r.gasoline_price!);
      }
    }

    const salesByDate = new Map(days.map((d) => [d.date, d]));

    const bucketDefs2 = [
      { range: "-30원 이하", min: -Infinity, max: -30 },
      { range: "-30~-10원", min: -30, max: -10 },
      { range: "-10~+10원", min: -10, max: 10 },
      { range: "+10~+30원", min: 10, max: 30 },
      { range: "+30원 이상", min: 30, max: Infinity },
    ];

    for (const comp of filteredKeyComp) {
      const compPriceMap = compPriceByDateStation.get(comp.id);
      if (!compPriceMap) continue;

      const points: KeyCompPoint[] = [];

      for (const [date, compPrice] of compPriceMap) {
        const myDay = salesByDate.get(date);
        const myPh = priceByDate.get(date);
        if (!myDay || !myPh) continue;

        points.push({
          date,
          gap: myPh.gasoline - compPrice,
          gasoline_volume: myDay.gasoline_volume,
        });
      }

      points.sort((a, b) => a.date.localeCompare(b.date));

      // 구간별 평균 판매량
      const buckets = bucketDefs2.map((def) => {
        const matching = def.min === -Infinity
          ? points.filter((p) => p.gap <= def.max)
          : def.max === Infinity
            ? points.filter((p) => p.gap > def.min)
            : points.filter((p) => p.gap > def.min && p.gap <= def.max);
        return {
          range: def.range,
          avgVolume: matching.length > 0
            ? Math.round(matching.reduce((s, p) => s + p.gasoline_volume, 0) / matching.length)
            : 0,
          count: matching.length,
        };
      });

      // 피어슨 상관계수: 가격 차이 vs 판매량
      let correlation: number | null = null;
      if (points.length >= 5) {
        const xs = points.map((p) => p.gap);
        const ys = points.map((p) => p.gasoline_volume);
        const n = xs.length;
        const sumX = xs.reduce((a, b) => a + b, 0);
        const sumY = ys.reduce((a, b) => a + b, 0);
        const sumXY = xs.reduce((a, b, i) => a + b * ys[i], 0);
        const sumX2 = xs.reduce((a, b) => a + b * b, 0);
        const sumY2 = ys.reduce((a, b) => a + b * b, 0);
        const denom = Math.sqrt((n * sumX2 - sumX ** 2) * (n * sumY2 - sumY ** 2));
        if (denom > 0) {
          correlation = Math.round(((n * sumXY - sumX * sumY) / denom) * 100) / 100;
        }
      }

      keyCompetitorAnalysis.competitors.push({
        stationId: comp.id,
        name: comp.name,
        points,
        buckets,
        correlation,
        totalDays: points.length,
      });
    }

    // 상관계수 기준 정렬 (음수가 클수록 = 가격 차이 커지면 판매량 줄어드는 경쟁사)
    keyCompetitorAnalysis.competitors.sort((a, b) => (a.correlation ?? 0) - (b.correlation ?? 0));

    // 인사이트 생성
    const withCorr = keyCompetitorAnalysis.competitors.filter((c) => c.correlation != null);
    if (withCorr.length > 0) {
      const mostImpact = withCorr[0]; // 가장 음의 상관관계
      if (mostImpact.correlation != null && mostImpact.correlation < -0.1) {
        keyCompetitorAnalysis.insight =
          `${mostImpact.name}와의 가격 차이가 판매량에 가장 큰 영향 (상관계수 ${mostImpact.correlation}). ` +
          `이 경쟁사가 가격을 내리면 우리 판매량에 가장 큰 타격이 예상됩니다.`;
      } else if (withCorr.every((c) => Math.abs(c.correlation!) < 0.1)) {
        keyCompetitorAnalysis.insight =
          "현재 데이터에서는 특정 경쟁사와의 가격 차이가 판매량에 뚜렷한 영향을 미치지 않습니다. 데이터가 더 쌓이면 패턴이 나타날 수 있습니다.";
      } else {
        const strongest = withCorr.reduce((a, b) => Math.abs(a.correlation!) > Math.abs(b.correlation!) ? a : b);
        keyCompetitorAnalysis.insight =
          `${strongest.name}와의 가격 차이가 판매량과 가장 높은 상관관계 (${strongest.correlation}).`;
      }
    }

    keyCompetitorAnalysis.totalDays = Math.max(...keyCompetitorAnalysis.competitors.map((c) => c.totalDays), 0);
  }

  return NextResponse.json(
    {
      summary: {
        avg30d: { gasoline: avg30Gas, diesel: avg30Diesel },
        totalEvents: events.length,
        elasticity: avgElasticity,
        elasticityLabel,
        dataRange: {
          from: days[0]?.date ?? null,
          to: days[days.length - 1]?.date ?? null,
          totalDays: days.length,
        },
      },
      events: events.sort((a, b) => b.date.localeCompare(a.date)), // 최신순
      dailySales,
      eventDates,
      weekdayPattern,
      competitorGap,
      keyCompetitorAnalysis,
    },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600" } }
  );
}
