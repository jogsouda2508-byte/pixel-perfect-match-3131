-- Minimal stand-in for the parts of Supabase our migrations rely on (roles, auth.users, auth.uid(),
-- storage, realtime publication, pg_net), so every migration can be replayed on plain Postgres in CI.
-- TEST-ONLY: never run this against a real Supabase project.
-- Minimal Supabase stub so the app's migrations can replay on vanilla Postgres.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_admin') then create role supabase_admin nologin; end if;
end $$;
grant anon, authenticated, service_role to postgres;
create schema auth; 
create table auth.users (id uuid primary key default gen_random_uuid(), email text, phone text, email_confirmed_at timestamptz default now(), phone_confirmed_at timestamptz,
  raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}', created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true),''), 'anon') $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb, created_at timestamptz default now());
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
create publication supabase_realtime;
create schema extensions; create schema net;
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 1000) returns bigint language sql as $$ select 1::bigint $$;
grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated;
-- Sessions + JWT helper (used by delete_my_account's "recent sign-in" check).
create table auth.sessions (id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade, created_at timestamptz default now());
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant execute on function auth.jwt() to anon, authenticated;
