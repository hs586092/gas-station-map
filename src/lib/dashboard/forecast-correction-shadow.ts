import { createServiceClient } from "@/lib/supabase";

/**
 * Phase 1 Shadow Mode — 평균 잔차 기반 자동 보정 계산 모듈
 *
 * ## 무엇을 하는가
 * 최근 30일의 잔차(actual - predicted) 평균을 계산하여, 오늘 이후의
 * forecast_history 행에 `corrected_volume = predicted + 평균잔차` 를
 * **계산만** 해서 저장한다. 실제 예측값(predicted_volume)에는 영향을
 * 절대 주지 않는다 (Shadow = 관찰 전용).
 *
 * ## 안전 원칙 (절대 위반 금지)
 *   1. predicted_volume 컬럼은 SELECT 만, UPDATE SET 절에 절대 포함 안 함
 *   2. UPDATE 대상은 forecast_date >= 오늘 (KST) 인 행만 — 과거 소급 금지
 *   3. correction_confidence IS NULL 인 행만 갱신 — 이중 적용 방지
 *   4. |correction_delta| <= predicted_volume * 20% 로 clamp
 *   5. ±200L 가드 — meanResidual 절대값이 200L 이하면 unbiased 로 보고 skip
 *   6. N < 7 이면 'insufficient_N' 으로 skip (의미 없는 보정 방지)
 *   7. 정책 mode != 'shadow' 이면 즉시 종료 (off / active 는 이 모듈이 처리 안 함)
 *
 * ## 호출 시점
 *   /api/snapshot/rebuild 에서 backfillForecastActuals() 완료 직후,
 *   buildDashboardSnapshot() 호출 직전에 await. 실패해도 snapshot 빌드는 계속.
 *
 * ## 시간대 주의
 *   forecast_date 는 KST 기준 DATE. "오늘 이후" 판정은 Asia/Seoul 기준.
 *   서버가 UTC 라도 KST 자정 경계를 정확히 처리해야 함.
 */

// ── 출력 타입 ─────────────────────────────────────────────────────────
export interface ShadowCorrectionResult {
  stationId: string;
  mode: "shadow" | "off" | "active" | "unknown";
  /** 이번 실행에서 계산된 보정 파라미터 (skip된 경우 null) */
  policy: {
    meanResidualL: number;
    sampleN: number;
    windowDays: number;
  } | null;
  /** 이번 실행에서 corrected_volume 을 새로 기록한 행 수 */
  appliedRows: number;
  /** clamp로 인해 보정량이 잘린 행 수 (appliedRows에 포함됨) */
  clampedRows: number;
  /** 갱신 대상이었으나 이미 confidence != NULL 이라 건너뛴 행 수 */
  alreadyCorrectedRows: number;
  /** skip 사유 (정상 적용 시 null) */
  skipReason:
    | "no_policy"
    | "mode_off"
    | "mode_not_shadow"
    | "insufficient_N"
    | "unbiased"
    | "no_target_rows"
    | "compute_error"
    | null;
  /** 사람이 읽기 위한 한 줄 요약 */
  message: string;
}

// ── 내부: KST 기준 오늘 (YYYY-MM-DD) ──────────────────────────────────
function todayKstDateStr(): string {
  // 서버가 어느 시간대건 한국 기준 오늘을 반환한다.
  const now = new Date();
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  return new Date(kstMs).toISOString().split("T")[0];
}

