import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * GET /api/oil-prices?days=60
 * 최근 N일간 국제유가 데이터 반환 (기본 60일)
 */
export async function GET(request: NextRequest) {
  const days = parseInt(request.nextUrl.searchParams.get("days") || "60", 10);
  const limit = Math.min(Math.max(days, 1), 365);

  const { data, error } = await supabase
    .from("oil_prices")
    .select("date, wti, brent")
    .order("date", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json(
      { error: "유가 데이터를 가져오는데 실패했습니다." },
      { status: 500 }
    );
  }

  // 오래된 순으로 정렬해서 반환 (차트용)
  const prices = (data || []).reverse();

  // 최신 데이터 + 2주 전 대비 변동 계산
  let summary = null;
  if (prices.length > 0) {
    const latest = prices[prices.length - 1];
    // 14일 전에 가장 가까운 데이터
    const twoWeeksAgo = prices.find((p) => {
      const diff = (new Date(latest.date).getTime() - new Date(p.date).getTime()) / 86400000;
      return diff >= 12 && diff <= 16;
    }) || (prices.length > 10 ? prices[prices.length - 11] : prices[0]);

    summary = {
      date: latest.date,
      wti: latest.wti,
      brent: latest.brent,
      wtiChange: latest.wti && twoWeeksAgo.wti
        ? +(latest.wti - twoWeeksAgo.wti).toFixed(2)
        : null,
      brentChange: latest.brent && twoWeeksAgo.brent
        ? +(latest.brent - twoWeeksAgo.brent).toFixed(2)
        : null,
      twoWeeksAgoDate: twoWeeksAgo.date,
    };
  }

  return NextResponse.json(
    { prices, summary },
    {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600",
      },
    }
  );
}
