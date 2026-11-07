-- 2026-11-07 (d) : généalogie (famille) lisible par les administrateurs seulement ; modification toujours par Benoit et Quentin.
drop policy if exists docs_lecture on public.docs;
create policy docs_lecture on public.docs for select to anon, authenticated
  using (case when collection = 'famille' then public.est_admin() or public.acces_prive()
              when public.collection_privee(collection) then public.acces_prive()
         else public.est_admin() or (collection in ('ventes', 'transactions', 'reglages', 'crm', 'clients') and public.est_membre()) end);
