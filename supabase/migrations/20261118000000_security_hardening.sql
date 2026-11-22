-- Security hardening (audit 2026-11-18). Additive and safe to apply on its own: no existing app
-- feature depends on anything this removes. The one breaking step (taking the username -> email
-- lookups away from signed-out visitors) is deliberately a SEPARATE file,
-- 20261118000001_revoke_email_lookup.sql, to be applied last. See docs/SECURITY-PATCH.md.
--
-- Contents
--   1. profiles: clients can no longer rewrite id / created_at (referral window bypass)
--   2. storage: nobody can LIST other people's files any more (public SELECT policies dropped);
--      chat-media gets a file-type allow-list
--   3. function EXECUTE: signed-out visitors keep only the three RPCs the sign-up page needs
--   4. table grants: the signed-out role has no table access (RLS already denied it; now it
--      also has no privilege to fall back on if a policy is ever written wrongly)
--   5. server-side throttle used by the auth-lookup edge function

-- ------------------------------------------------------------------ 1. profiles system columns
-- profiles_update_own lets a person update their own row, which included created_at. The referral
-- rule "accounts older than 7 days cannot claim" reads created_at, so anyone could reset their own
-- clock. Clients (anon / authenticated) keep whatever the stored value is; SECURITY DEFINER
-- functions, the service role and migrations are not affected.
create or replace function public.profiles_protect_system_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.id := old.id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_system_columns on public.profiles;
create trigger profiles_protect_system_columns
  before update on public.profiles
  for each row execute function public.profiles_protect_system_columns();

-- ------------------------------------------------------------------ 2. storage
-- The "<bucket>_public_read" policies let ANYONE (even without logging in, using the public anon
-- key that ships inside the app) call the storage LIST API and enumerate every file in the bucket:
-- all direct-message photos and files (chat-media) and all voice notes (voice) included.
-- Public buckets serve their files by URL without consulting this policy, so removing it does not
-- break any image or video in the app. Each person keeps read access to their own folder, which
-- is what upload(upsert), remove() and account deletion (list own folder) need.
drop policy if exists avatars_public_read on storage.objects;
drop policy if exists chat_media_public_read on storage.objects;
drop policy if exists media_public_read on storage.objects;
drop policy if exists videos_public_read on storage.objects;
drop policy if exists voice_public_read on storage.objects;

