-- =====================================================================
-- Ediraa: push notifications for GROUP INVITES + clearer GROUP CHAT pushes
-- Run in Supabase SQL Editor AFTER 20261023000000_push_triggers.sql.
-- Safe to run more than once. Changes no tables and no app code.
--
-- 1. Group invitation  -> the invited person gets "<name> invited you to join <group>"
--                         (tapping it opens /groups, where Accept / Decline is).
-- 2. Group chat message -> title becomes "<sender> in <group name>" so people can tell
--                         a group message from a 1:1 message. 1:1 messages are unchanged.
--
-- Same safety rules as the other push triggers: a push problem can never block or fail
-- the action that caused it, and nothing is sent until private.push_config is filled in.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Chat messages: same as before, but group chats show the group name
-- ---------------------------------------------------------------------
create or replace function private.push_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipients  uuid[];
  shared_kind text;
  preview     text;
  group_name  text;
  title       text;
begin
  select coalesce(array_agg(cp.user_id), '{}') into recipients
  from public.conversation_participants cp
  where cp.conversation_id = new.conversation_id and cp.user_id <> new.sender_id;

  if new.shared_post_id is not null then
    select coalesce(sp.media_type, 'post') into shared_kind
    from public.posts sp where sp.id = new.shared_post_id;
    preview := case when shared_kind = 'video' then 'shared a video with you'
                    else 'shared a post with you' end;
  else
    preview := left(new.body, 100);
  end if;

  -- group chat? (conversations.group_id is set only for group rooms)
  select g.name into group_name
  from public.conversations c
  join public.groups g on g.id = c.group_id
  where c.id = new.conversation_id;

  title := private.push_name(new.sender_id);
  if group_name is not null then
    title := title || ' in ' || group_name;
  end if;

  perform private.send_push(
    recipients, new.sender_id, title, preview,
    '/chat/' || new.conversation_id, 'chat:' || new.conversation_id);
  return null;
exception when others then
  raise warning 'push_on_message failed: %', sqlerrm;
  return null;
end;
$$;

-- the trigger itself already exists (20261023000000); re-create it so this file is complete on its own
drop trigger if exists push_on_message on public.messages;
create trigger push_on_message
  after insert on public.messages
  for each row execute function private.push_on_message();

-- ---------------------------------------------------------------------
-- 2. Group invitation: notify the invited person
--    (group_invites is only written by create_group / invite_to_group)
-- ---------------------------------------------------------------------
create or replace function private.push_on_group_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  gname text;
begin
  select g.name into gname from public.groups g where g.id = new.group_id;

  perform private.send_push(
    array[new.user_id], new.invited_by, private.push_name(new.invited_by),
    'invited you to join ' || coalesce(gname, 'a group'),
    '/groups', 'group-invite:' || new.group_id);
  return null;
exception when others then
  raise warning 'push_on_group_invite failed: %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists push_on_group_invite on public.group_invites;
create trigger push_on_group_invite
  after insert on public.group_invites
  for each row execute function private.push_on_group_invite();
