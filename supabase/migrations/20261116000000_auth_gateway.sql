-- =====================================================================
-- Auth gateway support: rate-limit counters and brute-force lockouts.
-- Used by the `auth-gateway` Edge Function (supabase/functions/auth-gateway).
--
-- ADDITIVE ONLY. Nothing here changes how the app works today:
--   * new tables in the private schema (not exposed through the API),
--   * new functions that only the service role (the Edge Function) can call,
--   * the service role is explicitly allowed to call the existing sign-in helper functions.
-- Run in Supabase Dashboard -> SQL Editor (or `supabase db push`). Safe to run more than once.
--
-- The lock-down step that stops the browser calling the old helper functions lives in
-- supabase/manual/auth_lockdown.sql. Run it LAST, after the gateway is deployed and the new app
-- version is out (see docs/AUTH-SECURITY.md).
--
-- Keys are HMAC hashes made by the Edge Function, so no raw IP address, email or username is
-- stored here.
-- =====================================================================

create schema if not exists private;

-- ------------------------------------------------ fixed-window request counters
create table if not exists private.auth_rate_limits (
  key          text primary key check (char_length(key) <= 160),
  window_start timestamptz not null default now(),
  hits         integer     not null default 0
);
alter table private.auth_rate_limits enable row level security;
revoke all on private.auth_rate_limits from public, anon, authenticated;

-- ------------------------------------------------ failed-attempt counters with lockout
create table if not exists private.auth_lockouts (
  key          text primary key check (char_length(key) <= 160),
  fails        integer     not null default 0,
  first_fail   timestamptz not null default now(),
  locked_until timestamptz,
  updated_at   timestamptz not null default now()
);
alter table private.auth_lockouts enable row level security;
revoke all on private.auth_lockouts from public, anon, authenticated;

-- Count one request for `p_key`. Returns allowed=false (and how many seconds to wait) once more
-- than `p_limit` requests arrive within `p_window_seconds`. The check and the count are one
-- atomic statement, so parallel requests cannot slip past the limit.
create or replace function public.auth_gw_rate_hit(p_key text, p_limit integer, p_window_seconds integer)
returns table (allowed boolean, retry_after integer)
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_start timestamptz;
  v_hits  integer;
begin
  if p_key is null or char_length(p_key) not between 1 and 160
     or p_limit is null or p_limit < 1
     or p_window_seconds is null or p_window_seconds not between 1 and 86400 then
    raise exception 'invalid rate limit arguments';
  end if;

  insert into private.auth_rate_limits as r (key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (key) do update
    set window_start = case when r.window_start <= now() - make_interval(secs => p_window_seconds)
                            then now() else r.window_start end,
        hits         = case when r.window_start <= now() - make_interval(secs => p_window_seconds)
                            then 1 else r.hits + 1 end
  returning r.window_start, r.hits into v_start, v_hits;

  allowed := v_hits <= p_limit;
  retry_after := case when allowed then 0
                      else greatest(1, ceil(extract(epoch from
                             (v_start + make_interval(secs => p_window_seconds) - now())))::integer) end;
  return next;
end $$;

-- Is this key locked right now?
create or replace function public.auth_gw_lock_status(p_key text)
returns table (locked boolean, retry_after integer)
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare v_until timestamptz;
begin
  select l.locked_until into v_until from private.auth_lockouts l where l.key = p_key;
  locked := v_until is not null and v_until > now();
  retry_after := case when locked then greatest(1, ceil(extract(epoch from (v_until - now())))::integer) else 0 end;
  return next;
end $$;

-- Record one failed attempt. After `p_threshold` failures inside `p_window_seconds` the key is
-- locked for p_base_seconds, doubling with every further failure up to p_max_seconds.
create or replace function public.auth_gw_lock_fail(
  p_key text, p_threshold integer, p_base_seconds integer, p_max_seconds integer, p_window_seconds integer)
returns table (locked boolean, retry_after integer)
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_fails integer;
  v_secs  integer;
  v_until timestamptz;
begin
  if p_key is null or char_length(p_key) not between 1 and 160
     or p_threshold is null or p_threshold < 1
     or p_base_seconds is null or p_base_seconds < 1
     or p_max_seconds is null or p_max_seconds < p_base_seconds
     or p_window_seconds is null or p_window_seconds not between 1 and 86400 then
    raise exception 'invalid lockout arguments';
  end if;

  insert into private.auth_lockouts as l (key, fails, first_fail, updated_at)
  values (p_key, 1, now(), now())
  on conflict (key) do update
    set fails      = case when l.first_fail <= now() - make_interval(secs => p_window_seconds)
                          then 1 else l.fails + 1 end,
        first_fail = case when l.first_fail <= now() - make_interval(secs => p_window_seconds)
                          then now() else l.first_fail end,
        updated_at = now()
  returning l.fails into v_fails;

  if v_fails >= p_threshold then
    v_secs := least(p_max_seconds::numeric, p_base_seconds * power(2, least(v_fails - p_threshold, 20)))::integer;
    v_until := now() + make_interval(secs => v_secs);
    update private.auth_lockouts set locked_until = v_until where key = p_key;
    locked := true;
    retry_after := v_secs;
  else
    locked := false;
    retry_after := 0;
  end if;
  return next;
end $$;

-- A good attempt clears the failures.
create or replace function public.auth_gw_lock_clear(p_key text)
returns void
language sql
security definer
set search_path = public, private, pg_temp
as $$ delete from private.auth_lockouts where key = p_key $$;

-- Housekeeping. Not scheduled by this migration; run it by hand now and then, or schedule it
-- with pg_cron if you use it:  select public.auth_gw_cleanup();
create or replace function public.auth_gw_cleanup()
returns integer
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare a integer; b integer;
begin
  delete from private.auth_rate_limits where window_start < now() - interval '1 day';
  get diagnostics a = row_count;
  delete from private.auth_lockouts
   where updated_at < now() - interval '1 day' and (locked_until is null or locked_until < now());
  get diagnostics b = row_count;
  return a + b;
end $$;

-- Only the service role (the Edge Function) may call these.
revoke all on function public.auth_gw_rate_hit(text, integer, integer)               from public, anon, authenticated;
revoke all on function public.auth_gw_lock_status(text)                              from public, anon, authenticated;
revoke all on function public.auth_gw_lock_fail(text, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.auth_gw_lock_clear(text)                               from public, anon, authenticated;
revoke all on function public.auth_gw_cleanup()                                      from public, anon, authenticated;
grant execute on function public.auth_gw_rate_hit(text, integer, integer)               to service_role;
grant execute on function public.auth_gw_lock_status(text)                              to service_role;
grant execute on function public.auth_gw_lock_fail(text, integer, integer, integer, integer) to service_role;
grant execute on function public.auth_gw_lock_clear(text)                               to service_role;
grant execute on function public.auth_gw_cleanup()                                      to service_role;
grant usage on schema private to service_role;

-- The gateway looks accounts up with the existing helper functions. Make sure the service role may
-- keep calling them once the browser no longer can (see supabase/manual/auth_lockdown.sql).
grant execute on function public.get_login_email(text)           to service_role;
grant execute on function public.get_reset_emails(text)          to service_role;
grant execute on function public.plan_signup_email(text, text)   to service_role;
grant execute on function public.is_username_available(text)     to service_role;
