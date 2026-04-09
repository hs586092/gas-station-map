import { NextRequest, NextResponse } from "next/server";
import { getForecastReview } from "@/lib/dashboard/forecast-review";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getForecastReview(id);
  return NextResponse.json(data, { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=300" } });
}
