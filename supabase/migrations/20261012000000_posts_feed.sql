-- =====================================================================
-- Ediraa: posts, likes, comments, stories, media storage, feed RPCs
-- Run in Supabase Dashboard -> SQL Editor (or `supabase db push`)
-- AFTER 20261011000000_auth_profiles_follows.sql. Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. profiles: remember when the user last opened Notifications
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists notifications_seen_at timestamptz not null default now();

-- ---------------------------------------------------------------------
-- 1. posts
-- ---------------------------------------------------------------------
create table if not exists public.posts (
  id         uuid        primary key default gen_random_uuid(),
  author_id  uuid        not null references public.profiles (id) on delete cascade,
  content    text        not null default '',
  image_url  text,
  audience   text        not null default 'Public'
               check (audience in ('Public', 'Friends', 'Local Community')),
  created_at timestamptz not null default now(),
  constraint posts_content_length check (char_length(content) <= 500),
  constraint posts_not_empty check (char_length(btrim(content)) > 0 or image_url is not null)
);

create index if not exists posts_created_at_idx on public.posts (created_at desc);
create index if not exists posts_author_created_idx on public.posts (author_id, created_at desc);

alter table public.posts enable row level security;

-- Who can see a post:
--   Public           -> every logged-in user
--   Friends          -> the author and people who follow each other with the author
--   Local Community  -> the author and users whose profile location matches the author's
drop policy if exists "posts_select_visible" on public.posts;
create policy "posts_select_visible"
  on public.posts for select to authenticated
  using (
    author_id = auth.uid()
    or audience = 'Public'
    or (
      audience = 'Friends'
      and exists (select 1 from public.follows f
                  where f.follower_id = auth.uid() and f.following_id = posts.author_id)
      and exists (select 1 from public.follows f
                  where f.follower_id = posts.author_id and f.following_id = auth.uid())
    )
    or (
      audience = 'Local Community'
      and exists (select 1
                  from public.profiles me, public.profiles au
                  where me.id = auth.uid() and au.id = posts.author_id
                    and me.location is not null
                    and lower(btrim(me.location)) = lower(btrim(au.location)))
    )
  );

drop policy if exists "posts_insert_own" on public.posts;
create policy "posts_insert_own"
  on public.posts for insert to authenticated
  with check (author_id = auth.uid());

drop policy if exists "posts_delete_own" on public.posts;
create policy "posts_delete_own"
  on public.posts for delete to authenticated
  using (author_id = auth.uid());

-- ---------------------------------------------------------------------
-- 2. post_likes
-- ---------------------------------------------------------------------
create table if not exists public.post_likes (
  post_id    uuid        not null references public.posts (id) on delete cascade,
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists post_likes_user_idx on public.post_likes (user_id);

alter table public.post_likes enable row level security;

-- Sub-selects on posts are filtered by the posts policy above, so likes on
-- posts you cannot see are invisible too.
drop policy if exists "post_likes_select_visible" on public.post_likes;
create policy "post_likes_select_visible"
  on public.post_likes for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_likes.post_id));

drop policy if exists "post_likes_insert_own" on public.post_likes;
create policy "post_likes_insert_own"
  on public.post_likes for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.posts p where p.id = post_likes.post_id)
  );

drop policy if exists "post_likes_delete_own" on public.post_likes;
create policy "post_likes_delete_own"
  on public.post_likes for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 3. post_comments
-- ---------------------------------------------------------------------
create table if not exists public.post_comments (
  id         uuid        primary key default gen_random_uuid(),
  post_id    uuid        not null references public.posts (id) on delete cascade,
  author_id  uuid        not null references public.profiles (id) on delete cascade,
  content    text        not null,
  created_at timestamptz not null default now(),
  constraint post_comments_content_length
    check (char_length(btrim(content)) between 1 and 300)
);

create index if not exists post_comments_post_idx on public.post_comments (post_id, created_at);

alter table public.post_comments enable row level security;

drop policy if exists "post_comments_select_visible" on public.post_comments;
create policy "post_comments_select_visible"
  on public.post_comments for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_comments.post_id));

