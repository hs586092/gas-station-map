import { NextRequest, NextResponse } from "next/server";
import { getTimingAnalysis } from "@/lib/dashboard/timing-analysis";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const data = await getTimingAnalysis(id);
  if (!data) return NextResponse.json({ error: "데이터 부족" }, { status: 404 });
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=3600",
    },
  });
}
