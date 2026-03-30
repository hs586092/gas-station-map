import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const maxDuration = 60;

/**
 * GET /api/cleanup-traffic
 *
 * 30일 이상 된 traffic_snapshots 삭제 (매일 새벽 3시 크론)
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = createServiceClient();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  const { error, count } = await supabase
    .from("traffic_snapshots")
    .delete()
    .lt("collected_at", cutoff.toISOString());

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const result = {
    success: true,
    deleted: count ?? 0,
    cutoffDate: cutoff.toISOString(),
  };

  console.log("[cleanup-traffic]", JSON.stringify(result));
  return NextResponse.json(result);
}
