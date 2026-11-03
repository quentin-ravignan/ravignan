-- Domaine de Ravignan : base de données Supabase
-- À exécuter une fois dans Supabase > SQL Editor.
-- Remplacez l'adresse du premier administrateur à la fin du fichier.

-- Administrateurs (connexion par lien email)
create table if not exists public.membres (
  email      text primary key check (email = lower(email)),
  role       text not null default 'vendeur' check (role in ('vendeur', 'admin')),
  created_at timestamptz not null default now()
);

-- Données de l'app, rangées par collection (ventes, transactions, chambres, reservations…)
create table if not exists public.docs (
  collection text not null,
  id         text not null,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);
alter table public.docs replica identity full;

create or replace function public.mon_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function public.est_membre() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.membres where email = public.mon_email())
$$;

create or replace function public.est_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.membres where email = public.mon_email() and role = 'admin')
$$;

alter table public.membres enable row level security;
alter table public.docs    enable row level security;

drop policy if exists membres_lecture on public.membres;
drop policy if exists membres_ajout on public.membres;
drop policy if exists membres_modif on public.membres;
drop policy if exists membres_suppr on public.membres;
create policy membres_lecture on public.membres for select to authenticated
  using (email = public.mon_email() or public.est_admin());
create policy membres_ajout on public.membres for insert to authenticated
  with check (public.est_admin());
create policy membres_modif on public.membres for update to authenticated
  using (public.est_admin()) with check (public.est_admin());
create policy membres_suppr on public.membres for delete to authenticated
  using (public.est_admin() and email <> public.mon_email());

-- Accès aux données (rien n'est lisible sans connexion) :
--  - généalogie et plan du château : Benoit et Quentin seulement (acces_prive)
--  - ventes, transactions, réglages, fichier clients : membres connectés
--  - le reste (suppressions de ventes commencées, config) : administrateurs
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

-- Une seule liste : les personnes qui ont accès au site sont aussi les vendeurs de la caisse
alter table public.membres add column if not exists nom text;
-- noms des vendeurs, sans les emails, lisibles sans connexion (caisse)
create or replace function public.liste_vendeurs() returns setof text
language sql stable security definer set search_path = public as $$
  select distinct nom from public.membres where coalesce(nom, '') <> '' order by 1;
$$;
revoke all on function public.liste_vendeurs() from public;
grant execute on function public.liste_vendeurs() to anon, authenticated;

-- Factures des ventes privées : numéro « année-mois-jour-numéro » (ex. 2026-11-21-0005),
-- le compteur continue d’un jour à l’autre : la série reste continue et sans doublon.
-- Le numéro est attribué une seule fois à une transaction existante (rappeler la fonction renvoie le même).
create sequence if not exists public.factures_vp;
create sequence if not exists public.avoirs_vp;
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

-- Photos de la généalogie (Storage) : lecture publique, envoi d'images jusqu'à 2 Mo
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portraits', 'portraits', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
drop policy if exists portraits_lecture on storage.objects;
drop policy if exists portraits_ajout on storage.objects;
create policy portraits_lecture on storage.objects for select to anon, authenticated using (bucket_id = 'portraits');
create policy portraits_ajout on storage.objects for insert to authenticated with check (bucket_id = 'portraits' and public.acces_prive());

-- Mises à jour en direct entre téléphones
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- Premier administrateur
insert into public.membres (email, role) values ('ADRESSE_ADMIN@exemple.fr', 'admin')
on conflict (email) do update set role = 'admin';
