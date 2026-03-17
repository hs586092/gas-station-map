import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const maxDuration = 300;
import {
  getAroundStations,
  katecToWgs84,
  wgs84ToKatec,
  PROD_CD,
} from "@/lib/opinet";

/** 전국 수집 포인트 (~75개, 반경 20km 격자) */
const COLLECT_POINTS = [
  // ── 서울·경기 ──
  { name: "서울 중심", lat: 37.5665, lng: 126.978 },
  { name: "서울 북부", lat: 37.65, lng: 127.05 },
  { name: "고양/파주", lat: 37.72, lng: 126.77 },
  { name: "의정부/양주", lat: 37.74, lng: 127.05 },
  { name: "남양주/구리", lat: 37.63, lng: 127.22 },
  { name: "인천", lat: 37.4563, lng: 126.7052 },
  { name: "부천/광명", lat: 37.5, lng: 126.78 },
  { name: "안양/과천", lat: 37.39, lng: 126.93 },
  { name: "수원", lat: 37.2636, lng: 127.0286 },
  { name: "용인", lat: 37.2411, lng: 127.1776 },
  { name: "성남", lat: 37.42, lng: 127.14 },
  { name: "하남/광주", lat: 37.52, lng: 127.22 },
  { name: "안산/시흥", lat: 37.32, lng: 126.83 },
  { name: "화성/오산", lat: 37.2, lng: 126.95 },
  { name: "평택/안성", lat: 36.99, lng: 127.09 },
  { name: "이천/여주", lat: 37.27, lng: 127.44 },
  { name: "가평/양평", lat: 37.58, lng: 127.51 },
  { name: "포천/연천", lat: 37.9, lng: 127.2 },
  { name: "김포", lat: 37.62, lng: 126.72 },

  // ── 강원 ──
  { name: "춘천", lat: 37.8813, lng: 127.7298 },
  { name: "원주", lat: 37.3422, lng: 127.9202 },
  { name: "강릉", lat: 37.7519, lng: 128.8761 },
  { name: "속초/양양", lat: 38.19, lng: 128.54 },
  { name: "동해/삼척", lat: 37.45, lng: 129.17 },
  { name: "태백/영월", lat: 37.17, lng: 128.78 },
  { name: "홍천/횡성", lat: 37.63, lng: 128.15 },
  { name: "철원/화천", lat: 38.15, lng: 127.3 },
  { name: "정선", lat: 37.38, lng: 128.66 },

  // ── 충북 ──
  { name: "청주", lat: 36.6424, lng: 127.489 },
  { name: "충주", lat: 36.99, lng: 127.93 },
  { name: "제천", lat: 37.13, lng: 128.19 },
  { name: "영동/옥천", lat: 36.17, lng: 127.78 },
  { name: "음성/진천", lat: 36.85, lng: 127.55 },

  // ── 충남·세종 ──
  { name: "대전", lat: 36.3504, lng: 127.3845 },
  { name: "세종", lat: 36.48, lng: 127.0 },
  { name: "천안", lat: 36.8151, lng: 127.1139 },
  { name: "아산/당진", lat: 36.78, lng: 126.8 },
  { name: "서산/태안", lat: 36.78, lng: 126.45 },
  { name: "홍성/예산", lat: 36.6, lng: 126.66 },
  { name: "공주/논산", lat: 36.33, lng: 127.0 },
  { name: "보령/서천", lat: 36.33, lng: 126.61 },
  { name: "금산", lat: 36.1, lng: 127.49 },

  // ── 전북 ──
  { name: "전주", lat: 35.8242, lng: 127.148 },
  { name: "군산/익산", lat: 35.97, lng: 126.74 },
  { name: "남원/장수", lat: 35.42, lng: 127.39 },
  { name: "정읍/김제", lat: 35.57, lng: 126.86 },
  { name: "무주/진안", lat: 35.87, lng: 127.66 },

  // ── 전남 ──
  { name: "광주", lat: 35.1595, lng: 126.8526 },
  { name: "목포/무안", lat: 34.81, lng: 126.39 },
  { name: "순천/광양", lat: 34.95, lng: 127.49 },
  { name: "여수", lat: 34.7604, lng: 127.6622 },
  { name: "나주/함평", lat: 35.02, lng: 126.71 },
  { name: "해남/완도", lat: 34.57, lng: 126.6 },
  { name: "고흥/보성", lat: 34.6, lng: 127.07 },
  { name: "담양/곡성", lat: 35.32, lng: 127.0 },

  // ── 경북 ──
  { name: "포항", lat: 36.019, lng: 129.3435 },
  { name: "경주", lat: 35.86, lng: 129.21 },
  { name: "구미/김천", lat: 36.12, lng: 128.34 },
  { name: "안동", lat: 36.57, lng: 128.73 },
  { name: "영주/봉화", lat: 36.81, lng: 128.74 },
  { name: "상주/문경", lat: 36.58, lng: 128.16 },
  { name: "영천/청도", lat: 35.97, lng: 128.94 },
  { name: "영덕/울진", lat: 36.53, lng: 129.4 },

  // ── 경남 ──
  { name: "부산", lat: 35.1796, lng: 129.0756 },
  { name: "울산", lat: 35.5384, lng: 129.3114 },
  { name: "창원/마산", lat: 35.2284, lng: 128.6811 },
  { name: "김해/양산", lat: 35.23, lng: 128.98 },
  { name: "진주/사천", lat: 35.18, lng: 128.11 },
  { name: "통영/거제", lat: 34.85, lng: 128.43 },
  { name: "밀양/창녕", lat: 35.5, lng: 128.75 },
  { name: "거창/합천", lat: 35.68, lng: 128.0 },
  { name: "하동/남해", lat: 35.07, lng: 127.75 },

  // ── 제주 ──
  { name: "제주시", lat: 33.4996, lng: 126.5312 },
  { name: "서귀포", lat: 33.25, lng: 126.56 },
];

