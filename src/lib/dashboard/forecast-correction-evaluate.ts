import { supabase } from "@/lib/supabase";

/**
 * Phase 1 Shadow Mode — 효과 측정 / Go·No-Go 판정 모듈
 *
 * ## 무엇을 하는가
 * forecast_history 의 shadow 레코드(correction_confidence='shadow' 인 행)를
 * 모아 "만약 보정을 적용했다면 오차가 얼마나 개선/악화되었는가" 를 측정한다.
 * 결과는 **읽기 전용 통계** — 자동으로 mode를 'active' 로 바꾸지 않는다.
 *
 * ## 비교 방식
 *   beforeAbsErr = |actual - predicted| / predicted * 100
 *   afterAbsErr  = |actual - corrected| / predicted * 100   ← 분모는 동일하게 predicted 유지
 *   improvementPp = beforeMape - afterMape
 *
 * ## Go/No-Go 기준 (사용자 합의 기준 — 변형 A)
 *   insufficient : observationDays < 7  OR  sampleN < 30
 *   go           : improvementPp >= 1.0  AND  worseDaysRatio <= 0.30
 *   no_go        : improvementPp <  0    OR  worseDaysRatio >  0.50
 *   inconclusive : 그 외
 *
 * ## 안전성
 *   - SELECT 전용. 어떤 컬럼도 UPDATE 하지 않음.
 *   - shadow_started_at 이 null 이면 observationDays = 0 으로 처리.
 */

const N_THRESHOLD = 30; // 변형 A — N>=30 까지는 'insufficient' 표시

export interface ShadowEvaluationResult {
  stationId: string;
  /** Shadow Mode 시작 후 경과일 (KST 기준) */
  observationDays: number;
  /** 정책 현재 상태 */
  policy: {
    mode: string;
    method: string | null;
    meanResidualL: number | null;
    sampleN: number | null;
    shadowStartedAt: string | null;
    lastEvaluatedAt: string | null;
  };
  /** 평가 결과 (sampleN < 1 이면 null) */
  evaluated: {
    sampleN: number;
    beforeMape: number;
    afterMape: number;
    improvementPp: number;
    worseDays: number;
    betterDays: number;
    sameDays: number;
    worseDaysRatio: number;
    /** 일별 detail (UI 타임라인용, 최근 N개) */
    timeline: Array<{
      date: string;
      predicted: number;
      corrected: number;
      actual: number;
      beforeAbsErrPct: number;
      afterAbsErrPct: number;
      delta: number; // afterAbsErrPct - beforeAbsErrPct (양수=악화, 음수=개선)
    }>;
  } | null;
  /** Go/No-Go 판정 */
  goNoGo: {
    verdict: "insufficient" | "go" | "no_go" | "inconclusive";
    reasons: string[];
  };
}

// ── KST 일수 계산 ─────────────────────────────────────────────────────
function daysSinceKst(isoTimestamp: string | null): number {
  if (!isoTimestamp) return 0;
  const start = new Date(isoTimestamp).getTime();
  const now = Date.now();
  if (now < start) return 0;
  return Math.floor((now - start) / 86400000);
}

const mean = (arr: number[]) =>
  arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;

