-- =====================================================================
-- Referrals hardening. Run in Supabase Dashboard -> SQL Editor (or `supabase db push`).
-- Safe to run more than once. Requires 20261112000000_referrals.sql to have run first.
--
-- 1. The app already accepts "@asha" / " ASHA " as an invite code (src/lib/referral.ts,
--    normalizeRef). The database functions only trimmed + lower-cased, so "@asha" matched
--    nobody when called directly. Both functions now normalise exactly like the app.
-- 2. Asks PostgREST (the Supabase API layer) to reload its schema cache. If the API was
--    started before the referrals table existed, calls fail with PGRST205 / PGRST202
--    ("could not find the table/function in the schema cache") even though the SQL ran fine.
-- =====================================================================

do $$
begin
  if to_regclass('public.referrals') is null then
    raise exception 'Run supabase/migrations/20261112000000_referrals.sql first (public.referrals is missing).';
  end if;
end $$;

-- One place that turns user input into a username: trim, lower-case, drop ONE leading "@".
create or replace function public.normalize_referral_code(p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(lower(btrim(coalesce(p_code, ''))), '^@', '')
$$;

create or replace function public.get_referrer(p_code text)
returns table (username text, full_name text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select p.username, p.full_name, p.avatar_url
  from public.profiles p
  where p.username = public.normalize_referral_code(p_code)
    and p.onboarding_completed
  limit 1 $$;
revoke all on function public.get_referrer(text) from public;
grant execute on function public.get_referrer(text) to anon, authenticated;

create or replace function public.claim_referral(p_code text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_me       uuid := auth.uid();
  v_referrer uuid;
  v_created  timestamptz;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;

  select p.created_at into v_created from public.profiles p where p.id = v_me and p.onboarding_completed;
  if v_created is null then raise exception 'profile_not_ready'; end if;

  select p.id into v_referrer from public.profiles p
   where p.username = public.normalize_referral_code(p_code) and p.onboarding_completed;
  if v_referrer is null then return 'unknown_code'; end if;
  if v_referrer = v_me then return 'self'; end if;
  if exists (select 1 from public.referrals r where r.referred_id = v_me) then return 'already'; end if;
  if v_created < now() - interval '7 days' then return 'too_late'; end if;

  insert into public.referrals (referred_id, referrer_id) values (v_me, v_referrer)
  on conflict (referred_id) do nothing;
  if not found then return 'already'; end if;
  return 'ok';
end $$;
revoke all on function public.claim_referral(text) from public, anon;
grant execute on function public.claim_referral(text) to authenticated;

-- Make the API pick up the table and both functions immediately.
notify pgrst, 'reload schema';
