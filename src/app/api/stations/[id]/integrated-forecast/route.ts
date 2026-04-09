import { NextRequest, NextResponse } from "next/server";
import { getIntegratedForecast } from "@/lib/dashboard/integrated-forecast";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // 날씨 예보 가져오기
  let weatherForecast: any = null;
  try {
    const wxRes = await fetch(`${request.nextUrl.origin}/api/weather`, { next: { revalidate: 600 } });
    if (wxRes.ok) weatherForecast = await wxRes.json();
  } catch {}

  const result = await getIntegratedForecast(id, weatherForecast);
  if (!result) {
    return NextResponse.json({ error: "데이터 부족" }, { status: 404 });
  }

  return NextResponse.json(result, {
    headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=300" },
  });
}
