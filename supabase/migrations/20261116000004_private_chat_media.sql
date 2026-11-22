-- =====================================================================
-- Private chat media: only the people in a conversation can read its photos, files and voice
-- messages.
--
-- BEFORE this migration the "chat-media" and "voice" buckets were PUBLIC: anyone who had (or
-- guessed / was forwarded) a file's URL could open it, signed in or not.
--
-- AFTER it:
--   * both buckets are private (no public URLs work);
--   * the storage read rule is "you uploaded it, or it is attached to a message in a conversation
--     you are a member of" (can_read_chat_media). Someone who leaves a group loses access;
--   * the app opens files through short-lived SIGNED URLs, which Supabase only hands out to people
--     who pass that rule;
--   * chat-media only accepts photos, videos, audio, PDFs and common documents (no SVG / HTML /
--     scripts / APKs), and uploads must have a plain file name inside the uploader's own folder;
--   * send_chat_message / send_voice_message only accept a file that really is in the sender's
--     own folder (the old check was a loose "contains" test that also accepted foreign addresses).
--
-- Nothing is deleted or moved. Old messages keep their stored value (a public-style address of the
-- form  .../storage/v1/object/public/chat-media/<user id>/<file>); the app reads the path out of it
-- and signs it. Safe to run more than once.
--
-- ROLLOUT ORDER (see docs/CHAT-MEDIA-SECURITY.md): deploy the new app first, THEN run this.
-- The new app works against the old (public) and the new (private) database, but an old app
-- cannot show chat photos once the buckets are private.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Read the storage path out of a stored value (strict).
--    Accepts  <user id>/<file>  or a full  http(s)://host/storage/v1/object/{public|sign|authenticated}/<bucket>/<user id>/<file>[?query]
--    Returns NULL for anything else: other buckets, other hosts' look-alikes, "..", odd characters.
-- ---------------------------------------------------------------------
create or replace function public.chat_media_path(p_bucket text, p_value text)
returns text
language sql
immutable
parallel safe
as $$
  select (regexp_match(
    p_value,
    '^(?:https?://[^/?#]+/storage/v1/object/(?:public|sign|authenticated)/' || p_bucket || '/)?'
    || '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-][A-Za-z0-9._-]{0,119})'
    || '(?:\?[^#]*)?$'
  ))[1]
$$;

revoke all on function public.chat_media_path(text, text) from public;
grant execute on function public.chat_media_path(text, text) to anon, authenticated, service_role;

-- Lookups by file path stay fast as chats grow.
create index if not exists messages_chat_image_path_idx
  on public.messages (public.chat_media_path('chat-media', image_url)) where image_url is not null;
create index if not exists messages_chat_file_path_idx
  on public.messages (public.chat_media_path('chat-media', file_url)) where file_url is not null;
create index if not exists messages_chat_voice_path_idx
  on public.messages (public.chat_media_path('voice', audio_url)) where audio_url is not null;

