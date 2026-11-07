-- 2026-11-07 (f) : tout le site pour les membres connectés par email ; Généalogie, Plan du Château et Administration pour les administrateurs.
-- acces_prive() : Benoit, Quentin et tous les administrateurs (chambres, réservations, famille, coordonnées, portraits).
create or replace function public.acces_prive() returns boolean
language sql stable security definer set search_path = public as $$
  select public.mon_email() in ('benoit.deravignan@gmail.com', 'benoit.deravignan@sfr.fr', 'quentin.ravignan@gmail.com')
      or public.est_admin()
$$;
-- Clients : les membres peuvent aussi mettre à jour les fiches clients et le suivi (crm)
drop policy if exists docs_ajout on public.docs;
create policy docs_ajout on public.docs for insert to anon, authenticated
  with check (case when public.collection_privee(collection) then public.acces_prive()
              else public.est_admin() or (collection in ('ventes', 'transactions', 'clients', 'crm') and public.est_membre()) end);
drop policy if exists docs_modif on public.docs;
create policy docs_modif on public.docs for update to anon, authenticated
  using (case when public.collection_privee(collection) then public.acces_prive()
         else public.est_admin() or (collection in ('ventes', 'clients', 'crm') and public.est_membre()) end)
  with check (case when public.collection_privee(collection) then public.acces_prive()
              else public.est_admin() or (collection in ('ventes', 'clients', 'crm') and public.est_membre()) end);
