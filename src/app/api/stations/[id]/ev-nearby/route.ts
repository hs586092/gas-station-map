import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // 기준 주유소 좌표
  const { data: station, error } = await supabase
    .from("stations")
    .select("id, name, lat, lng")
    .eq("id", id)
    .single();

  if (error || !station || !station.lat || !station.lng) {
    return NextResponse.json({ error: "주유소를 찾을 수 없습니다." }, { status: 404 });
  }

  // 3km 반경 EV 충전소 조회
  const EV_RADIUS_KM = 3;
  const degPerKm = 1 / 111;
  const latDelta = EV_RADIUS_KM * degPerKm;
  const lngDelta = EV_RADIUS_KM * degPerKm / Math.cos(station.lat * (Math.PI / 180));

  const { data: evData, error: evError } = await supabase
    .from("ev_charger_stations")
    .select("station_id, station_name, address, lat, lng, fast_count, slow_count, total_count, operator")
    .gte("lat", station.lat - latDelta)
    .lte("lat", station.lat + latDelta)
    .gte("lng", station.lng - lngDelta)
    .lte("lng", station.lng + lngDelta);

  if (evError) {
    return NextResponse.json({ error: "충전소 데이터 조회 실패" }, { status: 500 });
  }

  // 정밀 거리 계산 + 필터
  const chargers = (evData || [])
    .map((ev) => {
      const dLat = (ev.lat - station.lat) * 111000;
      const dLng = (ev.lng - station.lng) * 111000 * Math.cos(station.lat * (Math.PI / 180));
      const distM = Math.sqrt(dLat * dLat + dLng * dLng);
      return { ...ev, distance_km: Math.round(distM / 10) / 100 };
    })
    .filter((ev) => ev.distance_km <= EV_RADIUS_KM)
    .sort((a, b) => a.distance_km - b.distance_km);

  // 집계
  let totalFast = 0, totalSlow = 0, fastStations = 0;
  for (const ev of chargers) {
    totalFast += ev.fast_count;
    totalSlow += ev.slow_count;
    if (ev.fast_count > 0) fastStations++;
  }

  // 운영업체별 분류
  const operatorMap = new Map<string, number>();
  for (const ev of chargers) {
    const op = ev.operator || "기타";
    operatorMap.set(op, (operatorMap.get(op) || 0) + 1);
  }
  const operators = Array.from(operatorMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json(
    {
      station: { id: station.id, name: station.name, lat: station.lat, lng: station.lng },
      summary: { totalFast, totalSlow, stations: chargers.length, fastStations },
      chargers,
      operators,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=3600",
      },
    }
  );
}
