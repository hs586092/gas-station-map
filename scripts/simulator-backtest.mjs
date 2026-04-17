// 가격 시뮬레이터 다변수 vs 단변수 backtest (read-only).
//
// 명세: memory/spec_simulator_multivariate_phase1.md (작성 예정)
// 일정 정책: project_release_policy.md (시간 게이트 없음)
//
// 비교 대상 3 모델:
//   A — 단변수 (현재 시뮬): perWon = up/down.avgVolumeChangeRate / |avgPriceChange|
//                          salesImpact% = perWon × delta (그룹별: 주중/주말 × 인상/인하)
//   B — 다변수 (integrated): salesImpactL = (myPriceElasticity.perWon + compGapElasticity.perWon) × delta
//                          salesImpact% = salesImpactL / overallMean × 100
//   C — 베이스라인: 항상 0% (모델 가치 sanity check)
//
// 측정: MAE + Sign agreement (휘발유/경유 분리 + 종합)
// holdout: (라) 단순화 — 현재 계수로 모든 events 평가 (모델 재학습 없음)
//
// 사용법:
//   1. dev 서버 실행 (npm run dev)
//   2. node scripts/simulator-backtest.mjs
//
// read-only — 어떤 테이블도 쓰지 않음.

const BASE = process.env.BACKTEST_BASE_URL || "http://localhost:3000";
const STATION_ID = "A0003453";
const OUTLIER_THRESHOLD = 100; // |actualVolChangeRate| > 100% 는 outlier (포함하되 별도 표시)

function pad(s, n) {
  s = String(s);
  let v = 0;
  for (const c of s) v += c.charCodeAt(0) > 127 ? 2 : 1;
  return s + " ".repeat(Math.max(0, n - v));
}

