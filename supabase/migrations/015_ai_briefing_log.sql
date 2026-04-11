-- AI 브리핑 감사 로그
-- 목적: 발표에서 "지난 N일간 M건 브리핑 중 K건을 검증자가 차단했다" 같은
-- 실제 수치를 쓰기 위함. ai-briefing/route.ts 가 fire-and-forget 으로 INSERT.
-- service role 키 사용 전제 (RLS silent failure 방지).
CREATE TABLE ai_briefing_log (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  station_id          TEXT NOT NULL,
  called_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  input_tokens        INT,
  output_tokens       INT,
  briefing_text       TEXT,           -- 5줄 원본 (retention 정책은 후속 PR)
  validation_passed   BOOLEAN NOT NULL,
  warnings            JSONB,          -- [{rule, severity, line, detail}]
  recommendation_type TEXT,           -- Claude 응답에서 유도된 type (현재는 rec.type 와 동일하게 echo)
  rule_rec_type       TEXT            -- insights.recommendation.type (규칙 엔진 원본)
);

CREATE INDEX idx_ai_briefing_log_called_at ON ai_briefing_log(called_at DESC);
CREATE INDEX idx_ai_briefing_log_station_called ON ai_briefing_log(station_id, called_at DESC);

ALTER TABLE ai_briefing_log ENABLE ROW LEVEL SECURITY;

-- 읽기는 anon 허용 (대시보드에서 통계 표시용)
CREATE POLICY "ai_briefing_log_select"
  ON ai_briefing_log FOR SELECT
  USING (true);

-- 쓰기는 service role 만 (RLS silent failure 방지)
-- 별도 INSERT 정책을 만들지 않으면 anon 은 차단됨
