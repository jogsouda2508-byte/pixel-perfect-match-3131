-- =====================================================================
-- Gicco chat: video view counts (shown under each video in a profile's Reels tab).
-- Run in Supabase Dashboard -> SQL Editor (or `supabase db push`).
-- Safe to run more than once.
--
-- One person counts once per video (watching it again does not add more).
-- Only people who are allowed to see a video can add a view to it.
-- =====================================================================

create table if not exists public.post_video_views (
  post_id    uuid not null references public.posts (id) on delete cascade,
  viewer_id  uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, viewer_id)
);

alter table public.post_video_views enable row level security;
revoke all on public.post_video_views from anon, authenticated;  -- only the functions below touch it

-- Called when someone watches a video for a moment.
create or replace function public.record_video_view(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  if not public.can_view_post(p_post_id, auth.uid()) then
    return;
  end if;
  insert into public.post_video_views (post_id, viewer_id)
  values (p_post_id, auth.uid())
  on conflict do nothing;
end;
$$;

-- View counts for a list of videos (only the ones the caller may see).
create or replace function public.get_video_view_counts(p_post_ids uuid[])
returns table (post_id uuid, view_count bigint)
language sql
security definer
stable
set search_path = public
as $$
  select v.post_id, count(*)::bigint
  from public.post_video_views v
  where v.post_id = any (p_post_ids[1:200])
    and auth.uid() is not null
    and public.can_view_post(v.post_id, auth.uid())
  group by v.post_id;
$$;

revoke all on function public.record_video_view(uuid)        from public, anon;
revoke all on function public.get_video_view_counts(uuid[])  from public, anon;
grant execute on function public.record_video_view(uuid)       to authenticated;
grant execute on function public.get_video_view_counts(uuid[]) to authenticated;