// ── 내부: 평균 ────────────────────────────────────────────────────────
function mean(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ── 내부: 로그 기록 (실패해도 throw 하지 않음) ────────────────────────
async function logEvent(
  svc: ReturnType<typeof createServiceClient>,
  stationId: string,
  action: string,
  triggerReason: string,
  paramsBefore: Record<string, unknown> | null,
  paramsAfter: Record<string, unknown> | null,
  metricsSnapshot: Record<string, unknown>
): Promise<void> {
  try {
    await svc.from("forecast_correction_log").insert({
      station_id: stationId,
      action,
      method: "mean_30d",
      segment: "ALL",
      trigger_reason: triggerReason,
      params_before: paramsBefore,
      params_after: paramsAfter,
      metrics_snapshot: metricsSnapshot,
    });
  } catch {
    // 로그 실패는 본 작업을 막지 않는다 (관찰 가능성 < 가용성)
  }
}

// ── 메인 ──────────────────────────────────────────────────────────────
export async function computeAndStoreShadowCorrection(
  stationId: string,
  windowDays = 30
): Promise<ShadowCorrectionResult> {
  const svc = createServiceClient();
  const today = todayKstDateStr();

  // ── 1. 정책 조회 + 모드 가드 ──
  const { data: policyRow, error: policyErr } = await svc
    .from("forecast_correction_policy")
    .select("station_id, mode, params")
    .eq("station_id", stationId)
    .maybeSingle();

  if (policyErr || !policyRow) {
    return {
      stationId,
      mode: "unknown",
      policy: null,
      appliedRows: 0,
      clampedRows: 0,
      alreadyCorrectedRows: 0,
      skipReason: "no_policy",
      message: `정책 없음 — forecast_correction_policy 에 ${stationId} seed 필요`,
    };
  }

  const mode = policyRow.mode as "shadow" | "off" | "active";
  if (mode === "off") {
    return {
      stationId, mode, policy: null,
      appliedRows: 0, clampedRows: 0, alreadyCorrectedRows: 0,
      skipReason: "mode_off",
      message: "정책 mode='off' — Shadow 비활성",
    };
  }
  if (mode !== "shadow") {
    // active 모드는 이 모듈이 처리하지 않는다 (Phase 2 별도 모듈)
    return {
      stationId, mode, policy: null,
      appliedRows: 0, clampedRows: 0, alreadyCorrectedRows: 0,
      skipReason: "mode_not_shadow",
      message: `정책 mode='${mode}' — Shadow 모듈은 'shadow' 모드만 처리`,
    };
  }

  // ── 2. 평균 잔차 계산 (최근 windowDays, actual & predicted 모두 있는 행) ──
  const fromDate = new Date(Date.now() - windowDays * 86400000)
    .toISOString()
    .split("T")[0];

  const { data: rows, error: rowErr } = await svc
    .from("forecast_history")
    .select("forecast_date, predicted_volume, actual_volume")
    .eq("station_id", stationId)
    .gte("forecast_date", fromDate)
    .not("predicted_volume", "is", null)
    .not("actual_volume", "is", null);

  if (rowErr) {
    await logEvent(svc, stationId, "shadow_computed", "scheduled", null, null, {
      error: rowErr.message,
    });
    return {
      stationId, mode, policy: null,
      appliedRows: 0, clampedRows: 0, alreadyCorrectedRows: 0,
      skipReason: "compute_error",
      message: `잔차 조회 실패: ${rowErr.message}`,
    };
  }

  // 유효 행만 필터 (predicted > 0)
  const validRows = (rows ?? []).filter(
    (r) => Number(r.predicted_volume) > 0 && Number(r.actual_volume) > 0
  );
  const sampleN = validRows.length;

  if (sampleN < 7) {
    await logEvent(svc, stationId, "shadow_computed", "scheduled", null, null, {
      sampleN, reason: "insufficient_N",
    });
    return {
      stationId, mode, policy: null,
      appliedRows: 0, clampedRows: 0, alreadyCorrectedRows: 0,
      skipReason: "insufficient_N",
      message: `샘플 부족 (N=${sampleN}/7) — Shadow 계산 보류`,
    };
  }

  const residuals = validRows.map(
    (r) => Number(r.actual_volume) - Number(r.predicted_volume)
  );
  const meanResidualL = +mean(residuals).toFixed(1);

  // ── 3. ±200L 가드 (섹션 B 와 동일 임계값) ──
  if (Math.abs(meanResidualL) <= 200) {
    const newParams = { meanResidualL, sampleN, windowDays, computedAt: new Date().toISOString() };
    await svc
      .from("forecast_correction_policy")
      .update({
        params: newParams,
        last_evaluated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("station_id", stationId);
    await logEvent(svc, stationId, "shadow_computed", "scheduled",
      policyRow.params ?? null, newParams,
      { sampleN, meanResidualL, reason: "unbiased" });
    return {
      stationId, mode,
      policy: { meanResidualL, sampleN, windowDays },
      appliedRows: 0, clampedRows: 0, alreadyCorrectedRows: 0,
      skipReason: "unbiased",
      message: `편향 미미 (|평균잔차|=${Math.abs(meanResidualL)}L ≤ 200L) — 보정 불필요`,
    };
  }

  // ── 4. params 업데이트 + 로그 ──
  const oldParams = (policyRow.params as Record<string, unknown> | null) ?? null;
  const newParams = { meanResidualL, sampleN, windowDays, computedAt: new Date().toISOString() };

  await svc
    .from("forecast_correction_policy")
    .update({
      params: newParams,
      last_evaluated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("station_id", stationId);

  await logEvent(svc, stationId, "shadow_computed", "scheduled", oldParams, newParams, {
    sampleN, meanResidualL, windowDays,
  });

  // ── 5. 대상 행 조회 (오늘 이후 + 아직 보정 안 된 행만) ──
  // ⚠️ 절대 안전장치: forecast_date >= today AND correction_confidence IS NULL
  const { data: targetRows, error: tgtErr } = await svc
    .from("forecast_history")
    .select("id, forecast_date, predicted_volume, correction_confidence")
    .eq("station_id", stationId)
    .gte("forecast_date", today)
    .is("correction_confidence", null);

  if (tgtErr) {
    return {
      stationId, mode,
      policy: { meanResidualL, sampleN, windowDays },
      appliedRows: 0, clampedRows: 0, alreadyCorrectedRows: 0,
      skipReason: "compute_error",
      message: `대상 행 조회 실패: ${tgtErr.message}`,
    };
  }

  if (!targetRows || targetRows.length === 0) {
    return {
      stationId, mode,
      policy: { meanResidualL, sampleN, windowDays },
      appliedRows: 0, clampedRows: 0, alreadyCorrectedRows: 0,
      skipReason: "no_target_rows",
      message: `평균 잔차 ${meanResidualL >= 0 ? "+" : ""}${meanResidualL}L 계산됨, 단 적용 대상 행 없음 (오늘 이후 미보정 행 0)`,
    };
  }

  // ── 6. 행별 clamp + UPDATE (predicted_volume 절대 SET 절에 없음) ──
  let appliedRows = 0;
  let clampedRows = 0;
  let alreadyCorrectedRows = 0;

  for (const row of targetRows) {
    // 이중 안전장치: select 시점과 update 시점 사이 race 방지
    if (row.correction_confidence != null) {
      alreadyCorrectedRows += 1;
      continue;
    }

    const predicted = Number(row.predicted_volume);
    if (!(predicted > 0)) continue; // predicted 0 또는 NULL 인 행은 보정 의미 없음

    const maxDelta = predicted * 0.2;
    let clampedDelta = meanResidualL;
    let wasClamped = false;
    if (clampedDelta > maxDelta) {
      clampedDelta = maxDelta;
      wasClamped = true;
    } else if (clampedDelta < -maxDelta) {
      clampedDelta = -maxDelta;
      wasClamped = true;
    }
    clampedDelta = +clampedDelta.toFixed(2);
    const correctedVolume = +(predicted + clampedDelta).toFixed(2);

    // ★★★ predicted_volume 은 SET 절에 절대 포함 안 됨 ★★★
    const { error: upErr } = await svc
      .from("forecast_history")
      .update({
        corrected_volume: correctedVolume,
        correction_delta: clampedDelta,
        correction_method: "mean_30d",
        correction_segment: "ALL",
        correction_confidence: "shadow",
      })
      .eq("id", row.id)
      .is("correction_confidence", null); // DB 레벨 race guard

    if (upErr) {
      // 개별 행 실패는 다음 행 진행 (전체 트랜잭션 abort 하지 않음)
      continue;
    }

    appliedRows += 1;
    if (wasClamped) clampedRows += 1;
  }

  return {
    stationId, mode,
    policy: { meanResidualL, sampleN, windowDays },
    appliedRows, clampedRows, alreadyCorrectedRows,
    skipReason: null,
    message:
      `평균 잔차 ${meanResidualL >= 0 ? "+" : ""}${meanResidualL}L 기반 ` +
      `${appliedRows}행 shadow 기록${clampedRows > 0 ? ` (clamp ${clampedRows}행)` : ""}`,
  };
}
