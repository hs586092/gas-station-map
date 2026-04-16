-- ============================================================================
-- 마이그레이션 016 — Phase 1 Shadow Mode 인프라
-- ============================================================================
--
-- 목적
--   "복기의 복기" 카드를 자동 학습/보정 시스템으로 확장하기 위한 1단계
--   인프라 구축. Shadow Mode 는 평균 잔차 기반 보정값을 "계산만" 하고
--   실제 예측(predicted_volume)에는 적용하지 않는다.
--
-- 안전 원칙 (이 마이그레이션이 보장하는 것)
--   1. predicted_volume 원본 컬럼은 절대 변경하지 않음
--   2. 신규 컬럼 5개는 모두 NULLABLE + DEFAULT 없음
--      → PG11+ 메타데이터 변경만 (테이블 rewrite 없음, 기존 데이터 0건 변경)
--   3. ALTER TABLE 은 IF NOT EXISTS 로 멱등 보장 (재실행 안전)
--   4. CREATE TABLE 은 IF NOT EXISTS 로 멱등 보장
--   5. seed INSERT 는 ON CONFLICT DO NOTHING 으로 중복 방지
--
-- 잠금 영향
--   ALTER TABLE 시 AccessExclusiveLock 짧게 (수십 ms 예상, 11행 테이블)
--   동시 INSERT/UPDATE 가 있더라도 즉시 풀림
--
-- 적용 방법
--   Supabase Dashboard → SQL Editor → 이 파일 전체 붙여넣기 → Run
--   (실행 후 016_post_validate.sql 로 검증)
--
-- 롤백 방법
--   문제 발생 시 016_rollback.sql 실행
--   (단, predicted_volume 자체는 이 마이그레이션에서 건드리지 않으므로
--    롤백해도 원본 데이터는 영향 없음)
--
-- ============================================================================


BEGIN;


-- ── 1. forecast_history 컬럼 5개 추가 ───────────────────────────────────
-- 모두 NULLABLE, DEFAULT 없음 → 메타데이터 변경만 (안전)
-- 기존 11행의 predicted_volume / actual_volume 등은 한 글자도 변경 안 됨
ALTER TABLE forecast_history
  ADD COLUMN IF NOT EXISTS corrected_volume      NUMERIC(10, 2),   -- 보정 후 예측 (Shadow: 계산만)
  ADD COLUMN IF NOT EXISTS correction_delta      NUMERIC(10, 2),   -- corrected - predicted (양수=상향, 음수=하향)
  ADD COLUMN IF NOT EXISTS correction_method     TEXT,             -- 'mean_30d' (MVP), 향후 'weekday'|'weather'
  ADD COLUMN IF NOT EXISTS correction_segment    TEXT,             -- MVP는 'ALL', 향후 '금요일'|'rain' 등
  ADD COLUMN IF NOT EXISTS correction_confidence TEXT;             -- 'shadow' | 'active' | 'rollback'

