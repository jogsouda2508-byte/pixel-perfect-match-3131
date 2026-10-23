-- ---------------------------------------------------------------------
-- get_notifications: ONE version that has everything
--
-- Two earlier migrations each redefine get_notifications(), and whichever runs last
-- silently wins:
--   20261021000000_private_accounts.sql          adds 'follow_request' + 'follow_accepted'
--                                                (but reads story likes from the OLD story_likes table)
--   20261021000000_story_like_notifications.sql  reads story likes from story_views
--                                                (but has no follow requests)
-- This file combines them: follow requests / accepted requests AND story likes from
-- story_views. Run it AFTER both of them (and after 20261023/24 if you ran those).
-- Same columns as before, so it is a plain "create or replace"; safe to run more than once.
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
    union all
    -- someone is asking to follow me (shown until I accept or decline)
    select 'follow_request', fr.requester_id, null::uuid, null::text, fr.created_at, null::uuid
    from public.follow_requests fr
    where fr.target_id = auth.uid() and fr.status = 'pending'
    union all
    -- an account I asked to follow accepted me (only while I still follow it)
    select 'follow_accepted', fr.target_id, null::uuid, null::text,
           coalesce(fr.responded_at, fr.created_at), null::uuid
    from public.follow_requests fr
    where fr.requester_id = auth.uid() and fr.status = 'accepted'
      and exists (select 1 from public.follows f
                  where f.follower_id = auth.uid() and f.following_id = fr.target_id)
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
