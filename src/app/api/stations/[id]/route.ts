import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { createServiceClient } from "@/lib/supabase";
import { getStationDetail, katecToWgs84 } from "@/lib/opinet";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { data, error } = await supabase
    .from("stations")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "주유소 정보를 찾을 수 없습니다." },
      { status: 404 }
    );
  }

  // 상세 정보가 없으면 Opinet API로 on-demand 조회 후 DB 캐시
  if (!data.old_address && !data.new_address) {
    try {
      const detail = await getStationDetail(id);
      const wgs = katecToWgs84(detail.GIS_X_COOR, detail.GIS_Y_COOR);

      const updates = {
        old_address: detail.VAN_ADR || "",
        new_address: detail.NEW_ADR || "",
        tel: detail.TEL || "",
        lat: wgs.lat,
        lng: wgs.lng,
        lpg_yn: detail.LPG_YN || "N",
        car_wash_yn: detail.CAR_WASH_YN || "N",
        cvs_yn: detail.CVS_YN || "N",
      };

      // service role로 DB 업데이트
      const serviceClient = createServiceClient();
      await serviceClient.from("stations").update(updates).eq("id", id);

      // 응답에 반영
      Object.assign(data, updates);
    } catch {
      // API 호출 실패 시 기존 데이터로 응답
    }
  }

  const prices: { product: string; price: number }[] = [];
  if (data.gasoline_price) prices.push({ product: "B027", price: data.gasoline_price });
  if (data.diesel_price) prices.push({ product: "D047", price: data.diesel_price });
  if (data.premium_price) prices.push({ product: "B034", price: data.premium_price });

  // EV 충전소 반경 3km 검색
  let evNearby: { fast: number; slow: number; stations: number; fastStations: number } | null = null;
  if (data.lat && data.lng) {
    const EV_RADIUS_KM = 3;
    const degPerKm = 1 / 111;
    const latDelta = EV_RADIUS_KM * degPerKm;
    const lngDelta = EV_RADIUS_KM * degPerKm / Math.cos(data.lat * (Math.PI / 180));

    const { data: evData } = await supabase
      .from("ev_charger_stations")
      .select("lat, lng, fast_count, slow_count")
      .gte("lat", data.lat - latDelta)
      .lte("lat", data.lat + latDelta)
      .gte("lng", data.lng - lngDelta)
      .lte("lng", data.lng + lngDelta);

    if (evData) {
      let fast = 0, slow = 0, stationCount = 0, fastStations = 0;
      for (const ev of evData) {
        const dLat = (ev.lat - data.lat) * 111000;
        const dLng = (ev.lng - data.lng) * 111000 * Math.cos(data.lat * (Math.PI / 180));
        const dist = Math.sqrt(dLat * dLat + dLng * dLng);
        if (dist <= EV_RADIUS_KM * 1000) {
          fast += ev.fast_count;
          slow += ev.slow_count;
          stationCount++;
          if (ev.fast_count > 0) fastStations++;
        }
      }
      evNearby = { fast, slow, stations: stationCount, fastStations };
    }
  }

  return NextResponse.json(
    {
      id: data.id,
      name: data.name,
      brand: data.brand,
      oldAddress: data.old_address,
      newAddress: data.new_address,
      tel: data.tel,
      lat: data.lat,
      lng: data.lng,
      hasLpg: data.lpg_yn === "Y",
      hasCarWash: data.car_wash_yn === "Y",
      hasCvs: data.cvs_yn === "Y",
      prices,
      evNearby,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600",
      },
    }
  );
}
