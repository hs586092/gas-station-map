import { NextRequest, NextResponse } from "next/server";
import { backfillForecastActuals } from "@/lib/dashboard/backfill-forecast-actuals";

const GAS_WEBAPP_URL = process.env.GAS_SYNC_SALES_URL;

/**
 * POST /api/sync-sales  — 대시보드 "데이터 새로고침" 버튼
 * GET  /api/sync-sales  — Vercel 크론 (매일 00:20 UTC = KST 09:20)
 *
 * GAS webapp 을 호출해 최근 판매 데이터를 Supabase 로 동기화한다.
 * 완료 직후 `forecast_history.actual_*` 를 자동으로 backfill 한다.
 *
 * GET 은 Vercel 크론 전용이므로 CRON_SECRET 인증을 요구한다.
 * POST 는 대시보드 버튼에서 호출하므로 인증 없이 허용한다.
 */
const DEFAULT_STATION_ID = "A0003453";

// ── 공용 동기화 로직 ──

async function runSync(): Promise<NextResponse> {
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

// ── GET: Vercel 크론 전용 (CRON_SECRET 인증 필수) ──

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return runSync();
}

// ── POST: 대시보드 "데이터 새로고침" 버튼 ──

export async function POST() {
  return runSync();
}
