-- ============================================================================
-- 진단 SQL — forecast_history 테이블 위치 추적
-- ============================================================================
--
-- 배경
--   1차 baseline 캡처 시 'relation forecast_history does not exist' 에러 발생.
--   코드는 supabase.from("forecast_history") 로 호출하고 있으므로
--   반드시 어딘가에 존재해야 함. 다음 5개 진단으로 위치/이름을 추적.
--
-- 안전성: 모든 쿼리 SELECT 전용
-- ============================================================================


-- ── ① 모든 스키마의 모든 테이블 목록 ───────────────────────────────────
-- 시스템 스키마 제외, 사용자 정의 테이블만
SELECT
  '① 전체 테이블' AS section,
  table_schema,
  table_name,
  table_type
FROM information_schema.tables
WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
ORDER BY table_schema, table_name;


-- ── ② forecast/predict 키워드 포함 테이블 ─────────────────────────────
-- 이름이 살짝 달라졌을 가능성 (forecasts, forecast_data, predictions 등)
SELECT
  '② forecast/predict 관련' AS section,
  table_schema,
  table_name
FROM information_schema.tables
WHERE table_name ILIKE '%forecast%'
   OR table_name ILIKE '%predict%';


-- ── ③ public 스키마에서 코드가 참조하는 테이블 존재 확인 ─────────────
-- 코드가 supabase.from(...) 으로 호출하는 핵심 테이블 7종
SELECT
  '③ 핵심 테이블 존재 여부' AS section,
  needed_table,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = needed_table
    ) THEN '✅ EXISTS'
    ELSE '❌ MISSING'
  END AS status
FROM (VALUES
  ('forecast_history'),
  ('sales_data'),
  ('carwash_daily'),
  ('weather_daily'),
  ('oil_prices'),
  ('dashboard_snapshot'),
  ('stations_cache')
) AS t(needed_table);


-- ── ④ 현재 DB 검색 경로 (search_path) ─────────────────────────────────
-- 기본 스키마가 'public' 이 아닐 수도 있음
SELECT
  '④ search_path / 현재 DB' AS section,
  current_database()  AS database_name,
  current_schema()    AS current_schema,
  current_user        AS current_user;


-- ── ⑤ 'forecast' 로 시작하는 모든 객체 (테이블/뷰/함수 모두) ─────────
SELECT
  '⑤ forecast* 객체' AS section,
  n.nspname AS schema_name,
  c.relname AS object_name,
  CASE c.relkind
    WHEN 'r' THEN 'table'
    WHEN 'v' THEN 'view'
    WHEN 'm' THEN 'materialized view'
    WHEN 'f' THEN 'foreign table'
    WHEN 'p' THEN 'partitioned table'
    ELSE c.relkind::text
  END AS object_type
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relname ILIKE '%forecast%'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema');
