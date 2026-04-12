import { supabase } from "@/lib/supabase";

/**
 * 복기의 복기 — 모델 자기진단
 *
 * ## 왜 필요한가
 * 기존 `forecast-review.ts` 는 "어제 1일치" 오차 분해에 집중한다. 사장이
 * 정말 알고 싶은 건 "자꾸 같은 곳에서 틀리는 패턴이 있는가?", "모델이
 * 체계적으로 한쪽으로 치우쳐 있는가?" 같은 **메타 질문**이다.
 *
 * 이 모듈은 `forecast_history` 를 직접 읽어 N 일 윈도우 잔차 통계를 돌리고,
 * 두 섹션을 반환한다:
 *   1. 섹션 A — "자꾸 같은 곳에서 틀리는 패턴" 상위 3 (방향/요일/날씨)
 *   2. 섹션 B — 평균 잔차 기반 체계적 편향 진단 + 보정 시뮬레이션
 *
 * ## 설계 원칙
 * - forecast-review.ts 와는 **완전 독립** (기존 함수 변경 없음)
 * - snapshot rebuild 흐름에 합류시키지 **않음** (HTTP 캐시만)
 * - 데이터 부족 시 절대 "거짓 패턴" 을 만들지 않는다 (N 가드 + 유의성 필터)
 * - 섹션 B 의 "보정 후 정확도" 는 in-sample 추정이므로 범위로만 표기
 *
 * ## 유의성 기준 (섹션 A)
 * 한 그룹(예: 금요일)이 "의미있는 패턴" 으로 인정되려면 모두 만족해야 한다:
 *   - 그룹 내 샘플 ≥ 3 개
 *   - 그룹 평균 절대 오차율 ≥ 전체 평균의 1.5 배
 *   - 그룹 평균 절대 오차율 ≥ 전체 평균 + 3 %p (상대비만 보면
 *     전체 평균이 낮을 때 0.2 % → 0.3 % 도 1.5배로 잡히기 때문)
 *
 * ## N 가드 (카드 표시 모드)
 *   - N < 3            → status: "insufficient"  (카드 전체 플레이스홀더)
 *   - 3 ≤ N < 7        → status: "partial"       (섹션 A 플레이스홀더, 섹션 B 만 작동)
 *   - N ≥ 7            → status: "ready"         (두 섹션 모두 작동)
 * "N" 은 **예측·실측이 모두 있는 유효 행 수** 를 가리킨다.
 */

