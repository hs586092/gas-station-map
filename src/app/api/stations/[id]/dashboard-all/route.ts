import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/stations/[id]/dashboard-all
 *
 * 대시보드에 필요한 분석 API를 서버 내부에서 병렬 호출하여
 * 하나의 JSON으로 합쳐 반환한다.
 *
 * ?tier=essential (기본) — 브리핑+경쟁사분석+판매량+세차 (위쪽 카드용, 빠르게)
 * ?tier=extended        — 상관관계+크로스인사이트+타이밍 (아래쪽 카드용, 나중에)
 * ?tier=all             — 전부 (레거시 호환)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const origin = request.nextUrl.origin;
  const base = `${origin}/api/stations/${id}`;
  const tier = request.nextUrl.searchParams.get("tier") || "essential";

  async function safeFetch<T>(label: string, url: string): Promise<T | null> {
    try {
      console.time(`[dashboard-all] ${label}`);
      const res = await fetch(url, { cache: "no-store" });
      console.timeEnd(`[dashboard-all] ${label}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      console.timeEnd(`[dashboard-all] ${label}`);
      return null;
    }
  }

  // Essential: 빠른 API들 (브리핑 + 판매분석 + 날씨영향 + 예측복기 + 세차)
  const essentialAPIs = [
    safeFetch("insights", `${base}/dashboard-insights`),
    safeFetch("salesAnalysis", `${base}/sales-analysis`),
    safeFetch("weatherSales", `${base}/weather-sales-analysis`),
    safeFetch("forecast", `${base}/forecast-review?t=${Date.now()}`),
    safeFetch("carwash", `${base}/carwash-summary?compact=1`),
  ] as const;

  // Extended: 느린 API들 (상관관계 + 타이밍 + 크로스인사이트)
  const extendedAPIs = [
    safeFetch("correlation", `${base}/correlation-matrix?compact=1`),
    safeFetch("timing", `${base}/timing-analysis`),
    safeFetch("crossInsights", `${base}/cross-insights?compact=1`),
  ] as const;

  console.time(`[dashboard-all] total (tier=${tier})`);

  if (tier === "extended") {
    const [correlation, timing, crossInsights] = await Promise.all(extendedAPIs);
    console.timeEnd(`[dashboard-all] total (tier=${tier})`);
    return NextResponse.json(
      { correlation, timing, crossInsights },
      {
        headers: {
          "Cache-Control": "public, s-maxage=600, stale-while-revalidate=120",
        },
      }
    );
  }

  if (tier === "all") {
    const [insights, salesAnalysis, weatherSales, forecast, carwash, correlation, timing, crossInsights] =
      await Promise.all([...essentialAPIs, ...extendedAPIs]);
    console.timeEnd(`[dashboard-all] total (tier=${tier})`);
    return NextResponse.json(
      { insights, salesAnalysis, weatherSales, timing, forecast, correlation, carwash, crossInsights },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
        },
      }
    );
  }

  // Default: essential
  const [insights, salesAnalysis, weatherSales, forecast, carwash] = await Promise.all(essentialAPIs);
  console.timeEnd(`[dashboard-all] total (tier=${tier})`);
  return NextResponse.json(
    { insights, salesAnalysis, weatherSales, forecast, carwash },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
      },
    }
  );
}
