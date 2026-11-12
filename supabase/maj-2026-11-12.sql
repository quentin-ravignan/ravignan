-- 2026-11-12 : commandes du site (Stripe) et contacts Mailchimp synchronisés toutes les heures.
-- La synchro Squarespace (API payante, jamais configurée) est arrêtée : les commandes du site deviennent la vente permanente « site-web ».
select cron.unschedule('squarespace-sync') where exists (select 1 from cron.job where jobname = 'squarespace-sync');

select cron.unschedule('stripe-sync') where exists (select 1 from cron.job where jobname = 'stripe-sync');
select cron.schedule('stripe-sync', '17 * * * *', $cron$
  select net.http_post(
    url := 'https://zvrzpfyxtqygzsihjccu.supabase.co/functions/v1/stripe-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2cnpwZnl4dHF5Z3pzaWhqY2N1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3NjYwNzMsImV4cCI6MjEwODM0MjA3M30.XImY1lOpd-CIZ4ZTx_7ADpUlrwqE1xYH8-23NPkDZXo'),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000)
$cron$);

select cron.unschedule('mailchimp-sync') where exists (select 1 from cron.job where jobname = 'mailchimp-sync');
select cron.schedule('mailchimp-sync', '27 * * * *', $cron$
  select net.http_post(
    url := 'https://zvrzpfyxtqygzsihjccu.supabase.co/functions/v1/mailchimp-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2cnpwZnl4dHF5Z3pzaWhqY2N1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3NjYwNzMsImV4cCI6MjEwODM0MjA3M30.XImY1lOpd-CIZ4ZTx_7ADpUlrwqE1xYH8-23NPkDZXo'),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000)
$cron$);
