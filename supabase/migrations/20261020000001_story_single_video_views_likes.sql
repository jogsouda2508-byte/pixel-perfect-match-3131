-- =====================================================================
-- Ediraa: one video = ONE story, plus story viewers + likes
-- Run in Supabase Dashboard -> SQL Editor (or `supabase db push`)
-- AFTER 20261019000000_story_videos_local_feed.sql. Safe to run more than once.
--
-- 1. A video story is no longer cut into 15 s parts. A 26 s clip on the 30 s
--    limit is stored as a single story row (0 s .. 26 s). The old rule that
--    limited one row to 15 s is relaxed to 60 s. Stories that were already
--    saved in 15 s parts keep working exactly as before.
-- 2. story_views: who viewed a story, and whether they liked it.
--      * a viewer can only add / change their OWN row (never on their own story)
--      * the story's author can read every row for their stories
--      * everyone else can read only their own row
-- 3. RPCs used by the app (all SECURITY INVOKER, so RLS decides what is visible):
--      record_story_view(story)        -> remember that I viewed it
--      set_story_like(story, liked)    -> like / unlike
--      get_story_engagement(stories[]) -> view count, like count, liked by me
--      get_story_viewers(story)        -> the viewers list (author only)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. stories: allow one row to cover a whole (up to 60 s) video
-- ---------------------------------------------------------------------
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
      -- one story is at most 60 s (tiny tolerance for float rounding)
      and segment_end - segment_start <= 60.01
      and segment_end <= 60.01
      and duration_seconds is not null
      and duration_seconds > 0
      and duration_seconds <= 60.01
    )
  );

-- ---------------------------------------------------------------------
-- 2. story_views
-- ---------------------------------------------------------------------
create table if not exists public.story_views (
  story_id  uuid        not null references public.stories (id)  on delete cascade,
  viewer_id uuid        not null references public.profiles (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  liked     boolean     not null default false,
  liked_at  timestamptz,
  primary key (story_id, viewer_id)
);

create index if not exists story_views_story_idx
  on public.story_views (story_id, viewed_at desc);

alter table public.story_views enable row level security;

-- Only the columns the app needs are writable.
revoke all on public.story_views from anon, authenticated;
grant select on public.story_views to authenticated;
grant insert (story_id, viewer_id, liked, liked_at) on public.story_views to authenticated;
grant update (liked, liked_at) on public.story_views to authenticated;

-- read: my own row, or every row of a story I posted
drop policy if exists "story_views_select" on public.story_views;
create policy "story_views_select"
  on public.story_views for select to authenticated
  using (
    viewer_id = auth.uid()
    or exists (
      select 1 from public.stories s
      where s.id = story_views.story_id and s.author_id = auth.uid()
    )
  );

-- add: only as myself, only on a story I am allowed to see (stories RLS applies
-- inside this check) and never on my own story
drop policy if exists "story_views_insert" on public.story_views;
create policy "story_views_insert"
  on public.story_views for insert to authenticated
  with check (
    viewer_id = auth.uid()
    and exists (
      select 1 from public.stories s
      where s.id = story_views.story_id and s.author_id <> auth.uid()
    )
  );

-- change (like / unlike): only my own row
drop policy if exists "story_views_update" on public.story_views;
create policy "story_views_update"
  on public.story_views for update to authenticated
  using (viewer_id = auth.uid())
  with check (viewer_id = auth.uid());

-- ---------------------------------------------------------------------
-- 3. RPCs
-- ---------------------------------------------------------------------

-- Remember that I viewed a story. Does nothing for my own story, for a story I
-- cannot see, or when I already viewed it.
create or replace function public.record_story_view(p_story_id uuid)
returns void
language sql
set search_path = public
as $$
  insert into public.story_views (story_id, viewer_id)
  select s.id, auth.uid()
  from public.stories s
  where s.id = p_story_id and s.author_id <> auth.uid()
  on conflict (story_id, viewer_id) do nothing;
$$;

revoke all on function public.record_story_view(uuid) from public, anon;
grant execute on function public.record_story_view(uuid) to authenticated;

-- Like or unlike a story (also counts as a view). Returns the new liked state.
create or replace function public.set_story_like(p_story_id uuid, p_liked boolean)
returns boolean
language sql
set search_path = public
as $$
  insert into public.story_views (story_id, viewer_id, liked, liked_at)
  select s.id, auth.uid(), coalesce(p_liked, false),
         case when coalesce(p_liked, false) then now() else null end
  from public.stories s
  where s.id = p_story_id and s.author_id <> auth.uid()
  on conflict (story_id, viewer_id) do update
    set liked    = excluded.liked,
        liked_at = excluded.liked_at
  returning liked;
$$;

revoke all on function public.set_story_like(uuid, boolean) from public, anon;
grant execute on function public.set_story_like(uuid, boolean) to authenticated;

-- Counts for stories. For the author these are the real totals; for anyone else
-- RLS only lets them see their own row, so only liked_by_me is meaningful to them.
create or replace function public.get_story_engagement(p_story_ids uuid[])
returns table (
  story_id    uuid,
  view_count  bigint,
  like_count  bigint,
  liked_by_me boolean
)
language sql
stable
set search_path = public
as $$
  select
    v.story_id,
    count(*)                                                    as view_count,
    count(*) filter (where v.liked)                             as like_count,
    coalesce(bool_or(v.liked and v.viewer_id = auth.uid()), false) as liked_by_me
  from public.story_views v
  where v.story_id = any (p_story_ids)
  group by v.story_id;
$$;

revoke all on function public.get_story_engagement(uuid[]) from public, anon;
grant execute on function public.get_story_engagement(uuid[]) to authenticated;

-- Who viewed my story (newest first) and who liked it. Only the author gets rows.
create or replace function public.get_story_viewers(p_story_id uuid)
returns table (
  viewer_id  uuid,
  full_name  text,
  username   text,
  avatar_url text,
  viewed_at  timestamptz,
  liked      boolean,
  liked_at   timestamptz
)
language sql
stable
set search_path = public
as $$
  select v.viewer_id, p.full_name, p.username, p.avatar_url, v.viewed_at, v.liked, v.liked_at
  from public.story_views v
  join public.profiles p on p.id = v.viewer_id
  where v.story_id = p_story_id
    and exists (
      select 1 from public.stories s
      where s.id = p_story_id and s.author_id = auth.uid()
    )
  order by v.viewed_at desc;
$$;

revoke all on function public.get_story_viewers(uuid) from public, anon;
grant execute on function public.get_story_viewers(uuid) to authenticated;
