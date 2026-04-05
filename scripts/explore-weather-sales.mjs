// 날씨 × 판매량 탐색 스크립트 (탐색 전용, 1회성)
//
// 사용법:
//   node scripts/explore-weather-sales.mjs
//
// - .env.local에서 NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 자동 로드
// - sales_data ∩ weather_daily 조인
// - 날씨코드별 / 기온구간별 / 요일×날씨 셀별 n, 평균, 표준편차 출력
// - 건당 주유량 분해 (손님 수 vs 건당 주유량)
// - 이 결과를 보고 API 설계를 확정

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── .env.local 수동 로드 ──
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
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("SUPABASE 환경변수가 없습니다.");
  process.exit(1);
}

const STATION_ID = "A0003453";

// ── Supabase REST 헬퍼 ──
async function sbSelect(table, query) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Range: "0-9999",
    },
  });
  if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

// ── WMO 코드 분류 ──
function weatherGroup(code) {
  if (code == null) return "unknown";
  if (code <= 1) return "clear";       // 0, 1: 맑음
  if (code <= 3) return "cloudy";      // 2, 3: 흐림
  if (code <= 48) return "fog";        // 45, 48: 안개
  if (code <= 57) return "drizzle";    // 51-57: 이슬비
  if (code <= 65) return "rain";       // 61-65: 비
  if (code <= 77) return "snow";       // 66-77: 눈/진눈깨비
  if (code <= 82) return "shower";     // 80-82: 소나기
  if (code <= 86) return "snowShower"; // 85-86: 눈 소나기
  if (code <= 99) return "thunder";    // 95-99: 뇌우
  return "unknown";
}
const groupLabel = {
  clear: "맑음", cloudy: "흐림", fog: "안개", drizzle: "이슬비",
  rain: "비", snow: "눈", shower: "소나기", snowShower: "눈소나기",
  thunder: "뇌우", unknown: "알수없음",
};

// ── 기온 구간 ──
function tempBucket(t) {
  if (t == null) return null;
  if (t < 0) return "0↓";
  if (t < 10) return "0~10";
  if (t < 20) return "10~20";
  if (t < 30) return "20~30";
  return "30↑";
}

// ── 통계 유틸 ──
function stats(arr) {
  const n = arr.length;
  if (n === 0) return { n: 0, mean: null, std: null, median: null };
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(n - 1, 1);
  const std = Math.sqrt(variance);
  const sorted = [...arr].sort((a, b) => a - b);
  const median = sorted[Math.floor(n / 2)];
  return { n, mean, std, median };
}
function fmt(n, digits = 0) {
  if (n == null || Number.isNaN(n)) return "  -  ";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits }).padStart(7);
}

