import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const maxDuration = 300;

// 경기도 31개 시/군 중심좌표 (시청/군청 기준)
const GYEONGGI_CITIES = [
  { name: "수원시", lat: 37.2636, lng: 127.0286 },
  { name: "성남시", lat: 37.4200, lng: 127.1267 },
  { name: "의정부시", lat: 37.7381, lng: 127.0337 },
  { name: "안양시", lat: 37.3943, lng: 126.9568 },
  { name: "부천시", lat: 37.5034, lng: 126.7660 },
  { name: "광명시", lat: 37.4786, lng: 126.8646 },
  { name: "평택시", lat: 36.9922, lng: 127.1128 },
  { name: "동두천시", lat: 37.9034, lng: 127.0607 },
  { name: "안산시", lat: 37.3219, lng: 126.8309 },
  { name: "고양시", lat: 37.6584, lng: 126.8320 },
  { name: "과천시", lat: 37.4293, lng: 126.9876 },
  { name: "구리시", lat: 37.5943, lng: 127.1297 },
  { name: "남양주시", lat: 37.6360, lng: 127.2165 },
  { name: "오산시", lat: 37.1499, lng: 127.0696 },
  { name: "시흥시", lat: 37.3800, lng: 126.8028 },
  { name: "군포시", lat: 37.3616, lng: 126.9352 },
  { name: "의왕시", lat: 37.3449, lng: 126.9685 },
  { name: "하남시", lat: 37.5393, lng: 127.2148 },
  { name: "용인시", lat: 37.2411, lng: 127.1776 },
  { name: "파주시", lat: 37.7599, lng: 126.7799 },
  { name: "이천시", lat: 37.2720, lng: 127.4350 },
  { name: "안성시", lat: 37.0080, lng: 127.2797 },
  { name: "김포시", lat: 37.6154, lng: 126.7156 },
  { name: "화성시", lat: 37.1994, lng: 126.8313 },
  { name: "광주시", lat: 37.4095, lng: 127.2573 },
  { name: "양주시", lat: 37.7853, lng: 127.0458 },
  { name: "포천시", lat: 37.8949, lng: 127.2003 },
  { name: "여주시", lat: 37.2984, lng: 127.6372 },
  { name: "양평군", lat: 37.4917, lng: 127.4876 },
  { name: "가평군", lat: 37.8316, lng: 127.5097 },
  { name: "연천군", lat: 38.0964, lng: 127.0752 },
];

// 경기도 범위 (대략적인 bounding box)
const GYEONGGI_BOUNDS = {
  latMin: 36.9,
  latMax: 38.3,
  lngMin: 126.3,
  lngMax: 127.9,
};

// 최대 매칭 거리 (km) — 경기도 시/군은 서울 구보다 넓으므로 15km
const MAX_CITY_DISTANCE_KM = 15;

function distanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
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

// 주소에서 "경기(도) XX시/군" 추출
function extractGyeonggiCity(address: string): string | null {
  const match = address.match(/경기(?:도)?\s*(\S+[시군])/);
  if (!match) return null;
  const cityName = match[1];
  // 유효한 시/군인지 확인
  const valid = GYEONGGI_CITIES.find((c) => c.name === cityName);
  return valid ? cityName : null;
}

// 좌표가 경기도 범위인지 확인
function isInGyeonggiBounds(lat: number, lng: number): boolean {
  return (
    lat >= GYEONGGI_BOUNDS.latMin &&
    lat <= GYEONGGI_BOUNDS.latMax &&
    lng >= GYEONGGI_BOUNDS.lngMin &&
    lng <= GYEONGGI_BOUNDS.lngMax
  );
}

// 좌표로 가장 가까운 경기도 시/군 찾기
function findNearestCity(
  lat: number,
  lng: number
): { name: string; distKm: number } | null {
  let minDist = Infinity;
  let nearest = "";
  for (const c of GYEONGGI_CITIES) {
    const dist = distanceKm(lat, lng, c.lat, c.lng);
    if (dist < minDist) {
      minDist = dist;
      nearest = c.name;
    }
  }
  if (minDist > MAX_CITY_DISTANCE_KM) return null;
  return { name: nearest, distKm: minDist };
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (
    cronSecret &&
    authHeader !== `Bearer ${cronSecret}` &&
    process.env.NODE_ENV === "production"
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const PAGE_SIZE = 1000;

  // district가 NULL인 주유소만 가져오기 (서울 매칭된 것은 절대 건드리지 않음)
  const stations: {
    id: string;
    lat: number;
    lng: number;
    old_address: string | null;
    new_address: string | null;
  }[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("stations")
      .select("id, lat, lng, old_address, new_address")
      .is("district", null)
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
  const cityCounts: Record<string, number> = {};
  const updates: { id: string; district: string }[] = [];

  for (const s of stations) {
    let city: string | null = null;

    // 1순위: 주소에서 "경기(도) XX시/군" 추출
    const addr = s.old_address || s.new_address || "";
    if (addr) {
      city = extractGyeonggiCity(addr);
      if (city) addressMatched++;
    }

    // 2순위: 좌표 기반 — 경기도 범위 내에서 가장 가까운 시/군청
    if (!city && s.lat && s.lat > 0 && s.lng && s.lng > 0) {
      if (isInGyeonggiBounds(s.lat, s.lng)) {
        const nearest = findNearestCity(s.lat, s.lng);
        if (nearest) {
          city = nearest.name;
          coordMatched++;
        } else {
          skipped++;
        }
      } else {
        skipped++;
      }
    }

    if (!city) {
      skipped++;
      continue;
    }

    updates.push({ id: s.id, district: city });
    cityCounts[city] = (cityCounts[city] || 0) + 1;
  }

  // 배치 업데이트 (district NULL → 경기 시/군)
  let updatedCount = 0;
  let updateErrors = 0;
  for (const item of updates) {
    const { error: updateErr } = await supabase
      .from("stations")
      .update({ district: item.district })
      .eq("id", item.id);

    if (!updateErr) updatedCount++;
    else updateErrors++;
  }

  const sortedCities = Object.entries(cityCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  const gyeonggiTotal = sortedCities.reduce((s, c) => s + c.count, 0);

  return NextResponse.json({
    success: true,
    source_stations: stations.length,
    matched: gyeonggiTotal,
    updated: updatedCount,
    update_errors: updateErrors,
    matching: {
      address_matched: addressMatched,
      coord_matched: coordMatched,
      skipped,
    },
    cities: sortedCities,
  });
}
