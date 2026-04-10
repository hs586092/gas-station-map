// 1회성 긴급 패치: forecast_history.actual_* 값을 sales_data / carwash_daily 로부터 채운다.
//
// 사용법:
//   node scripts/patch-forecast-actual.mjs
//
// 배경: 스냅샷 시스템이 forecast_history.actual = null 상태로 얼어붙어
// 대시보드가 최신값을 반영하지 못함 → 4/9 레코드 등 수동 패치 필요.

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));

try {
  const envText = readFileSync(resolve(__dirname, "../.env.local"), "utf8");
  for (const line of envText.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch (e) {
  console.error(".env.local 로드 실패:", e.message);
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("SUPABASE 환경변수가 없습니다.");
  process.exit(1);
}

const svc = createClient(SUPABASE_URL, SERVICE_KEY);
const STATION_ID = "A0003453";

async function main() {
  // 0. 스키마 확인 — 한 행을 select("*") 해서 어떤 컬럼이 있는지 파악
  const { data: probe } = await svc
    .from("forecast_history")
    .select("*")
    .eq("station_id", STATION_ID)
    .limit(1);
  const cols = probe && probe[0] ? Object.keys(probe[0]) : [];
  console.log("[probe] forecast_history columns:", cols);
  const hasActualVol = cols.includes("actual_volume");
  const hasActualCnt = cols.includes("actual_count");
  const hasActualCarwash = cols.includes("actual_carwash");

  const sixtyAgo = new Date(Date.now() - 60 * 86400000).toISOString().split("T")[0];

  const selectCols = ["id", "forecast_date", "predicted_volume"]
    .concat(hasActualVol ? ["actual_volume"] : [])
    .concat(hasActualCnt ? ["actual_count"] : [])
    .concat(hasActualCarwash ? ["actual_carwash"] : [])
    .join(", ");

  const { data: rows, error: rowErr } = await svc
    .from("forecast_history")
    .select(selectCols)
    .eq("station_id", STATION_ID)
    .gte("forecast_date", sixtyAgo)
    .order("forecast_date", { ascending: false });

  if (rowErr) throw rowErr;
  console.log(`[patch] forecast_history rows: ${rows?.length ?? 0}`);
  if (!rows || rows.length === 0) return;

  const dates = rows.map((r) => r.forecast_date);
  const minDate = dates.reduce((a, b) => (a < b ? a : b));
  const maxDate = dates.reduce((a, b) => (a > b ? a : b));

  const [salesRes, cwRes] = await Promise.all([
    svc
      .from("sales_data")
      .select("date, gasoline_volume, diesel_volume, gasoline_count, diesel_count")
      .eq("station_id", STATION_ID)
      .gte("date", minDate)
      .lte("date", maxDate),
    hasActualCarwash
      ? svc
          .from("carwash_daily")
          .select("date, total_count")
          .eq("station_id", STATION_ID)
          .gte("date", minDate)
          .lte("date", maxDate)
      : Promise.resolve({ data: [] }),
  ]);

  const salesVol = new Map();
  const salesCnt = new Map();
  for (const s of salesRes.data ?? []) {
    salesVol.set(
      s.date,
      (Number(s.gasoline_volume) || 0) + (Number(s.diesel_volume) || 0)
    );
    salesCnt.set(
      s.date,
      (Number(s.gasoline_count) || 0) + (Number(s.diesel_count) || 0)
    );
  }
  const cwCnt = new Map();
  for (const c of cwRes.data ?? []) {
    cwCnt.set(c.date, Number(c.total_count) || 0);
  }

  let updated = 0;
  for (const fc of rows) {
    const updates = {};

    if (hasActualVol) {
      const vol = salesVol.get(fc.forecast_date);
      if (vol != null) {
        const cur = fc.actual_volume;
        if (cur == null || (Number(cur) === 0 && vol > 0) || Number(cur) !== vol) {
          updates.actual_volume = vol;
        }
      }
    }
    if (hasActualCnt) {
      const cnt = salesCnt.get(fc.forecast_date);
      if (cnt != null) {
        const cur = fc.actual_count;
        if (cur == null || (Number(cur) === 0 && cnt > 0) || Number(cur) !== cnt) {
          updates.actual_count = cnt;
        }
      }
    }
    if (hasActualCarwash) {
      const cw = cwCnt.get(fc.forecast_date);
      if (cw != null) {
        const cur = fc.actual_carwash;
        if (cur == null || (Number(cur) === 0 && cw > 0) || Number(cur) !== cw) {
          updates.actual_carwash = cw;
        }
      }
    }

    if (Object.keys(updates).length === 0) continue;

    const { error: upErr } = await svc
      .from("forecast_history")
      .update(updates)
      .eq("id", fc.id);

    if (upErr) {
      console.error(`[patch] update failed for ${fc.forecast_date}:`, upErr.message);
      continue;
    }
    updated += 1;
    console.log(`[patch] ${fc.forecast_date} updated:`, updates);
  }

  console.log(`\n[patch] done. ${updated} rows updated.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
