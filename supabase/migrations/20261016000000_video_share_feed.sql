-- =====================================================================
-- Ediraa: video posts in the Home feed + safe "share video" via chat
-- Run in Supabase Dashboard -> SQL Editor (or `supabase db push`)
-- AFTER 20261015000000_videos.sql. Safe to run more than once.
--
-- 1. get_feed / get_saved_posts now also return the video columns, so the
--    client can render a real player instead of a blank / text-only card.
--    Both stay SECURITY INVOKER: the posts RLS policy still decides what
--    each user may see (audience + follows rules are unchanged).
-- 2. messages.shared_post_id: a message may carry a shared post. Clients
--    can NOT write this column (no INSERT grant); only share_post_to_user().
-- 3. share_post_to_user(): the only way to share a post. It enforces on the
--    server that the sender follows the recipient and that both people are
--    allowed to see the post, then reuses get_or_create_dm() + messages.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1a. get_feed: same rows as before + video columns
--     (a function's OUT columns cannot change with CREATE OR REPLACE,
--      so drop and re-create it, then re-grant)
-- ---------------------------------------------------------------------
drop function if exists public.get_feed(text, text, int, timestamptz);

create function public.get_feed(
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
  liked_by_me         boolean,
  media_type          text,
  video_url           text,
  thumbnail_url       text,
  duration_seconds    numeric
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
    p.media_type, p.video_url, p.thumbnail_url, p.duration_seconds
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

revoke all on function public.get_feed(text, text, int, timestamptz) from public, anon;
grant execute on function public.get_feed(text, text, int, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- 1b. get_saved_posts: same rows as before + video columns
-- ---------------------------------------------------------------------
drop function if exists public.get_saved_posts(int, timestamptz);

create function public.get_saved_posts(
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
  saved_at            timestamptz,
  media_type          text,
  video_url           text,
  thumbnail_url       text,
  duration_seconds    numeric
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
    s.created_at,
    p.media_type, p.video_url, p.thumbnail_url, p.duration_seconds
  from public.saved_posts s
  join public.posts p    on p.id = s.post_id
  join public.profiles a on a.id = p.author_id
  where s.user_id = auth.uid()
    and (p_before is null or s.created_at < p_before)
  order by s.created_at desc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

revoke all on function public.get_saved_posts(int, timestamptz) from public, anon;
grant execute on function public.get_saved_posts(int, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- 2. messages.shared_post_id
--    ON DELETE SET NULL: if the post is deleted the message stays and the
--    chat shows "no longer available".
--    The existing column-level grant is  insert (conversation_id, sender_id, body)
--    so clients cannot set this column themselves.
-- ---------------------------------------------------------------------
alter table public.messages
  add column if not exists shared_post_id uuid references public.posts (id) on delete set null;

-- ---------------------------------------------------------------------
-- 3a. can_view_post(post, user): the posts_select_visible rule for ANY user.
--     SECURITY DEFINER so it can evaluate it for the recipient too.
--     KEEP IN SYNC with the "posts_select_visible" policy.
--     Not callable by clients (would let people probe other users' relations).
-- ---------------------------------------------------------------------
create or replace function public.can_view_post(p_post_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.posts p
    where p.id = p_post_id
      and (
        p.author_id = p_user_id
        or p.audience = 'Public'
        or (
          p.audience = 'Friends'
          and exists (select 1 from public.follows f
                      where f.follower_id = p_user_id and f.following_id = p.author_id)
          and exists (select 1 from public.follows f
                      where f.follower_id = p.author_id and f.following_id = p_user_id)
        )
        or (
          p.audience = 'Local Community'
          and exists (select 1
                      from public.profiles me, public.profiles au
                      where me.id = p_user_id and au.id = p.author_id
                        and me.location is not null
                        and lower(btrim(me.location)) = lower(btrim(au.location)))
        )
      )
  );
$$;

revoke all on function public.can_view_post(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3b. share_post_to_user(post, recipient) -> conversation id
--     Errors (raised as exception messages the client maps to text):
--       not_authenticated | invalid_recipient | not_following_recipient
--       post_not_found    | recipient_cannot_view_post | recipient_not_found
--     Double clicks: the same sender sharing the same post into the same
--     conversation within 30 seconds returns the existing conversation
--     instead of inserting a second message.
-- ---------------------------------------------------------------------
create or replace function public.share_post_to_user(p_post_id uuid, p_recipient_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me           uuid := auth.uid();
  v_media        text;
  v_conversation uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;
  if p_post_id is null or p_recipient_id is null or p_recipient_id = v_me then
    raise exception 'invalid_recipient';
  end if;

  -- The sender must follow the recipient (checked here, not in the browser).
  if not exists (
    select 1 from public.follows f
    where f.follower_id = v_me and f.following_id = p_recipient_id
  ) then
    raise exception 'not_following_recipient';
  end if;

  -- The sender must be allowed to see the post, and so must the recipient,
  -- so sharing can never reveal a Friends / Local Community post to someone
  -- the audience rules exclude.
  if not public.can_view_post(p_post_id, v_me) then
    raise exception 'post_not_found';
  end if;
  if not public.can_view_post(p_post_id, p_recipient_id) then
    raise exception 'recipient_cannot_view_post';
  end if;

  select p.media_type into v_media from public.posts p where p.id = p_post_id;

  -- Reuse the existing 1:1 conversation (or create it) -- no second messaging system.
  v_conversation := public.get_or_create_dm(p_recipient_id);

  if exists (
    select 1 from public.messages m
    where m.conversation_id = v_conversation
      and m.sender_id = v_me
      and m.shared_post_id = p_post_id
      and m.created_at > now() - interval '30 seconds'
  ) then
    return v_conversation;
  end if;

  insert into public.messages (conversation_id, sender_id, body, shared_post_id)
  values (
    v_conversation,
    v_me,
    case when v_media = 'video' then 'Shared a video' else 'Shared a post' end,
    p_post_id
  );

  return v_conversation;
end;
$$;

revoke all on function public.share_post_to_user(uuid, uuid) from public, anon;
grant execute on function public.share_post_to_user(uuid, uuid) to authenticated;
