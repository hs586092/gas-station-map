-- ============================================================================
-- 첫 Shadow 배치 실행 후 검증 SQL (5종)
-- ============================================================================
--
-- 실행 시점
--   /api/snapshot/rebuild?stationId=A0003453 호출 후
--   응답: appliedRows=1, meanResidualL=-1576.1, sampleN=10
--
-- 사용법
--   각 ── 섹션 ── 단위로 한 번에 하나씩 실행하여 결과 공유.
--   모든 쿼리는 SELECT 전용 (DB 변경 없음).
-- ============================================================================


-- ── ① predicted_volume 체크섬 (마이그레이션 전과 100% 동일해야 함) ──
-- 기준값: total_rows=11, sum_predicted=288086.0000,
--         checksum=6be195041828e0f356306218b174f4d3
SELECT
  COUNT(*)                                                       AS total_rows,
  COUNT(predicted_volume)                                        AS non_null_predicted,
  ROUND(SUM(predicted_volume)::numeric, 4)                       AS sum_predicted,
  MD5(STRING_AGG(
    station_id || '|' || forecast_date::text || '|' ||
    COALESCE(predicted_volume::text, 'NULL'),
    ',' ORDER BY station_id, forecast_date
  )) AS predicted_volume_checksum
FROM forecast_history;


-- ── ② 오늘(2026-04-16) 이후 행 — corrected_volume 정상 기록 확인 ──
-- 기대: 1행 (오늘 행), corrected_volume = predicted_volume + correction_delta,
--       correction_method='mean_30d', correction_segment='ALL',
--       correction_confidence='shadow'
-- meanResidual=-1576.1L 이므로:
--   - 만약 |delta| <= predicted * 20% 이면 delta = -1576.1
--   - clamp 발동 시 delta = -predicted * 0.2 (예: predicted=10000 → -2000)
SELECT
  forecast_date,
  predicted_volume,
  corrected_volume,
  correction_delta,
  -- 산술 검증: corrected = predicted + delta (반올림 오차 ±0.01 허용)
  ROUND((predicted_volume + correction_delta - corrected_volume)::numeric, 2) AS arithmetic_diff,
  -- clamp 발동 여부 (|delta| 가 predicted*20% 와 같으면 clamp 됨)
  CASE
    WHEN ABS(correction_delta) >= ROUND((predicted_volume * 0.2)::numeric, 2) - 0.01
      THEN '⚠ CLAMPED'
    ELSE 'within range'
  END AS clamp_status,
  correction_method,
  correction_segment,
  correction_confidence
FROM forecast_history
WHERE station_id = 'A0003453'
  AND forecast_date >= CURRENT_DATE
ORDER BY forecast_date;


-- ── ③ 과거 행(2026-04-06 ~ 2026-04-15) — 소급 금지 확인 ──
-- 기대: 모든 과거 행에서 corrected_volume / correction_* 가 모두 NULL
-- 한 행이라도 NOT NULL 이 나오면 소급 적용 발생 → 즉시 롤백 검토
SELECT
  forecast_date,
  predicted_volume,
  actual_volume,
  corrected_volume,                  -- 모두 NULL 이어야 함
  correction_delta,                  -- 모두 NULL 이어야 함
  correction_confidence,             -- 모두 NULL 이어야 함
  CASE
    WHEN corrected_volume IS NULL AND correction_delta IS NULL
         AND correction_confidence IS NULL
      THEN '✅ 원본 보존'
    ELSE '❌ 소급 적용 발생 — 롤백 필요'
  END AS status
FROM forecast_history
WHERE station_id = 'A0003453'
  AND forecast_date < CURRENT_DATE
ORDER BY forecast_date;


-- ── ④ forecast_correction_log — shadow_computed 이벤트 기록 확인 ──
-- 기대: 최소 2행
--   1) action='shadow_started', trigger_reason='initial' (마이그레이션 016 seed)
--   2) action='shadow_computed', trigger_reason='scheduled' (방금 rebuild)
--      metrics_snapshot 에 sampleN=10, meanResidualL=-1576.1 포함
SELECT
  id,
  applied_at,
  action,
  method,
  segment,
  trigger_reason,
  params_before,
  params_after,
  metrics_snapshot
FROM forecast_correction_log
WHERE station_id = 'A0003453'
ORDER BY id DESC
LIMIT 10;


-- ── ⑤ forecast_correction_policy — params 업데이트 확인 ──
-- 기대: params = {"meanResidualL": -1576.1, "sampleN": 10, "windowDays": 30,
--                 "computedAt": <ISO8601 timestamp>}
--       last_evaluated_at = 방금 rebuild 시각 (NOT NULL)
SELECT
  station_id,
  mode,
  method,
  params,
  shadow_started_at,
  last_evaluated_at,
  rollback_count,
  updated_at
FROM forecast_correction_policy
WHERE station_id = 'A0003453';
