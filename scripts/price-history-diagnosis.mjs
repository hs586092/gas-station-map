// price_history 데이터 분포 진단 (read-only).
//
// 배경:
//   correlation-dry-run 결과 모든 경쟁사가 ~30일치만 수집됨.
//   sales_data 는 304일(2025-06-16~2026-04-15), price_history 는 30일.
//   원인: retention 정책? 버그? 크론 늦게 등록?
//
// 진단 항목:
//   1. price_history 전체 min/max collected_at, 총 행수
//   2. 본인(A0003453) min/max, 일수, 결측일
//   3. 5km 내 19개 경쟁사 각자 min/max, 일수
//   4. 일별 수집 주유소 수 (전체 기간) — 어떤 날 수집이 멈췄는지
//   5. 셀프광장이 수집된 일자 vs 안 된 일자 분포
//   6. 가설 검증: vercel.json 크론 시작 (2026-03-15)과 데이터 시작 일치하는지
//
// 사용법:
//   node scripts/price-history-diagnosis.mjs
//
// read-only — 어떤 테이블도 쓰지 않음.

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));

try {
  const envText = readFileSync(resolve(__dirname, "../.env.local"), "utf8");
  for (const line of envText.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m) {
      let v = m[2].replace(/^["']|["']$/g, "");
      v = v.replace(/\\n$/, "").trim();
      process.env[m[1]] = v;
    }
  }
} catch (e) {
  console.error(".env.local 로드 실패:", e.message);
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !KEY) {
  console.error("SUPABASE 환경변수가 없습니다.");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, KEY);
const STATION_ID = "A0003453";
const RADIUS_KM = 5;
const VERCEL_CRON_START = "2026-03-15"; // git log 기준

function pad(s, n) {
  s = String(s);
  let visualLen = 0;
  for (const ch of s) visualLen += ch.charCodeAt(0) > 127 ? 2 : 1;
  const padN = Math.max(0, n - visualLen);
  return s + " ".repeat(padN);
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function shortName(name) {
  return (
    name
      .replace(
        /^(?:HD현대오일뱅크|현대오일뱅크|에쓰오일|에스오일|SK에너지|GS칼텍스|알뜰)(?:㈜|주식회사|\(주\))?\s*/g,
        ""
      )
      .replace(/^(?:㈜|\(주\)|주식회사)\s*/g, "")
      .replace(/(?:㈜|\(주\)|주식회사)/g, "")
      .replace(/\s*(직영|위탁)\s*/g, "")
      .replace(/\s+/g, " ")
      .trim() || name
  );
}

// 대량 select 페이지네이션
async function fetchAll(builder) {
  const PAGE = 1000;
  const all = [];
  for (let from = 0; from < 100000; from += PAGE) {
    const { data, error } = await builder().range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}

async function main() {
  console.log("\n=== price_history 데이터 진단 ===");
  console.log(`기준일: ${new Date().toISOString().slice(0, 10)}`);
  console.log(`vercel.json cron 등록일 (git log): ${VERCEL_CRON_START}`);
  console.log("");

  // ── 1. 전체 통계 ──
  console.log("[1] price_history 전체 통계");

  // count는 head:true + count:exact 로 효율적 카운트
  const { count: totalRows, error: cntErr } = await sb
    .from("price_history")
    .select("*", { count: "exact", head: true });
  if (cntErr) throw cntErr;
  console.log(`  전체 행 수: ${totalRows?.toLocaleString() ?? "?"}`);

  // 전체 min/max collected_at
  const { data: minRow } = await sb
    .from("price_history")
    .select("collected_at")
    .order("collected_at", { ascending: true })
    .limit(1)
    .single();
  const { data: maxRow } = await sb
    .from("price_history")
    .select("collected_at")
    .order("collected_at", { ascending: false })
    .limit(1)
    .single();
  console.log(`  최초 수집: ${minRow?.collected_at ?? "?"}`);
  console.log(`  최근 수집: ${maxRow?.collected_at ?? "?"}`);

  if (minRow?.collected_at) {
    const minDate = minRow.collected_at.slice(0, 10);
    const days = Math.round(
      (Date.parse(maxRow.collected_at) - Date.parse(minRow.collected_at)) /
        86400000
    );
    console.log(`  운영 기간: ${days}일`);
    console.log(
      `  vercel.json 등록일과 차이: ${
        Math.round(
          (Date.parse(minDate) - Date.parse(VERCEL_CRON_START)) / 86400000
        )
      }일 (음수 = cron 등록 전부터 데이터 있음)`
    );
  }

  // ── 2. 본인 데이터 ──
  console.log(`\n[2] 본인 (${STATION_ID} 셀프광장주유소) 수집 일자 분포`);

  const myRows = await fetchAll(() =>
    sb
      .from("price_history")
      .select("collected_at, gasoline_price")
      .eq("station_id", STATION_ID)
      .order("collected_at", { ascending: true })
  );
  console.log(`  총 행 수: ${myRows.length}`);

  if (myRows.length === 0) {
    console.log("  ⚠️ 본인 데이터 0행");
  } else {
    // 일자별 묶기
    const myByDate = new Map();
    for (const r of myRows) {
      const d = r.collected_at.slice(0, 10);
      if (!myByDate.has(d)) myByDate.set(d, []);
      myByDate.get(d).push(r);
    }
    const dates = [...myByDate.keys()].sort();
    console.log(`  고유 일자 수: ${dates.length}일`);
    console.log(`  최초: ${dates[0]}  최근: ${dates[dates.length - 1]}`);

    const expected = Math.round(
      (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86400000
    ) + 1;
    console.log(
      `  기간 일수: ${expected}일  (수집률 ${(
        (dates.length / expected) *
        100
      ).toFixed(1)}%)`
    );

    // 결측일
    const missing = [];
    const startMs = Date.parse(dates[0]);
    const endMs = Date.parse(dates[dates.length - 1]);
    for (let ms = startMs; ms <= endMs; ms += 86400000) {
      const d = new Date(ms).toISOString().slice(0, 10);
      if (!myByDate.has(d)) missing.push(d);
    }
    console.log(
      `  결측일: ${missing.length}일${
        missing.length > 0 ? ` (${missing.slice(0, 10).join(", ")}${missing.length > 10 ? " ..." : ""})` : ""
      }`
    );

    // 일별 수집 횟수 분포 (1일 1회가 정상 — 중복 있는지 확인)
    const counts = {};
    for (const arr of myByDate.values()) {
      const k = arr.length;
      counts[k] = (counts[k] ?? 0) + 1;
    }
    console.log(`  일별 수집 횟수 분포:`);
    for (const k of Object.keys(counts).sort()) {
      console.log(`    ${k}회/일: ${counts[k]}일`);
    }
  }

  // ── 3. 5km 내 경쟁사 19곳 분포 ──
  console.log(`\n[3] 5km 내 경쟁사 분포`);

  const { data: baseRow } = await sb
    .from("stations")
    .select("id, name, lat, lng")
    .eq("id", STATION_ID)
    .single();
  const latDelta = RADIUS_KM / 111;
  const lngDelta = RADIUS_KM / 88;
  const { data: candidates } = await sb
    .from("stations")
    .select("id, name, lat, lng")
    .gte("lat", baseRow.lat - latDelta)
    .lte("lat", baseRow.lat + latDelta)
    .gte("lng", baseRow.lng - lngDelta)
    .lte("lng", baseRow.lng + lngDelta)
    .neq("id", STATION_ID);

  const neighbors = (candidates ?? [])
    .map((s) => ({
      ...s,
      distance_km:
        Math.round(haversineKm(baseRow.lat, baseRow.lng, s.lat, s.lng) * 100) /
        100,
    }))
    .filter((s) => s.distance_km <= RADIUS_KM)
    .sort((a, b) => a.distance_km - b.distance_km);

  console.log(`  5km 내 후보: ${neighbors.length}곳`);

  // 모든 경쟁사 + 본인의 price_history 한꺼번에 가져오기
  const allIds = [STATION_ID, ...neighbors.map((n) => n.id)];
  const histories = await fetchAll(() =>
    sb
      .from("price_history")
      .select("station_id, collected_at, gasoline_price")
      .in("station_id", allIds)
      .order("collected_at", { ascending: true })
  );
  console.log(`  fetch 결과 (페이지네이션): ${histories.length}행`);

  const perStation = new Map();
  for (const r of histories) {
    if (!perStation.has(r.station_id)) {
      perStation.set(r.station_id, {
        rows: 0,
        gasolineNonNull: 0,
        dates: new Set(),
        min: null,
        max: null,
      });
    }
    const e = perStation.get(r.station_id);
    e.rows++;
    if (r.gasoline_price != null) e.gasolineNonNull++;
    e.dates.add(r.collected_at.slice(0, 10));
    if (e.min == null || r.collected_at < e.min) e.min = r.collected_at;
    if (e.max == null || r.collected_at > e.max) e.max = r.collected_at;
  }

  console.log(
    `\n  순위  주유소                       거리       총행  휘발유non-null 일수  최초~최근`
  );
  console.log(`  본인:`);
  const me = perStation.get(STATION_ID);
  if (me) {
    console.log(
      `        ${pad("셀프광장주유소", 26)} 0.00km   ${String(me.rows).padStart(4)}   ${String(me.gasolineNonNull).padStart(4)}        ${String(me.dates.size).padStart(3)}   ${me.min?.slice(0, 10)} ~ ${me.max?.slice(0, 10)}`
    );
  } else {
    console.log(`        본인 데이터 없음`);
  }
  console.log(`  경쟁사:`);
  neighbors.forEach((n, i) => {
    const e = perStation.get(n.id);
    if (!e) {
      console.log(
        `   ${String(i + 1).padStart(3)}.  ${pad(shortName(n.name), 26)} ${n.distance_km.toFixed(2).padStart(5)}km   (price_history 0행)`
      );
      return;
    }
    console.log(
      `   ${String(i + 1).padStart(3)}.  ${pad(shortName(n.name), 26)} ${n.distance_km.toFixed(2).padStart(5)}km   ${String(e.rows).padStart(4)}   ${String(e.gasolineNonNull).padStart(4)}        ${String(e.dates.size).padStart(3)}   ${e.min?.slice(0, 10)} ~ ${e.max?.slice(0, 10)}`
    );
  });

  // ── 4. 일별 수집 주유소 수 (시계열) ──
  console.log(`\n[4] 일별 전체 수집 주유소 수 (어떤 날 멈췄나)`);

  // 일별 (date → unique station_id 수)
  const dailyStations = new Map();
  for (const r of histories) {
    const d = r.collected_at.slice(0, 10);
    if (!dailyStations.has(d)) dailyStations.set(d, new Set());
    dailyStations.get(d).add(r.station_id);
  }
  const sortedDates = [...dailyStations.keys()].sort();
  console.log(`  본인 + 19곳 = ${allIds.length}곳 중 일별 수집 station 수`);
  console.log(`  (전체 ${sortedDates.length}일 표시)`);
  for (const d of sortedDates) {
    const cnt = dailyStations.get(d).size;
    const bar = "█".repeat(Math.min(cnt, 20));
    const flag = cnt < allIds.length * 0.5 ? "  ⚠️" : "";
    console.log(
      `    ${d}  ${String(cnt).padStart(2)}/${allIds.length}곳  ${bar}${flag}`
    );
  }

  // ── 5. 가설 검증 결론 ──
  console.log(`\n[5] 가설 검증 결론`);
  const myDates = me ? [...me.dates].sort() : [];
  if (myDates.length > 0) {
    const dataStart = myDates[0];
    const cronStart = VERCEL_CRON_START;
    const diff = Math.round(
      (Date.parse(dataStart) - Date.parse(cronStart)) / 86400000
    );
    console.log(`  본인 첫 데이터: ${dataStart}`);
    console.log(`  vercel.json 첫 등록: ${cronStart}`);
    console.log(`  차이: ${diff}일`);
    if (Math.abs(diff) <= 2) {
      console.log(
        `  ✅ 가설 확인: cron 등록 시점부터 데이터 수집 시작 — retention 아님, 버그 아님`
      );
    } else if (diff > 0) {
      console.log(
        `  🤔 cron 등록보다 ${diff}일 늦게 데이터 시작 — cron 초기 실패 가능성`
      );
    } else {
      console.log(
        `  ⚠️ cron 등록 전부터 데이터 존재 (수동 호출 또는 다른 경로) — 별도 확인 필요`
      );
    }
  }

  // 본인 vs 경쟁사 일수 비교
  console.log(`\n[6] 본인 vs 경쟁사 일수 비교 (격차 = 수집 실패 가능성)`);
  if (me) {
    const myDays = me.dates.size;
    let bigGap = 0;
    let zeroData = 0;
    for (const n of neighbors) {
      const e = perStation.get(n.id);
      if (!e || e.dates.size === 0) {
        zeroData++;
        continue;
      }
      if (myDays - e.dates.size >= 5) bigGap++;
    }
    console.log(`  본인 일수: ${myDays}일`);
    console.log(`  경쟁사 평균 일수: ${
      neighbors
        .map((n) => perStation.get(n.id)?.dates.size ?? 0)
        .reduce((s, x) => s + x, 0) / neighbors.length
    }일 (수치 그대로)`);
    console.log(`  본인 대비 5일 이상 적은 경쟁사: ${bigGap}곳`);
    console.log(`  price_history 0행 경쟁사: ${zeroData}곳`);
  }

  console.log(`\n=== 진단 끝 ===\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
