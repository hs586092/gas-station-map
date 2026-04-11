import { NextRequest, NextResponse } from "next/server";
import { getForecastSelfDiagnosis } from "@/lib/dashboard/forecast-self-diagnosis";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(request.url);
  const windowDays = Number(url.searchParams.get("window") ?? "30");
  const data = await getForecastSelfDiagnosis(id, windowDays);
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=300",
    },
  });
}
