-- 2026-11-07 (h) : désabonnement des emails d'information et archive légale des factures.

-- 1. Désabonnement : un jeton aléatoire par adresse (le lien ne contient pas l'adresse email)
create table if not exists public.jetons_desabonnement (
  email text primary key,
  jeton text unique not null default encode(extensions.gen_random_bytes(18), 'hex')
);
alter table public.jetons_desabonnement enable row level security; -- aucune règle : lisible seulement par les fonctions

create table if not exists public.desabonnes (
  email text primary key,
  date  timestamptz not null default now()
);
alter table public.desabonnes enable row level security;
drop policy if exists desabonnes_lecture on public.desabonnes;
create policy desabonnes_lecture on public.desabonnes for select to authenticated using (public.est_membre());

-- jeton d'une adresse (créé au premier email) : fonctions Edge seulement
create or replace function public.jeton_desabonnement(adresse text) returns text
language sql security definer set search_path = public as $$
  insert into public.jetons_desabonnement (email) values (lower(trim(adresse)))
  on conflict (email) do update set email = excluded.email
  returning jeton
$$;
revoke all on function public.jeton_desabonnement(text) from public, anon, authenticated;
grant execute on function public.jeton_desabonnement(text) to service_role;

-- clic sur le lien : sans connexion, avec le seul jeton
create or replace function public.se_desabonner(code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare adr text;
begin
  select email into adr from public.jetons_desabonnement where jeton = code;
  if adr is null then return false; end if;
  insert into public.desabonnes (email) values (adr) on conflict (email) do nothing;
  return true;
end $$;
revoke all on function public.se_desabonner(text) from public;
grant execute on function public.se_desabonner(text) to anon, authenticated;

-- 2. Archive légale des factures (10 ans, article L123-22 du code de commerce) : bucket privé « archives ».
--    Ajout par les membres et les fonctions ; lecture par les administrateurs ; ni modification ni suppression.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('archives', 'archives', false, 3000000, array['application/pdf'])
on conflict (id) do nothing;
drop policy if exists archives_ajout on storage.objects;
create policy archives_ajout on storage.objects for insert to authenticated with check (bucket_id = 'archives' and public.est_membre());
drop policy if exists archives_lecture on storage.objects;
create policy archives_lecture on storage.objects for select to authenticated using (bucket_id = 'archives' and public.est_admin());
