-- =====================================================================
-- Ediraa: edit and delete my own chat messages (for everyone in the chat)
-- Run in Supabase SQL Editor AFTER 20261028000000_voice_messages.sql.
-- Safe to run more than once. Only ADDS things: no existing table, policy,
-- trigger or function is changed, so sending / receiving keeps working as before.
--
-- 1. messages.edited_at (null until a message is edited)
-- 2. edit_message(message, body)  -> the updated messages row
--      only the sender, only plain text messages (not voice / shared post / story reply)
-- 3. delete_message(message)      -> removes the row, so it disappears for the
--      sender AND the receiver(s); works for text, voice, shared posts, story replies
--    The client has no direct UPDATE / DELETE grant on messages; only these two
--    functions can change a message, and only your own.
--    Errors the client maps to text:
--      not_authenticated | not_allowed | not_editable | invalid_message
-- =====================================================================

alter table public.messages
  add column if not exists edited_at timestamptz;

-- ---------------------------------------------------------------------
-- edit_message
-- ---------------------------------------------------------------------
create or replace function public.edit_message(p_message uuid, p_body text)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_msg  public.messages;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_msg from public.messages where id = p_message;
  if not found
     or v_msg.sender_id <> v_me
     or not public.is_conversation_member(v_msg.conversation_id) then
    raise exception 'not_allowed';
  end if;

  -- only plain text can be edited (to_jsonb keeps this safe even if a column is absent)
  if v_msg.audio_url is not null
     or v_msg.shared_post_id is not null
     or (to_jsonb(v_msg) ->> 'story_kind') is not null then
    raise exception 'not_editable';
  end if;

  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'invalid_message';
  end if;

  update public.messages
  set body = v_body,
      edited_at = now()
  where id = p_message
  returning * into v_msg;

  -- keep the chat-list preview right when the newest message was edited
  update public.conversations
  set last_message_preview = left(v_body, 80)
  where id = v_msg.conversation_id
    and last_message_at = v_msg.created_at;

  return v_msg;
end;
$$;

revoke all on function public.edit_message(uuid, text) from public, anon;
grant execute on function public.edit_message(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- delete_message
-- ---------------------------------------------------------------------
create or replace function public.delete_message(p_message uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_conv uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select m.conversation_id into v_conv
  from public.messages m
  where m.id = p_message and m.sender_id = v_me;

  if v_conv is null or not public.is_conversation_member(v_conv) then
    raise exception 'not_allowed';
  end if;

  delete from public.messages where id = p_message;

  -- the chat list shows the newest remaining message (or nothing if it was the only one)
  update public.conversations c
  set last_message_at = (
        select max(m.created_at) from public.messages m where m.conversation_id = c.id
      ),
      last_message_preview = (
        select left(m.body, 80)
        from public.messages m
        where m.conversation_id = c.id
        order by m.created_at desc
        limit 1
      )
  where c.id = v_conv;
end;
$$;

revoke all on function public.delete_message(uuid) from public, anon;
grant execute on function public.delete_message(uuid) to authenticated;
