-- ============================================================================
-- Migration 016 사전 baseline 캡처 (read-only, 절대 데이터 변경 없음)
-- ============================================================================
--
-- 목적
--   Phase 1 Shadow Mode 구축을 위한 마이그레이션 016 직전,
--   forecast_history 테이블의 현재 상태를 기록하여 사후 대조용 baseline 확보.
--
-- 실행 방법
--   Supabase Dashboard → SQL Editor → 이 파일 전체를 붙여넣기 → Run
--   각 SELECT 결과를 텍스트/스크린샷으로 캡처하여 공유
--
-- 안전성
--   - 모든 쿼리는 SELECT 전용 (DDL/DML 일절 없음)
--   - DB 상태에 어떠한 변경도 가하지 않음
--   - 트랜잭션 잠금 없음 (읽기만)
--
-- 출력 7종
--   ① 전체 통계 (총 레코드 수, 날짜 범위, 유니크 station 수)
--   ② station 별 분포 (각 station의 행 수, 최신/최오래 forecast_date)
--   ③ 컬럼 스키마 현황 (마이그레이션 016 이전 컬럼 목록)
--   ④ predicted_volume 무결성 baseline (NOT NULL 행 수, 합계, 평균)
--   ⑤ actual_volume 무결성 baseline (backfill 진행 상황)
--   ⑥ 최근 30일 샘플 (사후 대조용 — predicted_volume 값 보존 확인)
--   ⑦ JSON 백업 (전체 행 — 사후 행 단위 비교용)
--
-- ============================================================================


-- ── ① 전체 통계 ──────────────────────────────────────────────────────────
-- 마이그레이션 후에도 동일해야 하는 핵심 카운트
SELECT
  '① 전체 통계' AS section,
  COUNT(*)                              AS total_rows,
  COUNT(DISTINCT station_id)            AS unique_stations,
  MIN(forecast_date)                    AS earliest_forecast,
  MAX(forecast_date)                    AS latest_forecast,
  COUNT(*) FILTER (WHERE predicted_volume IS NOT NULL) AS rows_with_predicted,
  COUNT(*) FILTER (WHERE actual_volume    IS NOT NULL) AS rows_with_actual
FROM forecast_history;


-- ── ② station 별 분포 ────────────────────────────────────────────────────
-- 활성 station seed 범위 결정에 참고
SELECT
  '② station 별 분포' AS section,
  station_id,
  COUNT(*)                              AS row_count,
  MIN(forecast_date)                    AS first_forecast,
  MAX(forecast_date)                    AS last_forecast,
  COUNT(*) FILTER (WHERE predicted_volume IS NOT NULL) AS predicted_count,
  COUNT(*) FILTER (WHERE actual_volume    IS NOT NULL) AS actual_count,
  -- 최근 30일 내 활동 여부 (활성 판정용)
  COUNT(*) FILTER (WHERE forecast_date >= CURRENT_DATE - INTERVAL '30 days') AS recent_30d_rows
FROM forecast_history
GROUP BY station_id
ORDER BY last_forecast DESC NULLS LAST;


-- ── ③ 컬럼 스키마 현황 (마이그레이션 016 이전 baseline) ──────────────────
-- 마이그레이션 후 비교 시 신규 컬럼 5개가 추가되었는지 확인용
SELECT
  '③ 컬럼 스키마' AS section,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'forecast_history'
ORDER BY ordinal_position;


-- ── ④ predicted_volume 무결성 baseline ──────────────────────────────────
-- 마이그레이션 직후 동일 쿼리 재실행하여 sum/avg/min/max 가 정확히 일치해야 함
SELECT
  '④ predicted_volume 무결성' AS section,
  COUNT(*)                                                 AS non_null_rows,
  ROUND(SUM(predicted_volume)::numeric,    2)              AS sum_predicted,
  ROUND(AVG(predicted_volume)::numeric,    2)              AS avg_predicted,
  ROUND(MIN(predicted_volume)::numeric,    2)              AS min_predicted,
  ROUND(MAX(predicted_volume)::numeric,    2)              AS max_predicted,
  -- 체크섬 (전체 row의 predicted_volume 변화 감지용)
  MD5(STRING_AGG(
    COALESCE(station_id, '') || '|' ||
    forecast_date::text       || '|' ||
    COALESCE(predicted_volume::text, 'NULL'),
    ',' ORDER BY station_id, forecast_date
  )) AS predicted_volume_checksum
FROM forecast_history;


-- ── ⑤ actual_volume 무결성 baseline ──────────────────────────────────────
SELECT
  '⑤ actual_volume 무결성' AS section,
  COUNT(*)                                                 AS non_null_rows,
  ROUND(SUM(actual_volume)::numeric,    2)                 AS sum_actual,
  ROUND(AVG(actual_volume)::numeric,    2)                 AS avg_actual,
  ROUND(MIN(actual_volume)::numeric,    2)                 AS min_actual,
  ROUND(MAX(actual_volume)::numeric,    2)                 AS max_actual
FROM forecast_history;


-- ── ⑥ 최근 30일 샘플 (사후 대조용) ─────────────────────────────────────
-- 마이그레이션 후 동일 쿼리 재실행 → predicted_volume / actual_volume 값이
-- 한 행도 빠짐없이 동일해야 함 (이게 변하면 안전성 위반)
SELECT
  '⑥ 최근 30일 샘플' AS section,
  station_id,
  forecast_date,
  predicted_volume,
  actual_volume,
  weather_intensity,
  day_of_week,
  confidence
FROM forecast_history
WHERE forecast_date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY station_id, forecast_date;


-- ── ⑦ JSON 백업 (전체 행 단위 백업) ─────────────────────────────────────
-- 행 단위 사후 대조용. 결과를 텍스트로 복사하여 JSON 파일로 저장.
-- 행 수가 많을 경우 응답이 길 수 있음 (500행 이하면 한 번에 출력 가능).
SELECT
  '⑦ JSON 백업' AS section,
  jsonb_build_object(
    'captured_at', NOW(),
    'total_rows',  COUNT(*),
    'rows',        jsonb_agg(
      jsonb_build_object(
        'station_id',         station_id,
        'forecast_date',      forecast_date,
        'predicted_volume',   predicted_volume,
        'predicted_count',    predicted_count,
        'actual_volume',      actual_volume,
        'actual_count',       actual_count,
        'weather_intensity',  weather_intensity,
        'day_of_week',        day_of_week,
        'confidence',         confidence,
        'predicted_carwash',  predicted_carwash,
        'actual_carwash',     actual_carwash
      ) ORDER BY station_id, forecast_date
    )
  ) AS forecast_history_backup
FROM forecast_history;
