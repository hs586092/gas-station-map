-- 006: ITS 활성 링크 매칭 컬럼 추가
-- ITS API가 실시간 소통정보를 제공하는 link_id를 별도 저장
-- nearest_link_id(가장 가까운 도로)와 분리하여 관리

ALTER TABLE stations ADD COLUMN IF NOT EXISTS its_link_id TEXT;          -- ITS 활성 link_id
ALTER TABLE stations ADD COLUMN IF NOT EXISTS its_link_distance INTEGER; -- ITS 링크까지 거리 (m)

CREATE INDEX IF NOT EXISTS idx_stations_its_link ON stations(its_link_id);
