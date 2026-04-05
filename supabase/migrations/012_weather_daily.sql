-- 하남시 일별 날씨 관측값 (Open-Meteo Historical API)
-- 판매량 × 날씨 교차분석용. 예보가 아니라 "실제 관측값"을 저장.
CREATE TABLE weather_daily (
  date                     DATE PRIMARY KEY,
  weather_code             INTEGER,        -- WMO weather code (0=맑음, 61=비, 71=눈 등)
  temp_max                 NUMERIC(4,1),   -- 일최고기온 (°C)
  temp_min                 NUMERIC(4,1),   -- 일최저기온 (°C)
  precipitation_mm         NUMERIC(5,1),   -- 일강수량 (mm)
  precipitation_prob_max   INTEGER,        -- 일최대 강수확률 (%) — 예보시점 저장
  collected_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_weather_daily_date ON weather_daily (date DESC);

ALTER TABLE weather_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "weather_daily_select"
  ON weather_daily FOR SELECT
  USING (true);

CREATE POLICY "weather_daily_insert"
  ON weather_daily FOR INSERT
  WITH CHECK (true);

CREATE POLICY "weather_daily_update"
  ON weather_daily FOR UPDATE
  USING (true)
  WITH CHECK (true);
