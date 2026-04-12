import { supabase } from "@/lib/supabase";

/**
 * 데이터 정합성 감시 — 3가지 체크
 *
 * 1. forecast_history 빈 row: predicted_volume IS NULL (오늘 제외, 최근 7일)
 * 2. forecast_history actual 누락: 어제 actual_volume IS NULL
 * 3. sales_data 어제 행 부재: GAS 동기화 완전 실패 감지
 *
 * build-snapshot 및 dashboard-all 에서 호출.
 * 이상 없으면 빈 배열, 이상 시 경고 배열 반환.
 * 체크 자체가 실패하면 check_failed 경고를 반환 (메타 감시).
 */

export interface DataIntegrityWarning {
  type: "empty_forecast" | "missing_actual" | "missing_sales" | "check_failed";
  date: string;
  message: string;
  recoverable: boolean;
}

/** KST 기준 오늘/어제 날짜 문자열 (YYYY-MM-DD) */
function getKSTDates(): { today: string; yesterday: string } {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = kst.toISOString().slice(0, 10);

  const yd = new Date(kst.getTime() - 24 * 60 * 60 * 1000);
  const yesterday = yd.toISOString().slice(0, 10);

  return { today, yesterday };
}

export async function checkDataIntegrity(
  stationId: string
): Promise<DataIntegrityWarning[]> {
  try {
    const { today, yesterday } = getKSTDates();
    const sevenAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

    const warnings: DataIntegrityWarning[] = [];

    // 3가지 체크를 병렬 실행
    const [emptyFcRes, actualRes, salesRes] = await Promise.all([
      // 1) 빈 row: 최근 7일 중 오늘 제외, predicted_volume IS NULL
      supabase
        .from("forecast_history")
        .select("forecast_date")
        .eq("station_id", stationId)
        .gte("forecast_date", sevenAgo)
        .lt("forecast_date", today)
        .is("predicted_volume", null),

      // 2) actual 누락: 어제 행의 actual_volume IS NULL
      supabase
        .from("forecast_history")
        .select("forecast_date, actual_volume")
        .eq("station_id", stationId)
        .eq("forecast_date", yesterday),

      // 3) sales_data 어제 행 부재
      supabase
        .from("sales_data")
        .select("date")
        .eq("station_id", stationId)
        .eq("date", yesterday),
    ]);

    // 1) 빈 forecast row
    if (emptyFcRes.error) throw new Error(`empty_forecast query: ${emptyFcRes.error.message}`);
    for (const row of emptyFcRes.data ?? []) {
      const d = row.forecast_date as string;
      warnings.push({
        type: "empty_forecast",
        date: d,
        message: `${d.slice(5)} 예측값 미생성`,
        recoverable: false,
      });
    }

    // 2) actual 누락
    if (actualRes.error) throw new Error(`missing_actual query: ${actualRes.error.message}`);
    const yesterdayFc = actualRes.data?.[0];
    if (yesterdayFc && yesterdayFc.actual_volume == null) {
      warnings.push({
        type: "missing_actual",
        date: yesterday,
        message: `어제(${yesterday.slice(5)}) 실측 미연결 · 새로고침 시 해소`,
        recoverable: true,
      });
    }

    // 3) sales_data 부재
    if (salesRes.error) throw new Error(`missing_sales query: ${salesRes.error.message}`);
    if (!salesRes.data || salesRes.data.length === 0) {
      warnings.push({
        type: "missing_sales",
        date: yesterday,
        message: `어제(${yesterday.slice(5)}) 판매 데이터 미수신`,
        recoverable: true,
      });
    }

    return warnings;
  } catch (e) {
    return [
      {
        type: "check_failed",
        date: new Date().toISOString().slice(0, 10),
        message: "정합성 검사 실행 실패",
        recoverable: false,
      },
    ];
  }
}
