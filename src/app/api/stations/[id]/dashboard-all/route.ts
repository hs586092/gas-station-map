import { NextRequest, NextResponse } from "next/server";
import { getDashboardInsights } from "@/lib/dashboard/insights";
import { getSalesAnalysis } from "@/lib/dashboard/sales-analysis";
import { getWeatherSales } from "@/lib/dashboard/weather-sales";
import { getTimingAnalysis } from "@/lib/dashboard/timing-analysis";
import { getForecastReview } from "@/lib/dashboard/forecast-review";
import { getCorrelationMatrix } from "@/lib/dashboard/correlation-matrix";
import { getCarwashSummary } from "@/lib/dashboard/carwash-summary";
import { getCrossInsights } from "@/lib/dashboard/cross-insights";
import { getIntegratedForecast } from "@/lib/dashboard/integrated-forecast";
import { checkDataIntegrity } from "@/lib/dashboard/check-data-integrity";
import { getForecastSelfDiagnosis } from "@/lib/dashboard/forecast-self-diagnosis";

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
    const wxRes = await fetch(`${request.nextUrl.origin}/api/weather`, { cache: "no-store" });
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
    // 통합 모델을 먼저 실행 → 계수를 forecast-review에 전달
    const [integratedForecast, insights, salesAnalysis, weatherSales, carwash, correlation, timing, crossInsights] =
      await Promise.all([
        safe("integratedForecast", () => getIntegratedForecast(id, weatherForecast)),
        safe("insights", () => getDashboardInsights(id)),
        safe("salesAnalysis", () => getSalesAnalysis(id)),
        safe("weatherSales", () => getWeatherSales(id, weatherForecast)),
        safe("carwash", () => getCarwashSummary(id, { compact: true, weatherForecast })),
        safe("correlation", () => getCorrelationMatrix(id, { compact: true })),
        safe("timing", () => getTimingAnalysis(id)),
        safe("crossInsights", () => getCrossInsights(id, { compact: true })),
      ]);
    const coeffs = (integratedForecast as any)?.coefficients ?? null;
    const selfDiagnosis = await safe("selfDiagnosis", () => getForecastSelfDiagnosis(id));
    const forecast = await safe("forecast", () => getForecastReview(id, coeffs, selfDiagnosis));
    const dataIntegrityWarnings = await safe("integrity", () => checkDataIntegrity(id)) ?? [];
    console.timeEnd(`[dashboard-all] total (tier=${tier})`);
    return NextResponse.json(
      { insights, salesAnalysis, weatherSales, timing, forecast, correlation, carwash, crossInsights, integratedForecast, dataIntegrityWarnings },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" } }
    );
  }

  // Default: essential — 통합 모델 먼저, 계수를 forecast-review에 전달
  const [integratedForecast, insights, salesAnalysis, weatherSales, carwash] = await Promise.all([
    safe("integratedForecast", () => getIntegratedForecast(id, weatherForecast)),
    safe("insights", () => getDashboardInsights(id)),
    safe("salesAnalysis", () => getSalesAnalysis(id)),
    safe("weatherSales", () => getWeatherSales(id, weatherForecast)),
    safe("carwash", () => getCarwashSummary(id, { compact: true, weatherForecast })),
  ]);
  const coeffs = (integratedForecast as any)?.coefficients ?? null;
  const selfDiagnosis = await safe("selfDiagnosis", () => getForecastSelfDiagnosis(id));
  const forecast = await safe("forecast", () => getForecastReview(id, coeffs, selfDiagnosis));
  const dataIntegrityWarnings = await safe("integrity", () => checkDataIntegrity(id)) ?? [];
  console.timeEnd(`[dashboard-all] total (tier=${tier})`);
  return NextResponse.json(
    { insights, salesAnalysis, weatherSales, forecast, carwash, integratedForecast, dataIntegrityWarnings },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" } }
  );
}
