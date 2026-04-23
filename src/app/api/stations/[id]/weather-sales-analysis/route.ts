import { NextRequest, NextResponse } from "next/server";
import { getWeatherSales } from "@/lib/dashboard/weather-sales";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Fetch weather for todayForecast
  let weatherForecast = null;
  try {
    const wxRes = await fetch(`${request.nextUrl.origin}/api/weather`, { cache: "no-store" });
    if (wxRes.ok) weatherForecast = await wxRes.json();
  } catch {}

  const data = await getWeatherSales(id, weatherForecast);
  if (!data) return NextResponse.json({ error: "데이터 부족" }, { status: 404 });

  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600",
    },
  });
}
