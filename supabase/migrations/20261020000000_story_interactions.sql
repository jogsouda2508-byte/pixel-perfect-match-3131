-- =====================================================================
-- Gicco chat: story likes + story comments (with @mentions in notifications)
-- Run in Supabase Dashboard -> SQL Editor AFTER 20261019000000_story_videos_local_feed.sql.
-- Safe to run more than once.
--
--  * story_likes    : one heart per person per story. The story's author sees
--                     every like; everyone else only sees their own.
--  * story_comments : comments on a story, visible to everyone who can see the
--                     story (its author and the author's followers).
--  * Replies are private messages and reuse the existing chat tables.
--  * get_notifications gains 'story_like', 'story_comment' and 'story_mention'
--    (someone wrote @your_username in a story comment).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. story_likes
-- ---------------------------------------------------------------------
create table if not exists public.story_likes (
  story_id   uuid        not null references public.stories (id) on delete cascade,
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (story_id, user_id)
);

alter table public.story_likes enable row level security;

drop policy if exists "story_likes_select" on public.story_likes;
create policy "story_likes_select"
  on public.story_likes for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.stories s
               where s.id = story_likes.story_id and s.author_id = auth.uid())
  );

drop policy if exists "story_likes_insert_own" on public.story_likes;
create policy "story_likes_insert_own"
  on public.story_likes for insert to authenticated
  with check (
    user_id = auth.uid()
    -- stories RLS applies here, so you can only like a story you can see
    and exists (select 1 from public.stories s where s.id = story_likes.story_id)
  );

drop policy if exists "story_likes_delete_own" on public.story_likes;
create policy "story_likes_delete_own"
  on public.story_likes for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 2. story_comments
-- ---------------------------------------------------------------------
create table if not exists public.story_comments (
  id         uuid        primary key default gen_random_uuid(),
  story_id   uuid        not null references public.stories (id) on delete cascade,
  author_id  uuid        not null references public.profiles (id) on delete cascade,
  content    text        not null check (char_length(btrim(content)) between 1 and 300),
  created_at timestamptz not null default now()
);

create index if not exists story_comments_story_created_idx
  on public.story_comments (story_id, created_at);

alter table public.story_comments enable row level security;

drop policy if exists "story_comments_select" on public.story_comments;
create policy "story_comments_select"
  on public.story_comments for select to authenticated
  using (exists (select 1 from public.stories s where s.id = story_comments.story_id));

drop policy if exists "story_comments_insert_own" on public.story_comments;
create policy "story_comments_insert_own"
  on public.story_comments for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (select 1 from public.stories s where s.id = story_comments.story_id)
  );

-- you can delete your own comment; the story's author can delete any comment on it
drop policy if exists "story_comments_delete" on public.story_comments;
create policy "story_comments_delete"
  on public.story_comments for delete to authenticated
  using (
    author_id = auth.uid()
    or exists (select 1 from public.stories s
               where s.id = story_comments.story_id and s.author_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- 3. Notifications: story likes, story comments, @mentions
--    (same columns as before; post_id stays null for the story kinds)
-- ---------------------------------------------------------------------
drop function if exists public.get_notifications(int);

create function public.get_notifications(p_limit int default 30)
returns table (
  kind            text,
  actor_id        uuid,
  actor_name      text,
  actor_username  text,
  actor_avatar    text,
  post_id         uuid,
  snippet         text,
  created_at      timestamptz,
  i_follow_actor  boolean,
  conversation_id uuid
)
language sql
stable
set search_path = public
as $$
  with n as (
    select 'like'::text as kind, l.user_id as actor_id, l.post_id,
           left(p.content, 80) as snippet, l.created_at, null::uuid as conversation_id
    from public.post_likes l
    join public.posts p on p.id = l.post_id
    where p.author_id = auth.uid() and l.user_id <> auth.uid()
    union all
    select 'comment', c.author_id, c.post_id, left(c.content, 120), c.created_at, null::uuid
    from public.post_comments c
    join public.posts p on p.id = c.post_id
    where p.author_id = auth.uid() and c.author_id <> auth.uid()
    union all
    select 'follow', f.follower_id, null::uuid, null::text, f.created_at, null::uuid
    from public.follows f
    where f.following_id = auth.uid()
    union all
    -- posts/videos other people shared with me in chat
    select 'share', m.sender_id, m.shared_post_id,
           coalesce(sp.media_type, 'post'), m.created_at, m.conversation_id
    from public.messages m
    join public.conversation_participants cp
      on cp.conversation_id = m.conversation_id and cp.user_id = auth.uid()
    left join public.posts sp on sp.id = m.shared_post_id
    where m.shared_post_id is not null and m.sender_id <> auth.uid()
    union all
    -- someone liked my story
    select 'story_like', sl.user_id, null::uuid, null::text, sl.created_at, null::uuid
    from public.story_likes sl
    join public.stories s on s.id = sl.story_id
    where s.author_id = auth.uid() and sl.user_id <> auth.uid()
    union all
    -- someone commented on my story
    select 'story_comment', c.author_id, null::uuid, left(c.content, 120), c.created_at, null::uuid
    from public.story_comments c
    join public.stories s on s.id = c.story_id
    where s.author_id = auth.uid() and c.author_id <> auth.uid()
    union all
    -- someone wrote @my_username in a comment on another person's story
    select 'story_mention', c.author_id, null::uuid, left(c.content, 120), c.created_at, null::uuid
    from public.story_comments c
    join public.stories s on s.id = c.story_id
    join public.profiles me on me.id = auth.uid()
    where c.author_id <> auth.uid()
      and s.author_id <> auth.uid()
      -- usernames are [a-z0-9_] only, so no regex escaping is needed
      and lower(c.content) ~ ('(^|[^a-z0-9_])@' || me.username || '([^a-z0-9_]|$)')
  )
  select
    n.kind, n.actor_id, a.full_name, a.username, a.avatar_url,
    n.post_id, n.snippet, n.created_at,
    exists (select 1 from public.follows f
            where f.follower_id = auth.uid() and f.following_id = n.actor_id),
    n.conversation_id
  from n
  join public.profiles a on a.id = n.actor_id
  order by n.created_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;

revoke all on function public.get_notifications(int) from public, anon;
grant execute on function public.get_notifications(int) to authenticated;
