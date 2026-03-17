-- 005: 도로 링크 테이블 + 주유소-도로 매칭 컬럼

-- ============================================================
-- 1. road_links: 표준노드링크 주요 도로 (ROAD_RANK 101~106)
-- ============================================================
CREATE TABLE IF NOT EXISTS road_links (
  link_id     TEXT PRIMARY KEY,          -- 표준노드링크 LINK_ID
  f_node      TEXT NOT NULL,             -- 시작 노드 ID
  t_node      TEXT NOT NULL,             -- 종료 노드 ID
  road_name   TEXT,                      -- 도로명
  road_rank   TEXT NOT NULL,             -- 101=고속도로 ~ 106=지방도
  road_no     TEXT,                      -- 노선 번호
  lanes       INTEGER,                   -- 차로 수
  max_spd     INTEGER,                   -- 제한 속도 (km/h)
  length      DOUBLE PRECISION,          -- 구간 길이 (m)
  center_lat  DOUBLE PRECISION NOT NULL, -- 중심점 위도 (WGS84)
  center_lng  DOUBLE PRECISION NOT NULL, -- 중심점 경도 (WGS84)
  start_lat   DOUBLE PRECISION,          -- 시작점 위도
  start_lng   DOUBLE PRECISION,          -- 시작점 경도
  end_lat     DOUBLE PRECISION,          -- 종료점 위도
  end_lng     DOUBLE PRECISION           -- 종료점 경도
);

CREATE INDEX IF NOT EXISTS idx_road_links_center ON road_links(center_lat, center_lng);
CREATE INDEX IF NOT EXISTS idx_road_links_rank ON road_links(road_rank);

-- ============================================================
-- 2. stations 테이블에 교통 관련 컬럼 추가
-- ============================================================
ALTER TABLE stations ADD COLUMN IF NOT EXISTS nearest_link_id TEXT;
ALTER TABLE stations ADD COLUMN IF NOT EXISTS link_distance INTEGER;        -- 최근접 링크까지 거리 (m)
ALTER TABLE stations ADD COLUMN IF NOT EXISTS road_name TEXT;               -- 매칭된 도로명
ALTER TABLE stations ADD COLUMN IF NOT EXISTS road_rank TEXT;               -- 매칭된 도로 등급
ALTER TABLE stations ADD COLUMN IF NOT EXISTS road_speed DOUBLE PRECISION;  -- 최근 소통 속도 (km/h)
ALTER TABLE stations ADD COLUMN IF NOT EXISTS road_speed_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_stations_nearest_link ON stations(nearest_link_id);

-- ============================================================
-- 3. traffic_snapshots: 교통소통 스냅샷 이력
-- ============================================================
CREATE TABLE IF NOT EXISTS traffic_snapshots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id      TEXT NOT NULL,
  speed        DOUBLE PRECISION NOT NULL,  -- 실시간 속도 (km/h)
  travel_time  DOUBLE PRECISION,           -- 통행시간 (초)
  collected_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_traffic_snapshots_link ON traffic_snapshots(link_id, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_traffic_snapshots_time ON traffic_snapshots(collected_at);

-- ============================================================
-- 4. RLS 정책
-- ============================================================
ALTER TABLE road_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE traffic_snapshots ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'road_links 누구나 조회') THEN
    CREATE POLICY "road_links 누구나 조회" ON road_links FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'road_links service만 쓰기') THEN
    CREATE POLICY "road_links service만 쓰기" ON road_links FOR ALL USING (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'traffic_snapshots 누구나 조회') THEN
    CREATE POLICY "traffic_snapshots 누구나 조회" ON traffic_snapshots FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'traffic_snapshots service만 쓰기') THEN
    CREATE POLICY "traffic_snapshots service만 쓰기" ON traffic_snapshots FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;
