-- 2026-11-07 (e) : photo des vendeurs.
-- Par défaut la photo du compte Google de la personne (enregistrée à sa connexion) ; un administrateur peut en mettre une autre.
alter table public.membres add column if not exists photo text;

-- la personne connectée enregistre la photo de son propre compte Google
create or replace function public.maj_ma_photo(url text) returns void
language sql security definer set search_path = public as $$
  update public.membres set photo = left(url, 600)
  where email = public.mon_email() and url ~ '^https://' and (photo is null or photo like '%googleusercontent.com%')
$$;
revoke all on function public.maj_ma_photo(text) from public, anon;
grant execute on function public.maj_ma_photo(text) to authenticated;

-- noms et photos des vendeurs, pour les membres connectés (sans les emails)
create or replace function public.photos_vendeurs() returns table(nom text, photo text)
language sql stable security definer set search_path = public as $$
  select m.nom, m.photo from public.membres m where public.est_membre() and m.nom is not null and m.photo is not null
$$;
revoke all on function public.photos_vendeurs() from public, anon;
grant execute on function public.photos_vendeurs() to authenticated;

-- photos choisies par un administrateur : bucket public « vendeurs », écriture par les administrateurs
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vendeurs', 'vendeurs', true, 2000000, array['image/jpeg'])
on conflict (id) do nothing;
drop policy if exists vendeurs_ajout on storage.objects;
create policy vendeurs_ajout on storage.objects for insert to authenticated with check (bucket_id = 'vendeurs' and public.est_admin());
