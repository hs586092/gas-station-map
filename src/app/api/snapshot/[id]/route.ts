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

  if (tier === "essential") {
    return NextResponse.json(
      { ...data.essential_data, _snapshot: { updatedAt } },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30" } }
    );
  }

  if (tier === "extended") {
    return NextResponse.json(
      { ...data.extended_data, _snapshot: { updatedAt } },
      { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=60" } }
    );
  }

  // all
  return NextResponse.json(
    {
      ...data.essential_data,
      ...data.extended_data,
      _snapshot: { updatedAt },
    },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30" } }
  );
}