drop policy if exists avatars_select_own_folder on storage.objects;
create policy avatars_select_own_folder on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists chat_media_select_own_folder on storage.objects;
create policy chat_media_select_own_folder on storage.objects for select to authenticated
  using (bucket_id = 'chat-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists media_select_own_folder on storage.objects;
create policy media_select_own_folder on storage.objects for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists videos_select_own_folder on storage.objects;
create policy videos_select_own_folder on storage.objects for select to authenticated
  using (bucket_id = 'videos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists voice_select_own_folder on storage.objects;
create policy voice_select_own_folder on storage.objects for select to authenticated
  using (bucket_id = 'voice' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- chat-media had a size limit but accepted any file type (HTML, SVG, scripts) on your Supabase
-- domain. Allow the kinds of file the chat actually sends. SVG and HTML are intentionally absent.
update storage.buckets
   set allowed_mime_types = array[
     'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/avif',
     'video/mp4', 'video/webm', 'video/quicktime',
     'audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/ogg', 'audio/wav', 'audio/aac', 'audio/x-m4a',
     'application/pdf', 'application/msword',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.ms-excel',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     'application/vnd.ms-powerpoint',
     'application/vnd.openxmlformats-officedocument.presentationml.presentation',
     'text/plain', 'text/csv', 'text/markdown', 'application/rtf', 'text/rtf', 'application/json',
     'application/zip', 'application/x-zip-compressed', 'application/vnd.rar',
     'application/x-rar-compressed'
   ]
 where id = 'chat-media';

-- ------------------------------------------------------------------ 3. function EXECUTE
-- Postgres gives every new function to PUBLIC, and Supabase also grants it to anon. Earlier
-- migrations remembered to revoke that on most functions but not all (24 were still callable by
-- a signed-out visitor, trigger functions included). Reset every function in the public schema:
--   * signed-out visitors keep ONLY what the sign-up / invite pages call
--   * signed-in users and the service role keep EXACTLY the access they had (never more)
--   * trigger functions are callable by nobody (triggers still fire; they do not check EXECUTE)
-- The two username -> email lookups are left alone here and handled in the next migration, so the
-- app keeps working until the replacement edge function is deployed.
do $$
declare
  r record;
  anon_ok constant text[] := array['get_referrer', 'is_username_available', 'plan_signup_email'];
  later   constant text[] := array['get_login_email', 'get_reset_emails'];
begin
  for r in
    select p.oid, p.oid::regprocedure as sig, p.proname, p.prorettype = 'trigger'::regtype as is_trigger,
           -- remember who can call it TODAY; some helpers (can_view_post, blocked_between,
           -- is_profile_visible_for) are deliberately NOT callable by signed-in users because they
           -- take arbitrary user ids. Never widen that.
           has_function_privilege('authenticated', p.oid, 'execute') as auth_had,
           has_function_privilege('service_role', p.oid, 'execute') as service_had
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind in ('f', 'p')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    continue when r.proname = any (later);
    execute format('revoke execute on function %s from public, anon', r.sig);
    if r.is_trigger then
      execute format('revoke execute on function %s from authenticated, service_role', r.sig);
    else
      -- re-grant explicitly only what existed (revoking PUBLIC must not lock anyone out)
      if r.auth_had then execute format('grant execute on function %s to authenticated', r.sig); end if;
      if r.service_had then execute format('grant execute on function %s to service_role', r.sig); end if;
      if r.proname = any (anon_ok) then
        execute format('grant execute on function %s to anon', r.sig);
      end if;
    end if;
  end loop;
end $$;

-- Nothing in the app calls get_login_emails (email -> account emails). It only helps someone who
-- is probing which emails are registered, so no client role needs it.
revoke execute on function public.get_login_emails(text) from public, anon, authenticated;
grant  execute on function public.get_login_emails(text) to service_role;

-- Functions created from now on are not callable by signed-out visitors unless a migration says so.
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges revoke execute on functions from public;

-- ------------------------------------------------------------------ 4. table grants
-- Every table already has RLS and every policy is "to authenticated", so the signed-out role could
-- read nothing. It still held SELECT/INSERT/UPDATE/DELETE grants on all of them (Supabase's
-- default), leaving RLS as the only wall. Take the grants away as a second wall.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- ------------------------------------------------------------------ 5. auth throttle
-- Used by the auth-lookup edge function (service role only) to slow down password guessing and
-- reset-email spam. Lives in the private schema, which the API does not expose.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.auth_throttle (
  key text not null,
  at  timestamptz not null default now()
);
create index if not exists auth_throttle_key_at_idx on private.auth_throttle (key, at desc);
alter table private.auth_throttle enable row level security;
revoke all on private.auth_throttle from public, anon, authenticated;

-- true  = allowed (and counted); false = over the limit, the caller should refuse.
create or replace function public.auth_throttle_hit(p_key text, p_max integer, p_window interval)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_count integer;
begin
  if coalesce(p_key, '') = '' or p_max < 1 then
    return false;
  end if;
  delete from private.auth_throttle where key = p_key and at < now() - p_window;
  select count(*) into v_count from private.auth_throttle where key = p_key;
  if v_count >= p_max then
    return false;
  end if;
  insert into private.auth_throttle (key) values (p_key);
  -- housekeeping: keep the table small without needing a cron job
  if random() < 0.02 then
    delete from private.auth_throttle where at < now() - interval '1 day';
  end if;
  return true;
end;
$$;
revoke all on function public.auth_throttle_hit(text, integer, interval) from public, anon, authenticated;
grant execute on function public.auth_throttle_hit(text, integer, interval) to service_role;
