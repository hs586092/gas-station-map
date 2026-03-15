import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import {
  getAroundStations,
  getStationDetail,
  wgs84ToKatec,
  PROD_CD,
} from "@/lib/opinet";

// 주요 도시 중심 좌표 (WGS84)
const CITY_CENTERS = [
  { name: "서울", lat: 37.5665, lng: 126.978 },
  { name: "부산", lat: 35.1796, lng: 129.0756 },
  { name: "대구", lat: 35.8714, lng: 128.6014 },
  { name: "인천", lat: 37.4563, lng: 126.7052 },
  { name: "광주", lat: 35.1595, lng: 126.8526 },
  { name: "대전", lat: 36.3504, lng: 127.3845 },
  { name: "울산", lat: 35.5384, lng: 129.3114 },
  { name: "세종", lat: 36.48, lng: 127.0 },
  { name: "수원", lat: 37.2636, lng: 127.0286 },
  { name: "용인", lat: 37.2411, lng: 127.1776 },
  { name: "고양", lat: 37.6584, lng: 126.832 },
  { name: "창원", lat: 35.2284, lng: 128.6811 },
  { name: "청주", lat: 36.6424, lng: 127.489 },
  { name: "전주", lat: 35.8242, lng: 127.148 },
  { name: "천안", lat: 36.8151, lng: 127.1139 },
  { name: "제주", lat: 33.4996, lng: 126.5312 },
  { name: "포항", lat: 36.019, lng: 129.3435 },
  { name: "춘천", lat: 37.8813, lng: 127.7298 },
  { name: "원주", lat: 37.3422, lng: 127.9202 },
  { name: "여수", lat: 34.7604, lng: 127.6622 },
];

export async function GET(request: Request) {
  // Vercel Cron 보안: CRON_SECRET 검증
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = createServiceClient();
  const collectedAt = new Date().toISOString();
  const seenIds = new Set<string>();
  const rows: Array<{
    station_id: string;
    station_name: string;
    brand: string;
    gasoline_price: number | null;
    diesel_price: number | null;
    premium_price: number | null;
    collected_at: string;
  }> = [];

  let processed = 0;
  let errors = 0;

  for (const city of CITY_CENTERS) {
    try {
      const katec = wgs84ToKatec(city.lat, city.lng);

      // 휘발유 기준으로 주유소 목록 가져오기 (반경 20km)
      const stations = await getAroundStations(
        katec.x,
        katec.y,
        20000,
        PROD_CD.GASOLINE,
        2 // 거리순
      );

      for (const station of stations) {
        if (seenIds.has(station.UNI_ID)) continue;
        seenIds.add(station.UNI_ID);

        try {
          const detail = await getStationDetail(station.UNI_ID);

          const gasolinePrice =
            detail.OIL_PRICE.find((p) => p.PRODCD === PROD_CD.GASOLINE)?.PRICE ?? null;
          const dieselPrice =
            detail.OIL_PRICE.find((p) => p.PRODCD === PROD_CD.DIESEL)?.PRICE ?? null;
          const premiumPrice =
            detail.OIL_PRICE.find((p) => p.PRODCD === PROD_CD.PREMIUM_GASOLINE)?.PRICE ?? null;

          rows.push({
            station_id: station.UNI_ID,
            station_name: detail.OS_NM,
            brand: detail.POLL_DIV_CO.trim(),
            gasoline_price: gasolinePrice,
            diesel_price: dieselPrice,
            premium_price: premiumPrice,
            collected_at: collectedAt,
          });

          processed++;

          // API 부하 방지: 50개마다 100ms 대기
          if (processed % 50 === 0) {
            await new Promise((r) => setTimeout(r, 100));
          }
        } catch {
          errors++;
        }
      }
    } catch {
      errors++;
    }
  }

  // Supabase에 일괄 삽입 (1000개씩 배치)
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const batch = rows.slice(i, i + 1000);
    const { error } = await supabase.from("price_history").insert(batch);
    if (error) {
      console.error("Supabase insert error:", error);
    } else {
      inserted += batch.length;
    }
  }

  return NextResponse.json({
    success: true,
    collected: rows.length,
    inserted,
    errors,
    cities: CITY_CENTERS.length,
    collectedAt,
  });
}
