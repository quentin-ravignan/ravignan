-- 2026-11-07
-- 1. Généalogie (collection « famille ») lisible par tous les membres connectés.
--    Modifier l'arbre et lire les coordonnées restent réservés à Benoit et Quentin (acces_prive).
drop policy if exists docs_lecture on public.docs;
create policy docs_lecture on public.docs for select to anon, authenticated
  using (case when collection = 'famille' then public.est_membre() or public.acces_prive()
              when public.collection_privee(collection) then public.acces_prive()
         else public.est_admin() or (collection in ('ventes', 'transactions', 'reglages', 'crm', 'clients') and public.est_membre()) end);

-- 2. Marque « remerciements » posée sur une vente par la fonction Edge « remerciements » (service_role seulement).
--    Fusion dans le JSON : ne réécrit pas le reste de la vente (stocks…) modifié entre-temps.
create or replace function public.marquer_remerciements(vente text, info jsonb) returns void
language sql security definer set search_path = public as $$
  update public.docs set data = data || jsonb_build_object('remerciements', info), updated_at = now()
  where collection = 'ventes' and id = vente
$$;
revoke all on function public.marquer_remerciements(text, jsonb) from public, anon, authenticated;
grant execute on function public.marquer_remerciements(text, jsonb) to service_role;

-- 3. Tous les matins à 8 h (UTC), la fonction « remerciements » écrit aux clients des ventes terminées depuis 7 jours.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('remerciements-ventes') where exists (select 1 from cron.job where jobname = 'remerciements-ventes');
select cron.schedule('remerciements-ventes', '0 8 * * *', $cron$
  select net.http_post(
    url := 'https://zvrzpfyxtqygzsihjccu.supabase.co/functions/v1/remerciements',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2cnpwZnl4dHF5Z3pzaWhqY2N1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3NjYwNzMsImV4cCI6MjEwODM0MjA3M30.XImY1lOpd-CIZ4ZTx_7ADpUlrwqE1xYH8-23NPkDZXo'),
    body := '{}'::jsonb)
$cron$);
