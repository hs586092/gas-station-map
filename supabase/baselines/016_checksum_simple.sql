-- ============================================================================
-- predicted_volume 무결성 대조용 단순 체크섬
-- ============================================================================
--
-- 사용법
--   1) 마이그레이션 016 실행 직전 → 이 SQL 실행 → 결과값 메모
--   2) 마이그레이션 016 실행 직후 → 이 SQL 재실행 → 동일한지 확인
--   동일하면 ✅ predicted_volume 한 행도 변경 안 됨 (안전)
--   다르면 ⚠️ 즉시 롤백 검토
--
-- 안전성: SELECT 전용
-- ============================================================================

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
