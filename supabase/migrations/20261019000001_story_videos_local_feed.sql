-- =====================================================================
-- Ediraa: video stories (15 s segments, 60 s max) + Following / Local feed
-- Run in Supabase Dashboard -> SQL Editor (or `supabase db push`)
-- AFTER 20261018000000_activity_vs_messages.sql. Safe to run more than once.
--
-- 1. stories can now be a video. A long video is NOT re-encoded: it is
--    stored once and referenced by up to 4 story rows ("segments"), each a
--    time range (segment_start..segment_end) of at most 15 seconds, so the
--    whole upload is never longer than 60 seconds. Nothing is truncated.
--    Existing image stories keep working unchanged.
-- 2. get_feed:
--      * Following = posts by people you follow (no longer your own posts).
--      * Local     = posts by people whose profile location matches either
--                    the locality you picked (new p_location) or, when none
--                    is picked, your own profile location.
--    Both stay SECURITY INVOKER, so the posts RLS policy still decides what
--    each person may see. No precise (GPS) location is ever involved.
-- 3. get_localities: the profile locations people use, to pick one from.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. stories: video + segment columns
-- ---------------------------------------------------------------------
alter table public.stories
  add column if not exists media_type    text    not null default 'image',
  add column if not exists video_url     text,
  add column if not exists upload_id     uuid,
  add column if not exists segment_index int     not null default 0,
  add column if not exists segment_count int     not null default 1,
  add column if not exists segment_start numeric not null default 0,
  add column if not exists segment_end   numeric,
  add column if not exists duration_seconds numeric;

-- video stories have no image
alter table public.stories alter column image_url drop not null;

alter table public.stories drop constraint if exists stories_media_check;
alter table public.stories
  add constraint stories_media_check check (
    (
      media_type = 'image'
      and image_url is not null
      and video_url is null
      and upload_id is null
    )
    or (
      media_type = 'video'
      and video_url is not null
      and upload_id is not null
      and segment_count between 1 and 4
      and segment_index between 0 and 3
      and segment_index < segment_count
      and segment_start >= 0
      and segment_end is not null
      and segment_end > segment_start
      -- one segment is at most 15 s (tiny tolerance for float rounding)
      and segment_end - segment_start <= 15.01
      -- the whole upload ends within 60 s
      and segment_end <= 60.01
      and duration_seconds is not null
      and duration_seconds > 0
      and duration_seconds <= 15.01
    )
  );

-- the video file must sit in the author's own folder of the `videos` bucket
alter table public.stories drop constraint if exists stories_video_owner_check;
alter table public.stories
  add constraint stories_video_owner_check check (
    video_url is null
    or video_url like '%/storage/v1/object/public/videos/' || author_id::text || '/%'
  );

create index if not exists stories_upload_idx
  on public.stories (upload_id, segment_index)
  where upload_id is not null;

-- RLS is unchanged: stories_select_active / stories_insert_own /
-- stories_delete_own from 20261012000000_posts_feed.sql already apply to
-- every row, image or video (own stories + people you follow, 24 hours).

-- ---------------------------------------------------------------------
-- 2. get_feed: Following + Local, with an optional picked locality
--    (new argument => drop the old 4-argument function first)
-- ---------------------------------------------------------------------
drop function if exists public.get_feed(text, text, int, timestamptz);
drop function if exists public.get_feed(text, text, int, timestamptz, text);

create function public.get_feed(
  p_tab      text        default 'for_you',
  p_search   text        default null,
  p_limit    int         default 10,
  p_before   timestamptz default null,
  p_location text        default null
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
      -- only people the signed-in user actually follows
      when 'following' then
        p.author_id <> auth.uid()
        and exists (select 1 from public.follows f
                    where f.follower_id = auth.uid() and f.following_id = p.author_id)
      -- people in the picked locality, else in the user's own profile locality.
      -- Nothing matches when neither exists (never falls back to "everyone").
      when 'local' then
        coalesce(
          nullif(btrim(p_location), ''),
          (select nullif(btrim(me.location), '') from public.profiles me where me.id = auth.uid())
        ) is not null
        and lower(btrim(coalesce(a.location, ''))) = lower(coalesce(
          nullif(btrim(p_location), ''),
          (select nullif(btrim(me.location), '') from public.profiles me where me.id = auth.uid())
        ))
      when 'business' then
        a.account_type = 'business'
      else true
    end
  order by p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

revoke all on function public.get_feed(text, text, int, timestamptz, text) from public, anon;
grant execute on function public.get_feed(text, text, int, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. get_localities: profile locations to choose from (most used first)
--    profiles are already readable by every signed-in user (RLS: true).
-- ---------------------------------------------------------------------
create or replace function public.get_localities(p_limit int default 20)
returns table (locality text, people bigint)
language sql
stable
set search_path = public
as $$
  select min(btrim(p.location)) as locality, count(*) as people
  from public.profiles p
  where p.location is not null and btrim(p.location) <> ''
  group by lower(btrim(p.location))
  order by 2 desc, 1
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

revoke all on function public.get_localities(int) from public, anon;
grant execute on function public.get_localities(int) to authenticated;
