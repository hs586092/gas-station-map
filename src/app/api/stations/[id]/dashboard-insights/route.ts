import { NextRequest, NextResponse } from "next/server";
import { getDashboardInsights } from "@/lib/dashboard/insights";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const data = await getDashboardInsights(id);
  if (!data) return NextResponse.json({ error: "주유소를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json(data, { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=300" } });
}
