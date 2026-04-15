import { supabase } from "@/lib/supabase";
import { getDashboardInsights } from "./insights";
import { getSalesAnalysis } from "./sales-analysis";
import { getWeatherSales } from "./weather-sales";
import { getForecastReview } from "./forecast-review";
import { getCarwashSummary } from "./carwash-summary";
import { getCorrelationMatrix } from "./correlation-matrix";
import { getTimingAnalysis } from "./timing-analysis";
import { getCrossInsights } from "./cross-insights";
import { getIntegratedForecast } from "./integrated-forecast";
import { checkDataIntegrity } from "./check-data-integrity";
import { getForecastSelfDiagnosis } from "./forecast-self-diagnosis";

/**
 * 대시보드 스냅샷을 재생성하여 dashboard_snapshot 테이블에 저장한다.
 *
 * 8개 분석 함수를 병렬 실행 → essential_data + extended_data JSONB로 upsert.
 * 이후 대시보드는 이 테이블에서 1행만 읽으면 됨 (57개 쿼리 → 1개).
 */
export async function buildDashboardSnapshot(
  stationId: string,
  weatherForecast?: any
): Promise<{ success: boolean; durationMs: number; error?: string }> {
  const start = Date.now();

  try {
    // 8개 함수 병렬 실행 — 개별 실패 시 null
    // 통합 모델을 먼저 실행 → 계수를 forecast-review에 전달
    const [integratedForecast, insights, salesAnalysis, weatherSales, carwash, correlation, timing, crossInsights] =
      await Promise.all([
        getIntegratedForecast(stationId, weatherForecast).catch(() => null),
        getDashboardInsights(stationId).catch(() => null),
        getSalesAnalysis(stationId).catch(() => null),
        getWeatherSales(stationId, weatherForecast).catch(() => null),
        getCarwashSummary(stationId, { compact: true, weatherForecast }).catch(() => null),
        getCorrelationMatrix(stationId, { compact: true }).catch(() => null),
        getTimingAnalysis(stationId).catch(() => null),
        getCrossInsights(stationId, { compact: true }).catch(() => null),
      ]);
    const coeffs = (integratedForecast as any)?.coefficients ?? null;
    const selfDiagnosis = await getForecastSelfDiagnosis(stationId).catch(() => null);
    const forecast = await getForecastReview(stationId, coeffs, selfDiagnosis).catch(() => null);

    // 데이터 정합성 감시 (체크 실패 시에도 빈 배열이 아닌 check_failed 경고 반환)
    const dataIntegrityWarnings = await checkDataIntegrity(stationId);

    const essentialData = { insights, salesAnalysis, weatherSales, forecast, carwash, integratedForecast, dataIntegrityWarnings };
    const extendedData = { correlation, timing, crossInsights };

    const { error } = await supabase
      .from("dashboard_snapshot")
      .upsert(
        {
          station_id: stationId,
          essential_data: essentialData,
          extended_data: extendedData,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "station_id" }
      );

    const durationMs = Date.now() - start;

    if (error) {
      console.error("[snapshot] upsert failed:", error.message);
      return { success: false, durationMs, error: error.message };
    }

    console.log(`[snapshot] ${stationId} rebuilt in ${durationMs}ms`);
    return { success: true, durationMs };
  } catch (e) {
    const durationMs = Date.now() - start;
    const msg = e instanceof Error ? e.message : "unknown error";
    console.error("[snapshot] build failed:", msg);
    return { success: false, durationMs, error: msg };
  }
}
