import { NextRequest, NextResponse } from "next/server";
import { buildDashboardSnapshot } from "@/lib/dashboard/build-snapshot";
import { backfillForecastActuals } from "@/lib/dashboard/backfill-forecast-actuals";

export const maxDuration = 300;

/**
 * POST /api/snapshot/rebuild
 *
 * 대시보드 스냅샷을 재생성한다.
 * body: { stationId: string }
 *
 * 호출 시점:
 *  1. 크론 (매일 00:30, 데이터 수집 완료 후)
 *  2. 유저가 새로고침 버튼 클릭 시
 *  3. sync-sales 완료 후 자동
 *
 * ⚠️ 중요: buildDashboardSnapshot 을 호출하기 "직전"에 반드시
 * backfillForecastActuals 를 await 해야 한다. 그래야 스냅샷이
 * 최신 actual 값을 얼려서 저장한다. (자세한 이유는 helper 파일 주석 참고)
 */
async function runRebuild(stationId: string, origin: string) {
  // 1) forecast_history.actual_* 를 sales_data / carwash_daily 로부터 먼저 채운다.
  const backfill = await backfillForecastActuals(stationId);

  // 2) weather forecast (스냅샷 빌드 입력)
  let weatherForecast = null;
  try {
    const wxRes = await fetch(`${origin}/api/weather`, {
      next: { revalidate: 600 },
    });
    if (wxRes.ok) weatherForecast = await wxRes.json();
  } catch {}

  // 3) 스냅샷 생성 (이 시점에 forecast_history 는 최신이 되어 있다)
  const result = await buildDashboardSnapshot(stationId, weatherForecast);
  return { backfill, result };
}

export async function POST(request: NextRequest) {
  let stationId: string;
  try {
    const body = await request.json();
    stationId = body.stationId;
  } catch {
    stationId = "A0003453";
  }

  if (!stationId) {
    return NextResponse.json({ error: "stationId required" }, { status: 400 });
  }

  const { backfill, result } = await runRebuild(stationId, request.nextUrl.origin);

  if (!result.success) {
    return NextResponse.json(
      { error: result.error, durationMs: result.durationMs, backfill },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    stationId,
    durationMs: result.durationMs,
    backfill,
  });
}

/**
 * GET /api/snapshot/rebuild
 *
 * 크론에서 GET 으로 호출할 수 있도록 지원 (Vercel 크론은 GET 만).
 */
export async function GET(request: NextRequest) {
  const stationId = request.nextUrl.searchParams.get("stationId") || "A0003453";
  const { backfill, result } = await runRebuild(stationId, request.nextUrl.origin);

  if (!result.success) {
    return NextResponse.json(
      { error: result.error, durationMs: result.durationMs, backfill },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    stationId,
    durationMs: result.durationMs,
    backfill,
  });
}
