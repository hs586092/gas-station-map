// 일회성 시뮬레이션: 실제 forecast_history 를 읽어 self-diagnosis 출력을
// 미리 본다. 배포 전 카드가 어떤 상태를 보여줄지 정직하게 확인하는 용도.
//
// 사용법:
//   node scripts/self-diagnosis-dry-run.mjs
//
// 이 스크립트는 read-only 다. 테이블에 아무것도 쓰지 않는다.

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 직접 .env.local 을 읽어 process.env 를 덮어쓴다.
// shell source 로 인한 `\n` 오염 방지를 위해 항상 재설정한다.
try {
  const envText = readFileSync(resolve(__dirname, "../.env.local"), "utf8");
  for (const line of envText.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m) {
      let value = m[2].replace(/^["']|["']$/g, "");
      // 끝에 붙은 literal `\n` 제거
      value = value.replace(/\\n$/, "").trim();
      process.env[m[1]] = value;
    }
  }
} catch (e) {
  console.error(".env.local 로드 실패:", e.message);
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
// 서비스 키로 모든 데이터를 볼 수 있도록 함 (read-only)
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !KEY) {
  console.error("SUPABASE 환경변수가 없습니다.");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, KEY);
const STATION_ID = "A0003453";
const WINDOW_DAYS = 30;

// ── 유틸 (forecast-self-diagnosis.ts 에서 그대로 가져옴) ──
function dowFromDateStr(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
const mean = (arr) =>
  arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
const stddev = (arr) => {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(v);
};

async function main() {
  const fromDate = new Date(Date.now() - WINDOW_DAYS * 86400000)
    .toISOString()
    .split("T")[0];

  console.log(`\n=== self-diagnosis dry-run ===`);
  console.log(`station_id: ${STATION_ID}`);
  console.log(`window: ${fromDate} ~ today (${WINDOW_DAYS}일)\n`);

  const { data: forecasts, error: fcErr } = await sb
    .from("forecast_history")
    .select(
      "forecast_date, predicted_volume, actual_volume, weather_intensity, day_of_week"
    )
    .eq("station_id", STATION_ID)
    .gte("forecast_date", fromDate)
    .order("forecast_date", { ascending: true });

  if (fcErr) {
    console.error("forecast_history 조회 실패:", fcErr);
    process.exit(1);
  }

  console.log(`forecast_history 총 행 수: ${forecasts?.length ?? 0}`);
  if (!forecasts || forecasts.length === 0) {
    console.log("\n결과: status=no_data (카드 전체 플레이스홀더)");
    return;
  }

  console.log(`\n── forecast_history 원본 ──`);
  for (const r of forecasts) {
    console.log(
      `  ${r.forecast_date}  pred=${r.predicted_volume ?? "null"}  actual=${r.actual_volume ?? "null"}  wi=${r.weather_intensity ?? "null"}  dow=${r.day_of_week ?? "null"}`
    );
  }

  // sales_data overlay
  const { data: salesRows } = await sb
    .from("sales_data")
    .select("date, gasoline_volume, diesel_volume")
    .eq("station_id", STATION_ID)
    .gte("date", fromDate)
    .order("date", { ascending: true });

  const salesMap = new Map();
  for (const s of salesRows ?? []) {
    const vol =
      (Number(s.gasoline_volume) || 0) + (Number(s.diesel_volume) || 0);
    if (vol > 0) salesMap.set(s.date, vol);
  }
  console.log(`\nsales_data overlay 행 수: ${salesMap.size}`);

  // 유효 행 추출
  const rows = [];
  for (const fc of forecasts) {
    const predicted =
      fc.predicted_volume != null ? Number(fc.predicted_volume) : null;
    if (predicted == null || predicted <= 0) continue;

    let actual =
      fc.actual_volume != null ? Number(fc.actual_volume) : null;
    if ((actual == null || actual === 0) && salesMap.has(fc.forecast_date)) {
      actual = salesMap.get(fc.forecast_date);
    }
    if (actual == null || actual <= 0) continue;

    const residual = actual - predicted;
    const absErrorPct = (Math.abs(residual) / predicted) * 100;
    const dow =
      fc.day_of_week != null
        ? Number(fc.day_of_week)
        : dowFromDateStr(fc.forecast_date);
    const wi = fc.weather_intensity ?? null;

    rows.push({
      date: fc.forecast_date,
      predicted,
      actual,
      residual,
      absErrorPct,
      dow,
      weatherIntensity: wi,
    });
  }

  console.log(`\n── 유효 샘플 (예측·실측 모두 있음): ${rows.length}개 ──`);
  const dowNames = ["일", "월", "화", "수", "목", "금", "토"];
  for (const r of rows) {
    console.log(
      `  ${r.date} (${dowNames[r.dow]})  pred=${r.predicted.toLocaleString()}L  actual=${r.actual.toLocaleString()}L  residual=${r.residual >= 0 ? "+" : ""}${Math.round(r.residual).toLocaleString()}L (${r.absErrorPct.toFixed(1)}%)  weather=${r.weatherIntensity}`
    );
  }

  const n = rows.length;
  console.log(`\n── 분기 판정 ──`);
  if (n < 3) {
    console.log(`N=${n} < 3 → status: "insufficient"`);
    console.log(`카드 표시: "데이터 누적 중 (현재 N=${n}/3)" 플레이스홀더만`);
    return;
  }

  // 섹션 B: bias
  const residuals = rows.map((r) => r.residual);
  const meanRes = mean(residuals);
  const sdRes = stddev(residuals);

  console.log(`\n── 섹션 B: Bias 분석 (N=${n}) ──`);
  console.log(`평균 잔차: ${meanRes >= 0 ? "+" : ""}${meanRes.toFixed(1)}L`);
  console.log(`표준편차: ±${sdRes.toFixed(1)}L`);

  let classification, diagnosis;
  if (Math.abs(meanRes) <= 200) {
    classification = "unbiased";
    diagnosis = `체계적 편향 없음 (평균 잔차 ${meanRes >= 0 ? "+" : ""}${Math.round(meanRes).toLocaleString()}L · ±${Math.round(sdRes).toLocaleString()}L)`;
  } else if (meanRes < 0) {
    classification = "over_forecast";
    diagnosis = `모델이 평균 ${Math.abs(Math.round(meanRes)).toLocaleString()}L 과대 예측 (±${Math.round(sdRes).toLocaleString()}L)`;
  } else {
    classification = "under_forecast";
    diagnosis = `모델이 평균 ${Math.round(meanRes).toLocaleString()}L 과소 예측 (±${Math.round(sdRes).toLocaleString()}L)`;
  }
  console.log(`classification: ${classification}`);
  console.log(`진단: "${diagnosis}"`);

  const beforeAbsErrors = rows.map(
    (r) => (Math.abs(r.residual) / r.predicted) * 100
  );
  const before = mean(beforeAbsErrors);
  const afterAbsErrors = rows.map(
    (r) => (Math.abs(r.residual - meanRes) / r.predicted) * 100
  );
  const after = mean(afterAbsErrors);
  const improvement = +(before - after).toFixed(2);
  console.log(`\n── 보정 시뮬레이션 ──`);
  console.log(`보정 전 평균 오차율: ${before.toFixed(1)}%`);
  console.log(`보정 후 (in-sample): ${after.toFixed(1)}%`);
  console.log(`향상폭: ${improvement}%p`);

  let rangeText, tooSmall;
  if (classification === "unbiased") {
    rangeText = "편향 없음 — 보정 불필요";
    tooSmall = true;
  } else if (improvement < 0.3) {
    rangeText = "보정 효과 미미";
    tooSmall = true;
  } else {
    const low = Math.max(0, improvement - 0.5);
    const high = improvement + 0.5;
    const lowR = Math.round(low);
    const highR = Math.round(high);
    rangeText = lowR === highR ? `약 ${lowR}%p 여지` : `약 ${lowR}~${highR}%p 여지`;
    tooSmall = false;
  }
  console.log(`표시 텍스트: "${rangeText}"`);
  console.log(`tooSmall: ${tooSmall}`);

  if (n < 7) {
    console.log(`\n── 최종 판정: status="partial" (N=${n} < 7) ──`);
    console.log(`카드 표시:`);
    console.log(`  - 섹션 A: "패턴 분석 중 (현재 N=${n}/7)" 플레이스홀더`);
    console.log(`  - 섹션 B: 작동 ↑ 위 진단 그대로 표시`);
    return;
  }

  // 섹션 A: 패턴
  console.log(`\n── 섹션 A: 패턴 발견 (N=${n} ≥ 7) ──`);
  const overallAvg = mean(rows.map((r) => r.absErrorPct));
  console.log(`전체 평균 절대 오차율: ${overallAvg.toFixed(2)}%`);

  // 방향
  const overCount = rows.filter((r) => r.residual < 0).length;
  const underCount = rows.filter((r) => r.residual > 0).length;
  const dominantDir = overCount > underCount ? "over" : "under";
  const dominantCount = Math.max(overCount, underCount);
  const dominantRatio = dominantCount / n;
  console.log(`\n방향: over=${overCount}, under=${underCount}, 우세=${dominantDir} (${(dominantRatio * 100).toFixed(0)}%)`);
  if (dominantCount >= 3 && dominantRatio >= 0.7) {
    console.log(`→ 방향 패턴 채택 (${dominantDir})`);
  } else {
    console.log(`→ 방향 패턴 미채택 (기준: ≥3회 AND ≥70%)`);
  }

  // 요일
  console.log(`\n요일별:`);
  for (let d = 0; d < 7; d++) {
    const groupRows = rows.filter((r) => r.dow === d);
    if (groupRows.length === 0) continue;
    const groupAvg = mean(groupRows.map((r) => r.absErrorPct));
    const qualifies =
      groupRows.length >= 3 &&
      groupAvg >= overallAvg * 1.5 &&
      groupAvg >= overallAvg + 3;
    console.log(
      `  ${dowNames[d]}: n=${groupRows.length}, avg=${groupAvg.toFixed(1)}%  ${qualifies ? "✅ 채택" : "❌"}`
    );
  }

  // 날씨
  console.log(`\n날씨별:`);
  for (const w of ["dry", "light", "heavy"]) {
    const groupRows = rows.filter((r) => r.weatherIntensity === w);
    if (groupRows.length === 0) {
      console.log(`  ${w}: n=0`);
      continue;
    }
    const groupAvg = mean(groupRows.map((r) => r.absErrorPct));
    const qualifies =
      groupRows.length >= 3 &&
      groupAvg >= overallAvg * 1.5 &&
      groupAvg >= overallAvg + 3;
    console.log(
      `  ${w}: n=${groupRows.length}, avg=${groupAvg.toFixed(1)}%  ${qualifies ? "✅ 채택" : "❌"}`
    );
  }

  console.log(`\n── 최종 판정: status="ready" (N=${n} ≥ 7) ──`);
  console.log(`카드 표시: 섹션 A + 섹션 B 모두 작동`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
