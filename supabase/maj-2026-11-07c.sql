-- 2026-11-07 (c) : synchronisation de la boutique Squarespace toutes les heures (fonction « squarespace-sync »).
-- Les commandes vont dans la collection « squarespace », lisible par les administrateurs seulement.
select cron.unschedule('squarespace-sync') where exists (select 1 from cron.job where jobname = 'squarespace-sync');
select cron.schedule('squarespace-sync', '7 * * * *', $cron$
  select net.http_post(
    url := 'https://zvrzpfyxtqygzsihjccu.supabase.co/functions/v1/squarespace-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2cnpwZnl4dHF5Z3pzaWhqY2N1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3NjYwNzMsImV4cCI6MjEwODM0MjA3M30.XImY1lOpd-CIZ4ZTx_7ADpUlrwqE1xYH8-23NPkDZXo'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000)
$cron$);