export async function evaluateShadowCorrection(
  stationId: string,
  timelineLimit = 14
): Promise<ShadowEvaluationResult> {
  // ── 1. 정책 조회 ──
  const { data: policyRow } = await supabase
    .from("forecast_correction_policy")
    .select("mode, method, params, shadow_started_at, last_evaluated_at")
    .eq("station_id", stationId)
    .maybeSingle();

  const params = (policyRow?.params as {
    meanResidualL?: number;
    sampleN?: number;
  } | null) ?? null;

  const policy = {
    mode: (policyRow?.mode as string) ?? "unknown",
    method: (policyRow?.method as string | null) ?? null,
    meanResidualL: params?.meanResidualL ?? null,
    sampleN: params?.sampleN ?? null,
    shadowStartedAt: (policyRow?.shadow_started_at as string | null) ?? null,
    lastEvaluatedAt: (policyRow?.last_evaluated_at as string | null) ?? null,
  };

  const observationDays = daysSinceKst(policy.shadowStartedAt);

  // ── 2. 평가 대상 행 조회 (corrected + actual 모두 있는 행) ──
  // 과거 shadow 레코드 중 actual 이 들어온 것만 평가 가능
  const { data: rows, error } = await supabase
    .from("forecast_history")
    .select(
      "forecast_date, predicted_volume, corrected_volume, actual_volume, correction_confidence"
    )
    .eq("station_id", stationId)
    .eq("correction_confidence", "shadow")
    .not("actual_volume", "is", null)
    .order("forecast_date", { ascending: false });

  if (error || !rows || rows.length === 0) {
    return {
      stationId,
      observationDays,
      policy,
      evaluated: null,
      goNoGo: {
        verdict: "insufficient",
        reasons: [
          observationDays < 7
            ? `관찰일수 ${observationDays}/7일 미만`
            : "평가 가능한 shadow 레코드 없음 (actual 미수집)",
        ],
      },
    };
  }

  // ── 3. 행별 오차 계산 ──
  const beforeErrs: number[] = [];
  const afterErrs: number[] = [];
  let worseDays = 0;
  let betterDays = 0;
  let sameDays = 0;
  const timeline: NonNullable<ShadowEvaluationResult["evaluated"]>["timeline"] = [];

  for (const r of rows) {
    const predicted = Number(r.predicted_volume);
    const corrected = Number(r.corrected_volume);
    const actual = Number(r.actual_volume);
    if (!(predicted > 0) || !(corrected > 0) || !(actual > 0)) continue;

    const before = (Math.abs(actual - predicted) / predicted) * 100;
    const after = (Math.abs(actual - corrected) / predicted) * 100;
    beforeErrs.push(before);
    afterErrs.push(after);

    const delta = +(after - before).toFixed(3);
    if (delta < -0.05) betterDays += 1;
    else if (delta > 0.05) worseDays += 1;
    else sameDays += 1;

    if (timeline.length < timelineLimit) {
      timeline.push({
        date: r.forecast_date as string,
        predicted: +predicted.toFixed(1),
        corrected: +corrected.toFixed(1),
        actual: +actual.toFixed(1),
        beforeAbsErrPct: +before.toFixed(2),
        afterAbsErrPct: +after.toFixed(2),
        delta,
      });
    }
  }

  const sampleN = beforeErrs.length;
  if (sampleN === 0) {
    return {
      stationId,
      observationDays,
      policy,
      evaluated: null,
      goNoGo: {
        verdict: "insufficient",
        reasons: ["평가 가능한 (predicted+corrected+actual 모두 있는) 행 0개"],
      },
    };
  }

  const beforeMape = +mean(beforeErrs).toFixed(2);
  const afterMape = +mean(afterErrs).toFixed(2);
  const improvementPp = +(beforeMape - afterMape).toFixed(2);
  const worseDaysRatio = +(worseDays / sampleN).toFixed(3);

  // ── 4. Go/No-Go 판정 ──
  const reasons: string[] = [];
  let verdict: ShadowEvaluationResult["goNoGo"]["verdict"];

  if (observationDays < 7) {
    verdict = "insufficient";
    reasons.push(`관찰일수 ${observationDays}/7일 미만`);
  } else if (sampleN < N_THRESHOLD) {
    verdict = "insufficient";
    reasons.push(`샘플 ${sampleN}/${N_THRESHOLD}개 미만 (변형 A 기준)`);
  } else if (improvementPp < 0) {
    verdict = "no_go";
    reasons.push(`개선폭 음수 (${improvementPp}%p) — 보정이 오히려 오차 키움`);
  } else if (worseDaysRatio > 0.5) {
    verdict = "no_go";
    reasons.push(`악화일 비율 ${(worseDaysRatio * 100).toFixed(0)}% > 50%`);
  } else if (improvementPp >= 1.0 && worseDaysRatio <= 0.3) {
    verdict = "go";
    reasons.push(`개선폭 +${improvementPp}%p ≥ 1.0%p`);
    reasons.push(`악화일 비율 ${(worseDaysRatio * 100).toFixed(0)}% ≤ 30%`);
  } else {
    verdict = "inconclusive";
    if (improvementPp < 1.0)
      reasons.push(`개선폭 ${improvementPp}%p < 1.0%p (Go 기준 미달)`);
    if (worseDaysRatio > 0.3)
      reasons.push(`악화일 비율 ${(worseDaysRatio * 100).toFixed(0)}% > 30% (Go 기준 초과)`);
  }

  return {
    stationId,
    observationDays,
    policy,
    evaluated: {
      sampleN,
      beforeMape,
      afterMape,
      improvementPp,
      worseDays,
      betterDays,
      sameDays,
      worseDaysRatio,
      timeline: timeline.reverse(), // 시간순 (오래된 → 최근)
    },
    goNoGo: { verdict, reasons },
  };
}
