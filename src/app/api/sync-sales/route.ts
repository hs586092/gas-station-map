import { NextResponse } from "next/server";
import { backfillForecastActuals } from "@/lib/dashboard/backfill-forecast-actuals";

const GAS_WEBAPP_URL = process.env.GAS_SYNC_SALES_URL;

/**
 * POST /api/sync-sales
 *
 * GAS webapp 을 호출해 최근 판매 데이터를 Supabase 로 동기화한다.
 * 완료 직후 `forecast_history.actual_*` 를 자동으로 backfill 한다.
 *
 * ## 왜 여기서 backfill 을 또 하는가
 * 프론트는 보통 sync-sales → snapshot/rebuild 순으로 호출하고,
 * snapshot/rebuild 도 내부에서 backfill 을 한다. 이중 실행이지만
 * - API 가 직접 호출될 수도 있고 (e.g. 외부 스크립트)
 * - rebuild 가 실패해도 forecast_history 자체는 최신이 되도록
 * 여기서 한 번 더 보장한다. (defense in depth)
 *
 * backfill 대상 stationId 는 현재 대시보드가 고정 주유소(A0003453)를
 * 사용하므로 그 값을 기본으로 한다. 나중에 다중 주유소로 확장되면
 * sales_data 에서 영향받은 station_id 목록을 뽑아 순회하면 된다.
 */
const DEFAULT_STATION_ID = "A0003453";

export async function POST() {
  if (!GAS_WEBAPP_URL) {
    return NextResponse.json(
      { error: "GAS_SYNC_SALES_URL 환경변수가 설정되지 않았습니다." },
      { status: 500 },
    );
  }

  try {
    const res = await fetch(GAS_WEBAPP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "syncRecentSales" }),
    });

    const data = await res.json();

    if (!data.success) {
      return NextResponse.json(
        { error: data.error || "동기화 실패" },
        { status: 502 },
      );
    }

    // GAS 동기화 완료 → forecast_history.actual 즉시 backfill
    const backfill = await backfillForecastActuals(DEFAULT_STATION_ID);

    return NextResponse.json({
      success: true,
      message: data.message,
      backfill,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "GAS 호출 실패" },
      { status: 502 },
    );
  }
}