/** 유종별 aroundAll.do 호출로 주유소 데이터를 수집 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = createServiceClient();
  const collectedAt = new Date().toISOString();
  let errors = 0;
  let apiCalls = 0;

  // 주유소별 데이터를 누적할 Map (UNI_ID → station data)
  const stationMap = new Map<
    string,
    {
      name: string;
      brand: string;
      lat: number;
      lng: number;
      gasoline_price: number | null;
      diesel_price: number | null;
      premium_price: number | null;
    }
  >();

  // 유종별로 전국 포인트 순회
  const fuelTypes = [
    { prodCd: PROD_CD.GASOLINE, field: "gasoline_price" as const },
    { prodCd: PROD_CD.DIESEL, field: "diesel_price" as const },
    { prodCd: PROD_CD.PREMIUM_GASOLINE, field: "premium_price" as const },
  ];

  for (const fuel of fuelTypes) {
    for (const point of COLLECT_POINTS) {
      try {
        const katec = wgs84ToKatec(point.lat, point.lng);
        const stations = await getAroundStations(
          katec.x,
          katec.y,
          20000,
          fuel.prodCd,
          1
        );
        apiCalls++;

        for (const s of stations) {
          const existing = stationMap.get(s.UNI_ID);
          if (existing) {
            // 이미 수집된 주유소 → 해당 유종 가격만 추가
            existing[fuel.field] = s.PRICE;
          } else {
            // 새 주유소 → 좌표 변환 후 등록
            const wgs = katecToWgs84(s.GIS_X_COOR, s.GIS_Y_COOR);
            stationMap.set(s.UNI_ID, {
              name: s.OS_NM,
              brand: s.POLL_DIV_CD,
              lat: wgs.lat,
              lng: wgs.lng,
              gasoline_price: fuel.field === "gasoline_price" ? s.PRICE : null,
              diesel_price: fuel.field === "diesel_price" ? s.PRICE : null,
              premium_price: fuel.field === "premium_price" ? s.PRICE : null,
            });
          }
        }
      } catch {
        errors++;
      }
    }
  }

  // Map → 배열 변환
  const priceRows = Array.from(stationMap.entries()).map(([id, s]) => ({
    station_id: id,
    station_name: s.name,
    brand: s.brand,
    gasoline_price: s.gasoline_price,
    diesel_price: s.diesel_price,
    premium_price: s.premium_price,
    collected_at: collectedAt,
  }));

  const stationRows = Array.from(stationMap.entries()).map(([id, s]) => ({
    id,
    name: s.name,
    brand: s.brand,
    lat: s.lat,
    lng: s.lng,
    gasoline_price: s.gasoline_price,
    diesel_price: s.diesel_price,
    premium_price: s.premium_price,
    updated_at: collectedAt,
  }));

  // 가격 이력 삽입
  let historyInserted = 0;
  for (let i = 0; i < priceRows.length; i += 1000) {
    const batch = priceRows.slice(i, i + 1000);
    const { error } = await supabase.from("price_history").insert(batch);
    if (error) {
      console.error("price_history insert error:", error);
    } else {
      historyInserted += batch.length;
    }
  }

  // stations 캐시 upsert (주소/전화/편의시설은 건드리지 않음)
  let stationsUpserted = 0;
  for (let i = 0; i < stationRows.length; i += 500) {
    const batch = stationRows.slice(i, i + 500);
    const { error } = await supabase
      .from("stations")
      .upsert(batch, { onConflict: "id", ignoreDuplicates: false });
    if (error) {
      console.error("stations upsert error:", error);
    } else {
      stationsUpserted += batch.length;
    }
  }

  // API 호출 로그 기록
  await supabase.from("api_call_log").insert({
    endpoint: "collect-prices",
    call_count: apiCalls,
    caller: "cron",
    success: errors === 0,
    error_message: errors > 0 ? `${errors} errors during collection` : null,
  });

  const result = {
    success: true,
    collected: stationMap.size,
    historyInserted,
    stationsUpserted,
    apiCalls,
    errors,
    points: COLLECT_POINTS.length,
    collectedAt,
  };

  console.log("[collect-prices]", JSON.stringify(result));

  return NextResponse.json(result);
}
