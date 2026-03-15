import { NextRequest, NextResponse } from "next/server";
import {
  getAroundStations,
  getStationDetail,
  katecToWgs84,
  wgs84ToKatec,
  PROD_CD,
} from "@/lib/opinet";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const lat = parseFloat(searchParams.get("lat") || "37.5665");
  const lng = parseFloat(searchParams.get("lng") || "126.978");
  const radius = parseInt(searchParams.get("radius") || "5000", 10);
  const prodCd = searchParams.get("prodCd") || PROD_CD.GASOLINE;

  try {
    // WGS84 → KATEC 변환
    const katec = wgs84ToKatec(lat, lng);

    // 반경 내 주유소 검색
    const stations = await getAroundStations(katec.x, katec.y, radius, prodCd);

    // 각 주유소의 좌표를 WGS84로 변환하여 반환
    const result = stations.map((s) => {
      const wgs = katecToWgs84(s.GIS_X_COOR, s.GIS_Y_COOR);
      return {
        id: s.UNI_ID,
        name: s.OS_NM,
        brand: s.POLL_DIV_CD,
        price: s.PRICE,
        distance: s.DISTANCE,
        lat: wgs.lat,
        lng: wgs.lng,
      };
    });

    return NextResponse.json({ stations: result });
  } catch (error) {
    console.error("Opinet API error:", error);
    return NextResponse.json(
      { error: "주유소 데이터를 가져오는데 실패했습니다." },
      { status: 500 }
    );
  }
}
