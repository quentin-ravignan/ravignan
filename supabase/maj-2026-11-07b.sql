-- 2026-11-07 (b) : numéro de facture réservé à l'ouverture de SumUp ; vente CB abandonnée gardée (vidée) si elle a déjà un numéro
create or replace function public.numero_facture(tx text) returns text
language plpgsql security definer set search_path = public as $$
declare n text; t text; st text;
begin
  select data->>'facture', data->>'type', data->>'statut' into n, t, st from public.docs where collection = 'transactions' and id = tx for update;
  if not found then raise exception 'transaction inconnue'; end if;
  -- une vente CB reçoit son numéro dès l'ouverture de SumUp (libellé « Nom de la vente - numéro ») ;
  -- abandonnée ensuite, elle reste dans la base, vidée, pour garder la numérotation continue
  if st = 'abandonnee' then raise exception 'vente abandonnée'; end if;
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
    if exists (select 1 from public.docs where collection = 'transactions' and id = tx and data ? 'facture') then
      update public.docs set data = data || jsonb_build_object('statut', 'abandonnee', 'lignes_abandonnees', data->'lignes', 'lignes', '[]'::jsonb, 'total', 0, 'abandon_date', now()), updated_at = now()
        where collection = 'transactions' and id = tx;
    else
      delete from public.docs where collection in ('transactions', 'clients') and id = tx;
    end if;
  else
    raise exception 'action inconnue';
  end if;
end $$;
revoke all on function public.regler_paiement(text, text, text, text) from public;
grant execute on function public.regler_paiement(text, text, text, text) to authenticated;
