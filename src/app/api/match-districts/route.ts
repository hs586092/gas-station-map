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

// 서울 대략적 범위
const SEOUL_BOUNDS = {
  latMin: 37.41,
  latMax: 37.72,
  lngMin: 126.76,
  lngMax: 127.18,
};

function distance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dlat = lat1 - lat2;
  const dlng = (lng1 - lng2) * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.sqrt(dlat * dlat + dlng * dlng);
}

function isInSeoul(lat: number, lng: number): boolean {
  return (
    lat >= SEOUL_BOUNDS.latMin &&
    lat <= SEOUL_BOUNDS.latMax &&
    lng >= SEOUL_BOUNDS.lngMin &&
    lng <= SEOUL_BOUNDS.lngMax
  );
}

function extractDistrict(address: string): string | null {
  const match = address.match(/서울(?:특별시)?\s+(\S+구)/);
  return match ? match[1] : null;
}

function findNearestDistrict(lat: number, lng: number): string {
  let minDist = Infinity;
  let nearest = SEOUL_DISTRICTS[0].name;
  for (const d of SEOUL_DISTRICTS) {
    const dist = distance(lat, lng, d.lat, d.lng);
    if (dist < minDist) {
      minDist = dist;
      nearest = d.name;
    }
  }
  return nearest;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  // 모든 주유소 가져오기
  const { data: stations, error } = await supabase
    .from("stations")
    .select("id, lat, lng, old_address, new_address");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let addressMatched = 0;
  let coordMatched = 0;
  let gyeonggi = 0;
  const districtCounts: Record<string, number> = {};

  const updates: { id: string; district: string }[] = [];

  for (const s of stations) {
    let district: string | null = null;

    // 1. 주소에서 추출 시도
    const addr = s.old_address || s.new_address;
    if (addr) {
      district = extractDistrict(addr);
      if (district) addressMatched++;
    }

    // 2. 주소에서 못 찾으면 좌표로 매칭
    if (!district && s.lat && s.lng) {
      if (isInSeoul(s.lat, s.lng)) {
        district = findNearestDistrict(s.lat, s.lng);
        coordMatched++;
      } else {
        district = "경기도";
        gyeonggi++;
      }
    }

    if (district) {
      updates.push({ id: s.id, district });
      districtCounts[district] = (districtCounts[district] || 0) + 1;
    }
  }

  // 배치 업데이트
  const BATCH_SIZE = 500;
  let updatedCount = 0;

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    // upsert로 district만 업데이트
    for (const item of batch) {
      const { error: updateErr } = await supabase
        .from("stations")
        .update({ district: item.district })
        .eq("id", item.id);

      if (!updateErr) updatedCount++;
    }
  }

  // 자치구별 정렬
  const sortedDistricts = Object.entries(districtCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  const seoulTotal = sortedDistricts
    .filter((d) => d.name !== "경기도")
    .reduce((s, d) => s + d.count, 0);

  return NextResponse.json({
    success: true,
    total: stations.length,
    updated: updatedCount,
    matching: {
      address_matched: addressMatched,
      coord_matched: coordMatched,
      gyeonggi: gyeonggi,
    },
    seoul_total: seoulTotal,
    gyeonggi_total: gyeonggi,
    districts: sortedDistricts,
  });
}
