import { NextRequest, NextResponse } from "next/server";
import { getDashboardInsights } from "@/lib/dashboard/insights";
import { getSalesAnalysis } from "@/lib/dashboard/sales-analysis";
import { getWeatherSales } from "@/lib/dashboard/weather-sales";
import { getTimingAnalysis } from "@/lib/dashboard/timing-analysis";
import { getForecastReview } from "@/lib/dashboard/forecast-review";
import { getCorrelationMatrix } from "@/lib/dashboard/correlation-matrix";
import { getCarwashSummary } from "@/lib/dashboard/carwash-summary";
import { getCrossInsights } from "@/lib/dashboard/cross-insights";

/**
 * GET /api/stations/[id]/dashboard-all
 *
 * 대시보드에 필요한 분석 로직을 직접 함수 호출로 병렬 실행.
 * HTTP fetch 오버헤드 완전 제거.
 *
 * ?tier=essential (기본) — 브리핑+판매분석+날씨영향+예측복기+세차 (위쪽 카드용, 빠르게)
 * ?tier=extended        — 상관관계+크로스인사이트+타이밍 (아래쪽 카드용, 나중에)
 * ?tier=all             — 전부 (레거시 호환)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tier = request.nextUrl.searchParams.get("tier") || "essential";

  // weather forecast를 한 번만 가져와서 필요한 함수에 주입
  let weatherForecast: any = null;
  try {
    const wxRes = await fetch(`${request.nextUrl.origin}/api/weather`, { next: { revalidate: 600 } });
    if (wxRes.ok) weatherForecast = await wxRes.json();
  } catch {}

  // 개별 실패 시 null로 대체
  async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    try {
      console.time(`[dashboard-all] ${label}`);
      const result = await fn();
      console.timeEnd(`[dashboard-all] ${label}`);
      return result;
    } catch (e) {
      console.timeEnd(`[dashboard-all] ${label}`);
      console.error(`[dashboard-all] ${label} failed:`, e);
      return null;
    }
  }

  console.time(`[dashboard-all] total (tier=${tier})`);

  if (tier === "extended") {
    const [correlation, timing, crossInsights] = await Promise.all([
      safe("correlation", () => getCorrelationMatrix(id, { compact: true })),
      safe("timing", () => getTimingAnalysis(id)),
      safe("crossInsights", () => getCrossInsights(id, { compact: true })),
    ]);
    console.timeEnd(`[dashboard-all] total (tier=${tier})`);
    return NextResponse.json(
      { correlation, timing, crossInsights },
      { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=120" } }
    );
  }

  if (tier === "all") {
    const [insights, salesAnalysis, weatherSales, forecast, carwash, correlation, timing, crossInsights] =
      await Promise.all([
        safe("insights", () => getDashboardInsights(id)),
        safe("salesAnalysis", () => getSalesAnalysis(id)),
        safe("weatherSales", () => getWeatherSales(id, weatherForecast)),
        safe("forecast", () => getForecastReview(id)),
        safe("carwash", () => getCarwashSummary(id, { compact: true, weatherForecast })),
        safe("correlation", () => getCorrelationMatrix(id, { compact: true })),
        safe("timing", () => getTimingAnalysis(id)),
        safe("crossInsights", () => getCrossInsights(id, { compact: true })),
      ]);
    console.timeEnd(`[dashboard-all] total (tier=${tier})`);
    return NextResponse.json(
      { insights, salesAnalysis, weatherSales, timing, forecast, correlation, carwash, crossInsights },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" } }
    );
  }

  // Default: essential
  const [insights, salesAnalysis, weatherSales, forecast, carwash] = await Promise.all([
    safe("insights", () => getDashboardInsights(id)),
    safe("salesAnalysis", () => getSalesAnalysis(id)),
    safe("weatherSales", () => getWeatherSales(id, weatherForecast)),
    safe("forecast", () => getForecastReview(id)),
    safe("carwash", () => getCarwashSummary(id, { compact: true, weatherForecast })),
  ]);
  console.timeEnd(`[dashboard-all] total (tier=${tier})`);
  return NextResponse.json(
    { insights, salesAnalysis, weatherSales, forecast, carwash },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" } }
  );
}