// ── 메인 ──
async function main() {
  console.log("─".repeat(70));
  console.log(" 날씨 × 판매량 탐색 (셀프광장주유소 A0003453)");
  console.log("─".repeat(70));

  const [sales, weather] = await Promise.all([
    sbSelect(
      "sales_data",
      `select=date,gasoline_volume,gasoline_count,gasoline_amount,diesel_volume,diesel_count&station_id=eq.${STATION_ID}&order=date.asc`
    ),
    sbSelect(
      "weather_daily",
      `select=date,weather_code,temp_max,temp_min,precipitation_mm&order=date.asc`
    ),
  ]);

  console.log(`\n[데이터] sales: ${sales.length}일, weather: ${weather.length}일`);
  console.log(`  sales 범위: ${sales[0]?.date} ~ ${sales[sales.length - 1]?.date}`);
  console.log(`  weather 범위: ${weather[0]?.date} ~ ${weather[weather.length - 1]?.date}`);

  // ── 조인 ──
  const weatherMap = new Map(weather.map((w) => [w.date, w]));
  const joined = [];
  for (const s of sales) {
    const w = weatherMap.get(s.date);
    if (!w) continue;
    const gVol = Number(s.gasoline_volume) || 0;
    const dVol = Number(s.diesel_volume) || 0;
    const gCnt = Number(s.gasoline_count) || 0;
    const dCnt = Number(s.diesel_count) || 0;
    if (gVol === 0 && dVol === 0) continue;
    const totalVol = gVol + dVol;
    const totalCnt = gCnt + dCnt;
    joined.push({
      date: s.date,
      dow: new Date(s.date + "T00:00:00+09:00").getDay(), // 0=일..6=토
      gVol, dVol, gCnt, dCnt,
      totalVol,
      totalCnt,
      perTxn: totalCnt > 0 ? totalVol / totalCnt : null,
      weatherCode: w.weather_code,
      weatherGroup: weatherGroup(w.weather_code),
      tempAvg: (Number(w.temp_max) + Number(w.temp_min)) / 2,
      tempMax: Number(w.temp_max),
      precip: Number(w.precipitation_mm) || 0,
    });
  }

  console.log(`\n[교집합] sales ∩ weather: ${joined.length}일`);
  if (joined.length === 0) {
    console.log("교집합 데이터가 없어 종료.");
    return;
  }
  console.log(`  범위: ${joined[0].date} ~ ${joined[joined.length - 1].date}`);

  // 전체 베이스라인
  const allVol = joined.map((d) => d.totalVol);
  const allCnt = joined.map((d) => d.totalCnt);
  const allPerTxn = joined.map((d) => d.perTxn).filter((x) => x != null);
  const baselineVol = stats(allVol);
  const baselineCnt = stats(allCnt);
  const baselinePerTxn = stats(allPerTxn);
  console.log(`\n[베이스라인] 전체 평균`);
  console.log(`  판매량:    mean=${fmt(baselineVol.mean)}L  std=${fmt(baselineVol.std)}  median=${fmt(baselineVol.median)}`);
  console.log(`  건수:      mean=${fmt(baselineCnt.mean)}건 std=${fmt(baselineCnt.std)}`);
  console.log(`  건당:      mean=${fmt(baselinePerTxn.mean, 1)}L/건`);

  // ── 1. 날씨 그룹별 ──
  console.log(`\n─── [1] 날씨 그룹별 판매량 / 건수 / 건당 ───`);
  console.log(`  그룹        n    판매량(평균)  건수   건당L  판매량Δ%`);
  const groups = new Map();
  for (const d of joined) {
    if (!groups.has(d.weatherGroup)) groups.set(d.weatherGroup, []);
    groups.get(d.weatherGroup).push(d);
  }
  const groupRows = [...groups.entries()]
    .map(([g, arr]) => {
      const vol = stats(arr.map((x) => x.totalVol));
      const cnt = stats(arr.map((x) => x.totalCnt));
      const pt = stats(arr.map((x) => x.perTxn).filter((x) => x != null));
      const diffPct = ((vol.mean - baselineVol.mean) / baselineVol.mean) * 100;
      return { g, n: vol.n, vol, cnt, pt, diffPct };
    })
    .sort((a, b) => b.n - a.n);
  for (const r of groupRows) {
    console.log(
      `  ${groupLabel[r.g].padEnd(8)} ${String(r.n).padStart(4)}  ${fmt(r.vol.mean)}L  ${fmt(r.cnt.mean)}  ${fmt(r.pt.mean, 1)}  ${(r.diffPct >= 0 ? "+" : "") + r.diffPct.toFixed(1)}%`
    );
  }

  // ── 2. 강수 유무 2분 (비 vs 안비)로 단순 비교 ──
  console.log(`\n─── [2] 강수 유무 (precipitation_mm >= 1) ───`);
  const wet = joined.filter((d) => d.precip >= 1);
  const dry = joined.filter((d) => d.precip < 1);
  const wetVol = stats(wet.map((x) => x.totalVol));
  const dryVol = stats(dry.map((x) => x.totalVol));
  const wetCnt = stats(wet.map((x) => x.totalCnt));
  const dryCnt = stats(dry.map((x) => x.totalCnt));
  const wetPt = stats(wet.map((x) => x.perTxn).filter((x) => x != null));
  const dryPt = stats(dry.map((x) => x.perTxn).filter((x) => x != null));
  console.log(`  건조일 (n=${dryVol.n}):  판매량=${fmt(dryVol.mean)}L  건수=${fmt(dryCnt.mean)}  건당=${fmt(dryPt.mean, 1)}L`);
  console.log(`  강수일 (n=${wetVol.n}):  판매량=${fmt(wetVol.mean)}L  건수=${fmt(wetCnt.mean)}  건당=${fmt(wetPt.mean, 1)}L`);
  console.log(`  차이:           판매량 ${((wetVol.mean - dryVol.mean) / dryVol.mean * 100).toFixed(1)}%  건수 ${((wetCnt.mean - dryCnt.mean) / dryCnt.mean * 100).toFixed(1)}%  건당 ${((wetPt.mean - dryPt.mean) / dryPt.mean * 100).toFixed(1)}%`);
  // Welch's t-test (판매량)
  const tStat = (wetVol.mean - dryVol.mean) / Math.sqrt((wetVol.std ** 2) / wetVol.n + (dryVol.std ** 2) / dryVol.n);
  console.log(`  Welch t-stat (판매량): ${tStat.toFixed(2)}  → |t|>1.96이면 p<0.05 수준 유의`);

  // ── 3. 기온 구간별 ──
  console.log(`\n─── [3] 기온 구간별 (일평균 기온) ───`);
  console.log(`  구간     n    판매량(평균)  건수    건당L   Δ%`);
  const tempGroups = new Map();
  for (const d of joined) {
    const b = tempBucket(d.tempAvg);
    if (!b) continue;
    if (!tempGroups.has(b)) tempGroups.set(b, []);
    tempGroups.get(b).push(d);
  }
  const tempOrder = ["0↓", "0~10", "10~20", "20~30", "30↑"];
  for (const b of tempOrder) {
    const arr = tempGroups.get(b);
    if (!arr) continue;
    const vol = stats(arr.map((x) => x.totalVol));
    const cnt = stats(arr.map((x) => x.totalCnt));
    const pt = stats(arr.map((x) => x.perTxn).filter((x) => x != null));
    const diffPct = ((vol.mean - baselineVol.mean) / baselineVol.mean) * 100;
    console.log(`  ${b.padEnd(6)} ${String(vol.n).padStart(4)}  ${fmt(vol.mean)}L  ${fmt(cnt.mean)}  ${fmt(pt.mean, 1)}  ${(diffPct >= 0 ? "+" : "") + diffPct.toFixed(1)}%`);
  }

  // ── 4. 요일 × 날씨(단순화: wet/dry) 교차표 ──
  console.log(`\n─── [4] 요일 × 강수 교차표 (셀: n / 평균판매량L) ───`);
  console.log(`            건조일              강수일`);
  const dowNames = ["일", "월", "화", "수", "목", "금", "토"];
  for (let dow = 0; dow < 7; dow++) {
    const dryCell = joined.filter((d) => d.dow === dow && d.precip < 1);
    const wetCell = joined.filter((d) => d.dow === dow && d.precip >= 1);
    const dryM = stats(dryCell.map((x) => x.totalVol));
    const wetM = stats(wetCell.map((x) => x.totalVol));
    console.log(
      `  ${dowNames[dow]}  n=${String(dryM.n).padStart(3)} ${fmt(dryM.mean)}L   n=${String(wetM.n).padStart(3)} ${fmt(wetM.mean)}L`
    );
  }

  // ── 5. 가법 모델 — 요일 효과와 날씨 효과 분리 ──
  // residual_i = v_i - dowMean[dow_i]
  // weatherEffect[group] = mean(residual_i for i in group)
  console.log(`\n─── [5] 가법 모델 (요일 효과 제거 후 날씨 효과) ───`);
  const dowMean = new Map();
  for (let dow = 0; dow < 7; dow++) {
    const arr = joined.filter((d) => d.dow === dow);
    dowMean.set(dow, stats(arr.map((x) => x.totalVol)).mean);
  }
  console.log(`  요일별 평균 판매량:`);
  for (let dow = 0; dow < 7; dow++) {
    console.log(`    ${dowNames[dow]}: ${fmt(dowMean.get(dow))}L`);
  }
  console.log(`\n  날씨 효과 (요일 조정 후 잔차, baseline 대비 Δ%):`);
  const residByGroup = new Map();
  for (const d of joined) {
    const resid = d.totalVol - dowMean.get(d.dow);
    if (!residByGroup.has(d.weatherGroup)) residByGroup.set(d.weatherGroup, []);
    residByGroup.get(d.weatherGroup).push(resid);
  }
  for (const [g, arr] of [...residByGroup.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const s = stats(arr);
    const pct = (s.mean / baselineVol.mean) * 100;
    console.log(`    ${groupLabel[g].padEnd(8)} n=${String(s.n).padStart(4)}  residual=${fmt(s.mean)}L  (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`);
  }

  // ── 6. 상관계수 — 일 강수량 vs 판매량, 기온 vs 판매량 ──
  function pearson(xs, ys) {
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      dx += (xs[i] - mx) ** 2;
      dy += (ys[i] - my) ** 2;
    }
    return num / Math.sqrt(dx * dy);
  }
  const rPrecip = pearson(joined.map((d) => d.precip), joined.map((d) => d.totalVol));
  const rTemp = pearson(joined.map((d) => d.tempAvg), joined.map((d) => d.totalVol));
  console.log(`\n─── [6] 상관계수 (Pearson) ───`);
  console.log(`  강수량 × 판매량: r = ${rPrecip.toFixed(3)}`);
  console.log(`  평균기온 × 판매량: r = ${rTemp.toFixed(3)}`);

  console.log(`\n${"─".repeat(70)}\n탐색 완료.`);
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
