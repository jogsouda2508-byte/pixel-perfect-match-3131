-- Stop strangers from LISTING every file in the public buckets.
--
-- `avatars`, `media` and `videos` are public buckets on purpose: posts and profile photos are
-- shown through plain URLs. But each also had a policy "for select using (bucket_id = '...')"
-- granted to everybody, which is what the storage API consults for list/search calls. With only the
-- public anon key, anyone could therefore enumerate every uploaded path (<user id>/<file id>),
-- including media attached to followers-only posts and close-friends stories, whose only protection
-- is that the URL is hard to guess.
--
-- Public URLs (/storage/v1/object/public/<bucket>/<path>) do not go through these policies, so
-- images and videos keep loading. The owner keeps SELECT on their own folder (needed for upsert
-- of avatars, for "delete my account" which lists the person's files, and for remove()).
--
-- !! VERIFY ON A STAGING PROJECT FIRST !! This relies on Supabase serving public-bucket URLs
-- without consulting RLS, which is documented behaviour but was not testable offline. After
-- applying, open a post image, a profile photo and a video in a logged-out browser window.
--
-- ROLLBACK:
--   create policy "avatars_public_read" on storage.objects for select using (bucket_id = 'avatars');
--   create policy "media_public_read"   on storage.objects for select using (bucket_id = 'media');
--   create policy "videos_public_read"  on storage.objects for select using (bucket_id = 'videos');
--
-- Safe to re-run.

drop policy if exists "avatars_public_read" on storage.objects;
drop policy if exists "avatars_read_own" on storage.objects;
create policy "avatars_read_own"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "media_public_read" on storage.objects;
drop policy if exists "media_read_own" on storage.objects;
create policy "media_read_own"
  on storage.objects for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "videos_public_read" on storage.objects;
drop policy if exists "videos_read_own" on storage.objects;
create policy "videos_read_own"
  on storage.objects for select to authenticated
  using (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
