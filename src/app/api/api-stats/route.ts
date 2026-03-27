// 관리용 API - 프론트엔드 UI 없음, 직접 URL 호출로 확인용
// 일일/주간 API 호출 통계 및 stations 캐시 현황 조회
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  // 오늘의 API 호출 통계
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data: todayLogs } = await supabase
    .from("api_call_log")
    .select("endpoint, call_count, caller, success, called_at")
    .gte("called_at", today.toISOString())
    .order("called_at", { ascending: false });

  const todayTotal = (todayLogs || []).reduce(
    (sum, log) => sum + log.call_count,
    0
  );

  // 최근 7일 일별 통계
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const { data: weekLogs } = await supabase
    .from("api_call_log")
    .select("call_count, called_at")
    .gte("called_at", weekAgo.toISOString())
    .order("called_at", { ascending: true });

  const dailyStats = new Map<string, number>();
  for (const log of weekLogs || []) {
    const date = new Date(log.called_at).toISOString().split("T")[0];
    dailyStats.set(date, (dailyStats.get(date) || 0) + log.call_count);
  }

  // stations 테이블 현황
  const { count: stationCount } = await supabase
    .from("stations")
    .select("*", { count: "exact", head: true });

  return NextResponse.json({
    today: {
      totalCalls: todayTotal,
      dailyLimit: 1500,
      remaining: 1500 - todayTotal,
      logs: todayLogs || [],
    },
    weekly: Array.from(dailyStats.entries()).map(([date, calls]) => ({
      date,
      calls,
    })),
    cache: {
      stationCount: stationCount || 0,
    },
  });
}
