-- =====================================================================
-- Ediraa: saved posts + groups
-- Run in Supabase Dashboard -> SQL Editor (or `supabase db push`)
-- AFTER 20261012000000_posts_feed.sql. Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. saved_posts (private bookmarks)
-- ---------------------------------------------------------------------
create table if not exists public.saved_posts (
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  post_id    uuid        not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create index if not exists saved_posts_user_created_idx
  on public.saved_posts (user_id, created_at desc);

alter table public.saved_posts enable row level security;

drop policy if exists "saved_posts_select_own" on public.saved_posts;
create policy "saved_posts_select_own"
  on public.saved_posts for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "saved_posts_insert_own" on public.saved_posts;
create policy "saved_posts_insert_own"
  on public.saved_posts for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.posts p where p.id = saved_posts.post_id)
  );

drop policy if exists "saved_posts_delete_own" on public.saved_posts;
create policy "saved_posts_delete_own"
  on public.saved_posts for delete to authenticated
  using (user_id = auth.uid());

-- Saved posts, newest save first. Same row shape as get_feed.
-- SECURITY INVOKER => the posts policy still decides what you may see.
create or replace function public.get_saved_posts(
  p_limit  int         default 10,
  p_before timestamptz default null
)
returns table (
  id                  uuid,
  author_id           uuid,
  content             text,
  image_url           text,
  audience            text,
  created_at          timestamptz,
  author_name         text,
  author_username     text,
  author_avatar       text,
  author_account_type text,
  like_count          bigint,
  comment_count       bigint,
  liked_by_me         boolean,
  saved_at            timestamptz
)
language sql
stable
set search_path = public
as $$
  select
    p.id, p.author_id, p.content, p.image_url, p.audience, p.created_at,
    a.full_name, a.username, a.avatar_url, a.account_type,
    (select count(*) from public.post_likes l where l.post_id = p.id),
    (select count(*) from public.post_comments c where c.post_id = p.id),
    exists (select 1 from public.post_likes l where l.post_id = p.id and l.user_id = auth.uid()),
    s.created_at
  from public.saved_posts s
  join public.posts p    on p.id = s.post_id
  join public.profiles a on a.id = p.author_id
  where s.user_id = auth.uid()
    and (p_before is null or s.created_at < p_before)
  order by s.created_at desc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

-- ---------------------------------------------------------------------
-- 2. groups + members
-- ---------------------------------------------------------------------
create table if not exists public.groups (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  description text        not null default '',
  created_by  uuid        not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint groups_name_length check (char_length(btrim(name)) between 3 and 50),
  constraint groups_description_length check (char_length(description) <= 300)
);

create index if not exists groups_created_at_idx on public.groups (created_at desc);

create table if not exists public.group_members (
  group_id   uuid        not null references public.groups (id) on delete cascade,
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  role       text        not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists group_members_user_idx on public.group_members (user_id);

alter table public.groups enable row level security;
alter table public.group_members enable row level security;

drop policy if exists "groups_select_authenticated" on public.groups;
create policy "groups_select_authenticated"
  on public.groups for select to authenticated
  using (true);

-- Groups are created through create_group() below (it also adds the creator as admin).
drop policy if exists "groups_delete_creator" on public.groups;
create policy "groups_delete_creator"
  on public.groups for delete to authenticated
  using (created_by = auth.uid());

drop policy if exists "group_members_select_authenticated" on public.group_members;
create policy "group_members_select_authenticated"
  on public.group_members for select to authenticated
  using (true);

-- You can only add YOURSELF, and only as a normal member.
drop policy if exists "group_members_join_self" on public.group_members;
create policy "group_members_join_self"
  on public.group_members for insert to authenticated
  with check (user_id = auth.uid() and role = 'member');

-- You can leave a group; the admin (creator) cannot leave, they delete the group instead.
drop policy if exists "group_members_leave_self" on public.group_members;
create policy "group_members_leave_self"
  on public.group_members for delete to authenticated
  using (user_id = auth.uid() and role = 'member');

-- Atomic "create group + become its admin".
create or replace function public.create_group(p_name text, p_description text default '')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  insert into public.groups (name, description, created_by)
  values (btrim(p_name), btrim(coalesce(p_description, '')), auth.uid())
  returning id into v_id;
  insert into public.group_members (group_id, user_id, role)
  values (v_id, auth.uid(), 'admin');
  return v_id;
end;
$$;

-- Browse / search groups, with member counts and "am I in it?".
create or replace function public.get_groups(
  p_query     text    default null,
  p_mine_only boolean default false,
  p_limit     int     default 30
)
returns table (
  id            uuid,
  name          text,
  description   text,
  created_by    uuid,
  created_at    timestamptz,
  member_count  bigint,
  is_member     boolean,
  my_role       text
)
language sql
stable
set search_path = public
as $$
  select
    g.id, g.name, g.description, g.created_by, g.created_at,
    (select count(*) from public.group_members m where m.group_id = g.id),
    exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = auth.uid()),
    (select m.role from public.group_members m where m.group_id = g.id and m.user_id = auth.uid())
  from public.groups g
  where (
      p_query is null or btrim(p_query) = ''
      or g.name ilike '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
    )
    and (
      not p_mine_only
      or exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = auth.uid())
    )
  order by 6 desc, g.created_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;

-- ---------------------------------------------------------------------
-- 3. Only logged-in users may call the new RPCs
-- ---------------------------------------------------------------------
revoke all on function public.get_saved_posts(int, timestamptz)     from public;
revoke all on function public.create_group(text, text)              from public;
revoke all on function public.get_groups(text, boolean, int)        from public;

grant execute on function public.get_saved_posts(int, timestamptz)  to authenticated;
grant execute on function public.create_group(text, text)           to authenticated;
grant execute on function public.get_groups(text, boolean, int)     to authenticated;
