-- 2026-11-07 (g) : les accès ne dépendent plus que du rôle (Administration). Plus aucune adresse en dur :
-- un administrateur voit tout (Généalogie, Plan du Château, coordonnées, Administration), un vendeur a l'accès restreint.
create or replace function public.acces_prive() returns boolean
language sql stable security definer set search_path = public as $$
  select public.est_admin()
$$;
