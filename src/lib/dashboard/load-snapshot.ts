import { supabase } from "@/lib/supabase";

/**
 * 대시보드 스냅샷 공용 로더.
 *
 * 이 함수가 dashboard_snapshot 테이블에 접근하는 **유일한 소비 경로**다.
 * 헤더 API(/api/snapshot/[id])와 AI 브리핑 모두 이 함수를 거치도록 하여,
 * "헤더와 브리핑이 같은 시점의 같은 데이터를 본다"는 invariant 를 강제한다.
 *
 * 예외: 스냅샷 **생성자** 는 build-snapshot.ts 가 담당. 소비는 여기서만.
 */

export type DashboardSnapshotEssential = {
  insights: unknown | null;
  salesAnalysis: unknown | null;
  weatherSales: unknown | null;
  forecast: unknown | null;
  carwash: unknown | null;
  integratedForecast: unknown | null;
  dataIntegrityWarnings: unknown[];
};

export type DashboardSnapshotExtended = {
  correlation: unknown | null;
  timing: unknown | null;
  crossInsights: unknown | null;
  correctionShadow: unknown | null;
};

export type DashboardSnapshotMeta = {
  stationId: string;
  updatedAt: string;
  /** integratedForecast.forecast.date 에서 추출한 기준일 (YYYY-MM-DD). 없으면 null. */
  referenceDate: string | null;
  /** 현 구현은 snapshot 만. 향후 realtime_fallback 추가 대비해 유니온으로 열어둠. */
  source: "snapshot";
};

export type DashboardSnapshotPayload = {
  essential: DashboardSnapshotEssential;
  extended: DashboardSnapshotExtended;
  meta: DashboardSnapshotMeta;
};

type RawSnapshotRow = {
  essential_data: Partial<DashboardSnapshotEssential> | null;
  extended_data: Partial<DashboardSnapshotExtended> | null;
  updated_at: string;
};

function extractReferenceDate(integratedForecast: unknown): string | null {
  if (integratedForecast == null || typeof integratedForecast !== "object") return null;
  const forecast = (integratedForecast as { forecast?: unknown }).forecast;
  if (forecast == null || typeof forecast !== "object") return null;
  const date = (forecast as { date?: unknown }).date;
  return typeof date === "string" ? date : null;
}

export async function loadDashboardSnapshot(
  stationId: string
): Promise<DashboardSnapshotPayload | null> {
  const { data, error } = await supabase
    .from("dashboard_snapshot")
    .select("essential_data, extended_data, updated_at")
    .eq("station_id", stationId)
    .single<RawSnapshotRow>();

  if (error || !data) return null;

  const essentialData = data.essential_data ?? {};
  const extendedData = data.extended_data ?? {};

  const essential: DashboardSnapshotEssential = {
    insights: essentialData.insights ?? null,
    salesAnalysis: essentialData.salesAnalysis ?? null,
    weatherSales: essentialData.weatherSales ?? null,
    forecast: essentialData.forecast ?? null,
    carwash: essentialData.carwash ?? null,
    integratedForecast: essentialData.integratedForecast ?? null,
    dataIntegrityWarnings: Array.isArray(essentialData.dataIntegrityWarnings)
      ? essentialData.dataIntegrityWarnings
      : [],
  };

  const extended: DashboardSnapshotExtended = {
    correlation: extendedData.correlation ?? null,
    timing: extendedData.timing ?? null,
    crossInsights: extendedData.crossInsights ?? null,
    correctionShadow: extendedData.correctionShadow ?? null,
  };

  return {
    essential,
    extended,
    meta: {
      stationId,
      updatedAt: data.updated_at,
      referenceDate: extractReferenceDate(essential.integratedForecast),
      source: "snapshot",
    },
  };
}
