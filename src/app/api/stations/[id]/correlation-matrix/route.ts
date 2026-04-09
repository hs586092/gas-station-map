import { NextRequest, NextResponse } from "next/server";
import { getCorrelationMatrix } from "@/lib/dashboard/correlation-matrix";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const compact = request.nextUrl.searchParams.get("compact") === "1";
  const data = await getCorrelationMatrix(id, { compact });
  if (!data)
    return NextResponse.json(
      { error: "판매 데이터가 없습니다." },
      { status: 404 }
    );
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=3600",
    },
  });
}