COMMENT ON COLUMN forecast_history.corrected_volume      IS 'Shadow/Active 보정 후 예측값. predicted_volume + correction_delta. NULL이면 보정 미적용.';
COMMENT ON COLUMN forecast_history.correction_delta      IS '예측 보정량 (L). 양수=상향 보정, 음수=하향 보정. clamp(±predicted*20%) 적용.';
COMMENT ON COLUMN forecast_history.correction_method     IS '보정 방법. MVP는 ''mean_30d'' 고정.';
COMMENT ON COLUMN forecast_history.correction_segment    IS '보정 적용 세그먼트. MVP는 ''ALL'' 고정.';
COMMENT ON COLUMN forecast_history.correction_confidence IS '''shadow''=관찰만, ''active''=실예측 반영, ''rollback''=악화 감지 후 해제.';


-- ── 2. forecast_history 신규 컬럼 인덱스 ────────────────────────────────
-- shadow 레코드만 빠르게 뽑기 위한 부분 인덱스 (NULL 행은 제외)
CREATE INDEX IF NOT EXISTS idx_forecast_history_correction_conf
  ON forecast_history (station_id, correction_confidence)
  WHERE correction_confidence IS NOT NULL;


-- ── 3. forecast_correction_policy 테이블 신설 ───────────────────────────
-- station 단위 보정 정책 상태 저장
-- mode='off'    : 보정 비활성
-- mode='shadow' : 계산만, 실예측 미반영 (MVP 기본값)
-- mode='active' : 계산+실예측 반영 (Phase 2 이후)
CREATE TABLE IF NOT EXISTS forecast_correction_policy (
  station_id          TEXT        PRIMARY KEY,
  mode                TEXT        NOT NULL DEFAULT 'shadow'
                                  CHECK (mode IN ('off', 'shadow', 'active')),
  method              TEXT        NOT NULL DEFAULT 'mean_30d'
                                  CHECK (method IN ('mean_30d', 'weekday', 'weather')),
  params              JSONB,                                       -- { meanResidualL, sampleN, windowDays, computedAt }
  shadow_started_at   TIMESTAMPTZ,
  last_evaluated_at   TIMESTAMPTZ,
  rollback_count      INTEGER     NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  forecast_correction_policy IS 'Station 별 자동 보정 정책 상태. Phase 1은 mode=''shadow'' 만 사용.';
COMMENT ON COLUMN forecast_correction_policy.params IS 'JSONB: { meanResidualL: number, sampleN: number, windowDays: number, computedAt: ISO8601 }';
COMMENT ON COLUMN forecast_correction_policy.shadow_started_at IS 'Shadow Mode 시작 시각. UI에서 관찰일수 계산용.';


-- ── 4. forecast_correction_log 테이블 신설 ──────────────────────────────
-- 모든 보정 이벤트(계산/적용/롤백) 감사 로그
-- 어떤 정책 변경도 흔적이 남도록 보장 → 사후 디버깅/분석 가능
CREATE TABLE IF NOT EXISTS forecast_correction_log (
  id                  BIGSERIAL   PRIMARY KEY,
  station_id          TEXT        NOT NULL,
  applied_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  action              TEXT        NOT NULL
                                  CHECK (action IN (
                                    'shadow_started', 'shadow_computed',
                                    'activated',      'updated',
                                    'rolled_back',    'paused'
                                  )),
  method              TEXT,
  segment             TEXT,
  params_before       JSONB,
  params_after        JSONB,
  trigger_reason      TEXT,                                        -- 'scheduled' | 'degradation_detected' | 'user' | 'initial'
  metrics_snapshot    JSONB                                        -- { sampleN, meanResidualL, beforeMape, afterMape, ... }
);

COMMENT ON TABLE forecast_correction_log IS '보정 시스템의 모든 상태 변경 이벤트 감사 로그. 절대 UPDATE/DELETE 하지 않음 (append-only).';

CREATE INDEX IF NOT EXISTS idx_correction_log_station_time
  ON forecast_correction_log (station_id, applied_at DESC);

CREATE INDEX IF NOT EXISTS idx_correction_log_action
  ON forecast_correction_log (action, applied_at DESC);


-- ── 5. forecast_history 의 모든 station 을 policy 에 seed ────────────────
-- 현재는 A0003453 하나뿐이지만, 범용 SQL 로 작성하여 향후 station 추가 시
-- 동일 SQL 재실행으로 자동 seed 가능 (ON CONFLICT DO NOTHING)
INSERT INTO forecast_correction_policy (station_id, mode, shadow_started_at)
SELECT DISTINCT
  station_id,
  'shadow'    AS mode,
  NOW()       AS shadow_started_at
FROM forecast_history
WHERE station_id IS NOT NULL
ON CONFLICT (station_id) DO NOTHING;


-- ── 6. seed 이벤트를 로그에 기록 ─────────────────────────────────────────
-- 이 마이그레이션 자체가 "shadow 시작" 의 출발점이므로 흔적 남김
INSERT INTO forecast_correction_log (
  station_id, action, method, segment,
  trigger_reason, metrics_snapshot
)
SELECT
  station_id,
  'shadow_started'                                AS action,
  'mean_30d'                                      AS method,
  'ALL'                                           AS segment,
  'initial'                                       AS trigger_reason,
  jsonb_build_object(
    'migration', '016',
    'seeded_at', NOW(),
    'note',      'Phase 1 Shadow Mode 인프라 구축 — 평가 임계값 N>=30'
  )                                               AS metrics_snapshot
FROM forecast_correction_policy
WHERE mode = 'shadow';


COMMIT;


-- ============================================================================
-- 적용 직후 확인용 SELECT (참고)
-- ============================================================================
-- 1. 신규 컬럼 5개 추가 확인
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'forecast_history'
  AND column_name IN (
    'corrected_volume', 'correction_delta', 'correction_method',
    'correction_segment', 'correction_confidence'
  )
ORDER BY column_name;

-- 2. 신규 테이블 2개 존재 확인
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('forecast_correction_policy', 'forecast_correction_log');

-- 3. seed 결과 확인 (모든 station이 mode='shadow' 로 등록되었는지)
SELECT station_id, mode, method, shadow_started_at
FROM forecast_correction_policy
ORDER BY station_id;

-- 4. seed 로그 기록 확인
SELECT id, station_id, action, trigger_reason, applied_at
FROM forecast_correction_log
WHERE action = 'shadow_started'
ORDER BY id DESC
LIMIT 10;

-- 5. 핵심 안전성 검증: predicted_volume 한 줄도 안 바뀌었는지
--    체크섬 SQL(016_checksum_simple.sql) 재실행 → 마이그레이션 전과 동일해야 함
