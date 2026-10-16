-- =====================================================================
-- Ediraa: notify people when someone shares a video/post with them in chat
-- Run in Supabase SQL Editor AFTER 20261016000000_video_share_feed.sql.
-- Safe to run more than once. get_notifications gains a 'share' kind and a
-- conversation_id column, so the notification can open the chat.
-- =====================================================================
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
