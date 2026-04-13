import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data, error } = await supabase
    .from("price_history")
    .select("gasoline_price, diesel_price, premium_price, collected_at")
    .eq("station_id", id)
    .gte("collected_at", thirtyDaysAgo.toISOString())
    .order("collected_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 날짜별로 그룹핑 (하루에 여러 번 수집된 경우 마지막 값 사용)
  const byDate = new Map<string, { gasoline: number | null; diesel: number | null; premium: number | null }>();
  for (const row of data || []) {
    const date = new Date(row.collected_at).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
    byDate.set(date, {
      gasoline: row.gasoline_price,
      diesel: row.diesel_price,
      premium: row.premium_price,
    });
  }

  const history = Array.from(byDate.entries()).map(([date, prices]) => ({
    date,
    gasoline: prices.gasoline,
    diesel: prices.diesel,
    premium: prices.premium,
  }));

  return NextResponse.json(
    { history },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600" } }
  );
}
