-- 주유소 일별 판매 데이터 (Google Sheets → GAS → Supabase REST API)
CREATE TABLE sales_data (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  station_id       TEXT NOT NULL DEFAULT 'A0003453',
  date             DATE NOT NULL,
  gasoline_volume  NUMERIC(10,2),   -- 휘발유 판매량 (리터)
  gasoline_count   INTEGER,          -- 휘발유 판매 건수
  gasoline_amount  NUMERIC(12,0),   -- 휘발유 판매금액 (원, 할인포함)
  diesel_volume    NUMERIC(10,2),   -- 경유 판매량 (리터)
  diesel_count     INTEGER,          -- 경유 판매 건수
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(station_id, date)
);

-- 날짜 범위 조회 최적화
CREATE INDEX idx_sales_data_station_date ON sales_data (station_id, date DESC);

-- RLS
ALTER TABLE sales_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sales_data_select"
  ON sales_data FOR SELECT
  USING (true);

CREATE POLICY "sales_data_insert"
  ON sales_data FOR INSERT
  WITH CHECK (true);

CREATE POLICY "sales_data_update"
  ON sales_data FOR UPDATE
  USING (true)
  WITH CHECK (true);
