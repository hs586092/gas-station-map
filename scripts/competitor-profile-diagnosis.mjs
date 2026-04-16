// 경쟁사 프로파일 카드 진단 (read-only).
//
// 사용자 보고: 카드에 6곳 전부 "선제형". 추종형/안정형 0곳.
//
// insights.ts:546-604 로직 그대로 재현:
//   - 5km 내 거리순 30곳 (slice(0, 30))
//   - 18일 윈도우 price_history fetch
//   - 같은 날짜는 첫 행만 dedupe (collected_at 일자 단위)
//   - 일자 간 가격 차이가 있으면 changes++
//   - changes >= 5 → leader / >= 3 → follower / 그 외 → steady
//   - rows.length < 3 → unknown (데이터 부족)
//   - API 노출: .filter(unknown 제외).sort(changeCount desc).slice(0, 8)
//   - 카드 노출: .slice(0, 6)
//
// 사용법:
//   node scripts/competitor-profile-diagnosis.mjs
//
// read-only.

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
const sb = createClient(SUPABASE_URL, KEY);

const STATION_ID = "A0003453";
const RADIUS_KM = 5;

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
  console.log("\n=== 경쟁사 프로파일 카드 진단 ===\n");

  // ── 1. 기준 + 5km 후보 (insights.ts:27-45 동치) ──
  const { data: base } = await sb
    .from("stations")
    .select("id, name, brand, lat, lng, gasoline_price, diesel_price")
    .eq("id", STATION_ID)
    .single();

  const latD = RADIUS_KM / 111;
  const lngD = RADIUS_KM / 88;
  const { data: candidates } = await sb
    .from("stations")
    .select("id, name, brand, lat, lng, gasoline_price, diesel_price")
    .gte("lat", base.lat - latD)
    .lte("lat", base.lat + latD)
    .gte("lng", base.lng - lngD)
    .lte("lng", base.lng + lngD)
    .neq("id", STATION_ID);

  const competitors = (candidates || [])
    .map((s) => ({
      ...s,
      distance_km:
        Math.round(haversineKm(base.lat, base.lng, s.lat, s.lng) * 100) / 100,
    }))
    .filter((s) => s.distance_km <= RADIUS_KM)
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, 30);

  console.log(`5km 내 후보: ${competitors.length}곳 (insights.ts 기준 slice(0, 30))`);

  // ── 2. 18일 윈도우 price_history (페이지네이션으로 cap 회피) ──
  const eighteenDaysAgo = new Date(Date.now() - 18 * 86400000).toISOString();
  console.log(`윈도우 시작: ${eighteenDaysAgo.slice(0, 10)} ~ 오늘`);

  // insights.ts 와 동일 호출 (limit 없음) — cap 영향 측정 위해
  const { data: histLimited } = await sb
    .from("price_history")
    .select("station_id, gasoline_price, collected_at")
    .in("station_id", competitors.map((c) => c.id))
    .gte("collected_at", eighteenDaysAgo)
    .not("gasoline_price", "is", null)
    .order("collected_at", { ascending: true });

  // 페이지네이션으로 진실값
  const histFull = await fetchAll(() =>
    sb
      .from("price_history")
      .select("station_id, gasoline_price, collected_at")
      .in("station_id", competitors.map((c) => c.id))
      .gte("collected_at", eighteenDaysAgo)
      .not("gasoline_price", "is", null)
      .order("collected_at", { ascending: true })
  );

  console.log(`limit 없음 fetch: ${histLimited?.length ?? 0}행`);
  console.log(`페이지네이션 fetch: ${histFull.length}행`);
  if ((histLimited?.length ?? 0) !== histFull.length) {
    console.log(`⚠️ PostgREST 1000 cap 에 의해 ${histFull.length - (histLimited?.length ?? 0)}행 잘림`);
  } else {
    console.log(`✅ cap 영향 없음 (현재 30 station × 18일 = 최대 540행)`);
  }

  // ── 3. insights.ts:557-604 로직 재현 ──
  const byStation = new Map();
  for (const r of histFull) {
    if (!byStation.has(r.station_id)) byStation.set(r.station_id, []);
    const arr = byStation.get(r.station_id);
    // dedupe: 같은 날짜는 첫 행만 (insights.ts:562)
    if (arr.length === 0 || arr[arr.length - 1].date !== r.collected_at.slice(0, 10)) {
      arr.push({ price: r.gasoline_price, date: r.collected_at.slice(0, 10) });
    }
  }

  // 모든 경쟁사에 대해 분류
  const profiles = [];
  for (const comp of competitors) {
    const rows = byStation.get(comp.id);
    if (!rows || rows.length < 3) {
      profiles.push({
        ...comp,
        rowsCount: rows?.length ?? 0,
        changeCount: 0,
        avgChangeSize: 0,
        type: "unknown",
        typeLabel: "데이터 부족",
        priceTrace: rows?.map((r) => `${r.date.slice(5)}:${r.price}`) ?? [],
      });
      continue;
    }
    let changes = 0;
    let totalSize = 0;
    const trace = [];
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].price !== rows[i - 1].price) {
        changes++;
        const diff = rows[i].price - rows[i - 1].price;
        totalSize += Math.abs(diff);
        trace.push(`${rows[i].date.slice(5)}:${diff > 0 ? "+" : ""}${diff}`);
      }
    }
    const avgSize = changes > 0 ? Math.round(totalSize / changes) : 0;
    let type, typeLabel;
    if (changes >= 5) {
      type = "leader";
      typeLabel = "선제형";
    } else if (changes >= 3) {
      type = "follower";
      typeLabel = "추종형";
    } else {
      type = "steady";
      typeLabel = "안정형";
    }
    profiles.push({
      ...comp,
      rowsCount: rows.length,
      changeCount: changes,
      avgChangeSize: avgSize,
      type,
      typeLabel,
      priceTrace: rows.map((r) => `${r.date.slice(5)}:${r.price}`),
      changeTrace: trace,
    });
  }

  // ── 4. 분류 임계값 ──
  console.log(`\n[분류 임계값] (insights.ts:590-596)`);
  console.log(`  changes >= 5 → leader (선제형)`);
  console.log(`  changes >= 3 → follower (추종형)`);
  console.log(`  changes 0~2 → steady (안정형)`);
  console.log(`  rows < 3   → unknown (데이터 부족, API 응답에서 제외)`);

  // ── 5. 30곳 전체 분류 결과 ──
  console.log(`\n[30곳 전체 분류 결과 — 거리순]`);
  console.log(`  순위  주유소                       거리      행수  변경수  평균폭  분류`);
  profiles.forEach((p, i) => {
    console.log(
      `   ${String(i + 1).padStart(2)}.  ${pad(shortName(p.name), 26)} ${p.distance_km.toFixed(2).padStart(5)}km    ${String(p.rowsCount).padStart(3)}     ${String(p.changeCount).padStart(2)}    ${String(p.avgChangeSize).padStart(4)}원  ${p.typeLabel}`
    );
  });

  // ── 6. 분류 분포 ──
  const dist = { leader: 0, follower: 0, steady: 0, unknown: 0 };
  for (const p of profiles) dist[p.type]++;
  console.log(`\n[분포]`);
  console.log(`  선제형 (≥5회): ${dist.leader}곳`);
  console.log(`  추종형 (3~4회): ${dist.follower}곳`);
  console.log(`  안정형 (0~2회): ${dist.steady}곳`);
  console.log(`  데이터 부족: ${dist.unknown}곳 (API 응답에서 제외됨)`);

  // ── 7. API/카드 노출 슬라이스 ──
  const apiOutput = profiles
    .filter((p) => p.type !== "unknown")
    .sort((a, b) => b.changeCount - a.changeCount)
    .slice(0, 8);
  const cardOutput = apiOutput.slice(0, 6);

  console.log(`\n[insights.ts API 노출 (.filter unknown 제외 .sort changeCount desc .slice(0, 8))]`);
  apiOutput.forEach((p, i) => {
    console.log(
      `  ${i + 1}. ${pad(shortName(p.name), 26)} ${p.distance_km.toFixed(2).padStart(5)}km  ${String(p.changeCount).padStart(2)}회  ${p.typeLabel}`
    );
  });

  console.log(`\n[메인 카드 노출 (.slice(0, 6))]`);
  cardOutput.forEach((p, i) => {
    console.log(
      `  ${i + 1}. ${pad(shortName(p.name), 26)} ${p.distance_km.toFixed(2).padStart(5)}km  ${String(p.changeCount).padStart(2)}회  ${p.typeLabel}`
    );
  });

  // ── 8. 변경 횟수 분포 (히스토그램) ──
  console.log(`\n[변경 횟수 분포 — 30곳]`);
  const histo = {};
  for (const p of profiles) {
    if (p.type === "unknown") continue;
    const k = p.changeCount;
    histo[k] = (histo[k] ?? 0) + 1;
  }
  for (const k of Object.keys(histo).sort((a, b) => +b - +a)) {
    const bar = "█".repeat(histo[k]);
    const tag =
      +k >= 5 ? " ← 선제형" : +k >= 3 ? " ← 추종형" : " ← 안정형";
    console.log(`  ${String(k).padStart(2)}회: ${bar} (${histo[k]}곳)${tag}`);
  }

  // ── 9. 진단 결론 ──
  console.log(`\n[진단 결론]`);
  if (dist.leader === profiles.length - dist.unknown) {
    console.log(`  🚨 분류 가능한 ${profiles.length - dist.unknown}곳 모두 leader 임.`);
    console.log(`     사용자 관찰 ("6곳 전부 선제형") 일치.`);
    console.log(`     원인: 지난 18일 동안 모두 5회 이상 변경됨.`);
    console.log(`     해석: 최근 시장 변동성이 컸던 시기 (유가 변동 등) →`);
    console.log(`           5회 임계값이 너무 낮아 모두 leader 로 잡힘.`);
  } else {
    console.log(`  분포: leader=${dist.leader}, follower=${dist.follower}, steady=${dist.steady}`);
    console.log(`  카드에 ${dist.leader >= 6 ? "leader 만 보일 가능성 큼" : "다양한 타입이 보임"}.`);
  }

  // ── 10. 실제 가격 변동 trace (상위 6곳) ──
  console.log(`\n[변동 추적 — 카드 노출 상위 6곳의 18일 가격 trace]`);
  cardOutput.forEach((p) => {
    console.log(
      `  ${shortName(p.name)} (${p.distance_km}km · ${p.changeCount}회 · 평균±${p.avgChangeSize}원):`
    );
    console.log(`    가격: ${p.priceTrace.join("  ")}`);
    console.log(`    변동: ${p.changeTrace?.join("  ") || "—"}`);
  });

  console.log(`\n=== 진단 끝 ===\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
