-- 007: pg_cron으로 collect-traffic Edge Function 매시 호출
-- Vercel 서버리스에서 ITS API(포트 9443) 접근 불가 → Supabase Edge Function 사용
-- pg_net의 net.http_get은 fire-and-forget (타임아웃 문제 없음)

-- pg_cron 활성화 (Supabase Pro에서 사용 가능)
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- pg_net 활성화
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 매시 정각 Edge Function 호출
SELECT cron.schedule(
  'collect-traffic-hourly',
  '0 * * * *',
  $$
  SELECT net.http_get(
    url := 'https://jlbzbsqfindjzhvdfpvb.supabase.co/functions/v1/collect-traffic',
    headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpsYnpic3FmaW5kanpodmRmcHZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MTc0OTQsImV4cCI6MjA4OTA5MzQ5NH0.HzqYjKz-oRcn9cakh5Gngwc_kWoE5-3lgI0Q28Z_oww", "x-cron-secret": "e9669459ee2d055b9a25c573f44ab57dcd2d939f"}'::jsonb
  );
  $$
);