-- ---------------------------------------------------------------------
-- 2. Who may read a stored file.
-- ---------------------------------------------------------------------
create or replace function public.can_read_chat_media(p_bucket text, p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and p_bucket in ('chat-media', 'voice')
     and public.chat_media_path(p_bucket, p_name) is not null
     and (
       -- my own upload (so I can see it before it is sent, and manage it)
       split_part(p_name, '/', 1) = auth.uid()::text
       -- or it is attached to a message, sent by its uploader, in a conversation I belong to
       or exists (
         select 1
         from public.messages m
         where m.sender_id::text = split_part(p_name, '/', 1)
           and (
             (p_bucket = 'chat-media'
               and (public.chat_media_path('chat-media', m.image_url) = p_name
                 or public.chat_media_path('chat-media', m.file_url) = p_name))
             or (p_bucket = 'voice'
               and public.chat_media_path('voice', m.audio_url) = p_name)
           )
           and public.is_conversation_member(m.conversation_id)
       )
     )
$$;

revoke all on function public.can_read_chat_media(text, text) from public, anon;
grant execute on function public.can_read_chat_media(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Buckets: private, and chat-media only takes safe file types.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media', 'chat-media', false, 15728640,
  array[
    -- photos
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
    -- video and audio
    'video/mp4', 'video/webm', 'video/quicktime',
    'audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/ogg',
    -- documents
    'application/pdf', 'text/plain', 'text/csv', 'application/rtf', 'text/rtf', 'application/json',
    'application/zip', 'application/x-zip-compressed', 'application/vnd.rar', 'application/x-rar-compressed',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = 15728640,
      allowed_mime_types = excluded.allowed_mime_types;

-- the voice bucket keeps its size limit and audio-only types; it just stops being public
update storage.buckets set public = false where id = 'voice';

-- ---------------------------------------------------------------------
-- 4. Storage rules. The two public-read rules are removed (that is what exposed everything).
-- ---------------------------------------------------------------------
drop policy if exists "chat_media_public_read" on storage.objects;
drop policy if exists "chat_media_participant_read" on storage.objects;
create policy "chat_media_participant_read"
  on storage.objects for select to authenticated
  using (bucket_id = 'chat-media' and public.can_read_chat_media('chat-media', name));

drop policy if exists "voice_public_read" on storage.objects;
drop policy if exists "voice_participant_read" on storage.objects;
create policy "voice_participant_read"
  on storage.objects for select to authenticated
  using (bucket_id = 'voice' and public.can_read_chat_media('voice', name));

-- Uploads: only into my own folder, and only with a plain  <uuid>.<ext>-style file name.
drop policy if exists "chat_media_insert_own_folder" on storage.objects;
create policy "chat_media_insert_own_folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and public.chat_media_path('chat-media', name) is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "voice_insert_own_folder" on storage.objects;
create policy "voice_insert_own_folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'voice'
    and public.chat_media_path('voice', name) is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );
-- (the existing "...delete_own_folder" rules stay as they are; there is no UPDATE rule, so a file
--  cannot be swapped for another after it has been sent)

-- ---------------------------------------------------------------------
-- 5. Sending: the attached file must be in the SENDER'S OWN folder, checked strictly.
--    Same functions as 20261030000000_chat_whatsapp.sql and 20261028000001_voice_messages.sql;
--    only the media checks changed.
-- ---------------------------------------------------------------------
create or replace function public.send_chat_message(
  p_conversation uuid,
  p_body text,
  p_reply_to uuid default null,
  p_image_url text default null,
  p_image_w integer default null,
  p_image_h integer default null,
  p_file_url text default null,
  p_file_name text default null,
  p_file_size integer default null
)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_row   public.messages;
  v_body  text := btrim(coalesce(p_body, ''));
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if p_conversation is null or not public.is_conversation_member(p_conversation) then
    raise exception 'not_allowed';
  end if;

  -- a reply must point at a message of the SAME conversation
  if p_reply_to is not null and not exists (
    select 1 from public.messages m
    where m.id = p_reply_to and m.conversation_id = p_conversation
  ) then
    raise exception 'invalid_reply';
  end if;

  -- media must be a file this person uploaded into their own folder
  if p_image_url is not null and (
       char_length(p_image_url) > 1000
       or split_part(coalesce(public.chat_media_path('chat-media', p_image_url), ''), '/', 1) <> v_me::text
     ) then
    raise exception 'invalid_media';
  end if;
  if p_file_url is not null and (
       char_length(p_file_url) > 1000
       or split_part(coalesce(public.chat_media_path('chat-media', p_file_url), ''), '/', 1) <> v_me::text
     ) then
    raise exception 'invalid_media';
  end if;
  if p_image_url is not null and p_file_url is not null then
    raise exception 'invalid_media';
  end if;

  if v_body = '' then
    if p_image_url is not null then
      v_body := E'\U0001F4F7 Photo';
    elsif p_file_url is not null then
      v_body := E'\U0001F4C4 ' || left(coalesce(nullif(btrim(p_file_name), ''), 'Document'), 100);
    end if;
  end if;

  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'invalid_message';
  end if;

  insert into public.messages (
    conversation_id, sender_id, body, reply_to_id,
    image_url, image_w, image_h, file_url, file_name, file_size
  )
  values (
    p_conversation, v_me, v_body, p_reply_to,
    p_image_url,
    case when p_image_w between 1 and 20000 then p_image_w end,
    case when p_image_h between 1 and 20000 then p_image_h end,
    p_file_url,
    left(nullif(btrim(p_file_name), ''), 200),
    case when p_file_size between 0 and 2147483647 then p_file_size end
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.send_chat_message(uuid, text, uuid, text, integer, integer, text, text, integer)
  from public, anon;
grant execute on function public.send_chat_message(uuid, text, uuid, text, integer, integer, text, text, integer)
  to authenticated;

create or replace function public.send_voice_message(
  p_conversation uuid,
  p_url text,
  p_seconds integer
)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me  uuid := auth.uid();
  v_row public.messages;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  -- Same rule as the normal message insert policy: members only.
  if p_conversation is null or not public.is_conversation_member(p_conversation) then
    raise exception 'not_allowed';
  end if;

  if p_seconds is null or p_seconds < 1 or p_seconds > 600 then
    raise exception 'invalid_duration';
  end if;

  -- The file must be one this person uploaded into their own folder of the voice bucket.
  if p_url is null
     or char_length(p_url) > 1000
     or split_part(coalesce(public.chat_media_path('voice', p_url), ''), '/', 1) <> v_me::text then
    raise exception 'invalid_audio';
  end if;

  insert into public.messages (conversation_id, sender_id, body, audio_url, audio_seconds)
  values (p_conversation, v_me, 'Voice message', p_url, p_seconds)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.send_voice_message(uuid, text, integer) from public, anon;
grant execute on function public.send_voice_message(uuid, text, integer) to authenticated;

-- Ask the API layer to reload (harmless if nothing is listening).
notify pgrst, 'reload schema';
