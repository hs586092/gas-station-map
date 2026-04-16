// 영향력 순위 카드 변경 사전 검증용 dry-run.
//
// 명세: memory/spec_correlation_top_n.md
//
// 검증 사항:
//   1. PostgREST 1000행 cap 영향 측정
//      - cap=4 (현재) × limit 없음  (현재 운영 동작 재현)
//      - cap=4 × limit=50000        (cap만 같지만 잘림 없는 진실)
//      - cap=15 × limit 없음        (변경 후 cap만 적용 시 잘림 정도)
//      - cap=15 × limit=50000       (명세 최종 동작)
//   2. 4가지 시나리오의 ranking 비교 → 시나리오 A/B/C 판정
//   3. 새로 진입할 경쟁사 목록 + 각자의 |r|, n
//
// 사용법:
//   node scripts/correlation-dry-run.mjs
//
// read-only — 어떤 테이블도 쓰지 않음.

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── .env.local 로드 (self-diagnosis-dry-run.mjs 와 동일 패턴) ──
try {
  const envText = readFileSync(resolve(__dirname, "../.env.local"), "utf8");
  for (const line of envText.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m) {
      let value = m[2].replace(/^["']|["']$/g, "");
      value = value.replace(/\\n$/, "").trim();
      process.env[m[1]] = value;
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

// ── 통계 유틸 (correlation-matrix.ts 동치) ──
const mean = (a) => (a.length === 0 ? 0 : a.reduce((s, x) => s + x, 0) / a.length);

function pearsonR(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
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

// 라벨 정리 (correlation-matrix.ts 동치)
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

// ── 페이지네이션 유틸 ──
// 1000행 cap을 우회하기 위해 .range(from, to)로 분할 fetch.
// limit=null 이면 1번만 호출 (cap 동작 재현).
async function fetchPriceHistory(allIds, { useLimit }) {
  if (!useLimit) {
    // 현재 운영 코드 그대로: limit/range 없음 → PostgREST 기본 cap (1000)
    const { data, error } = await sb
      .from("price_history")
      .select("station_id, collected_at, gasoline_price")
      .in("station_id", allIds)
      .not("gasoline_price", "is", null)
      .order("collected_at", { ascending: true });
    if (error) throw error;
    return { rows: data ?? [], pages: 1 };
  }

  // 50000까지 페이지네이션 (1000씩)
  const PAGE = 1000;
  const HARD_CAP = 50000;
  const all = [];
  let pages = 0;
  for (let from = 0; from < HARD_CAP; from += PAGE) {
    const to = from + PAGE - 1;
    const { data, error } = await sb
      .from("price_history")
      .select("station_id, collected_at, gasoline_price")
      .in("station_id", allIds)
      .not("gasoline_price", "is", null)
      .order("collected_at", { ascending: true })
      .range(from, to);
    if (error) throw error;
    pages++;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return { rows: all, pages };
}

// ── 한 가지 (cap, useLimit) 조합으로 분석 1회 수행 ──
async function runScenario({ cap, useLimit, base, neighborsAll, salesMap }) {
  // 거리순 cap만큼 자른다
  const neighbors = neighborsAll.slice(0, cap);
  const allIds = [STATION_ID, ...neighbors.map((n) => n.id)];

  const t0 = Date.now();
  const { rows: histories, pages } = await fetchPriceHistory(allIds, { useLimit });
  const fetchMs = Date.now() - t0;

  // 주유소별 → 날짜별 가격
  const stationPrices = new Map();
  for (const row of histories) {
    const sid = row.station_id;
    const date = row.collected_at.slice(0, 10);
    if (!stationPrices.has(sid)) stationPrices.set(sid, new Map());
    stationPrices.get(sid).set(date, row.gasoline_price);
  }
  const myPrices = stationPrices.get(STATION_ID) ?? new Map();

  // station별 데이터 일수
  const perStationDays = neighbors.map((n) => ({
    id: n.id,
    name: n.name,
    distance_km: n.distance_km,
    days: stationPrices.get(n.id)?.size ?? 0,
  }));

  // 경쟁사별 r 계산
  const results = [];
  for (const n of neighbors) {
    const nPrices = stationPrices.get(n.id) ?? new Map();
    const pairs = [];
    for (const [date, myPrice] of myPrices) {
      const nPrice = nPrices.get(date);
      const sale = salesMap.get(date);
      if (
        nPrice != null &&
        myPrice > 0 &&
        nPrice > 0 &&
        sale != null
      ) {
        const diff = myPrice - nPrice;
        pairs.push({ vol: sale, diff });
      }
    }
    if (pairs.length < 3) {
      results.push({
        id: n.id,
        name: n.name,
        shortName: shortName(n.name),
        distance_km: n.distance_km,
        n: pairs.length,
        r: null,
        skipped: true,
      });
      continue;
    }
    const r = pearsonR(
      pairs.map((p) => p.diff),
      pairs.map((p) => p.vol)
    );
    results.push({
      id: n.id,
      name: n.name,
      shortName: shortName(n.name),
      distance_km: n.distance_km,
      n: pairs.length,
      r: r != null ? Math.round(r * 1000) / 1000 : null,
      absR: r != null ? Math.abs(r) : 0,
      skipped: false,
    });
  }

  results.sort((a, b) => (b.absR ?? 0) - (a.absR ?? 0));

  return {
    cap,
    useLimit,
    fetchMs,
    pages,
    fetchedRows: histories.length,
    expectedRowsApprox: allIds.length * (myPrices.size || 0),
    perStationDays,
    results,
  };
}

function pad(s, n) {
  s = String(s);
  // 한글은 폭 2로 가정해 시각적 정렬을 맞춘다 (대충, 콘솔 비교용)
  let visualLen = 0;
  for (const ch of s) visualLen += ch.charCodeAt(0) > 127 ? 2 : 1;
  const padN = Math.max(0, n - visualLen);
  return s + " ".repeat(padN);
}

function fmtR(r) {
  if (r == null) return "  null";
  return (r >= 0 ? "+" : "") + r.toFixed(3);
}

async function main() {
  console.log("\n=== correlation-matrix dry-run ===");
  console.log(`station_id: ${STATION_ID}`);
  console.log(`반경: ${RADIUS_KM} km\n`);

  // ── 1. 기준 주유소 ──
  const { data: baseRow, error: baseErr } = await sb
    .from("stations")
    .select("id, name, lat, lng")
    .eq("id", STATION_ID)
    .single();
  if (baseErr || !baseRow) {
    console.error("기준 주유소 조회 실패:", baseErr);
    process.exit(1);
  }
  console.log(`기준: ${baseRow.name} (lat=${baseRow.lat}, lng=${baseRow.lng})`);

  // ── 2. 5km 후보 (correlation-matrix.ts 와 동일 박스 + 정밀 필터) ──
  const latDelta = RADIUS_KM / 111;
  const lngDelta = RADIUS_KM / 88;
  const { data: candidates, error: candErr } = await sb
    .from("stations")
    .select("id, name, lat, lng")
    .gte("lat", baseRow.lat - latDelta)
    .lte("lat", baseRow.lat + latDelta)
    .gte("lng", baseRow.lng - lngDelta)
    .lte("lng", baseRow.lng + lngDelta)
    .neq("id", STATION_ID);
  if (candErr) {
    console.error("후보 조회 실패:", candErr);
    process.exit(1);
  }
  const neighborsAll = (candidates ?? [])
    .map((s) => ({
      ...s,
      distance_km:
        Math.round(haversineKm(baseRow.lat, baseRow.lng, s.lat, s.lng) * 100) /
        100,
    }))
    .filter((s) => s.distance_km <= RADIUS_KM)
    .sort((a, b) => a.distance_km - b.distance_km);

  console.log(`5km 내 후보 총 ${neighborsAll.length}곳`);
  console.log("거리순 전체 목록:");
  neighborsAll.forEach((n, i) => {
    console.log(
      `  ${String(i + 1).padStart(2)}. ${pad(shortName(n.name), 26)}  ${n.distance_km.toFixed(2).padStart(5)} km   id=${n.id}`
    );
  });

  if (neighborsAll.length === 0) {
    console.log("\n경쟁사 없음 → 분석 불가");
    return;
  }

  // ── 3. 판매 데이터 ──
  const { data: salesRaw } = await sb
    .from("sales_data")
    .select("date, gasoline_volume, diesel_volume")
    .eq("station_id", STATION_ID)
    .order("date", { ascending: true });
  const salesMap = new Map();
  for (const s of salesRaw ?? []) {
    const v = (Number(s.gasoline_volume) || 0) + (Number(s.diesel_volume) || 0);
    if (v > 0) salesMap.set(s.date, v);
  }
  const salesDates = [...salesMap.keys()].sort();
  console.log(
    `\nsales_data: ${salesMap.size}일 (${salesDates[0]} ~ ${salesDates[salesDates.length - 1]})`
  );

  // ── 4. 4개 시나리오 실행 ──
  const scenarios = [
    { cap: 4, useLimit: false, label: "현재 운영 (cap=4, limit 없음)" },
    { cap: 4, useLimit: true, label: "cap=4, limit=50000 (잘림 없음)" },
    { cap: 15, useLimit: false, label: "cap=15, limit 없음 (cap만 변경)" },
    { cap: 15, useLimit: true, label: "cap=15, limit=50000 (명세 최종)" },
  ];

  const out = [];
  for (const sc of scenarios) {
    console.log(`\n────────────────────────────────────────`);
    console.log(`▶ 시나리오: ${sc.label}`);
    console.log(`────────────────────────────────────────`);
    const res = await runScenario({
      cap: sc.cap,
      useLimit: sc.useLimit,
      base: baseRow,
      neighborsAll,
      salesMap,
    });
    out.push({ ...sc, ...res });

    console.log(`fetch: ${res.fetchedRows}행 (page ${res.pages}회) · ${res.fetchMs}ms`);
    console.log(`이론 최대 (station수 × 기준 일수): ~${res.expectedRowsApprox}행`);
    console.log(`station별 수집 일수:`);
    for (const ps of res.perStationDays) {
      const flag = ps.days < (salesMap.size * 0.5) ? "  ⚠️ 절반 미만" : "";
      console.log(
        `   ${pad(shortName(ps.name), 26)} ${ps.distance_km.toFixed(2).padStart(5)}km  ${String(ps.days).padStart(4)}일${flag}`
      );
    }
    console.log(`\n  순위  주유소                       거리       n     r       비고`);
    res.results.forEach((r, i) => {
      const note = r.skipped
        ? "skip (n<3)"
        : r.absR < 0.10
        ? "임계값 미만 (|r|<0.10)"
        : r.absR < 0.20
        ? "약함"
        : r.absR < 0.40
        ? "보통"
        : "강함";
      console.log(
        `  ${String(i + 1).padStart(3)}.  ${pad(r.shortName, 26)} ${r.distance_km.toFixed(2).padStart(5)}km   ${String(r.n).padStart(4)}   ${fmtR(r.r)}   ${note}`
      );
    });
  }

  // ── 5. 비교: 현재 (cap=4, limit 없음) vs 명세 (cap=15, limit=50000) ──
  console.log(`\n\n========================================`);
  console.log(`📊 비교 분석`);
  console.log(`========================================`);

  const cur = out[0]; // cap=4, limit 없음 (현재 운영)
  const spec = out[3]; // cap=15, limit=50000 (명세 최종)

  console.log(`\n[A] PostgREST 1000행 cap 영향`);
  console.log(`  cap=4 + limit없음: ${cur.fetchedRows}행`);
  console.log(`  cap=4 + limit=50000: ${out[1].fetchedRows}행`);
  const lostByCap = out[1].fetchedRows - cur.fetchedRows;
  console.log(
    `  → 1000행 cap에 의해 잘린 양 (cap=4 기준): ${lostByCap}행 (${
      out[1].fetchedRows > 0 ? ((lostByCap / out[1].fetchedRows) * 100).toFixed(1) : 0
    }%)`
  );

  const lostByCapAt15 = out[3].fetchedRows - out[2].fetchedRows;
  console.log(`  cap=15 + limit없음: ${out[2].fetchedRows}행`);
  console.log(`  cap=15 + limit=50000: ${out[3].fetchedRows}행`);
  console.log(
    `  → 1000행 cap에 의해 잘린 양 (cap=15 기준): ${lostByCapAt15}행 (${
      out[3].fetchedRows > 0 ? ((lostByCapAt15 / out[3].fetchedRows) * 100).toFixed(1) : 0
    }%)`
  );

  console.log(`\n[B] 현재 4곳 vs 명세 상위 8곳 (|r| ≥ 0.10) 비교`);
  const TOP_N = 8;
  const R_FLOOR = 0.10;
  const currentTop = cur.results.filter((r) => !r.skipped);
  const specTop = spec.results.filter((r) => !r.skipped && r.absR >= R_FLOOR).slice(0, TOP_N);

  console.log(`\n  현재 카드에 보이는 4곳 (cap=4):`);
  currentTop.forEach((r, i) => {
    console.log(
      `    ${i + 1}. ${pad(r.shortName, 26)} ${r.distance_km.toFixed(2)}km  r=${fmtR(r.r)}  n=${r.n}`
    );
  });

  console.log(`\n  명세 적용 시 카드에 보일 상위 ${TOP_N}곳 (cap=15, |r|≥${R_FLOOR}):`);
  if (specTop.length === 0) {
    console.log(`    (없음 — 모든 경쟁사 |r| < ${R_FLOOR})`);
  } else {
    specTop.forEach((r, i) => {
      const isNew = !currentTop.find((c) => c.id === r.id);
      const tag = isNew ? "  🆕 신규 진입" : "";
      console.log(
        `    ${i + 1}. ${pad(r.shortName, 26)} ${r.distance_km.toFixed(2)}km  r=${fmtR(r.r)}  n=${r.n}${tag}`
      );
    });
  }

  const droppedFromCurrent = currentTop.filter(
    (c) => !specTop.find((s) => s.id === c.id)
  );
  if (droppedFromCurrent.length > 0) {
    console.log(`\n  명세 적용 시 카드에서 사라지는 주유소:`);
    droppedFromCurrent.forEach((r) => {
      const reason =
        r.absR < R_FLOOR
          ? `|r|=${Math.abs(r.r).toFixed(3)} < ${R_FLOOR}`
          : `상위 ${TOP_N} 밖`;
      console.log(
        `    - ${pad(r.shortName, 26)} ${r.distance_km.toFixed(2)}km  r=${fmtR(r.r)}  → ${reason}`
      );
    });
  }

  // ── 6. 시나리오 판정 ──
  console.log(`\n[C] 시나리오 판정 (명세 §5)`);
  const allSpecResults = spec.results.filter((r) => !r.skipped);
  const maxAbsR = Math.max(...allSpecResults.map((r) => r.absR ?? 0), 0);
  const newEntrants = specTop.filter(
    (s) => !currentTop.find((c) => c.id === s.id)
  );
  const newStrong = newEntrants.filter((r) => r.absR >= 0.20);

  let verdict;
  let recommendation;
  if (maxAbsR < 0.10) {
    verdict = "C — 전체적으로 약한 상관 (모든 경쟁사 |r| < 0.10)";
    recommendation =
      "발표 직전 도입은 부담. 카드가 비어 보임. 발표 후 도입 또는 fallback 메시지 준비 필요.";
  } else if (newStrong.length === 0 && droppedFromCurrent.length === 0) {
    verdict = "B — 거리가 영향력 proxy (현 4곳이 그대로 상위 유지)";
    recommendation =
      "안전한 변경. 사용자 직관 확증. 진행 권장.";
  } else {
    verdict = "A — 거리 ≠ 영향력 입증";
    recommendation = `진행 권장. 신규 ${newEntrants.length}곳 진입 (|r|≥0.20: ${newStrong.length}곳), 기존 ${droppedFromCurrent.length}곳 탈락. 발표 스토리 강화 가능.`;
  }
  console.log(`\n  최대 |r|: ${maxAbsR.toFixed(3)}`);
  console.log(`  신규 진입: ${newEntrants.length}곳 (그중 |r|≥0.20: ${newStrong.length}곳)`);
  console.log(`  기존 탈락: ${droppedFromCurrent.length}곳`);
  console.log(`\n  ▶ 시나리오: ${verdict}`);
  console.log(`  ▶ 권장: ${recommendation}`);

  console.log(`\n[D] 데이터 결측 (sales_data 일수 대비 절반 미만 수집)`);
  const sparseStations = spec.perStationDays.filter(
    (ps) => ps.days < salesMap.size * 0.5
  );
  if (sparseStations.length === 0) {
    console.log(`  없음 — 모든 경쟁사가 sales_data 일수의 50% 이상 수집됨`);
  } else {
    sparseStations.forEach((ps) => {
      console.log(
        `  ⚠️ ${pad(shortName(ps.name), 26)} ${ps.distance_km.toFixed(2)}km  ${ps.days}일 / ${salesMap.size}일`
      );
    });
  }

  console.log(`\n=== 끝 ===\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
