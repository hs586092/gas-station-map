import { NextRequest, NextResponse } from "next/server";
import { getCrossInsights } from "@/lib/dashboard/cross-insights";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const compact = request.nextUrl.searchParams.get("compact") === "1";
  const data = await getCrossInsights(id, { compact });
  if (!data) return NextResponse.json({ error: "데이터 부족" }, { status: 404 });
  const cache = "public, s-maxage=86400, stale-while-revalidate=3600";
  return NextResponse.json(data, { headers: { "Cache-Control": cache } });
}
