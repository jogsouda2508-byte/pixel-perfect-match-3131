-- =====================================================================
-- Ediraa: story like notifications ("X liked your story")
-- Run in Supabase SQL Editor AFTER 20261020000000_story_single_video_views_likes.sql.
-- Safe to run more than once.
--
-- 1. story_views.first_liked_at: the moment a person FIRST liked a story.
--    The like times are now set by the database (trigger), never by the client,
--    so nobody can fake or bump them.
-- 2. set_story_like(): unchanged rules (at most ONE row per person per story,
--    never your own story, only stories you are allowed to see); it now returns
--    NULL when the story is not available, so the app can undo the heart.
-- 3. get_notifications() gains a 'story_like' kind:
--      * one notification per person per story (the table's primary key)
--      * never for liking your own story
--      * liking, unliking and liking again does NOT create another one: it is
--        dated by first_liked_at and disappears while the like is removed
--      * the story owner is the only one who sees it, and only while the
--        story itself is visible (stories RLS: 24 hours)
--    The bell's unread count already reads get_notifications(), so it counts too.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. first_liked_at (+ backfill BEFORE the trigger exists)
-- ---------------------------------------------------------------------
alter table public.story_views
  add column if not exists first_liked_at timestamptz;

update public.story_views
   set first_liked_at = coalesce(liked_at, viewed_at)
 where liked and first_liked_at is null;

-- Like times are owned by the database.
create or replace function public.story_views_like_times()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.liked_at       := case when new.liked then now() else null end;
    new.first_liked_at := new.liked_at;
  else
    -- who / what / when viewed can never change
    new.story_id  := old.story_id;
    new.viewer_id := old.viewer_id;
    new.viewed_at := old.viewed_at;
    if new.liked and not old.liked then
      new.liked_at := now();
    elsif not new.liked then
      new.liked_at := null;
    else
      new.liked_at := old.liked_at;   -- already liked: repeating it changes nothing
    end if;
    new.first_liked_at := coalesce(old.first_liked_at, case when new.liked then now() end);
  end if;
  return new;
end;
$$;

drop trigger if exists story_views_like_times on public.story_views;
create trigger story_views_like_times
  before insert or update on public.story_views
  for each row execute function public.story_views_like_times();

-- ---------------------------------------------------------------------
-- 2. set_story_like: returns the new liked state, or NULL if the story is not
--    available to me (hidden, expired, deleted, or my own).
-- ---------------------------------------------------------------------
create or replace function public.set_story_like(p_story_id uuid, p_liked boolean)
returns boolean
language sql
set search_path = public
as $$
  insert into public.story_views (story_id, viewer_id, liked)
  select s.id, auth.uid(), coalesce(p_liked, false)
  from public.stories s
  where s.id = p_story_id and s.author_id <> auth.uid()
  on conflict (story_id, viewer_id) do update
    set liked = excluded.liked
  returning liked;
$$;

revoke all on function public.set_story_like(uuid, boolean) from public, anon;
grant execute on function public.set_story_like(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 3. get_notifications: add the 'story_like' kind (same columns as before)
--    snippet = the story's media type ('image' or 'video')
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
    -- people who like one of MY stories (stories RLS: only while it is visible)
    select 'story_like', v.viewer_id, null::uuid, st.media_type, v.first_liked_at, null::uuid
    from public.story_views v
    join public.stories st on st.id = v.story_id
    where st.author_id = auth.uid()
      and v.viewer_id <> auth.uid()
      and v.liked
      and v.first_liked_at is not null
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
