import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Haversine 공식: 두 좌표 간 직선거리(km)
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // 1. 기준 주유소 조회
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

  // 2. 반경 5km 후보 조회 (위경도 박스 필터링 → Haversine 정밀 계산)
  //    위도 1도 ≈ 111km, 경도 1도 ≈ 88km (한국 위도 ~37도 기준)
  const RADIUS_KM = 5;
  const latDelta = RADIUS_KM / 111;
  const lngDelta = RADIUS_KM / 88;

  const { data: candidates, error: candError } = await supabase
    .from("stations")
    .select("id, name, brand, lat, lng, gasoline_price, diesel_price")
    .gte("lat", base.lat - latDelta)
    .lte("lat", base.lat + latDelta)
    .gte("lng", base.lng - lngDelta)
    .lte("lng", base.lng + lngDelta)
    .neq("id", id);

  if (candError) {
    return NextResponse.json(
      { error: "경쟁사 조회 실패" },
      { status: 500 }
    );
  }

  // 3. Haversine 거리 계산 + 5km 필터 + 거리순 정렬
  const competitors = (candidates || [])
    .map((s) => ({
      ...s,
      distance_km: Math.round(haversineKm(base.lat, base.lng, s.lat, s.lng) * 100) / 100,
    }))
    .filter((s) => s.distance_km <= RADIUS_KM)
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, 30);

  // 4. 통계 계산 (기준 주유소 포함)
  const allStations = [{ ...base, distance_km: 0 }, ...competitors];

  const gasolinePrices = allStations
    .map((s) => s.gasoline_price)
    .filter((p): p is number => p != null && p > 0);
  const dieselPrices = allStations
    .map((s) => s.diesel_price)
    .filter((p): p is number => p != null && p > 0);

  const avg = (arr: number[]) =>
    arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

  // 순위 계산 (가격 오름차순, 1 = 최저가)
  const gasolineRank = base.gasoline_price
    ? gasolinePrices.sort((a, b) => a - b).indexOf(base.gasoline_price) + 1
    : null;
  const dieselRank = base.diesel_price
    ? dieselPrices.sort((a, b) => a - b).indexOf(base.diesel_price) + 1
    : null;

  // 5. 응답 구성
  return NextResponse.json({
    baseStation: {
      id: base.id,
      name: base.name,
      brand: base.brand,
      gasoline_price: base.gasoline_price,
      diesel_price: base.diesel_price,
    },
    competitors: competitors.map((c) => ({
      id: c.id,
      name: c.name,
      brand: c.brand,
      gasoline_price: c.gasoline_price,
      diesel_price: c.diesel_price,
      distance_km: c.distance_km,
      gasoline_diff:
        c.gasoline_price && base.gasoline_price
          ? c.gasoline_price - base.gasoline_price
          : null,
      diesel_diff:
        c.diesel_price && base.diesel_price
          ? c.diesel_price - base.diesel_price
          : null,
    })),
    stats: {
      avg_gasoline: avg(gasolinePrices),
      avg_diesel: avg(dieselPrices),
      my_gasoline_rank: gasolineRank,
      my_diesel_rank: dieselRank,
      total_count: allStations.length,
    },
  });
}