// ── YYYY-MM-DD → 요일 (UTC 서버 안전) ──
function dowFromDateStr(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const mean = (arr: number[]) =>
  arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;

const stddev = (arr: number[]) => {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(v);
};

// ── 출력 타입 ──
export type DiagnosisStatus = "insufficient" | "partial" | "ready" | "no_data";

export interface SelfDiagnosisPattern {
  /** 차원 종류 */
  dimension: "direction" | "weekday" | "weather";
  /** 사람이 읽을 수 있는 라벨 (예: "금요일 예측 오차") */
  label: string;
  /** 빈도 텍스트 (예: "최근 5번 중 3번") */
  frequencyText: string;
  /** 이 그룹 샘플 수 */
  groupCount: number;
  /** 전체 샘플 수 (프린터용) */
  totalCount: number;
  /** 그룹 평균 절대 오차율 (%) */
  avgAbsErrorPct: number;
  /** 전체 평균 절대 오차율 (%) — 비교용 */
  overallAvgAbsErrorPct: number;
  /** 한 줄 해석 */
  interpretation: string;
  /** 정렬용 strength (그룹평균 / 전체평균) */
  strength: number;
}

export interface SelfDiagnosisBias {
  /** 평균 잔차 (actual - predicted, 단위: L). 양수 = 과소예측, 음수 = 과대예측 */
  meanResidualL: number;
  /** 잔차 표준편차 */
  stdResidualL: number;
  /** 진단 분류 */
  classification: "over_forecast" | "under_forecast" | "unbiased";
  /** 한 줄 진단 */
  diagnosis: string;
  /** 보정 시뮬레이션 결과. in-sample 추정이므로 범위로 표기. */
  correction: {
    /** 보정 전 평균 절대 오차율 (%) */
    beforeAvgAbsErrorPct: number;
    /** 보정 후 평균 절대 오차율 (%, in-sample) */
    afterAvgAbsErrorPct: number;
    /** 향상폭 (%p, in-sample) */
    improvementPp: number;
    /** 향상 범위 텍스트 ("약 2~3%p 여지" 또는 "보정 효과 미미") */
    rangeText: string;
    /** 사용자에게 보여줄 한 줄 해석 (정직한 경고 포함) */
    interpretation: string;
    /** 효과 미미 플래그 */
    tooSmall: boolean;
  } | null;
  /** 진단에 사용된 샘플 수 */
  sampleCount: number;
}

export interface SelfDiagnosisResult {
  status: DiagnosisStatus;
  /** 분석에 사용된 유효 샘플 수 (예측·실측 모두 있는 행) */
  sampleCount: number;
  /** 윈도우 일수 (입력) */
  windowDays: number;
  /** 데이터 범위 */
  dataRange: { from: string; to: string } | null;
  /** 섹션 A — 최대 3 개 */
  patterns: SelfDiagnosisPattern[];
  /** 섹션 B */
  bias: SelfDiagnosisBias | null;
  /** 사용자에게 보여줄 한 줄 사유 (insufficient/partial 일 때) */
  message: string | null;
}

// ── 내부: 한 행의 통계적 그림자 ──
interface RecordRow {
  date: string;
  predicted: number;
  actual: number;
  residual: number; // actual - predicted
  absErrorPct: number; // |residual| / predicted * 100
  dow: number;
  weatherIntensity: "dry" | "light" | "heavy" | null;
}

// ── 섹션 A: 패턴 발견 ──
function findPatterns(rows: RecordRow[]): SelfDiagnosisPattern[] {
  if (rows.length < 7) return [];

  const overallAvg = mean(rows.map((r) => r.absErrorPct));
  const candidates: SelfDiagnosisPattern[] = [];
  const totalCount = rows.length;

  // ── 1. 방향 편향 (과대/과소) ──
  // 이 차원은 "그룹" 이 아니라 단일 수치지만, 한쪽 방향으로 매우 쏠려 있으면
  // 섹션 A 최상단에 "패턴" 으로 올려준다. (섹션 B 의 bias 와는 별개로,
  // 여기서는 "빈도" 관점으로 해석 — 예: "10일 중 8일이 과대 예측")
  const overCount = rows.filter((r) => r.residual < 0).length;
  const underCount = rows.filter((r) => r.residual > 0).length;
  const dominantDir = overCount > underCount ? "over" : "under";
  const dominantCount = Math.max(overCount, underCount);
  const dominantRatio = dominantCount / totalCount;

  if (dominantCount >= 3 && dominantRatio >= 0.7) {
    // 70% 이상이 한 방향 = 강한 방향 편향
    const groupRows = rows.filter((r) =>
      dominantDir === "over" ? r.residual < 0 : r.residual > 0
    );
    const groupAvg = mean(groupRows.map((r) => r.absErrorPct));
    // 방향 패턴은 "한 방향으로 치우침" 자체가 의미이므로
    // 그룹 평균이 전체와 비슷해도 표시한다. (다만 strength 는 낮게)
    candidates.push({
      dimension: "direction",
      label: dominantDir === "over" ? "과대 예측 경향" : "과소 예측 경향",
      frequencyText: `최근 ${totalCount}번 중 ${dominantCount}번`,
      groupCount: dominantCount,
      totalCount,
      avgAbsErrorPct: +groupAvg.toFixed(1),
      overallAvgAbsErrorPct: +overallAvg.toFixed(1),
      interpretation:
        dominantDir === "over"
          ? "→ 모델이 한쪽으로 치우쳐 있음 (섹션 B 보정 참조)"
          : "→ 실제가 예측보다 계속 많음 (섹션 B 보정 참조)",
      // 방향 패턴의 strength 는 dominantRatio 자체로 계산 (0.7 = 1.0 기준)
      strength: dominantRatio / 0.7,
    });
  }

  // ── 2. 요일별 패턴 ──
  const dowNames = ["일", "월", "화", "수", "목", "금", "토"];
  for (let d = 0; d < 7; d++) {
    const groupRows = rows.filter((r) => r.dow === d);
    if (groupRows.length < 3) continue; // 그룹 ≥ 3

    const groupAvg = mean(groupRows.map((r) => r.absErrorPct));
    // 유의성 3종
    if (groupAvg < overallAvg * 1.5) continue;
    if (groupAvg < overallAvg + 3) continue;

    candidates.push({
      dimension: "weekday",
      label: `${dowNames[d]}요일 예측 오차`,
      frequencyText: `최근 ${totalCount}번 중 ${groupRows.length}번`,
      groupCount: groupRows.length,
      totalCount,
      avgAbsErrorPct: +groupAvg.toFixed(1),
      overallAvgAbsErrorPct: +overallAvg.toFixed(1),
      interpretation: `→ ${dowNames[d]}요일에 모델이 약함 (전체 평균의 ${(groupAvg / (overallAvg || 1)).toFixed(1)}배)`,
      strength: groupAvg / (overallAvg || 1),
    });
  }

  // ── 3. 날씨별 패턴 ──
  const weatherLabels: Record<string, string> = {
    dry: "맑은 날",
    light: "약한 비 오는 날",
    heavy: "본격 비 오는 날",
  };
  for (const w of ["dry", "light", "heavy"] as const) {
    const groupRows = rows.filter((r) => r.weatherIntensity === w);
    if (groupRows.length < 3) continue; // 그룹 ≥ 3

    const groupAvg = mean(groupRows.map((r) => r.absErrorPct));
    if (groupAvg < overallAvg * 1.5) continue;
    if (groupAvg < overallAvg + 3) continue;

    candidates.push({
      dimension: "weather",
      label: `${weatherLabels[w]} 예측 오차`,
      frequencyText: `최근 ${totalCount}번 중 ${groupRows.length}번`,
      groupCount: groupRows.length,
      totalCount,
      avgAbsErrorPct: +groupAvg.toFixed(1),
      overallAvgAbsErrorPct: +overallAvg.toFixed(1),
      interpretation: `→ ${weatherLabels[w]} 모델이 약함 (전체 평균의 ${(groupAvg / (overallAvg || 1)).toFixed(1)}배)`,
      strength: groupAvg / (overallAvg || 1),
    });
  }

  // strength 내림차순 정렬, 최대 3개
  return candidates.sort((a, b) => b.strength - a.strength).slice(0, 3);
}

// ── 섹션 B: Bias 분석 ──
function analyzeBias(rows: RecordRow[]): SelfDiagnosisBias | null {
  if (rows.length < 3) return null;

  const residuals = rows.map((r) => r.residual);
  const meanRes = mean(residuals);
  const sdRes = stddev(residuals);

  // 분류 — ±200L 가드
  let classification: SelfDiagnosisBias["classification"];
  let diagnosis: string;
  if (Math.abs(meanRes) <= 200) {
    classification = "unbiased";
    diagnosis = `체계적 편향 없음 (평균 잔차 ${meanRes >= 0 ? "+" : ""}${Math.round(meanRes).toLocaleString()}L · ±${Math.round(sdRes).toLocaleString()}L)`;
  } else if (meanRes < 0) {
    // actual < predicted → 모델이 더 많이 팔릴 거라 함 (과대 예측)
    classification = "over_forecast";
    diagnosis = `모델이 평균 ${Math.abs(Math.round(meanRes)).toLocaleString()}L 과대 예측 (±${Math.round(sdRes).toLocaleString()}L)`;
  } else {
    // actual > predicted → 모델이 적게 팔릴 거라 함 (과소 예측)
    classification = "under_forecast";
    diagnosis = `모델이 평균 ${Math.round(meanRes).toLocaleString()}L 과소 예측 (±${Math.round(sdRes).toLocaleString()}L)`;
  }

  // 보정 시뮬레이션
  const beforeAbsErrors = rows.map(
    (r) => (Math.abs(r.residual) / r.predicted) * 100
  );
  const before = mean(beforeAbsErrors);

  // 평균 잔차만큼 예측에 더해준다고 가정 (bias correction)
  const afterAbsErrors = rows.map(
    (r) => (Math.abs(r.residual - meanRes) / r.predicted) * 100
  );
  const after = mean(afterAbsErrors);
  const improvement = +(before - after).toFixed(2);

  let correction: SelfDiagnosisBias["correction"];
  if (classification === "unbiased") {
    correction = {
      beforeAvgAbsErrorPct: +before.toFixed(1),
      afterAvgAbsErrorPct: +after.toFixed(1),
      improvementPp: improvement,
      rangeText: "편향 없음 — 보정 불필요",
      interpretation: "→ 평균 잔차가 ±200L 이내로, 체계적 보정 필요성 낮음",
      tooSmall: true,
    };
  } else if (improvement < 0.3) {
    correction = {
      beforeAvgAbsErrorPct: +before.toFixed(1),
      afterAvgAbsErrorPct: +after.toFixed(1),
      improvementPp: improvement,
      rangeText: "보정 효과 미미",
      interpretation:
        "→ 평균만큼 빼는 단순 보정은 효과가 작음. 요일·날씨별 세분화 필요",
      tooSmall: true,
    };
  } else {
    // 정직한 범위 표기: 점추정 대신 ±0.5%p 범위로 표현하고,
    // 소수점 1자리까지만 사용. in-sample 경고 문구 필수.
    const low = Math.max(0, improvement - 0.5);
    const high = improvement + 0.5;
    // 범위가 같은 정수로 반올림되면 단일 값으로 표기
    const lowR = Math.round(low);
    const highR = Math.round(high);
    const rangeText =
      lowR === highR
        ? `약 ${lowR}%p 여지`
        : `약 ${lowR}~${highR}%p 여지`;
    correction = {
      beforeAvgAbsErrorPct: +before.toFixed(1),
      afterAvgAbsErrorPct: +after.toFixed(1),
      improvementPp: improvement,
      rangeText,
      interpretation:
        "→ 다음 시스템 업데이트에서 평균 보정 추가 시 개선 여지 있음",
      tooSmall: false,
    };
  }

  return {
    meanResidualL: +meanRes.toFixed(1),
    stdResidualL: +sdRes.toFixed(1),
    classification,
    diagnosis,
    correction,
    sampleCount: rows.length,
  };
}

// ── 메인 함수 ──
export async function getForecastSelfDiagnosis(
  stationId: string,
  windowDays = 30
): Promise<SelfDiagnosisResult> {
  const fromDate = new Date(Date.now() - windowDays * 86400000)
    .toISOString()
    .split("T")[0];

  // 1. forecast_history 직접 쿼리
  const { data: forecasts, error: fcErr } = await supabase
    .from("forecast_history")
    .select(
      "forecast_date, predicted_volume, actual_volume, weather_intensity, day_of_week"
    )
    .eq("station_id", stationId)
    .gte("forecast_date", fromDate)
    .order("forecast_date", { ascending: true });

  if (fcErr || !forecasts || forecasts.length === 0) {
    return {
      status: "no_data",
      sampleCount: 0,
      windowDays,
      dataRange: null,
      patterns: [],
      bias: null,
      message: "예측 데이터 축적 중 — 내일부터 자기진단 시작",
    };
  }

  // 2. sales_data overlay (backfill 이 아직 안 돈 경우 대비)
  const { data: salesRows } = await supabase
    .from("sales_data")
    .select("date, gasoline_volume, diesel_volume")
    .eq("station_id", stationId)
    .gte("date", fromDate)
    .order("date", { ascending: true });

  const salesMap = new Map<string, number>();
  for (const s of salesRows ?? []) {
    const vol =
      (Number(s.gasoline_volume) || 0) + (Number(s.diesel_volume) || 0);
    if (vol > 0) salesMap.set(s.date, vol);
  }

  // 3. 유효 행 추출 — predicted 와 actual 이 모두 있어야 함
  const rows: RecordRow[] = [];
  for (const fc of forecasts) {
    const predicted =
      fc.predicted_volume != null ? Number(fc.predicted_volume) : null;
    if (predicted == null || predicted <= 0) continue;

    let actual =
      fc.actual_volume != null ? Number(fc.actual_volume) : null;
    if ((actual == null || actual === 0) && salesMap.has(fc.forecast_date)) {
      actual = salesMap.get(fc.forecast_date)!;
    }
    if (actual == null || actual <= 0) continue;

    const residual = actual - predicted;
    const absErrorPct = (Math.abs(residual) / predicted) * 100;
    // day_of_week 가 null 이면 forecast_date 로 폴백
    const dow =
      fc.day_of_week != null
        ? Number(fc.day_of_week)
        : dowFromDateStr(fc.forecast_date);
    const wi =
      (fc.weather_intensity as "dry" | "light" | "heavy" | null) ?? null;

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

  const n = rows.length;
  const dataRange =
    n > 0 ? { from: rows[0].date, to: rows[n - 1].date } : null;

  // 4. 가드 분기
  if (n === 0) {
    return {
      status: "no_data",
      sampleCount: 0,
      windowDays,
      dataRange: null,
      patterns: [],
      bias: null,
      message: "예측·실측 데이터 축적 중",
    };
  }

  if (n < 3) {
    return {
      status: "insufficient",
      sampleCount: n,
      windowDays,
      dataRange,
      patterns: [],
      bias: null,
      message: `데이터 누적 중 (현재 N=${n}/3)`,
    };
  }

  // n ≥ 3 부터는 섹션 B 는 항상 시도
  const bias = analyzeBias(rows);

  if (n < 7) {
    return {
      status: "partial",
      sampleCount: n,
      windowDays,
      dataRange,
      patterns: [], // 섹션 A 는 플레이스홀더
      bias,
      message: `패턴 분석 중 (현재 N=${n}/7)`,
    };
  }

  // n ≥ 7 — 섹션 A + B 모두
  const patterns = findPatterns(rows);
  return {
    status: "ready",
    sampleCount: n,
    windowDays,
    dataRange,
    patterns,
    bias,
    message: null,
  };
}