drop policy if exists "post_comments_insert_own" on public.post_comments;
create policy "post_comments_insert_own"
  on public.post_comments for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (select 1 from public.posts p where p.id = post_comments.post_id)
  );

drop policy if exists "post_comments_delete_own" on public.post_comments;
create policy "post_comments_delete_own"
  on public.post_comments for delete to authenticated
  using (author_id = auth.uid());

-- ---------------------------------------------------------------------
-- 4. stories (visible for 24 hours, to yourself and the people who follow you)
-- ---------------------------------------------------------------------
create table if not exists public.stories (
  id         uuid        primary key default gen_random_uuid(),
  author_id  uuid        not null references public.profiles (id) on delete cascade,
  image_url  text        not null,
  created_at timestamptz not null default now()
);

create index if not exists stories_author_created_idx on public.stories (author_id, created_at desc);

alter table public.stories enable row level security;

drop policy if exists "stories_select_active" on public.stories;
create policy "stories_select_active"
  on public.stories for select to authenticated
  using (
    created_at > now() - interval '24 hours'
    and (
      author_id = auth.uid()
      or exists (select 1 from public.follows f
                 where f.follower_id = auth.uid() and f.following_id = stories.author_id)
    )
  );

drop policy if exists "stories_insert_own" on public.stories;
create policy "stories_insert_own"
  on public.stories for insert to authenticated
  with check (author_id = auth.uid());

drop policy if exists "stories_delete_own" on public.stories;
create policy "stories_delete_own"
  on public.stories for delete to authenticated
  using (author_id = auth.uid());

-- ---------------------------------------------------------------------
-- 5. Storage: public "media" bucket for post + story images
--    Files must live under <uid>/...  e.g. <uid>/posts/<uuid>.jpg
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public             = true,
      file_size_limit    = 10485760,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

drop policy if exists "media_public_read" on storage.objects;
create policy "media_public_read"
  on storage.objects for select
  using (bucket_id = 'media');

drop policy if exists "media_insert_own_folder" on storage.objects;
create policy "media_insert_own_folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "media_delete_own_folder" on storage.objects;
create policy "media_delete_own_folder"
  on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- 6. RPC: the home feed (one query: posts + author + counts + "did I like it")
