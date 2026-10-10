-- =====================================================================
-- Ediraa: auth profiles, follows, avatar storage
-- Run in Supabase Dashboard -> SQL Editor (or `supabase db push`).
-- Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. profiles
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  full_name            text        not null default '',
  username             text        not null unique,
  bio                  text,
  location             text,
  avatar_url           text,
  interests            text[]      not null default '{}',
  account_type         text        not null default 'personal'
                         check (account_type in ('personal', 'business')),
  onboarding_completed boolean     not null default false,
  created_at           timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,20}$')
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
  on public.profiles for select to authenticated
  using (true);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert to authenticated
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ---------------------------------------------------------------------
-- 2. Auto-create a profile when a user signs up
--    - Email signup: reads full_name + username from signup metadata.
--    - Google / phone signup (no username supplied): generates a unique one.
-- ---------------------------------------------------------------------
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
  end if;

  insert into public.profiles (id, full_name, username, avatar_url)
  values (new.id, v_name, v_username, v_avatar);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 3. Helper functions callable BEFORE login
--    (profiles is not readable by anonymous visitors, so these expose
--     only the minimum needed.)
-- ---------------------------------------------------------------------

-- Live "is this username free?" check on the sign-up form.
create or replace function public.is_username_available(p_username text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select not exists (select 1 from public.profiles where username = lower(p_username));
$$;

-- Lets people log in with their username: returns the email for a username.
create or replace function public.get_login_email(p_username text)
returns text
language sql
security definer
stable
set search_path = public, auth
as $$
  select u.email::text
  from auth.users u
  join public.profiles p on p.id = u.id
  where p.username = lower(p_username)
  limit 1;
$$;

revoke all on function public.is_username_available(text) from public;
revoke all on function public.get_login_email(text)       from public;
grant execute on function public.is_username_available(text) to anon, authenticated;
grant execute on function public.get_login_email(text)       to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. follows
-- ---------------------------------------------------------------------
create table if not exists public.follows (
  follower_id  uuid        not null references public.profiles (id) on delete cascade,
  following_id uuid        not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_no_self_follow check (follower_id <> following_id)
);

create index if not exists follows_following_id_idx on public.follows (following_id);

alter table public.follows enable row level security;

drop policy if exists "follows_select_authenticated" on public.follows;
create policy "follows_select_authenticated"
  on public.follows for select to authenticated
  using (true);

drop policy if exists "follows_insert_own" on public.follows;
create policy "follows_insert_own"
  on public.follows for insert to authenticated
  with check (follower_id = auth.uid());

drop policy if exists "follows_delete_own" on public.follows;
create policy "follows_delete_own"
  on public.follows for delete to authenticated
  using (follower_id = auth.uid());

-- ---------------------------------------------------------------------
-- 5. Storage: public "avatars" bucket
--    Files must live in a folder named after the user's id: <uid>/avatar.png
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public             = true,
      file_size_limit    = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "avatars_insert_own_folder" on storage.objects;
create policy "avatars_insert_own_folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_update_own_folder" on storage.objects;
create policy "avatars_update_own_folder"
  on storage.objects for update to authenticated
  using      (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_delete_own_folder" on storage.objects;
create policy "avatars_delete_own_folder"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
