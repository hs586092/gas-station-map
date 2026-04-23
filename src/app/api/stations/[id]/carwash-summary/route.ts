import { NextRequest, NextResponse } from "next/server";
import { getCarwashSummary } from "@/lib/dashboard/carwash-summary";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const compact = request.nextUrl.searchParams.get("compact") === "1";
  let weatherForecast = null;
  try {
    const wxRes = await fetch(`${request.nextUrl.origin}/api/weather`, { cache: "no-store" });
    if (wxRes.ok) weatherForecast = await wxRes.json();
  } catch {}
  const data = await getCarwashSummary(id, { compact, weatherForecast });
  if (!data) return NextResponse.json({ error: "세차 데이터 없음" }, { status: 404 });
  return NextResponse.json(data, {
    headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=3600" },
  });
}
