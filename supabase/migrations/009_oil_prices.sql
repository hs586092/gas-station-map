-- 국제유가 일별 데이터 (EIA API → WTI/Brent)
CREATE TABLE oil_prices (
  date         DATE PRIMARY KEY,
  wti          NUMERIC(8,2),        -- WTI Cushing Spot $/BBL
  brent        NUMERIC(8,2),        -- Brent Europe Spot $/BBL
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 최근 날짜 조회 최적화
CREATE INDEX idx_oil_prices_date ON oil_prices (date DESC);

-- RLS
ALTER TABLE oil_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "oil_prices_select"
  ON oil_prices FOR SELECT
  USING (true);

CREATE POLICY "oil_prices_insert"
  ON oil_prices FOR INSERT
  WITH CHECK (true);

CREATE POLICY "oil_prices_update"
  ON oil_prices FOR UPDATE
  USING (true)
  WITH CHECK (true);
