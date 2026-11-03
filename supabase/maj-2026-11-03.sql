-- Mise à jour du 3 novembre 2026, à coller une fois dans Supabase > SQL Editor puis « Run ».
-- Généalogie et Plan du Château réservés à Benoit et Quentin ; numéros de facture année-mois-jour-numéro ;
-- paiements par carte « en attente » jusqu à la confirmation de SumUp.

drop policy if exists docs_lecture on public.docs;
drop policy if exists docs_ajout on public.docs;
drop policy if exists docs_modif on public.docs;
drop policy if exists docs_suppr on public.docs;
-- Généalogie et plan du château (chambres, réservations, famille, coordonnées) : réservés à Benoit et Quentin,
-- y compris pour les autres administrateurs
create or replace function public.acces_prive() returns boolean
language sql stable as $$
  select public.mon_email() in ('benoit.deravignan@gmail.com', 'benoit.deravignan@sfr.fr', 'quentin.ravignan@gmail.com')
$$;
revoke all on function public.acces_prive() from public;
grant execute on function public.acces_prive() to authenticated;
create or replace function public.collection_privee(c text) returns boolean
language sql immutable as $$ select c in ('chambres', 'reservations', 'famille', 'coordonnees') $$;

-- Ventes et caisse : membres connectés. Le reste : administrateurs.
create policy docs_lecture on public.docs for select to anon, authenticated
  using (case when public.collection_privee(collection) then public.acces_prive()
         else public.est_admin() or (collection in ('ventes', 'transactions', 'reglages', 'crm', 'clients') and public.est_membre()) end);
create policy docs_ajout on public.docs for insert to anon, authenticated
  with check (case when public.collection_privee(collection) then public.acces_prive()
              else public.est_admin() or (collection in ('ventes', 'transactions', 'clients') and public.est_membre()) end);
create policy docs_modif on public.docs for update to anon, authenticated
  using (case when public.collection_privee(collection) then public.acces_prive()
         else public.est_admin() or (collection = 'ventes' and public.est_membre()) end)
  with check (case when public.collection_privee(collection) then public.acces_prive()
              else public.est_admin() or (collection = 'ventes' and public.est_membre()) end);
create policy docs_suppr on public.docs for delete to anon, authenticated
  using (case when public.collection_privee(collection) then public.acces_prive()
    else public.est_admin()
    -- une vente sans aucune transaction peut être supprimée par un membre ; une vente commencée, par un administrateur
    or (collection = 'ventes' and public.est_membre() and not exists (
      select 1 from public.docs t where t.collection = 'transactions' and t.data->>'venteId' = docs.id)) end);

-- Coordonnées de la famille (email, téléphone, réseau) : lues par Benoit et Quentin (acces_prive),
-- écrites seulement par cette fonction, qui complète la fiche d'une personne de l'arbre sans rien effacer
create or replace function public.maj_coordonnees(personne text, champs jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.docs (collection, id, data)
  select 'coordonnees', personne, jsonb_strip_nulls(jsonb_build_object(
           'email', nullif(left(champs->>'email', 200), ''), 'tel', nullif(left(champs->>'tel', 40), ''),
           'reseau', nullif(left(champs->>'reseau', 40), ''), 'reseau_lien', nullif(left(champs->>'reseau_lien', 300), '')))
  where public.acces_prive() and exists (select 1 from public.docs where collection = 'famille' and id = personne)
  on conflict (collection, id) do update set data = public.docs.data || excluded.data, updated_at = now();
$$;
revoke all on function public.maj_coordonnees(text, jsonb) from public;
grant execute on function public.maj_coordonnees(text, jsonb) to authenticated;
revoke execute on function public.maj_coordonnees(text, jsonb) from anon;

create or replace function public.numero_facture(tx text) returns text
language plpgsql security definer set search_path = public as $$
declare n text; t text; st text;
begin
  select data->>'facture', data->>'type', data->>'statut' into n, t, st from public.docs where collection = 'transactions' and id = tx for update;
  if not found then raise exception 'transaction inconnue'; end if;
  if st = 'attente' then raise exception 'paiement par carte en attente'; end if;
  if n is not null then return n; end if;
  -- les avoirs (annulations) ont leur propre série « AV-année-mois-jour-numéro »
  if t = 'avoir' then
    n := 'AV-' || to_char(now() at time zone 'Europe/Paris', 'YYYY-MM-DD') || '-' || lpad(nextval('public.avoirs_vp')::text, 4, '0');
  else
    n := to_char(now() at time zone 'Europe/Paris', 'YYYY-MM-DD') || '-' || lpad(nextval('public.factures_vp')::text, 4, '0');
  end if;
  update public.docs set data = data || jsonb_build_object('facture', n, 'facture_date', now()), updated_at = now()
    where collection = 'transactions' and id = tx;
  return n;
end $$;
revoke all on function public.numero_facture(text) from public;
grant execute on function public.numero_facture(text) to authenticated;

-- Paiement par carte : la transaction est créée « en attente » avant d'ouvrir SumUp.
-- Un membre peut seulement la régler (payée, ou payée autrement) ou l'annuler, et seulement tant qu'elle est en attente.
create or replace function public.regler_paiement(tx text, action text, code text default null, mode text default null) returns void
language plpgsql security definer set search_path = public as $$
declare st text;
begin
  if not public.est_membre() then raise exception 'réservé aux membres'; end if;
  select data->>'statut' into st from public.docs where collection = 'transactions' and id = tx for update;
  if not found then raise exception 'transaction inconnue'; end if;
  if st is distinct from 'attente' then
    if action = 'payee' and st = 'payee' then return; end if; -- retour SumUp reçu deux fois
    raise exception 'paiement déjà réglé';
  end if;
  if action = 'payee' then
    update public.docs set data = data || jsonb_build_object('statut', 'payee', 'sumup',
        jsonb_build_object('code', left(code, 64), 'date', now(), 'manuel', code is null)), updated_at = now()
      where collection = 'transactions' and id = tx;
  elsif action = 'mode' and mode in ('Espèces', 'Chèque', 'Caisse centrale') then
    update public.docs set data = (data - 'statut') || jsonb_build_object('paiement', mode), updated_at = now()
      where collection = 'transactions' and id = tx;
  elsif action = 'annuler' then
    delete from public.docs where collection in ('transactions', 'clients') and id = tx;
  else
    raise exception 'action inconnue';
  end if;
end $$;
revoke all on function public.regler_paiement(text, text, text, text) from public;
grant execute on function public.regler_paiement(text, text, text, text) to authenticated;

drop policy if exists portraits_ajout on storage.objects;
create policy portraits_ajout on storage.objects for insert to authenticated with check (bucket_id = 'portraits' and public.acces_prive());
