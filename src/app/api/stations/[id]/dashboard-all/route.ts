import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/stations/[id]/dashboard-all
 *
 * 대시보드에 필요한 6개 API를 서버 내부에서 병렬 호출하여
 * 하나의 JSON으로 합쳐 반환한다.
 *
 * 클라이언트 네트워크 왕복: 6~7회 → 1회
 * 서버 내부 호출은 같은 프로세스/데이터센터이므로 레이턴시 최소.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const origin = request.nextUrl.origin;
  const base = `${origin}/api/stations/${id}`;

  // 각 API를 병렬 호출 — 개별 실패 시 null로 대체
  async function safeFetch<T>(url: string): Promise<T | null> {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  const [
    insights,
    salesAnalysis,
    weatherSales,
    timing,
    forecast,
    correlation,
  ] = await Promise.all([
    safeFetch(`${base}/dashboard-insights`),
    safeFetch(`${base}/sales-analysis`),
    safeFetch(`${base}/weather-sales-analysis`),
    safeFetch(`${base}/timing-analysis`),
    safeFetch(`${base}/forecast-review?t=${Date.now()}`),
    safeFetch(`${base}/correlation-matrix?compact=1`),
  ]);

  return NextResponse.json(
    { insights, salesAnalysis, weatherSales, timing, forecast, correlation },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
      },
    }
  );
}
