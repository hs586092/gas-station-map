import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * GET /api/snapshot/[id]?tier=essential|extended|all
 *
 * dashboard_snapshot 테이블에서 1행 읽기.
 * 57개 쿼리 → 1개 쿼리.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tier = request.nextUrl.searchParams.get("tier") || "all";

  const { data, error } = await supabase
    .from("dashboard_snapshot")
    .select("essential_data, extended_data, updated_at")
    .eq("station_id", id)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "스냅샷 없음 — 새로고침 버튼을 눌러주세요", code: "NO_SNAPSHOT" },
      { status: 404 }
    );
  }

  const updatedAt = data.updated_at;

  // dashboard_snapshot 은 이미 "캐시 테이블" 역할이므로 edge 에 한 겹 더 얹지 않는다.
  // edge 캐시를 두면 rebuild 직후에도 브라우저가 stale 응답을 받아 "새로고침 1회로
  // 복구 안 됨" 증상이 발생한다 (2026-04-13 현수 진단).
  const headers = { "Cache-Control": "no-store, must-revalidate" };

  if (tier === "essential") {
    return NextResponse.json(
      { ...data.essential_data, _snapshot: { updatedAt } },
      { headers }
    );
  }

  if (tier === "extended") {
    return NextResponse.json(
      { ...data.extended_data, _snapshot: { updatedAt } },
      { headers }
    );
  }

  // all
  return NextResponse.json(
    {
      ...data.essential_data,
      ...data.extended_data,
      _snapshot: { updatedAt },
    },
    { headers }
  );
}
