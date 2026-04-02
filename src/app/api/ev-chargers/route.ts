import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const minLat = parseFloat(searchParams.get("minLat") || "0");
  const maxLat = parseFloat(searchParams.get("maxLat") || "0");
  const minLng = parseFloat(searchParams.get("minLng") || "0");
  const maxLng = parseFloat(searchParams.get("maxLng") || "0");

  if (!minLat || !maxLat || !minLng || !maxLng) {
    return NextResponse.json(
      { error: "minLat, maxLat, minLng, maxLng 파라미터가 필요합니다." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("ev_charger_stations")
    .select("station_id, station_name, lat, lng, fast_count, slow_count, total_count, operator")
    .gt("fast_count", 0)
    .gte("lat", minLat)
    .lte("lat", maxLat)
    .gte("lng", minLng)
    .lte("lng", maxLng)
    .limit(500);

  if (error) {
    return NextResponse.json(
      { error: "EV 충전소 데이터를 가져오는데 실패했습니다." },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { chargers: data || [] },
    {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600",
      },
    }
  );
}
