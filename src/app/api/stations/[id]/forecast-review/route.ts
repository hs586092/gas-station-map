import { NextRequest, NextResponse } from "next/server";
import { getForecastReview } from "@/lib/dashboard/forecast-review";
import { getForecastSelfDiagnosis } from "@/lib/dashboard/forecast-self-diagnosis";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const selfDiagnosis = await getForecastSelfDiagnosis(id).catch(() => null);
  const data = await getForecastReview(id, undefined, selfDiagnosis);
  return NextResponse.json(data, { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=300" } });
}
