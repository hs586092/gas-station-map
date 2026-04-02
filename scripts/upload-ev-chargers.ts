/**
 * EV 충전소 CSV → Supabase 업로드 스크립트
 *
 * 사용법: npx tsx scripts/upload-ev-chargers.ts
 *
 * - 환경부 CSV(CP949) → 충전소ID 그룹핑 → 급속/완속 카운트 → upsert
 * - first_seen_at은 신규 충전소만 DB DEFAULT로 설정
 * - 기존 충전소는 updated_at만 갱신
 */

import { createClient } from "@supabase/supabase-js";
import { parse } from "csv-parse/sync";
import { readFileSync } from "fs";
import { resolve } from "path";
import * as iconv from "iconv-lite";

// --- 환경변수 ---
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE env vars. Load .env.local first.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- 설정 ---
const CSV_PATH = resolve(__dirname, "../data/ev-chargers/전기차충전소현황_제공표준_.csv");
const BATCH_SIZE = 500;
const SLOW_TYPE = 2; // 타입 2 = 완속, 나머지 = 급속

interface CsvRow {
  충전소명: string;
  충전기타입: string;
  소재지도로명주소: string;
  관리업체명: string;
  이용가능시간: string;
  위도: string;
  경도: string;
  충전소ID: string;
}

interface StationAgg {
  station_id: string;
  station_name: string;
  address: string;
  lat: number;
  lng: number;
  fast_count: number;
  slow_count: number;
  total_count: number;
  operator: string;
  available_time: string;
  updated_at: string;
}

async function main() {
  console.log("1. CSV 읽기...");
  const raw = readFileSync(CSV_PATH);
  const decoded = iconv.decode(raw, "cp949");

  const rows: CsvRow[] = parse(decoded, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
  console.log(`   총 ${rows.length.toLocaleString()}행 파싱 완료`);

  // 2. 충전소ID 기준 그룹핑
  console.log("2. 충전소ID 기준 그룹핑...");
  const stationMap = new Map<string, StationAgg>();

  for (const row of rows) {
    const id = row.충전소ID;
    if (!id) continue;

    const chargerType = parseInt(row.충전기타입, 10);
    const isSlow = chargerType === SLOW_TYPE;

    const existing = stationMap.get(id);
    if (existing) {
      if (isSlow) existing.slow_count++;
      else existing.fast_count++;
      existing.total_count++;
    } else {
      const lat = parseFloat(row.위도);
      const lng = parseFloat(row.경도);
      if (!lat || !lng) continue;

      stationMap.set(id, {
        station_id: id,
        station_name: row.충전소명,
        address: row.소재지도로명주소 || null!,
        lat,
        lng,
        fast_count: isSlow ? 0 : 1,
        slow_count: isSlow ? 1 : 0,
        total_count: 1,
        operator: row.관리업체명 || null!,
        available_time: row.이용가능시간 || null!,
        updated_at: new Date().toISOString(),
      });
    }
  }

  const stations = Array.from(stationMap.values());
  console.log(`   ${stations.length.toLocaleString()}개 충전소로 집계`);

  // 3. 배치 upsert
  console.log(`3. Supabase upsert (${BATCH_SIZE}개씩)...`);
  let uploaded = 0;
  let errors = 0;

  for (let i = 0; i < stations.length; i += BATCH_SIZE) {
    const batch = stations.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from("ev_charger_stations")
      .upsert(batch, {
        onConflict: "station_id",
        ignoreDuplicates: false,
      });

    if (error) {
      console.error(`   배치 ${i}~${i + batch.length} 에러:`, error.message);
      errors++;
    } else {
      uploaded += batch.length;
    }
  }

  console.log(`\n완료: ${uploaded.toLocaleString()}개 업로드, ${errors}개 에러`);

  // 4. 검증
  const { count } = await supabase
    .from("ev_charger_stations")
    .select("*", { count: "exact", head: true });
  console.log(`DB 총 행 수: ${count?.toLocaleString()}`);
}

main().catch(console.error);
