import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

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

  const { data: base, error: baseError } = await supabase
    .from("stations")
    .select("id, name, brand, lat, lng, gasoline_price, diesel_price")
    .eq("id", id)
    .single();

  if (baseError || !base || !base.lat || !base.lng) {
    return NextResponse.json(
      { error: "주유소를 찾을 수 없습니다." },
      { status: 404 }
    );
  }

  // 반경 5km 경쟁사 조회
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

  const competitors = (candidates || [])
    .map((s) => ({
      ...s,
      distance_km:
        Math.round(haversineKm(base.lat, base.lng, s.lat, s.lng) * 100) / 100,
    }))
    .filter((s) => s.distance_km <= RADIUS_KM)
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, 30);

  if (competitors.length === 0) {
    return NextResponse.json({ changes: [], noChangeCount: 0 });
  }

  // 경쟁사 ID 목록으로 최근 2일 price_history 조회
  const competitorIds = competitors.map((c) => c.id);
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();

  const { data: history } = await supabase
    .from("price_history")
    .select("station_id, gasoline_price, diesel_price, collected_at")
    .in("station_id", competitorIds)
    .gte("collected_at", twoDaysAgo)
    .order("collected_at", { ascending: false });

  if (!history || history.length === 0) {
    return NextResponse.json({
      changes: [],
      noChangeCount: competitors.length,
    });
  }

  // 각 경쟁사별 최근 2일 가격 추출
  const stationHistory = new Map<
    string,
    { today: (typeof history)[0] | null; yesterday: (typeof history)[0] | null }
  >();

  for (const row of history) {
    const sid = row.station_id;
    if (!stationHistory.has(sid)) {
      stationHistory.set(sid, { today: null, yesterday: null });
    }
    const entry = stationHistory.get(sid)!;
    if (!entry.today) {
      entry.today = row;
    } else if (!entry.yesterday) {
      entry.yesterday = row;
    }
  }

  // 변동 감지
  const changes: Array<{
    id: string;
    name: string;
    brand: string;
    distance_km: number;
    gasoline_price: number | null;
    diesel_price: number | null;
    gasoline_diff: number | null;
    diesel_diff: number | null;
  }> = [];

  let noChangeCount = 0;

  for (const comp of competitors) {
    const h = stationHistory.get(comp.id);
    if (!h || !h.today || !h.yesterday) {
      noChangeCount++;
      continue;
    }

    const gDiff =
      h.today.gasoline_price != null && h.yesterday.gasoline_price != null
        ? h.today.gasoline_price - h.yesterday.gasoline_price
        : null;
    const dDiff =
      h.today.diesel_price != null && h.yesterday.diesel_price != null
        ? h.today.diesel_price - h.yesterday.diesel_price
        : null;

    if ((gDiff != null && gDiff !== 0) || (dDiff != null && dDiff !== 0)) {
      changes.push({
        id: comp.id,
        name: comp.name,
        brand: comp.brand,
        distance_km: comp.distance_km,
        gasoline_price: h.today.gasoline_price,
        diesel_price: h.today.diesel_price,
        gasoline_diff: gDiff,
        diesel_diff: dDiff,
      });
    } else {
      noChangeCount++;
    }
  }

  // 변동폭 절대값 큰 순으로 정렬
  changes.sort((a, b) => {
    const aMax = Math.max(
      Math.abs(a.gasoline_diff || 0),
      Math.abs(a.diesel_diff || 0)
    );
    const bMax = Math.max(
      Math.abs(b.gasoline_diff || 0),
      Math.abs(b.diesel_diff || 0)
    );
    return bMax - aMax;
  });

  return NextResponse.json(
    { changes, noChangeCount },
    {
      headers: {
        "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=300",
      },
    }
  );
}
