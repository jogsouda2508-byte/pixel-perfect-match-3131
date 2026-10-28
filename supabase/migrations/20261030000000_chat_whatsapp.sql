-- =====================================================================
-- Ediraa: WhatsApp-style chat  (reply to a message, reactions, photos, files)
-- Run in Supabase SQL Editor AFTER 20261029000000_edit_delete_messages.sql.
-- Safe to run more than once. Only ADDS things: no existing table, policy,
-- trigger or function is changed, so text / voice / shared posts keep working.
--
-- 1. messages.reply_to_id, image_url/image_w/image_h, file_url/file_name/file_size
-- 2. "chat-media" storage bucket (public read, 15 MB per file);
--    each person can only write into their own folder  chat-media/<user id>/...
-- 3. message_reactions table (one reaction per person per message) + react_to_message()
-- 4. send_chat_message()  -> the new messages row (reply and/or photo and/or file)
--    Errors the client maps to text:
--      not_authenticated | not_allowed | invalid_message | invalid_reply | invalid_media
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------
alter table public.messages
  add column if not exists reply_to_id uuid,
  add column if not exists image_url text
    constraint messages_image_url_length check (image_url is null or char_length(image_url) <= 1000),
  add column if not exists image_w integer,
  add column if not exists image_h integer,
  add column if not exists file_url text
    constraint messages_file_url_length check (file_url is null or char_length(file_url) <= 1000),
  add column if not exists file_name text
    constraint messages_file_name_length check (file_name is null or char_length(file_name) <= 200),
  add column if not exists file_size integer;

-- ---------------------------------------------------------------------
-- 2. Storage bucket + policies
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-media', 'chat-media', true, 15728640)
on conflict (id) do update
  set public = true,
      file_size_limit = 15728640;

drop policy if exists "chat_media_public_read" on storage.objects;
create policy "chat_media_public_read"
  on storage.objects for select
  using (bucket_id = 'chat-media');

drop policy if exists "chat_media_insert_own_folder" on storage.objects;
create policy "chat_media_insert_own_folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "chat_media_delete_own_folder" on storage.objects;
create policy "chat_media_delete_own_folder"
  on storage.objects for delete to authenticated
  using (bucket_id = 'chat-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- 3. Reactions
-- ---------------------------------------------------------------------
create table if not exists public.message_reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  emoji text not null constraint message_reactions_emoji_length check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists message_reactions_conversation_idx
  on public.message_reactions (conversation_id);

alter table public.message_reactions enable row level security;

drop policy if exists "message_reactions_select_member" on public.message_reactions;
create policy "message_reactions_select_member"
  on public.message_reactions for select to authenticated
  using (public.is_conversation_member(conversation_id));

revoke all on public.message_reactions from anon, authenticated;
grant select on public.message_reactions to authenticated;

-- p_emoji = null / '' removes my reaction; anything else sets (replaces) it.
create or replace function public.react_to_message(p_message uuid, p_emoji text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_conv  uuid;
  v_emoji text := btrim(coalesce(p_emoji, ''));
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select m.conversation_id into v_conv from public.messages m where m.id = p_message;
  if v_conv is null or not public.is_conversation_member(v_conv) then
    raise exception 'not_allowed';
  end if;

  if v_emoji = '' then
    delete from public.message_reactions where message_id = p_message and user_id = v_me;
    return;
  end if;

  if char_length(v_emoji) > 16 then
    raise exception 'invalid_message';
  end if;

  insert into public.message_reactions (message_id, user_id, conversation_id, emoji)
  values (p_message, v_me, v_conv, v_emoji)
  on conflict (message_id, user_id)
  do update set emoji = excluded.emoji, created_at = now();
end;
$$;

revoke all on function public.react_to_message(uuid, text) from public, anon;
grant execute on function public.react_to_message(uuid, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'message_reactions'
     ) then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. send_chat_message()
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
  v_media text := '/storage/v1/object/public/chat-media/' || coalesce(auth.uid()::text, '') || '/';
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
  if p_image_url is not null and (char_length(p_image_url) > 1000 or position(v_media in p_image_url) = 0) then
    raise exception 'invalid_media';
  end if;
  if p_file_url is not null and (char_length(p_file_url) > 1000 or position(v_media in p_file_url) = 0) then
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
