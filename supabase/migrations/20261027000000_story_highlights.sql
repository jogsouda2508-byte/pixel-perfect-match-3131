-- =====================================================================
-- Story highlights: stories a person keeps on their profile after the
-- 24 hours are over (like Instagram).
-- Run in Supabase SQL Editor AFTER 20261021000000_private_accounts.sql.
-- Safe to run more than once. Nothing existing is changed.
--
--   story_highlights       : one row per highlight (title, owner)
--   story_highlight_items  : the photos / video parts inside it. They keep
--                            their own copy of the media link, so they stay
--                            after the story itself expires.
--
-- Who can see them: the same people who can see the owner's profile content
-- (public account = everyone, private account = accepted followers).
-- Only the owner can create or delete their highlights.
-- =====================================================================

create table if not exists public.story_highlights (
  id         uuid        primary key default gen_random_uuid(),
  owner_id   uuid        not null references public.profiles (id) on delete cascade,
  title      text        not null check (char_length(btrim(title)) between 1 and 20),
  created_at timestamptz not null default now()
);
create index if not exists story_highlights_owner_idx
  on public.story_highlights (owner_id, created_at desc);

create table if not exists public.story_highlight_items (
  id            uuid        primary key default gen_random_uuid(),
  highlight_id  uuid        not null references public.story_highlights (id) on delete cascade,
  media_type    text        not null default 'image' check (media_type in ('image', 'video')),
  image_url     text,
  video_url     text,
  segment_start numeric     not null default 0,
  segment_end   numeric,
  position      integer     not null default 0,
  created_at    timestamptz not null default now(),
  constraint story_highlight_items_media_check check (
    (media_type = 'image' and image_url is not null)
    or (media_type = 'video' and video_url is not null)
  )
);
create index if not exists story_highlight_items_hl_idx
  on public.story_highlight_items (highlight_id, position);

alter table public.story_highlights enable row level security;
alter table public.story_highlight_items enable row level security;

revoke all on public.story_highlights from anon, authenticated;
revoke all on public.story_highlight_items from anon, authenticated;
grant select, insert, delete on public.story_highlights to authenticated;
grant select, insert, delete on public.story_highlight_items to authenticated;

drop policy if exists "story_highlights_select" on public.story_highlights;
create policy "story_highlights_select"
  on public.story_highlights for select to authenticated
  using (owner_id = auth.uid() or public.is_profile_visible(owner_id));

drop policy if exists "story_highlights_insert" on public.story_highlights;
create policy "story_highlights_insert"
  on public.story_highlights for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "story_highlights_delete" on public.story_highlights;
create policy "story_highlights_delete"
  on public.story_highlights for delete to authenticated
  using (owner_id = auth.uid());

drop policy if exists "story_highlight_items_select" on public.story_highlight_items;
create policy "story_highlight_items_select"
  on public.story_highlight_items for select to authenticated
  using (exists (
    select 1 from public.story_highlights h
    where h.id = story_highlight_items.highlight_id
      and (h.owner_id = auth.uid() or public.is_profile_visible(h.owner_id))
  ));

drop policy if exists "story_highlight_items_insert" on public.story_highlight_items;
create policy "story_highlight_items_insert"
  on public.story_highlight_items for insert to authenticated
  with check (exists (
    select 1 from public.story_highlights h
    where h.id = story_highlight_items.highlight_id and h.owner_id = auth.uid()
  ));

drop policy if exists "story_highlight_items_delete" on public.story_highlight_items;
create policy "story_highlight_items_delete"
  on public.story_highlight_items for delete to authenticated
  using (exists (
    select 1 from public.story_highlights h
    where h.id = story_highlight_items.highlight_id and h.owner_id = auth.uid()
  ));
