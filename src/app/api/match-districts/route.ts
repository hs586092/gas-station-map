import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const maxDuration = 300;

const SEOUL_DISTRICTS = [
  { name: "종로구", lat: 37.5735, lng: 126.9790 },
  { name: "중구", lat: 37.5641, lng: 126.9979 },
  { name: "용산구", lat: 37.5326, lng: 126.9907 },
  { name: "성동구", lat: 37.5634, lng: 127.0368 },
  { name: "광진구", lat: 37.5385, lng: 127.0823 },
  { name: "동대문구", lat: 37.5744, lng: 127.0396 },
  { name: "중랑구", lat: 37.6064, lng: 127.0928 },
  { name: "성북구", lat: 37.5894, lng: 127.0167 },
  { name: "강북구", lat: 37.6396, lng: 127.0256 },
  { name: "도봉구", lat: 37.6688, lng: 127.0472 },
  { name: "노원구", lat: 37.6542, lng: 127.0568 },
  { name: "은평구", lat: 37.6027, lng: 126.9292 },
  { name: "서대문구", lat: 37.5791, lng: 126.9368 },
  { name: "마포구", lat: 37.5638, lng: 126.9084 },
  { name: "양천구", lat: 37.5170, lng: 126.8665 },
  { name: "강서구", lat: 37.5510, lng: 126.8496 },
  { name: "구로구", lat: 37.4955, lng: 126.8878 },
  { name: "금천구", lat: 37.4519, lng: 126.8967 },
  { name: "영등포구", lat: 37.5264, lng: 126.8963 },
  { name: "동작구", lat: 37.5124, lng: 126.9393 },
  { name: "관악구", lat: 37.4784, lng: 126.9516 },
  { name: "서초구", lat: 37.4837, lng: 127.0324 },
  { name: "강남구", lat: 37.5172, lng: 127.0473 },
  { name: "송파구", lat: 37.5146, lng: 127.1066 },
  { name: "강동구", lat: 37.5301, lng: 127.1238 },
];

// 최대 매칭 거리 (km) - 구청에서 5km 이상 떨어지면 서울이 아님
const MAX_DISTRICT_DISTANCE_KM = 5;

// Haversine 거리 계산 (km 단위)
function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function extractDistrict(address: string): string | null {
  const match = address.match(/서울(?:특별시|시)?\s*(\S+구)/);
  return match ? match[1] : null;
}

// 가장 가까운 구청을 찾되, 5km 이내인 경우만 서울로 판정
function findNearestDistrict(lat: number, lng: number): { name: string; distKm: number } | null {
  let minDist = Infinity;
  let nearest = SEOUL_DISTRICTS[0].name;
  for (const d of SEOUL_DISTRICTS) {
    const dist = distanceKm(lat, lng, d.lat, d.lng);
    if (dist < minDist) {
      minDist = dist;
      nearest = d.name;
    }
  }
  if (minDist > MAX_DISTRICT_DISTANCE_KM) {
    return null; // 서울이 아님
  }
  return { name: nearest, distKm: minDist };
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const PAGE_SIZE = 1000;

  // 1. 서울 25개 구 district만 null로 초기화 (경기도 district는 보존)
  const seoulDistrictNames = SEOUL_DISTRICTS.map((d) => d.name);
  while (true) {
    const { data: resetData, error: resetError } = await supabase
      .from("stations")
      .update({ district: null })
      .in("district", seoulDistrictNames)
      .select("id");

    if (resetError) {
      return NextResponse.json({ error: `Reset failed: ${resetError.message}` }, { status: 500 });
    }
    if (!resetData || resetData.length < PAGE_SIZE) break;
  }

  // 2. 모든 주유소 가져오기 (페이징)
  const stations: { id: string; lat: number; lng: number; old_address: string; new_address: string }[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("stations")
      .select("id, lat, lng, old_address, new_address")
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data || data.length === 0) break;
    stations.push(...data);
    from += PAGE_SIZE;
    if (data.length < PAGE_SIZE) break;
  }

  let addressMatched = 0;
  let coordMatched = 0;
  let skipped = 0;
  const districtCounts: Record<string, number> = {};

  const updates: { id: string; district: string }[] = [];

  for (const s of stations) {
    let district: string | null = null;

    // 1순위: 주소에서 '서울 OO구' 추출 (가장 정확)
    const addr = s.old_address || s.new_address || "";
    district = extractDistrict(addr);
    if (district) {
      // 주소에서 서울 자치구를 찾았으므로 신뢰
      addressMatched++;
    }

    // 2순위: 좌표 기반 → 가장 가까운 구청, 5km 이내만
    if (!district && s.lat && s.lng) {
      const nearest = findNearestDistrict(s.lat, s.lng);
      if (nearest) {
        district = nearest.name;
        coordMatched++;
      } else {
        // 5km 이내 구청 없음 → 서울 아님, district=null 유지
        skipped++;
        continue;
      }
    }

    if (district) {
      updates.push({ id: s.id, district });
      districtCounts[district] = (districtCounts[district] || 0) + 1;
    } else {
      skipped++;
    }
  }

  // 배치 업데이트
  let updatedCount = 0;
  for (const item of updates) {
    const { error: updateErr } = await supabase
      .from("stations")
      .update({ district: item.district })
      .eq("id", item.id);

    if (!updateErr) updatedCount++;
  }

  // 자치구별 정렬
  const sortedDistricts = Object.entries(districtCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  const seoulTotal = sortedDistricts.reduce((s, d) => s + d.count, 0);

  return NextResponse.json({
    success: true,
    total: stations.length,
    updated: updatedCount,
    matching: {
      address_matched: addressMatched,
      coord_matched: coordMatched,
      skipped_not_seoul: skipped,
    },
    seoul_total: seoulTotal,
    districts: sortedDistricts,
  });
}
