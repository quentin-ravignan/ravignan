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

-- Accès aux données :
--  - ventes, transactions, chambres, réservations, famille : lisibles par tout le monde, sans connexion
--  - réglages (clé affiliée SumUp) : lisibles par tout le monde, modifiables par les admins
--  - fichier clients (crm, clients) et coordonnées de la famille : lisibles par les membres connectés
--  - les visiteurs peuvent créer ventes, transactions, réservations et fiches clients,
--    clôturer une vente, annuler une réservation et modifier les fiches de la généalogie ;
--    le reste (suppressions, chambres, config) est réservé aux administrateurs
drop policy if exists docs_lecture on public.docs;
drop policy if exists docs_ajout on public.docs;
drop policy if exists docs_modif on public.docs;
drop policy if exists docs_suppr on public.docs;
create policy docs_lecture on public.docs for select to anon, authenticated
  using (collection in ('chambres', 'reservations', 'ventes', 'transactions', 'famille', 'reglages') or public.est_admin()
         or (collection in ('coordonnees', 'crm', 'clients') and public.est_membre()));
create policy docs_ajout on public.docs for insert to anon, authenticated
  with check (collection in ('reservations', 'ventes', 'transactions', 'clients', 'famille') or public.est_admin());
create policy docs_modif on public.docs for update to anon, authenticated
  using (collection in ('ventes', 'famille') or public.est_admin())
  with check (collection in ('ventes', 'famille') or public.est_admin());
create policy docs_suppr on public.docs for delete to anon, authenticated
  using (collection = 'reservations' or public.est_admin()
    -- une vente sans aucune transaction peut être supprimée par tous ; une vente commencée, par un administrateur
    or (collection = 'ventes' and not exists (
      select 1 from public.docs t where t.collection = 'transactions' and t.data->>'venteId' = docs.id)));

-- Coordonnées de la famille (email, téléphone, réseau) : lues par les membres connectés,
-- écrites seulement par cette fonction, qui complète la fiche d'une personne de l'arbre sans rien effacer
create or replace function public.maj_coordonnees(personne text, champs jsonb) returns void
language sql security definer set search_path = public as $
  insert into public.docs (collection, id, data)
  select 'coordonnees', personne, jsonb_strip_nulls(jsonb_build_object(
           'email', nullif(left(champs->>'email', 200), ''), 'tel', nullif(left(champs->>'tel', 40), ''),
           'reseau', nullif(left(champs->>'reseau', 40), ''), 'reseau_lien', nullif(left(champs->>'reseau_lien', 300), '')))
  where exists (select 1 from public.docs where collection = 'famille' and id = personne)
  on conflict (collection, id) do update set data = public.docs.data || excluded.data, updated_at = now();
$;
revoke all on function public.maj_coordonnees(text, jsonb) from public;
grant execute on function public.maj_coordonnees(text, jsonb) to anon, authenticated;

-- Factures des ventes privées : série « VP-année-numéro », continue et sans doublon.
-- Le numéro est attribué une seule fois à une transaction existante (rappeler la fonction renvoie le même).
create sequence if not exists public.factures_vp;
create or replace function public.numero_facture(tx text) returns text
language plpgsql security definer set search_path = public as $$
declare n text;
begin
  select data->>'facture' into n from public.docs where collection = 'transactions' and id = tx for update;
  if not found then raise exception 'transaction inconnue'; end if;
  if n is not null then return n; end if;
  n := 'VP-' || to_char(now() at time zone 'Europe/Paris', 'YYYY') || '-' || lpad(nextval('public.factures_vp')::text, 4, '0');
  update public.docs set data = data || jsonb_build_object('facture', n, 'facture_date', now()), updated_at = now()
    where collection = 'transactions' and id = tx;
  return n;
end $$;
revoke all on function public.numero_facture(text) from public;
grant execute on function public.numero_facture(text) to anon, authenticated;

-- Photos de la généalogie (Storage) : lecture publique, envoi d'images jusqu'à 2 Mo
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portraits', 'portraits', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
drop policy if exists portraits_lecture on storage.objects;
drop policy if exists portraits_ajout on storage.objects;
create policy portraits_lecture on storage.objects for select to anon, authenticated using (bucket_id = 'portraits');
create policy portraits_ajout on storage.objects for insert to anon, authenticated with check (bucket_id = 'portraits');

-- Mises à jour en direct entre téléphones
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- Premier administrateur
insert into public.membres (email, role) values ('ADRESSE_ADMIN@exemple.fr', 'admin')
on conflict (email) do update set role = 'admin';
