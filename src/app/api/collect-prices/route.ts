import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const maxDuration = 300;
import {
  getAroundStations,
  getStationDetail,
  katecToWgs84,
  wgs84ToKatec,
  PROD_CD,
} from "@/lib/opinet";

/** 서울+경기 수집 포인트 (43개, 반경 10km) */
const COLLECT_POINTS = [
  // ── 서울 (12개 포인트, 25개 구 전체 커버) ──
  { name: "종로/중구/용산", lat: 37.5715, lng: 126.9769 },
  { name: "마포/서대문/은평", lat: 37.5791, lng: 126.9198 },
  { name: "강남/서초", lat: 37.4969, lng: 127.0278 },
  { name: "송파/강동", lat: 37.5145, lng: 127.1059 },
  { name: "영등포/구로/금천", lat: 37.4873, lng: 126.8962 },
  { name: "강서/양천", lat: 37.5509, lng: 126.8497 },
  { name: "관악/동작", lat: 37.4783, lng: 126.9516 },
  { name: "성북/강북", lat: 37.6103, lng: 127.0255 },
  { name: "도봉/노원", lat: 37.6544, lng: 127.0565 },
  { name: "중랑/동대문", lat: 37.5953, lng: 127.0793 },
  { name: "성동/광진", lat: 37.5484, lng: 127.0565 },
  { name: "서울 남서(구로/관악 보완)", lat: 37.4671, lng: 126.8589 },

  // ── 경기 (31개 포인트, 31개 시/군 전체 커버) ──
  { name: "수원", lat: 37.2636, lng: 127.0286 },
  { name: "성남", lat: 37.4200, lng: 127.1267 },
  { name: "고양", lat: 37.6584, lng: 126.8320 },
  { name: "용인", lat: 37.2411, lng: 127.1776 },
  { name: "부천", lat: 37.5034, lng: 126.7660 },
  { name: "안산", lat: 37.3219, lng: 126.8309 },
  { name: "안양", lat: 37.3943, lng: 126.9568 },
  { name: "남양주", lat: 37.6360, lng: 127.2165 },
  { name: "화성", lat: 37.1995, lng: 126.8313 },
  { name: "평택", lat: 36.9921, lng: 127.1129 },
  { name: "의정부", lat: 37.7381, lng: 127.0337 },
  { name: "시흥", lat: 37.3800, lng: 126.8028 },
  { name: "파주", lat: 37.7590, lng: 126.7802 },
  { name: "김포", lat: 37.6153, lng: 126.7156 },
  { name: "광명", lat: 37.4786, lng: 126.8645 },
  { name: "광주", lat: 37.4294, lng: 127.2551 },
  { name: "군포", lat: 37.3614, lng: 126.9352 },
  { name: "하남", lat: 37.5393, lng: 127.2148 },
  { name: "오산", lat: 37.1498, lng: 127.0770 },
  { name: "이천", lat: 37.2720, lng: 127.4350 },
  { name: "양주", lat: 37.7853, lng: 127.0458 },
  { name: "구리", lat: 37.5943, lng: 127.1295 },
  { name: "안성", lat: 37.0080, lng: 127.2797 },
  { name: "포천", lat: 37.8949, lng: 127.2002 },
  { name: "의왕", lat: 37.3449, lng: 126.9685 },
  { name: "여주", lat: 37.2983, lng: 127.6375 },
  { name: "동두천", lat: 37.9035, lng: 127.0609 },
  { name: "과천", lat: 37.4292, lng: 126.9876 },
  { name: "가평", lat: 37.8315, lng: 127.5095 },
  { name: "양평", lat: 37.4917, lng: 127.4876 },
  { name: "연천", lat: 38.0964, lng: 127.0750 },
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
      old_address: string | null;
      new_address: string | null;
    }
  >();

  // 유종별로 서울+경기 포인트 순회
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
          10000,
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
              old_address: null,
              new_address: null,
            });
          }
        }
      } catch {
        errors++;
      }
    }
  }

  // 주소가 없는 주유소만 detailById로 주소 보충
  // 이미 DB에 주소가 있는 주유소 목록 조회
  const { data: existingAddrs } = await supabase
    .from("stations")
    .select("id")
    .not("new_address", "is", null);
  const hasAddress = new Set((existingAddrs ?? []).map((r) => r.id));

  const idsNeedingAddress = Array.from(stationMap.keys()).filter(
    (id) => !hasAddress.has(id)
  );
  let addressFetched = 0;

  // 동시 5개씩 배치로 상세 조회
  for (let i = 0; i < idsNeedingAddress.length; i += 5) {
    const batch = idsNeedingAddress.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map((id) => getStationDetail(id))
    );
    for (const result of results) {
      if (result.status === "fulfilled") {
        const detail = result.value;
        const entry = stationMap.get(detail.UNI_ID);
        if (entry) {
          entry.old_address = detail.VAN_ADR || null;
          entry.new_address = detail.NEW_ADR || null;
          addressFetched++;
        }
        apiCalls++;
      } else {
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

  const stationRows = Array.from(stationMap.entries()).map(([id, s]) => {
    const row: Record<string, unknown> = {
      id,
      name: s.name,
      brand: s.brand,
      lat: s.lat,
      lng: s.lng,
      gasoline_price: s.gasoline_price,
      diesel_price: s.diesel_price,
      premium_price: s.premium_price,
      updated_at: collectedAt,
    };
    // 주소가 있을 때만 포함 (기존 주소를 null로 덮어쓰지 않음)
    if (s.old_address) row.old_address = s.old_address;
    if (s.new_address) row.new_address = s.new_address;
    return row;
  });

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
    addressFetched,
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
