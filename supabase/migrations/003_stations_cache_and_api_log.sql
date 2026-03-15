-- 주유소 캐시 테이블 (매일 수집된 최신 데이터)
CREATE TABLE IF NOT EXISTS stations (
  id TEXT PRIMARY KEY,            -- UNI_ID
  name TEXT NOT NULL,
  brand TEXT NOT NULL,
  old_address TEXT,
  new_address TEXT,
  tel TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  gasoline_price INTEGER,
  diesel_price INTEGER,
  premium_price INTEGER,
  lpg_yn TEXT DEFAULT 'N',
  car_wash_yn TEXT DEFAULT 'N',
  cvs_yn TEXT DEFAULT 'N',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_stations_lat_lng ON stations(lat, lng);
CREATE INDEX idx_stations_brand ON stations(brand);
CREATE INDEX idx_stations_updated_at ON stations(updated_at);

-- Opinet API 호출 로그 테이블
CREATE TABLE IF NOT EXISTS api_call_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  endpoint TEXT NOT NULL,
  call_count INTEGER NOT NULL DEFAULT 1,
  caller TEXT NOT NULL,           -- 'cron', 'user' 등
  success BOOLEAN DEFAULT TRUE,
  error_message TEXT,
  called_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_api_call_log_called_at ON api_call_log(called_at);
CREATE INDEX idx_api_call_log_caller ON api_call_log(caller);

-- RLS 정책
ALTER TABLE stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_call_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stations_select" ON stations FOR SELECT USING (true);
CREATE POLICY "stations_insert" ON stations FOR INSERT WITH CHECK (true);
CREATE POLICY "stations_update" ON stations FOR UPDATE USING (true);

CREATE POLICY "api_call_log_select" ON api_call_log FOR SELECT USING (true);
CREATE POLICY "api_call_log_insert" ON api_call_log FOR INSERT WITH CHECK (true);