function fmt(n, digits = 2) {
  if (n == null || Number.isNaN(n)) return "—".padStart(digits + 4);
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}`;
}

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

// Model A — 단변수 (현재 시뮬 page.tsx 로직 재현)
// fuelEvents 의 splitElasticityByFuel 그룹 평균 perWon × priceChange
function predictA(event, splitByFuel) {
  const { fuel, isWeekend, priceChange } = event;
  const bf = splitByFuel?.[fuel];
  if (!bf) return null;
  const split = isWeekend ? bf.weekend : bf.weekday;
  if (!split) return null;

  // 시뮬 page.tsx 로직 그대로:
  // delta>0 + up.count >= 3 + up.avgPriceChange > 0 → perWon = up.avgVolumeChangeRate / up.avgPriceChange
  // delta<0 + down.count >= 3 + down.avgPriceChange < 0 → perWon = down.avgVolumeChangeRate / |down.avgPriceChange|
  // 그 외: dowElasticity fallback (avgVolumeChangeRate)
  if (priceChange > 0 && split.up && split.up.count >= 3 && split.up.avgPriceChange > 0) {
    const perWon = split.up.avgVolumeChangeRate / split.up.avgPriceChange;
    return perWon * priceChange;
  }
  if (priceChange < 0 && split.down && split.down.count >= 3 && split.down.avgPriceChange < 0) {
    const perWon = split.down.avgVolumeChangeRate / Math.abs(split.down.avgPriceChange);
    return perWon * Math.abs(priceChange);
  }
  // dowElasticity fallback (split.avgVolumeChangeRate)
  if (split.avgVolumeChangeRate != null && split.count >= 2) {
    // page.tsx 의 fallback 공식: -|dowElasticity / avgAbsChange| × delta
    // avgAbsChange는 fuelEvents 기준이므로 별도 인수로 받기 어려움
    // 단순화: split.avgVolumeChangeRate는 이미 % 단위 평균이라 그대로 반환
    // (page.tsx 와 미세 차이 있을 수 있으나 1차/2차 분기 만족 시에는 동일)
    return split.avgVolumeChangeRate;
  }
  return null;
}

// Model B — 다변수 (integrated coefficients)
// (myPriceElasticity.perWon + compGapElasticity.perWon) × delta → L 단위
// overallMean으로 % 환산
function predictB(event, coeffs) {
  if (!coeffs) return null;
  const my = coeffs.myPriceElasticity;
  const cg = coeffs.compGapElasticity;
  const om = coeffs.overallMean;
  if (!om) return null;

  let perWonSum = 0;
  let used = 0;
  if (my && my.perWon != null) {
    perWonSum += my.perWon;
    used++;
  }
  if (cg && cg.perWon != null) {
    perWonSum += cg.perWon;
    used++;
  }
  if (used === 0) return null;

  const deltaL = perWonSum * event.priceChange;
  return (deltaL / om) * 100;
}

// Model C — 항상 0%
function predictC(_event) {
  return 0;
}

// MAE + Sign agreement
function summarize(preds) {
  // preds: [{actual, predA, predB, predC, ...}]
  const stats = { A: { mae: 0, sign: 0 }, B: { mae: 0, sign: 0 }, C: { mae: 0, sign: 0 } };
  const counts = { A: 0, B: 0, C: 0 };
  for (const p of preds) {
    for (const m of ["A", "B", "C"]) {
      const pred = p["pred" + m];
      if (pred == null || p.actual == null) continue;
      stats[m].mae += Math.abs(pred - p.actual);
      // sign: 부호 일치 (둘 다 0이면 일치, 한쪽만 0이면 불일치)
      const aSign = Math.sign(p.actual);
      const pSign = Math.sign(pred);
      if (aSign === pSign) stats[m].sign++;
      counts[m]++;
    }
  }
  const result = {};
  for (const m of ["A", "B", "C"]) {
    result[m] = {
      mae: counts[m] > 0 ? stats[m].mae / counts[m] : null,
      sign: stats[m].sign,
      total: counts[m],
      signPct: counts[m] > 0 ? (stats[m].sign / counts[m]) * 100 : null,
    };
  }
  return result;
}

function printSection(title, preds) {
  console.log(`\n${title} events ${preds.length}건`);
  if (preds.length === 0) {
    console.log(`  표본 없음`);
    return;
  }
  const s = summarize(preds);
  for (const [m, label] of [["A", "단변수"], ["B", "다변수"], ["C", "always 0"]]) {
    const r = s[m];
    if (r.mae == null) {
      console.log(`  Model ${m} (${label}):    예측 불가 (계수 없음)`);
      continue;
    }
    console.log(`  Model ${m} (${label}):    MAE = ${r.mae.toFixed(2)}%   Sign agreement = ${r.sign}/${r.total} (${r.signPct.toFixed(1)}%)`);
  }
  // 요약
  const A = s.A, B = s.B;
  if (A.mae != null && B.mae != null) {
    const maeDiff = B.mae - A.mae;
    const signDiff = B.sign - A.sign;
    const dir = maeDiff < 0 ? "낮음" : "높음";
    console.log(`  → B가 A 대비 MAE ${fmt(maeDiff, 2)}%p ${dir}, Sign ${fmt(signDiff, 0)}건 ${signDiff >= 0 ? "더 일치" : "덜 일치"}`);
  }
}

async function main() {
  console.log("=== Simulator Backtest ===");
  console.log(`기준: ${BASE}/api/snapshot/${STATION_ID}`);
  console.log(`outlier 임계: |actualVolChangeRate| > ${OUTLIER_THRESHOLD}%`);

  let snap, sa, ig;
  try {
    snap = await fetchJson(`/api/snapshot/${STATION_ID}?tier=all`);
    sa = snap.salesAnalysis;
    ig = snap.integratedForecast;
  } catch (e) {
    console.error(`\n❌ snapshot fetch 실패: ${e.message}`);
    console.error(`   dev 서버가 실행 중인지 확인 (npm run dev) 또는 BACKTEST_BASE_URL 환경변수`);
    process.exit(1);
  }

  if (!sa || !sa.events) {
    console.error("salesAnalysis.events 없음");
    process.exit(1);
  }

  const events = sa.events;
  const splitByFuel = sa.splitElasticityByFuel || null;
  const coeffs = ig?.coefficients || null;

  console.log(`\n총 events: ${events.length}건 (휘발유 ${events.filter(e => (e.fuel||"gasoline")==="gasoline").length} / 경유 ${events.filter(e => (e.fuel||"gasoline")==="diesel").length})`);
  console.log(`splitElasticityByFuel: ${splitByFuel ? "있음" : "없음"}`);
  console.log(`integratedForecast.coefficients: ${coeffs ? "있음" : "없음"}`);
  if (coeffs) {
    console.log(`  myPriceElasticity: ${coeffs.myPriceElasticity ? `perWon=${coeffs.myPriceElasticity.perWon.toFixed(2)} L/원, n=${coeffs.myPriceElasticity.n}, reliable=${coeffs.myPriceElasticity.reliable}` : "null"}`);
    console.log(`  compGapElasticity: ${coeffs.compGapElasticity ? `perWon=${coeffs.compGapElasticity.perWon.toFixed(2)} L/원, n=${coeffs.compGapElasticity.n}, reliable=${coeffs.compGapElasticity.reliable}` : "null"}`);
    console.log(`  overallMean: ${coeffs.overallMean?.toFixed(0)} L`);
  }

  // 예측 계산
  const preds = events.map((e) => {
    const actual = e.volumeChangeRate;
    const predA = predictA(e, splitByFuel);
    const predB = predictB(e, coeffs);
    const predC = predictC(e);
    const isOutlier = Math.abs(actual) > OUTLIER_THRESHOLD;
    return {
      date: e.date,
      fuel: e.fuel || "gasoline",
      priceChange: e.priceChange,
      isWeekend: e.isWeekend,
      actual,
      predA,
      predB,
      predC,
      isOutlier,
      errorA: predA != null ? Math.abs(predA - actual) : null,
      errorB: predB != null ? Math.abs(predB - actual) : null,
    };
  });

  // 휘발유/경유/전체 요약
  const gasPreds = preds.filter((p) => p.fuel === "gasoline");
  const dslPreds = preds.filter((p) => p.fuel === "diesel");
  printSection("[휘발유]", gasPreds);
  printSection("[경유]", dslPreds);
  printSection("[전체 종합]", preds);

  // outlier 별도 표시
  const outliers = preds.filter((p) => p.isOutlier);
  if (outliers.length > 0) {
    console.log(`\n⚠️ outlier (|actual|>${OUTLIER_THRESHOLD}%): ${outliers.length}건 — 위 계산 포함됨`);
    for (const o of outliers) {
      console.log(`  ${o.date} ${o.fuel} ${o.priceChange > 0 ? "+" : ""}${o.priceChange}원 → 실제 ${o.actual.toFixed(1)}%`);
    }
    console.log(`  outlier 제외 시 재계산 ↓`);
    const cleanPreds = preds.filter((p) => !p.isOutlier);
    printSection("[전체 종합 — outlier 제외]", cleanPreds);
  }

  // per-event detail
  console.log(`\n=== per-event detail (CSV-like) ===`);
  console.log(`date, fuel, dPrice, actual%, predA%, predB%, errA, errB, signA, signB, outlier`);
  for (const p of preds.slice().sort((a, b) => a.date.localeCompare(b.date))) {
    const signA = p.predA != null && Math.sign(p.predA) === Math.sign(p.actual) ? "✓" : "✗";
    const signB = p.predB != null && Math.sign(p.predB) === Math.sign(p.actual) ? "✓" : "✗";
    console.log(
      `${p.date}, ${pad(p.fuel, 8)}, ${fmt(p.priceChange, 0).padStart(4)}, ${fmt(p.actual, 1).padStart(7)}, ${p.predA != null ? fmt(p.predA, 1).padStart(7) : "    —  "}, ${p.predB != null ? fmt(p.predB, 1).padStart(7) : "    —  "}, ${p.errorA != null ? p.errorA.toFixed(2).padStart(6) : "    — "}, ${p.errorB != null ? p.errorB.toFixed(2).padStart(6) : "    — "}, ${signA}, ${signB}${p.isOutlier ? ", OUT" : ""}`
    );
  }

  // 최종 권장
  console.log(`\n=== 결론 ===`);
  const sAll = summarize(preds);
  if (sAll.A.mae != null && sAll.B.mae != null) {
    const maeDiff = sAll.B.mae - sAll.A.mae;
    const signDiff = sAll.B.sign - sAll.A.sign;
    let verdict;
    if (maeDiff <= -2) verdict = "✅ 다변수(B)가 단변수(A)보다 명백히 더 정확 — Phase 1 도입 권장";
    else if (maeDiff <= -0.5 && signDiff >= 0) verdict = "🟡 다변수(B)가 약간 더 정확 — 도입 가능, walk-forward 추가 검증 권장";
    else if (Math.abs(maeDiff) < 1) verdict = "🟠 두 모델 비슷 — 도입 가치 적음 (단변수 유지 권장)";
    else verdict = "🔴 단변수(A)가 더 정확 — 다변수 도입 보류, 데이터 더 누적 후 재검토";
    console.log(`  전체 종합 MAE 차이 (B-A): ${fmt(maeDiff, 2)}%p`);
    console.log(`  전체 종합 Sign 차이 (B-A): ${fmt(signDiff, 0)}건`);
    console.log(`  → ${verdict}`);
  } else {
    console.log(`  Model B (다변수) 예측 불가 — 계수 없음. 다변수 도입 불가.`);
  }

  console.log(``);
}

main().catch((e) => {
  console.error("backtest 실패:", e);
  process.exit(1);
});
