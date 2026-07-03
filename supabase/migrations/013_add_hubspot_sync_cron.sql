-- Migration: Enable pg_cron and schedule hourly HubSpot sync job
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Safely unschedule previous schedule if exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-hubspot-hourly') THEN
    PERFORM cron.unschedule('sync-hubspot-hourly');
  END IF;
END;
$$;

-- Schedule cron job to run hourly at minute 0
-- Note: Replace <SERVICE_ROLE_KEY> with the actual service_role API key of your project.
-- Inside Supabase Postgres, kong can be reached via 'http://kong:8000/functions/v1/hubspot'
SELECT cron.schedule(
  'sync-hubspot-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://dcvopglyshlpmeugharm.supabase.co/functions/v1/hubspot',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer callpulse-sync-cron-key-987654321"}'::jsonb,
    body := '{"action": "cron-sync"}'::jsonb
  );
  $$
);
