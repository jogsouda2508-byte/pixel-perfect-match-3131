-- =====================================================================
-- Ediraa: story likes
-- Run in Supabase SQL Editor AFTER 20261019000000_post_location_tags.sql.
-- Safe to run more than once.
--
--  1. story_likes: one row per (story, person). The primary key guarantees
--     at most ONE active like per person per story, even if a request is
--     retried or the heart is double-tapped.
--  2. Row-level security:
--       insert  -> only as yourself, and only for a story you are allowed to
--                  see (the sub-select on stories is filtered by the stories
--                  policy: your own story, or a story from someone you follow,
--                  and only while it is under 24 hours old).
--       delete  -> only your own like (that is "unlike").
--       select  -> your own likes, plus every like on stories you posted.
--                  Followers can not see who else liked a story.
--  3. get_notifications() gains a 'story_like' kind ("X liked your story").
--     Notifications are derived from the rows, so a retried request cannot
--     notify twice, liking your own story never notifies you, and un-liking
--     removes the notification.
-- =====================================================================

create table if not exists public.story_likes (
  story_id   uuid        not null references public.stories  (id) on delete cascade,
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (story_id, user_id)
);

create index if not exists story_likes_user_idx on public.story_likes (user_id, created_at desc);

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
    and exists (select 1 from public.stories s where s.id = story_likes.story_id)
  );

drop policy if exists "story_likes_delete_own" on public.story_likes;
create policy "story_likes_delete_own"
  on public.story_likes for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- get_notifications: same columns as before (so a plain replace) plus 'story_like'.
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
    -- people who tagged me in a post I can see
    select 'tag', t.tagged_by, t.post_id, left(tp.content, 80), t.created_at, null::uuid
    from public.post_tags t
    join public.posts tp on tp.id = t.post_id
    where t.tagged_user_id = auth.uid() and t.tagged_by <> auth.uid()
    union all
    -- people who liked one of my (still active) stories; never my own likes
    select 'story_like', sl.user_id, null::uuid, null::text, sl.created_at, null::uuid
    from public.story_likes sl
    join public.stories s on s.id = sl.story_id
    where s.author_id = auth.uid() and sl.user_id <> auth.uid()
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
