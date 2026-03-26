import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Haversine 공식
function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
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

// 피어슨 상관계수
function pearson(x: number[], y: number[]): number | null {
  const n = x.length;
  if (n < 3) return null;

  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((a, b, i) => a + b * y[i], 0);
  const sumX2 = x.reduce((a, b) => a + b * b, 0);
  const sumY2 = y.reduce((a, b) => a + b * b, 0);

  const denom = Math.sqrt(
    (n * sumX2 - sumX ** 2) * (n * sumY2 - sumY ** 2)
  );
  if (denom === 0) return null;

  const r = (n * sumXY - sumX * sumY) / denom;
  return Math.round(r * 100) / 100;
}

// 일별 delta 계산: 연속 날짜의 가격 차이
function calcDeltas(
  history: { date: string; price: number | null }[]
): Map<string, number> {
  const deltas = new Map<string, number>();
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1].price;
    const curr = history[i].price;
    if (prev != null && curr != null && prev > 0 && curr > 0) {
      deltas.set(history[i].date, curr - prev);
    }
  }
  return deltas;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // 1) 기준 주유소 조회
  const { data: base, error: baseError } = await supabase
    .from("stations")
    .select("id, name, brand, lat, lng, gasoline_price, diesel_price")
    .eq("id", id)
    .single();

  if (baseError || !base) {
    return NextResponse.json(
      { error: "주유소를 찾을 수 없습니다." },
      { status: 404 }
    );
  }

  if (!base.lat || !base.lng) {
    return NextResponse.json(
      { error: "주유소 좌표 정보가 없습니다." },
      { status: 400 }
    );
  }

  // 5km 박스 필터 → Haversine 정밀 계산
  const RADIUS_KM = 5;
  const latDelta = RADIUS_KM / 111;
  const lngDelta = RADIUS_KM / 88;

  const { data: candidates } = await supabase
    .from("stations")
    .select("id, name, brand, lat, lng, gasoline_price, diesel_price")
    .gte("lat", base.lat - latDelta)
    .lte("lat", base.lat + latDelta)
    .gte("lng", base.lng - lngDelta)
    .lte("lng", base.lng + lngDelta)
    .neq("id", id);

  const neighbors = (candidates || [])
    .map((s) => ({
      ...s,
      distance_km:
        Math.round(haversineKm(base.lat, base.lng, s.lat, s.lng) * 100) / 100,
    }))
    .filter((s) => s.distance_km <= RADIUS_KM)
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, 30);

  // 2) price_history 조회 (기준 + 경쟁사 전부)
  const allIds = [id, ...neighbors.map((n) => n.id)];
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const fromDate = thirtyDaysAgo.toISOString().slice(0, 10);

  const { data: histories } = await supabase
    .from("price_history")
    .select("station_id, collected_at, gasoline_price, diesel_price")
    .in("station_id", allIds)
    .gte("collected_at", fromDate)
    .order("collected_at", { ascending: true });

  // 주유소별 → 날짜별 가격 정리
  type DayPrice = { date: string; gasoline: number | null; diesel: number | null };
  const stationHistories = new Map<string, DayPrice[]>();

  for (const row of histories || []) {
    const sid = row.station_id;
    const date = row.collected_at.slice(0, 10);
    if (!stationHistories.has(sid)) stationHistories.set(sid, []);
    const arr = stationHistories.get(sid)!;
    // 같은 날짜 중복 방지 (마지막 값 사용)
    const existing = arr.find((d) => d.date === date);
    if (existing) {
      existing.gasoline = row.gasoline_price;
      existing.diesel = row.diesel_price;
    } else {
      arr.push({
        date,
        gasoline: row.gasoline_price,
        diesel: row.diesel_price,
      });
    }
  }

  // 3) delta 계산
  const baseHistory = stationHistories.get(id) || [];
  const baseGasolineDeltas = calcDeltas(
    baseHistory.map((h) => ({ date: h.date, price: h.gasoline }))
  );
  const baseDieselDeltas = calcDeltas(
    baseHistory.map((h) => ({ date: h.date, price: h.diesel }))
  );

  // 날짜 범위
  const allDates = baseHistory.map((h) => h.date).sort();
  const dateFrom = allDates[0] || null;
  const dateTo = allDates[allDates.length - 1] || null;

  // 4) 각 경쟁사와 상관계수 계산
  const correlations = neighbors.map((neighbor) => {
    const nHistory = stationHistories.get(neighbor.id) || [];
    const nGasolineDeltas = calcDeltas(
      nHistory.map((h) => ({ date: h.date, price: h.gasoline }))
    );
    const nDieselDeltas = calcDeltas(
      nHistory.map((h) => ({ date: h.date, price: h.diesel }))
    );

    // 공통 날짜의 delta 추출
    const commonGasDates: string[] = [];
    for (const date of baseGasolineDeltas.keys()) {
      if (nGasolineDeltas.has(date)) commonGasDates.push(date);
    }
    const commonDieselDates: string[] = [];
    for (const date of baseDieselDeltas.keys()) {
      if (nDieselDeltas.has(date)) commonDieselDates.push(date);
    }

    const baseGasArr = commonGasDates.map((d) => baseGasolineDeltas.get(d)!);
    const nGasArr = commonGasDates.map((d) => nGasolineDeltas.get(d)!);
    const baseDieselArr = commonDieselDates.map((d) => baseDieselDeltas.get(d)!);
    const nDieselArr = commonDieselDates.map((d) => nDieselDeltas.get(d)!);

    const dataPoints = Math.max(commonGasDates.length, commonDieselDates.length);

    return {
      id: neighbor.id,
      name: neighbor.name,
      brand: neighbor.brand,
      distance_km: neighbor.distance_km,
      gasoline_correlation: pearson(baseGasArr, nGasArr),
      diesel_correlation: pearson(baseDieselArr, nDieselArr),
      gasoline_price: neighbor.gasoline_price,
      diesel_price: neighbor.diesel_price,
      data_points: dataPoints,
    };
  });

  // 5) 응답
  const baseDataPoints = Math.max(
    baseGasolineDeltas.size,
    baseDieselDeltas.size
  );
  const reliability =
    baseDataPoints < 7 ? "low" : baseDataPoints < 15 ? "medium" : "high";

  return NextResponse.json(
    {
      baseStation: {
        id: base.id,
        name: base.name,
        brand: base.brand,
      },
      dataPoints: baseDataPoints,
      dateRange: {
        from: dateFrom,
        to: dateTo,
      },
      correlations,
      reliability,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600",
      },
    }
  );
}
