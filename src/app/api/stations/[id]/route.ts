import { NextRequest, NextResponse } from "next/server";
import { getStationDetail, katecToWgs84 } from "@/lib/opinet";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const detail = await getStationDetail(id);
    const wgs = katecToWgs84(detail.GIS_X_COOR, detail.GIS_Y_COOR);

    return NextResponse.json({
      id: detail.UNI_ID,
      name: detail.OS_NM,
      brand: detail.POLL_DIV_CO,
      oldAddress: detail.VAN_ADR,
      newAddress: detail.NEW_ADR,
      tel: detail.TEL,
      lat: wgs.lat,
      lng: wgs.lng,
      hasLpg: detail.LPG_YN === "Y",
      hasCarWash: detail.CAR_WASH_YN === "Y",
      hasCvs: detail.CVS_YN === "Y",
      prices: detail.OIL_PRICE.map((p) => ({
        product: p.PRODCD,
        price: p.PRICE,
        date: p.TRADE_DT,
        time: p.TRADE_TM,
      })),
    });
  } catch (error) {
    console.error("Opinet API error:", error);
    return NextResponse.json(
      { error: "주유소 상세 정보를 가져오는데 실패했습니다." },
      { status: 500 }
    );
  }
}
