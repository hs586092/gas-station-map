-- ============================================================================
-- 마이그레이션 016 롤백 SQL
-- ============================================================================
--
-- 사용 시점
--   016_forecast_correction_shadow.sql 적용 후 문제가 발견되어
--   원상복구가 필요할 때만 사용. 평상시 절대 실행 금지.
--
-- 안전성
--   1. predicted_volume / actual_volume 등 원본 컬럼은 이 SQL에서도
--      절대 건드리지 않음 (마이그레이션 016이 추가한 것만 제거)
--   2. 신규 테이블 2개 DROP → 그 안의 모든 정책/로그도 함께 삭제됨
--      (Shadow 데이터는 영구 손실되지만, 원본 forecast_history 는 안전)
--   3. forecast_history 의 신규 컬럼 5개 DROP → 그 안의 corrected_volume
--      등 Shadow 계산 결과도 영구 손실
--
-- 롤백 후 상태
--   마이그레이션 015 시점과 정확히 동일 (forecast_history 의 원본 컬럼만 남음)
--
-- 적용 방법
--   Supabase Dashboard → SQL Editor → 이 파일 전체 붙여넣기 → Run
--   롤백 후 016_checksum_simple.sql 재실행하여 predicted_volume 무결성 재확인
--
-- ============================================================================


BEGIN;


-- ── 1. 신규 테이블 DROP (정책 + 로그) ────────────────────────────────────
-- CASCADE 불필요 (외래키 없음). DROP 순서 무관.
DROP TABLE IF EXISTS forecast_correction_log;
DROP TABLE IF EXISTS forecast_correction_policy;


-- ── 2. forecast_history 의 부분 인덱스 DROP ─────────────────────────────
-- 컬럼을 DROP 하기 전에 명시적으로 인덱스 제거 (사실 컬럼 DROP 시 자동 삭제되지만 명시)
DROP INDEX IF EXISTS idx_forecast_history_correction_conf;


-- ── 3. forecast_history 의 신규 컬럼 5개 DROP ───────────────────────────
-- 각 컬럼은 마이그레이션 016 에서만 추가됐으므로 DROP 안전
-- IF EXISTS 로 멱등 보장 (이미 없어도 에러 안 남)
ALTER TABLE forecast_history
  DROP COLUMN IF EXISTS corrected_volume,
  DROP COLUMN IF EXISTS correction_delta,
  DROP COLUMN IF EXISTS correction_method,
  DROP COLUMN IF EXISTS correction_segment,
  DROP COLUMN IF EXISTS correction_confidence;


COMMIT;


-- ============================================================================
-- 롤백 직후 확인용 SELECT (참고)
-- ============================================================================
-- 1. 신규 컬럼 5개가 모두 사라졌는지
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'forecast_history'
  AND column_name IN (
    'corrected_volume', 'correction_delta', 'correction_method',
    'correction_segment', 'correction_confidence'
  );
-- 결과 0행이어야 함

-- 2. 신규 테이블 2개가 모두 사라졌는지
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('forecast_correction_policy', 'forecast_correction_log');
-- 결과 0행이어야 함

-- 3. forecast_history 의 원본 컬럼은 모두 그대로 유지되어야 함
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'forecast_history'
ORDER BY ordinal_position;

-- 4. predicted_volume 무결성 재확인 (016_checksum_simple.sql 와 동일)
--    이 결과가 마이그레이션 016 적용 직전 메모해둔 값과 일치해야 함
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
