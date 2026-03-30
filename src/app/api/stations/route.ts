import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const lat = parseFloat(searchParams.get("lat") || "37.5665");
  const lng = parseFloat(searchParams.get("lng") || "126.978");
  const radius = parseInt(searchParams.get("radius") || "5000", 10);
  const prodCd = searchParams.get("prodCd") || "B027";

  // 반경을 대략적인 위경도 범위로 변환 (1도 ≈ 111km)
  const degPerKm = 1 / 111;
  const radiusKm = radius / 1000;
  const latDelta = radiusKm * degPerKm;
  const lngDelta = radiusKm * degPerKm / Math.cos(lat * (Math.PI / 180));

  // 가격 컬럼 선택
  const priceColumn =
    prodCd === "D047"
      ? "diesel_price"
      : prodCd === "B034"
        ? "premium_price"
        : "gasoline_price";

  const { data, error } = await supabase
    .from("stations")
    .select("id, name, brand, lat, lng, gasoline_price, diesel_price, premium_price, road_speed, road_name, road_rank, road_speed_updated_at")
    .gte("lat", lat - latDelta)
    .lte("lat", lat + latDelta)
    .gte("lng", lng - lngDelta)
    .lte("lng", lng + lngDelta)
    .not(priceColumn, "is", null)
    .gt(priceColumn, 0)
    .gt("lat", 0);

  if (error) {
    return NextResponse.json(
      { error: "주유소 데이터를 가져오는데 실패했습니다." },
      { status: 500 }
    );
  }

  // 실제 거리 계산 후 반경 내 필터링 + 정렬
  const stations = (data || [])
    .map((s) => {
      const dLat = (s.lat - lat) * 111000;
      const dLng = (s.lng - lng) * 111000 * Math.cos(lat * (Math.PI / 180));
      const distance = Math.sqrt(dLat * dLat + dLng * dLng);

      const price =
        prodCd === "D047"
          ? s.diesel_price
          : prodCd === "B034"
            ? s.premium_price
            : s.gasoline_price;

      return {
        id: s.id,
        name: s.name,
        brand: s.brand,
        price: price || 0,
        distance: Math.round(distance),
        lat: s.lat,
        lng: s.lng,
        roadSpeed: s.road_speed,
        roadName: s.road_name,
        roadRank: s.road_rank,
        roadSpeedUpdatedAt: s.road_speed_updated_at,
      };
    })
    .filter((s) => s.distance <= radius)
    .sort((a, b) => a.price - b.price);

  return NextResponse.json(
    { stations },
    {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600",
      },
    }
  );
}
