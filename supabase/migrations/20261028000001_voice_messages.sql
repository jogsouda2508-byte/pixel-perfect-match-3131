-- =====================================================================
-- Ediraa: voice messages in chat
-- Run in Supabase SQL Editor AFTER 20261027000000_story_highlights.sql.
-- Safe to run more than once. Only ADDS things: no existing table, policy,
-- trigger or function is changed, so text messages / shared posts keep working.
--
-- 1. messages.audio_url / messages.audio_seconds (null for ordinary messages)
-- 2. "voice" storage bucket (public read, 5 MB per file, audio only);
--    each person can only write into their own folder  voice/<user id>/...
-- 3. send_voice_message(conversation, url, seconds) -> the new messages row
--    The existing column grant is  insert (conversation_id, sender_id, body),
--    so clients cannot set the audio columns themselves; only this function can.
--    Errors the client maps to text:
--      not_authenticated | not_allowed | invalid_duration | invalid_audio
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------
alter table public.messages
  add column if not exists audio_url text
    constraint messages_audio_url_length check (audio_url is null or char_length(audio_url) <= 1000),
  add column if not exists audio_seconds integer
    constraint messages_audio_seconds_range check (audio_seconds is null or audio_seconds between 1 and 600);

-- ---------------------------------------------------------------------
-- 2. Storage bucket + policies
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'voice',
  'voice',
  true,
  5242880,
  array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'video/webm', 'video/mp4']
)
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types =
        array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'video/webm', 'video/mp4'];

drop policy if exists "voice_public_read" on storage.objects;
create policy "voice_public_read"
  on storage.objects for select
  using (bucket_id = 'voice');

drop policy if exists "voice_insert_own_folder" on storage.objects;
create policy "voice_insert_own_folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'voice' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "voice_delete_own_folder" on storage.objects;
create policy "voice_delete_own_folder"
  on storage.objects for delete to authenticated
  using (bucket_id = 'voice' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- 3. send_voice_message()
-- ---------------------------------------------------------------------
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
     or position('/storage/v1/object/public/voice/' || v_me::text || '/' in p_url) = 0 then
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
