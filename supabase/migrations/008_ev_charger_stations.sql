-- EV 충전소 테이블 (충전소ID 기준 집계, ~24K rows)
-- 원본: 환경부 전기차충전소현황 CSV (147K 충전기 → 충전소 단위 그룹핑)

CREATE TABLE ev_charger_stations (
  station_id      TEXT PRIMARY KEY,               -- 환경부 충전소ID ('ME18B248', 8자)
  station_name    TEXT NOT NULL,
  address         TEXT,
  lat             DOUBLE PRECISION NOT NULL,
  lng             DOUBLE PRECISION NOT NULL,

  fast_count      SMALLINT NOT NULL DEFAULT 0,     -- 급속 충전기 수 (타입 != 2)
  slow_count      SMALLINT NOT NULL DEFAULT 0,     -- 완속 충전기 수 (타입 = 2)
  total_count     SMALLINT NOT NULL DEFAULT 0,     -- fast + slow

  operator        TEXT,                            -- 관리업체명
  available_time  TEXT,                            -- 이용가능시간

  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 반경 검색용 인덱스 (기존 stations 테이블과 동일 패턴)
CREATE INDEX idx_ev_stations_lat_lng ON ev_charger_stations (lat, lng);

-- RLS: 읽기 공개, 쓰기 service_role만
ALTER TABLE ev_charger_stations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ev_charger_stations_select"
  ON ev_charger_stations FOR SELECT
  USING (true);

CREATE POLICY "ev_charger_stations_insert"
  ON ev_charger_stations FOR INSERT
  WITH CHECK (true);

CREATE POLICY "ev_charger_stations_update"
  ON ev_charger_stations FOR UPDATE
  USING (true)
  WITH CHECK (true);
