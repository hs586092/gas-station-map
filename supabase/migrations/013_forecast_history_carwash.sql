-- forecast_history 에 세차 예측/실측 컬럼 추가
--
-- 왜 필요한가:
--   src/lib/dashboard/carwash-summary.ts 가 `predicted_carwash` / `actual_carwash`
--   컬럼을 select·upsert 하고 있지만 테이블에는 컬럼이 없어 쿼리가 실패해왔다.
--   대시보드 세차 카드의 "어제 예측 vs 실제", "7일 정확도" 가 이 컬럼들을
--   소비하므로 코드 삭제 대신 컬럼을 추가한다.
--
-- 멱등 보장:
--   IF NOT EXISTS 사용. 이미 존재하면 ALTER 는 no-op.
ALTER TABLE forecast_history
  ADD COLUMN IF NOT EXISTS predicted_carwash NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS actual_carwash    NUMERIC(10, 2);

COMMENT ON COLUMN forecast_history.predicted_carwash IS '해당 날짜 예측 세차 대수 (요일+날씨 기반)';
COMMENT ON COLUMN forecast_history.actual_carwash    IS '해당 날짜 실측 세차 대수 (carwash_daily.total_count)';