--    SECURITY INVOKER (default) => the posts RLS policy decides what is returned.
--    p_tab: for_you | following | local | business
-- ---------------------------------------------------------------------
create or replace function public.get_feed(
  p_tab    text        default 'for_you',
  p_search text        default null,
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
  liked_by_me         boolean
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
    exists (select 1 from public.post_likes l where l.post_id = p.id and l.user_id = auth.uid())
  from public.posts p
  join public.profiles a on a.id = p.author_id
  where (p_before is null or p.created_at < p_before)
    and (
      p_search is null or btrim(p_search) = ''
      or p.content ilike '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%'
    )
    and case lower(coalesce(p_tab, 'for_you'))
      when 'following' then
        p.author_id = auth.uid()
        or exists (select 1 from public.follows f
                   where f.follower_id = auth.uid() and f.following_id = p.author_id)
      when 'local' then
        exists (select 1 from public.profiles me
                where me.id = auth.uid() and me.location is not null
                  and lower(btrim(me.location)) = lower(btrim(a.location)))
      when 'business' then
        a.account_type = 'business'
      else true
    end
  order by p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

-- ---------------------------------------------------------------------
-- 7. RPC: people (suggestions + Discover search)
--    mutual_count = people YOU follow who also follow that person
-- ---------------------------------------------------------------------
create or replace function public.get_people(
  p_query            text    default null,
  p_business_only    boolean default false,
  p_exclude_followed boolean default false,
  p_limit            int     default 20
)
returns table (
  id            uuid,
  full_name     text,
  username      text,
  avatar_url    text,
  account_type  text,
  mutual_count  bigint,
  is_following  boolean
)
language sql
stable
set search_path = public
as $$
  select
    p.id, p.full_name, p.username, p.avatar_url, p.account_type,
    (select count(*)
       from public.follows mine
       join public.follows theirs
         on theirs.follower_id = mine.following_id and theirs.following_id = p.id
      where mine.follower_id = auth.uid()),
    exists (select 1 from public.follows f
            where f.follower_id = auth.uid() and f.following_id = p.id)
  from public.profiles p
  where p.id <> auth.uid()
    and p.onboarding_completed
    and (not p_business_only or p.account_type = 'business')
    and (not p_exclude_followed or not exists (
          select 1 from public.follows f
          where f.follower_id = auth.uid() and f.following_id = p.id))
    and (
      p_query is null or btrim(p_query) = ''
      or p.full_name ilike '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
      or p.username  ilike '%' || replace(replace(replace(ltrim(btrim(p_query), '@'), '\', '\\'), '%', '\%'), '_', '\_') || '%'
    )
  order by 6 desc, p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

-- ---------------------------------------------------------------------
-- 8. RPC: trending hashtags (last 7 days, only from posts you can see)
-- ---------------------------------------------------------------------
create or replace function public.get_trending_topics(p_limit int default 8)
returns table (tag text, uses bigint)
language sql
stable
set search_path = public
as $$
  select lower(m[1]) as tag, count(distinct p.id) as uses
  from public.posts p,
       lateral regexp_matches(p.content, '#([A-Za-z0-9_]+)', 'g') as m
  where p.created_at > now() - interval '7 days'
  group by 1
  order by 2 desc, 1
  limit greatest(1, least(coalesce(p_limit, 8), 30));
$$;

-- ---------------------------------------------------------------------
-- 9. RPC: notifications, derived from likes / comments / follows on YOU
-- ---------------------------------------------------------------------
create or replace function public.get_notifications(p_limit int default 30)
returns table (
  kind            text,
  actor_id        uuid,
  actor_name      text,
  actor_username  text,
  actor_avatar    text,
  post_id         uuid,
  snippet         text,
  created_at      timestamptz,
  i_follow_actor  boolean
)
language sql
stable
set search_path = public
as $$
  with n as (
    select 'like'::text as kind, l.user_id as actor_id, l.post_id,
           left(p.content, 80) as snippet, l.created_at
    from public.post_likes l
    join public.posts p on p.id = l.post_id
    where p.author_id = auth.uid() and l.user_id <> auth.uid()
    union all
    select 'comment', c.author_id, c.post_id, left(c.content, 120), c.created_at
    from public.post_comments c
    join public.posts p on p.id = c.post_id
    where p.author_id = auth.uid() and c.author_id <> auth.uid()
    union all
    select 'follow', f.follower_id, null::uuid, null::text, f.created_at
    from public.follows f
    where f.following_id = auth.uid()
  )
  select
    n.kind, n.actor_id, a.full_name, a.username, a.avatar_url,
    n.post_id, n.snippet, n.created_at,
    exists (select 1 from public.follows f
            where f.follower_id = auth.uid() and f.following_id = n.actor_id)
  from n
  join public.profiles a on a.id = n.actor_id
  order by n.created_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;

create or replace function public.get_unread_notification_count()
returns bigint
language sql
stable
set search_path = public
as $$
  select count(*)
  from public.get_notifications(200) n
  where n.created_at > (select pr.notifications_seen_at from public.profiles pr where pr.id = auth.uid());
$$;

-- ---------------------------------------------------------------------
-- 10. Only logged-in users may call the RPCs
-- ---------------------------------------------------------------------
revoke all on function public.get_feed(text, text, int, timestamptz)       from public;
revoke all on function public.get_people(text, boolean, boolean, int)      from public;
revoke all on function public.get_trending_topics(int)                     from public;
revoke all on function public.get_notifications(int)                       from public;
revoke all on function public.get_unread_notification_count()              from public;

grant execute on function public.get_feed(text, text, int, timestamptz)    to authenticated;
grant execute on function public.get_people(text, boolean, boolean, int)   to authenticated;
grant execute on function public.get_trending_topics(int)                  to authenticated;
grant execute on function public.get_notifications(int)                    to authenticated;
grant execute on function public.get_unread_notification_count()           to authenticated;
