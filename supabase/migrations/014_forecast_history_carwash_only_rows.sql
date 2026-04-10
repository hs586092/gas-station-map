-- forecast_history.predicted_volume 을 nullable 로 완화
--
-- 왜 필요한가:
--   carwash-summary.ts 는 세차 예측만 쓰는데 기존 스키마가 `predicted_volume`
--   NOT NULL 을 강제해서 INSERT 가 23502 제약조건 위반으로 실패했다
--   (predicted_volume 은 weather-sales / integrated-forecast 쪽에서만 생성).
--   carwash-summary 의 upsert 가 race 로 먼저 실행되는 경우 세차 행 자체가
--   만들어지지 못해 `predicted_carwash` 가 전혀 저장되지 않았다.
--
--   세차-only 예측 행을 허용해서 race 를 근본적으로 해소한다.
ALTER TABLE forecast_history
  ALTER COLUMN predicted_volume DROP NOT NULL;
