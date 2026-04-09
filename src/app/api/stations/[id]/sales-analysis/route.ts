import { NextRequest, NextResponse } from "next/server";
import { getSalesAnalysis } from "@/lib/dashboard/sales-analysis";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const data = await getSalesAnalysis(id);
  if (!data) return NextResponse.json({ error: "판매 데이터가 없습니다." }, { status: 404 });
  return NextResponse.json(data, { headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=3600" } });
}
