-- Upload security (audit findings S2, S3).
--
--   1. Every bucket gets a server-side allow-list of file TYPES and file EXTENSIONS. The browser
--      checks are only a convenience; this is the part an attacker with the public anon key and a
--      valid login cannot skip.
--   2. `chat-media` and `voice` hold private conversations, so they become PRIVATE buckets: a file
--      can be read only by the person who uploaded it and by the members of a conversation that
--      has a message pointing at it. The app shows them through short-lived signed URLs
--      (src/lib/private-media.ts).
--
-- ORDER OF ROLLOUT (important):
--   a) ship the app version that contains src/lib/private-media.ts first. It works with public
--      AND private buckets, so nothing changes for people yet;
--   b) then run this file;
--   Running this file while people still use an older app build makes chat photos/voice notes show
--   as "unavailable" in those old builds until they update.
--
-- ROLLBACK (if something looks wrong after applying):
--   update storage.buckets set public = true where id in ('chat-media', 'voice');
--   create policy "chat_media_public_read" on storage.objects for select using (bucket_id = 'chat-media');
--   create policy "voice_public_read"      on storage.objects for select using (bucket_id = 'voice');
--   update storage.buckets set allowed_mime_types = null where id = 'chat-media';
--
-- Safe to re-run.

-- ---------------------------------------------------------------------
-- 1. Allowed types per bucket
-- ---------------------------------------------------------------------
-- chat-media had NO allow-list: any type (HTML, SVG, APK ...) could be hosted from our domain.
update storage.buckets
   set public = false,
       file_size_limit = 15728640,
       allowed_mime_types = array[
         'image/jpeg', 'image/png', 'image/webp', 'image/gif',
         'application/pdf',
         'application/msword',
         'application/vnd.ms-excel',
         'application/vnd.ms-powerpoint',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'application/vnd.openxmlformats-officedocument.presentationml.presentation',
         'application/zip', 'application/vnd.rar',
         'application/rtf', 'text/plain', 'text/csv', 'application/json'
       ]
 where id = 'chat-media';

update storage.buckets set public = false where id = 'voice';

-- ---------------------------------------------------------------------
-- 2. Who may read a private chat file
-- ---------------------------------------------------------------------
-- Messages store the public-style URL of the file. This extracts "<uid>/<file>" from it so a file
-- can be matched to the message(s) that reference it (immutable, so it can be indexed).
create or replace function public.storage_object_path(p_url text, p_bucket text)
returns text
language sql
immutable
parallel safe
as $$
  select substring(p_url from ('/storage/v1/object/public/' || p_bucket || '/([^?]+)'));
$$;

create index if not exists messages_chat_image_path_idx
  on public.messages (public.storage_object_path(image_url, 'chat-media'))
  where image_url is not null;
create index if not exists messages_chat_file_path_idx
  on public.messages (public.storage_object_path(file_url, 'chat-media'))
  where file_url is not null;
create index if not exists messages_voice_path_idx
  on public.messages (public.storage_object_path(audio_url, 'voice'))
  where audio_url is not null;

-- True when the signed-in person is in a conversation that has a message pointing at this file.
create or replace function public.can_read_chat_object(p_bucket text, p_name text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.messages m
    where public.is_conversation_member(m.conversation_id)
      and (
        (p_bucket = 'chat-media' and (
              public.storage_object_path(m.image_url, 'chat-media') = p_name
           or public.storage_object_path(m.file_url,  'chat-media') = p_name))
        or
        (p_bucket = 'voice' and public.storage_object_path(m.audio_url, 'voice') = p_name)
      )
  );
$$;
revoke all on function public.can_read_chat_object(text, text) from public, anon;
grant execute on function public.can_read_chat_object(text, text) to authenticated;

-- Remove legacy public-read policies.
-- Strict authenticated read policies are created by the later private-chat-media migration.
drop policy if exists "chat_media_public_read" on storage.objects;
drop policy if exists "voice_public_read" on storage.objects;
drop policy if exists "chat_media_read_own_or_member" on storage.objects;
drop policy if exists "voice_read_own_or_member" on storage.objects;

-- ---------------------------------------------------------------------
-- 3. File EXTENSION allow-list on every upload (own folder only, as before)
-- ---------------------------------------------------------------------
-- The mime allow-list above checks what the uploader SAYS the file is; the extension is part of the
-- object name, so it is checked here too ("evil.html" can no longer be stored as an "image").
create or replace function public.upload_ext_ok(p_name text, p_allowed text[])
returns boolean
language sql
immutable
parallel safe
as $$
  select lower(coalesce((regexp_match(p_name, '\.([^./]+)$'))[1], '')) = any (p_allowed);
$$;

drop policy if exists "avatars_insert_own_folder" on storage.objects;
create policy "avatars_insert_own_folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.upload_ext_ok(name, array['jpg', 'png', 'webp', 'gif'])
  );

drop policy if exists "avatars_update_own_folder" on storage.objects;
create policy "avatars_update_own_folder"
  on storage.objects for update to authenticated
  using      (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.upload_ext_ok(name, array['jpg', 'png', 'webp', 'gif'])
  );

drop policy if exists "media_insert_own_folder" on storage.objects;
create policy "media_insert_own_folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.upload_ext_ok(name, array['jpg', 'png', 'webp', 'gif'])
  );

drop policy if exists "videos_insert_own_folder" on storage.objects;
create policy "videos_insert_own_folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.upload_ext_ok(name, array['mp4', 'mov', 'webm'])
  );

drop policy if exists "videos_update_own_folder" on storage.objects;
create policy "videos_update_own_folder"
  on storage.objects for update to authenticated
  using      (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.upload_ext_ok(name, array['mp4', 'mov', 'webm'])
  );

drop policy if exists "voice_insert_own_folder" on storage.objects;
create policy "voice_insert_own_folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'voice'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.upload_ext_ok(name, array['webm', 'm4a', 'ogg', 'mp3'])
  );

drop policy if exists "chat_media_insert_own_folder" on storage.objects;
create policy "chat_media_insert_own_folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.upload_ext_ok(name, array[
      'jpg', 'png', 'webp', 'gif',
      'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
      'txt', 'csv', 'json', 'rtf', 'zip', 'rar'
    ])
  );
