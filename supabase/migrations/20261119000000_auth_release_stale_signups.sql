-- =====================================================================
-- Auth fix: an unverified sign-up must not hold a username forever.
--
-- PROBLEM (reproduced on a replay of your migrations):
--   handle_new_user() creates the profile the moment someone signs up, before the email code is
--   entered. If the person never verifies (closed the app, lost the reply, bad connection, typo in
--   the email) the username stays taken for good:
--     * plan_signup_email()      -> { ok:false, reason:"username_taken" }
--     * is_username_available()  -> false
--   so the same person cannot retry with the same username, and anyone can park usernames.
--
-- FIX (additive, same function names and signatures, grants are kept by CREATE OR REPLACE):
--   A sign-up that is still unverified after 2 hours (email AND phone unconfirmed) is "stale".
--     * is_username_available() ignores stale holders, so the live check says "available".
--     * plan_signup_email() removes the stale holder (profile + auth user, cascades) just before
--       it decides, so the new sign-up can take the name.
--   Verified accounts are never touched. Google / phone accounts are never touched.
--   2 hours is longer than Supabase's default 1 hour email-code lifetime.
--
-- Safe to run more than once. Does not change any existing account.
-- =====================================================================

-- 1. Live username check: ignore stale unverified holders.
create or replace function public.is_username_available(p_username text)
returns boolean
language sql
security definer
stable
set search_path = public, auth
as $$
  select not exists (
    select 1
    from public.profiles p
    left join auth.users u on u.id = p.id
    where p.username = lower(btrim(p_username))
      and not (
        u.id is not null
        and u.email_confirmed_at is null
        and u.phone_confirmed_at is null
        and u.created_at < now() - interval '2 hours'
      )
  );
$$;

-- 2. Sign-up planner: same rules as before, plus the stale clean-up (so it is no longer STABLE).
create or replace function public.plan_signup_email(p_email text, p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user    text := lower(btrim(coalesce(p_username, '')));
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_key     text;
  v_local   text;
  v_domain  text;
  v_alias   text;
begin
  if v_user !~ '^[a-z0-9_]{3,20}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_username');
  end if;

  -- Free the name if its owner never verified (see header).
  delete from auth.users u
  using public.profiles p
  where p.id = u.id
    and p.username = v_user
    and u.email_confirmed_at is null
    and u.phone_confirmed_at is null
    and u.created_at < now() - interval '2 hours';

  if exists (select 1 from public.profiles where username = v_user) then
    return jsonb_build_object('ok', false, 'reason', 'username_taken');
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_email');
  end if;

  v_key := public.normalize_contact_email(v_email);

  if (
    select count(*)
    from public.account_emails a
    join auth.users u on u.id = a.user_id
    where a.contact_email = v_key and u.email_confirmed_at is not null
  ) >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'limit_reached');
  end if;

  -- Mailbox not used by any auth user yet -> normal sign-up with the real email.
  if not exists (select 1 from auth.users where lower(email) = v_email) then
    return jsonb_build_object('ok', true, 'auth_email', v_email);
  end if;

  -- Already used -> make an inbox alias (same inbox, unique for Supabase).
  v_local  := split_part(split_part(v_email, '@', 1), '+', 1);
  v_domain := split_part(v_email, '@', 2);
  if v_domain ~ '^(yahoo\.|ymail\.com$|rocketmail\.com$|rediffmail\.com$|aol\.com$)' then
    return jsonb_build_object('ok', false, 'reason', 'unsupported_domain');
  end if;
  v_alias := v_local || '+' || v_user || '@' || v_domain;
  return jsonb_build_object('ok', true, 'auth_email', v_alias);
end;
$$;

-- Housekeeping for the same problem: remove every stale unverified sign-up in one go.
-- Not scheduled. Run by hand now and then:  select public.purge_stale_signups();
create or replace function public.purge_stale_signups()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare n integer;
begin
  delete from auth.users u
  using public.profiles p
  where p.id = u.id
    and u.email_confirmed_at is null
    and u.phone_confirmed_at is null
    and u.created_at < now() - interval '2 hours';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.purge_stale_signups() from public, anon, authenticated;
grant execute on function public.purge_stale_signups() to service_role;
