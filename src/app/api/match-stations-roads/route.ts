import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const maxDuration = 300;

/**
 * POST /api/match-stations-roads
 *
 * 주유소 ↔ 가장 가까운 도로 링크 매칭
 * stations 테이블의 모든 주유소에 대해 road_links에서 최근접 링크를 찾아 업데이트
 *
 * Query params:
 *   maxDistance=500  최대 매칭 거리 (m, 기본 500)
 *   limit=0         처리할 주유소 수 (0=전체)
 *   unmatchedOnly=true  아직 매칭 안 된 주유소만 (기본 true)
 */
export async function POST(request: NextRequest) {
  // 인증 체크
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const { searchParams } = request.nextUrl;
  const maxDistance = parseInt(searchParams.get("maxDistance") || "500", 10);
  const limit = parseInt(searchParams.get("limit") || "0", 10);
  const unmatchedOnly = searchParams.get("unmatchedOnly") !== "false";

  const supabase = createServiceClient();

  // 1. 주유소 목록 가져오기
  let query = supabase
    .from("stations")
    .select("id, lat, lng")
    .not("lat", "is", null)
    .not("lng", "is", null);

  if (unmatchedOnly) {
    query = query.is("nearest_link_id", null);
  }

  if (limit > 0) {
    query = query.limit(limit);
  }

  const { data: stations, error: stErr } = await query;
  if (stErr) {
    return NextResponse.json({ error: stErr.message }, { status: 500 });
  }
  if (!stations || stations.length === 0) {
    return NextResponse.json({
      success: true,
      message: "매칭할 주유소가 없습니다.",
      matched: 0,
      total: 0,
    });
  }

  // 2. 주유소별로 최근접 도로 링크 찾기
  let matched = 0;
  let noMatch = 0;
  const batchSize = 50;

  for (let i = 0; i < stations.length; i += batchSize) {
    const batch = stations.slice(i, i + batchSize);
    const updates: {
      id: string;
      nearest_link_id: string;
      link_distance: number;
      road_name: string | null;
      road_rank: string;
    }[] = [];

    for (const station of batch) {
      // 주유소 근처 도로 링크 검색 (위경도 범위)
      const degPerM = 1 / 111000;
      const latDelta = maxDistance * degPerM;
      const lngDelta = maxDistance * degPerM / Math.cos(station.lat * (Math.PI / 180));

      const { data: links, error: linkErr } = await supabase
        .from("road_links")
        .select("link_id, center_lat, center_lng, road_name, road_rank, lanes")
        .gte("center_lat", station.lat - latDelta)
        .lte("center_lat", station.lat + latDelta)
        .gte("center_lng", station.lng - lngDelta)
        .lte("center_lng", station.lng + lngDelta);

      if (linkErr || !links || links.length === 0) {
        noMatch++;
        continue;
      }

      // 가장 가까운 링크 찾기 (도로 등급 가중: 주요 도로 우선)
      let bestLink = links[0];
      let bestScore = Infinity;

      for (const link of links) {
        const dLat = (link.center_lat - station.lat) * 111000;
        const dLng =
          (link.center_lng - station.lng) *
          111000 *
          Math.cos(station.lat * (Math.PI / 180));
        const dist = Math.sqrt(dLat * dLat + dLng * dLng);

        // 도로 등급 보정: 주요 도로일수록 약간 가까운 것으로 취급
        const rankBonus: Record<string, number> = {
          "101": 0.7, // 고속도로
          "102": 0.75, // 도시고속도로
          "103": 0.8, // 일반국도
          "104": 0.85, // 특별광역시도
          "105": 0.9, // 국가지원지방도
          "106": 0.95, // 지방도
        };
        const score = dist * (rankBonus[link.road_rank] || 1.0);

        if (score < bestScore) {
          bestScore = score;
          bestLink = link;
        }
      }

      // 실제 거리 재계산
      const dLat = (bestLink.center_lat - station.lat) * 111000;
      const dLng =
        (bestLink.center_lng - station.lng) *
        111000 *
        Math.cos(station.lat * (Math.PI / 180));
      const distance = Math.round(Math.sqrt(dLat * dLat + dLng * dLng));

      if (distance <= maxDistance) {
        updates.push({
          id: station.id,
          nearest_link_id: bestLink.link_id,
          link_distance: distance,
          road_name: bestLink.road_name,
          road_rank: bestLink.road_rank,
        });
      } else {
        noMatch++;
      }
    }

    // 배치 업데이트
    for (const u of updates) {
      const { error: upErr } = await supabase
        .from("stations")
        .update({
          nearest_link_id: u.nearest_link_id,
          link_distance: u.link_distance,
          road_name: u.road_name,
          road_rank: u.road_rank,
        })
        .eq("id", u.id);

      if (!upErr) matched++;
    }
  }

  const result = {
    success: true,
    total: stations.length,
    matched,
    noMatch,
    maxDistance,
    unmatchedOnly,
  };

  console.log("[match-stations-roads]", JSON.stringify(result));
  return NextResponse.json(result);
}
