-- 전국 일일 평균가격 이력
CREATE TABLE IF NOT EXISTS avg_price_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL,
  product_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  avg_price NUMERIC NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(date, product_code)
);

CREATE INDEX idx_avg_price_history_date ON avg_price_history(date);
CREATE INDEX idx_avg_price_history_product_code ON avg_price_history(product_code);

-- 전국 일일 지역별 평균가격 이력
CREATE TABLE IF NOT EXISTS regional_price_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL,
  sido_code TEXT NOT NULL,
  sido_name TEXT NOT NULL,
  product_code TEXT NOT NULL,
  avg_price NUMERIC NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(date, sido_code, product_code)
);

CREATE INDEX idx_regional_price_history_date ON regional_price_history(date);
CREATE INDEX idx_regional_price_history_sido_code ON regional_price_history(sido_code);

-- 전국 일일 상표별 평균가격 이력
CREATE TABLE IF NOT EXISTS brand_price_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL,
  brand_code TEXT NOT NULL,
  brand_name TEXT NOT NULL,
  product_code TEXT NOT NULL,
  avg_price NUMERIC NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(date, brand_code, product_code)
);

CREATE INDEX idx_brand_price_history_date ON brand_price_history(date);
CREATE INDEX idx_brand_price_history_brand_code ON brand_price_history(brand_code);

-- RLS 정책
ALTER TABLE avg_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE regional_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_price_history ENABLE ROW LEVEL SECURITY;

-- 읽기: 누구나 가능
CREATE POLICY "avg_price_history_select" ON avg_price_history FOR SELECT USING (true);
CREATE POLICY "regional_price_history_select" ON regional_price_history FOR SELECT USING (true);
CREATE POLICY "brand_price_history_select" ON brand_price_history FOR SELECT USING (true);

-- 쓰기: service_role만 가능
CREATE POLICY "avg_price_history_insert" ON avg_price_history FOR INSERT WITH CHECK (true);
CREATE POLICY "regional_price_history_insert" ON regional_price_history FOR INSERT WITH CHECK (true);
CREATE POLICY "brand_price_history_insert" ON brand_price_history FOR INSERT WITH CHECK (true);
