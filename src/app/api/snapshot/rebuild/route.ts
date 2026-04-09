import { NextRequest, NextResponse } from "next/server";
import { buildDashboardSnapshot } from "@/lib/dashboard/build-snapshot";

export const maxDuration = 300;

/**
 * POST /api/snapshot/rebuild
 *
 * 대시보드 스냅샷을 재생성한다.
 * body: { stationId: string }
 *
 * 호출 시점:
 *  1. 크론 (매일 04:30, 데이터 수집 완료 후)
 *  2. 유저가 새로고침 버튼 클릭 시
 *  3. sync-sales 완료 후 자동
 */
export async function POST(request: NextRequest) {
  let stationId: string;

  try {
    const body = await request.json();
    stationId = body.stationId;
  } catch {
    // 크론에서 body 없이 호출 시 기본 주유소
    stationId = "A0003453";
  }

  if (!stationId) {
    return NextResponse.json({ error: "stationId required" }, { status: 400 });
  }

  // weather forecast 가져오기 (스냅샷 빌드에 필요)
  let weatherForecast = null;
  try {
    const wxRes = await fetch(`${request.nextUrl.origin}/api/weather`, { next: { revalidate: 600 } });
    if (wxRes.ok) weatherForecast = await wxRes.json();
  } catch {}

  const result = await buildDashboardSnapshot(stationId, weatherForecast);

  if (!result.success) {
    return NextResponse.json(
      { error: result.error, durationMs: result.durationMs },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    stationId,
    durationMs: result.durationMs,
  });
}

/**
 * GET /api/snapshot/rebuild
 *
 * 크론에서 GET으로 호출할 수 있도록 지원.
 * Vercel 크론은 GET만 지원.
 */
export async function GET(request: NextRequest) {
  const stationId = request.nextUrl.searchParams.get("stationId") || "A0003453";

  let weatherForecast = null;
  try {
    const wxRes = await fetch(`${request.nextUrl.origin}/api/weather`, { next: { revalidate: 600 } });
    if (wxRes.ok) weatherForecast = await wxRes.json();
  } catch {}

  const result = await buildDashboardSnapshot(stationId, weatherForecast);

  if (!result.success) {
    return NextResponse.json(
      { error: result.error, durationMs: result.durationMs },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    stationId,
    durationMs: result.durationMs,
  });
}
