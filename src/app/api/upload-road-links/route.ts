import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const maxDuration = 300;

/**
 * POST /api/upload-road-links
 *
 * road_links.json 데이터를 Supabase road_links 테이블에 업로드
 * Body: { links: Array<{ link_id, f_node, t_node, road_name, ... }> }
 *
 * 용량이 크므로 청크 단위로 전송 가능:
 *   Query: ?offset=0&chunk=10000
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const body = await request.json();
  const links: Array<{
    link_id: string;
    f_node: string;
    t_node: string;
    road_name: string;
    road_rank: string;
    road_no: string;
    lanes: number;
    max_spd: number;
    length: number;
    center_lat: number;
    center_lng: number;
    start_lat: number;
    start_lng: number;
    end_lat: number;
    end_lng: number;
  }> = body.links;

  if (!links || !Array.isArray(links) || links.length === 0) {
    return NextResponse.json(
      { error: "links 배열이 필요합니다." },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  let inserted = 0;
  let errors = 0;

  // 500개씩 배치 upsert
  for (let i = 0; i < links.length; i += 500) {
    const batch = links.slice(i, i + 500);
    const { error } = await supabase
      .from("road_links")
      .upsert(batch, { onConflict: "link_id", ignoreDuplicates: false });

    if (error) {
      console.error(`road_links upsert error (batch ${i}):`, error.message);
      errors++;
    } else {
      inserted += batch.length;
    }
  }

  return NextResponse.json({
    success: errors === 0,
    total: links.length,
    inserted,
    errors,
  });
}
