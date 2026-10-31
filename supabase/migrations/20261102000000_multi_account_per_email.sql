-- =====================================================================
-- Gicco chat: allow up to 3 accounts (different usernames) per email.
-- Run in Supabase Dashboard -> SQL Editor (or `supabase db push`).
-- Safe to run more than once. Does NOT change existing accounts/logins.
--
-- How it works: Supabase Auth allows only ONE auth user per email, so the
-- 2nd and 3rd account for the same mailbox are created with an inbox alias
-- (you+username@gmail.com). Mail still lands in the same inbox. The real
-- mailbox is remembered in a private table so we can enforce "max 3".
-- Usernames stay globally unique (profiles.username UNIQUE).
-- =====================================================================

-- 1. Private table: which real mailbox each account belongs to.
--    RLS on + no policies = invisible to the app, only the functions below read it.
create table if not exists public.account_emails (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  contact_email text not null,
  created_at    timestamptz not null default now()
);
create index if not exists account_emails_contact_idx on public.account_emails (contact_email);
alter table public.account_emails enable row level security;
revoke all on public.account_emails from anon, authenticated;

-- 2. Normalise an email to its real mailbox:
--    lowercase, drop "+tag", and for Gmail ignore dots (a.b == ab).
create or replace function public.normalize_contact_email(p_email text)
returns text
language plpgsql
immutable
as $$
declare
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_local  text;
  v_domain text;
begin
  if position('@' in v_email) = 0 then
    return v_email;
  end if;
  v_local  := split_part(v_email, '@', 1);
  v_domain := split_part(v_email, '@', 2);
  v_local  := split_part(v_local, '+', 1);
  if v_domain in ('gmail.com', 'googlemail.com') then
    v_local  := replace(v_local, '.', '');
    v_domain := 'gmail.com';
  end if;
  return v_local || '@' || v_domain;
end;
$$;

-- 3. Backfill existing accounts (their email is their real mailbox).
insert into public.account_emails (user_id, contact_email)
select u.id, public.normalize_contact_email(u.email)
from auth.users u
where u.email is not null
on conflict (user_id) do nothing;

-- 4. Profile auto-creation: now also records the real mailbox and enforces the
--    limit of 3 verified accounts per mailbox (backstop for the app-side check).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
  v_name     text;
  v_base     text;
  v_avatar   text;
  v_contact  text;
begin
  v_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    ''
  );
  v_avatar := coalesce(
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    nullif(new.raw_user_meta_data ->> 'picture', '')
  );
  v_username := lower(nullif(new.raw_user_meta_data ->> 'username', ''));

  if v_username is not null then
    if v_username !~ '^[a-z0-9_]{3,20}$' then
      raise exception 'invalid_username';
    end if;
    if exists (select 1 from public.profiles where username = v_username) then
      raise exception 'username_taken';
    end if;

    v_contact := public.normalize_contact_email(
      coalesce(nullif(new.raw_user_meta_data ->> 'contact_email', ''), new.email)
    );
    if v_contact <> '' and (
      select count(*)
      from public.account_emails a
      join auth.users u on u.id = a.user_id
      where a.contact_email = v_contact and u.email_confirmed_at is not null
    ) >= 3 then
      raise exception 'email_limit';
    end if;
  else
    v_base := regexp_replace(lower(split_part(coalesce(new.email, ''), '@', 1)), '[^a-z0-9_]', '', 'g');
    if length(v_base) < 3 then
      v_base := 'user';
    end if;
    v_base := left(v_base, 12);
    loop
      v_username := v_base || '_' || substr(md5(random()::text || clock_timestamp()::text), 1, 5);
      exit when not exists (select 1 from public.profiles where username = v_username);
    end loop;
    v_contact := public.normalize_contact_email(new.email);
  end if;

  insert into public.profiles (id, full_name, username, avatar_url)
  values (new.id, v_name, v_username, v_avatar);

  if coalesce(v_contact, '') <> '' then
    insert into public.account_emails (user_id, contact_email)
    values (new.id, v_contact)
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

-- 5. Sign-up planner: decides which auth email to use and rejects bad cases
--    BEFORE any account is created. Returns jsonb:
--      { ok: true,  auth_email: "..." }
--      { ok: false, reason: invalid_username | username_taken | invalid_email
--                           | limit_reached | unsupported_domain }
create or replace function public.plan_signup_email(p_email text, p_username text)
returns jsonb
language plpgsql
security definer
stable
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

-- 6. Log-in by email: every auth email that belongs to this mailbox (oldest first).
create or replace function public.get_login_emails(p_email text)
returns text[]
language sql
security definer
stable
set search_path = public, auth
as $$
  select coalesce(array_agg(u.email::text order by u.created_at), '{}')
  from public.account_emails a
  join auth.users u on u.id = a.user_id
  where a.contact_email = public.normalize_contact_email(p_email)
    and u.email is not null;
$$;

-- 7. Forgot password: email OR username -> the auth email(s) to send reset links to.
create or replace function public.get_reset_emails(p_identifier text)
returns text[]
language plpgsql
security definer
stable
set search_path = public, auth
as $$
declare
  v_id text := lower(btrim(coalesce(p_identifier, '')));
  v_out text[];
begin
  if left(v_id, 1) = '@' and position('@' in substr(v_id, 2)) = 0 then
    v_id := substr(v_id, 2);
  end if;

  if position('@' in v_id) > 0 then
    select coalesce(array_agg(distinct u.email::text), '{}') into v_out
    from auth.users u
    left join public.account_emails a on a.user_id = u.id
    where u.email is not null
      and (lower(u.email) = v_id or a.contact_email = public.normalize_contact_email(v_id));
  else
    select coalesce(array_agg(u.email::text), '{}') into v_out
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.username = v_id and u.email is not null;
  end if;
  return v_out;
end;
$$;

revoke all on function public.plan_signup_email(text, text) from public;
revoke all on function public.get_login_emails(text)        from public;
revoke all on function public.get_reset_emails(text)        from public;
grant execute on function public.plan_signup_email(text, text) to anon, authenticated;
grant execute on function public.get_login_emails(text)        to anon, authenticated;
grant execute on function public.get_reset_emails(text)        to anon, authenticated;
