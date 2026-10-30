-- =====================================================================
-- Story music: a song can be attached to a photo story and plays while it is watched.
-- Run in Supabase SQL Editor (any time after the earlier story migrations).
-- Safe to run more than once. Only ADDS two optional columns: existing stories are untouched.
--
--   music_title : "Song name - Artist", shown on the story
--   music_url   : a short preview clip (https) that plays during the story
--
-- Until this is run, stories still save and show the song name on the picture;
-- the app simply doesn't store / play the audio.
-- =====================================================================

alter table public.stories
  add column if not exists music_title text,
  add column if not exists music_url   text;

alter table public.stories drop constraint if exists stories_music_title_length;
alter table public.stories
  add constraint stories_music_title_length
  check (music_title is null or char_length(music_title) <= 200);

alter table public.stories drop constraint if exists stories_music_url_https;
alter table public.stories
  add constraint stories_music_url_https
  check (music_url is null or (music_url ~* '^https://' and char_length(music_url) <= 1000));

-- make the API see the new columns right away
notify pgrst, 'reload schema';
