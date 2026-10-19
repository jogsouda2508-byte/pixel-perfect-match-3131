-- =====================================================================
-- Gicco chat: send Web Push notifications from database triggers
-- Run in Supabase SQL Editor AFTER 20261022000000_push_subscriptions.sql.
-- Safe to run more than once.
--
-- Each trigger works out WHO should be told (never the person who did it) and
-- asks the `send-push` Edge Function, through pg_net, to push it to their
-- saved devices. The triggers are attached to the SOURCE tables (messages,
-- post_likes, post_comments, follows, post_tags, story_views), the same
-- tables get_notifications() reads, so in-app and push notifications agree.
--
--   new chat message / shared post  -> everyone in the conversation except the sender
--   like / comment                  -> the post's author
--   follow                          -> the person followed
--   tag                             -> the tagged person
--   story like (first like only)    -> the story's author
--
-- Safety rules:
--   * A push problem can NEVER block or fail the action that caused it:
--     every call is wrapped, failures only raise a WARNING.
--   * Nothing is sent until you store the function URL + secret (see the
--     INSERT at the bottom). Until then the triggers do nothing.
--   * pg_net is asynchronous, so saving a message / like is not slowed down.
--   * Group invitations are not included: this app has no invitation table
--     (people join groups directly). Group chat is not included either:
--     chat is one-to-one today, and the message trigger already notifies
--     every participant of a conversation, so it works if groups get chat.
-- =====================================================================

do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net could not be enabled here (%). Enable it in Supabase: Database -> Extensions -> pg_net.', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- Private settings: not exposed through the API, readable only by the
-- trigger functions below (they run as their owner).
-- ---------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.push_config (
  id             boolean primary key default true constraint push_config_single_row check (id),
  function_url   text not null,
  webhook_secret text not null
);
alter table private.push_config enable row level security;
revoke all on private.push_config from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- private.send_push: one place that calls the Edge Function
-- ---------------------------------------------------------------------
create or replace function private.send_push(
  p_recipients uuid[],
  p_sender     uuid,
  p_title      text,
  p_body       text,
  p_url        text,
  p_tag        text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg private.push_config;
begin
  if coalesce(array_length(p_recipients, 1), 0) = 0 then
    return;
  end if;

  select * into cfg from private.push_config limit 1;
  if not found then
    return;                         -- not configured yet: do nothing
  end if;

  perform net.http_post(
    url     := cfg.function_url,
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'x-push-secret', cfg.webhook_secret),
    body    := jsonb_build_object(
                 'recipient_ids', to_jsonb(p_recipients),
                 'sender_id',     p_sender,
                 'title',         p_title,
                 'body',          coalesce(p_body, ''),
                 'url',           p_url,
                 'tag',           p_tag)
  );
exception when others then
  -- never break the action that triggered this
  raise warning 'send_push failed: %', sqlerrm;
end;
$$;

revoke all on function private.send_push(uuid[], uuid, text, text, text, text) from public, anon, authenticated;

-- display name of a person (full name, else @username)
create or replace function private.push_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(btrim(p.full_name), ''), '@' || p.username, 'Someone')
  from public.profiles p where p.id = p_user;
$$;
revoke all on function private.push_name(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Chat messages (and shared posts / videos): everyone but the sender.
--    tag = chat:<conversation>, so several messages in one chat replace each
--    other on the lock screen instead of flooding it.
-- ---------------------------------------------------------------------
create or replace function private.push_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipients uuid[];
  shared_kind text;
  preview text;
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

  perform private.send_push(
    recipients, new.sender_id, private.push_name(new.sender_id), preview,
    '/chat/' || new.conversation_id, 'chat:' || new.conversation_id);
  return null;
exception when others then
  raise warning 'push_on_message failed: %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists push_on_message on public.messages;
create trigger push_on_message
  after insert on public.messages
  for each row execute function private.push_on_message();

-- ---------------------------------------------------------------------
-- 2. Likes on my post
-- ---------------------------------------------------------------------
create or replace function private.push_on_post_like()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
begin
  select p.author_id into owner from public.posts p where p.id = new.post_id;
  if owner is not null and owner <> new.user_id then
    perform private.send_push(
      array[owner], new.user_id, private.push_name(new.user_id), 'liked your post',
      '/post/' || new.post_id, 'like:' || new.post_id);
  end if;
  return null;
exception when others then
  raise warning 'push_on_post_like failed: %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists push_on_post_like on public.post_likes;
create trigger push_on_post_like
  after insert on public.post_likes
  for each row execute function private.push_on_post_like();

-- ---------------------------------------------------------------------
-- 3. Comments on my post
-- ---------------------------------------------------------------------
create or replace function private.push_on_post_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
begin
  select p.author_id into owner from public.posts p where p.id = new.post_id;
  if owner is not null and owner <> new.author_id then
    perform private.send_push(
      array[owner], new.author_id, private.push_name(new.author_id),
      'commented: ' || left(new.content, 100),
      '/post/' || new.post_id || '?comments=true', 'comment:' || new.post_id);
  end if;
  return null;
exception when others then
  raise warning 'push_on_post_comment failed: %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists push_on_post_comment on public.post_comments;
create trigger push_on_post_comment
  after insert on public.post_comments
  for each row execute function private.push_on_post_comment();

-- ---------------------------------------------------------------------
-- 4. New follower: opens their profile
-- ---------------------------------------------------------------------
create or replace function private.push_on_follow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uname text;
begin
  select p.username into uname from public.profiles p where p.id = new.follower_id;
  perform private.send_push(
    array[new.following_id], new.follower_id, private.push_name(new.follower_id),
    'started following you',
    case when uname is null then '/notifications' else '/u/' || uname end,
    'follow:' || new.follower_id);
  return null;
exception when others then
  raise warning 'push_on_follow failed: %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists push_on_follow on public.follows;
create trigger push_on_follow
  after insert on public.follows
  for each row execute function private.push_on_follow();

-- ---------------------------------------------------------------------
-- 5. Tagged in a post (set_post_tags already checked who may see the post)
-- ---------------------------------------------------------------------
create or replace function private.push_on_post_tag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform private.send_push(
    array[new.tagged_user_id], new.tagged_by, private.push_name(new.tagged_by),
    'tagged you in a post', '/post/' || new.post_id, 'tag:' || new.post_id);
  return null;
exception when others then
  raise warning 'push_on_post_tag failed: %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists push_on_post_tag on public.post_tags;
create trigger push_on_post_tag
  after insert on public.post_tags
  for each row execute function private.push_on_post_tag();

-- ---------------------------------------------------------------------
-- 6. Story like: only the FIRST time a person likes a story (like -> unlike ->
--    like again does not notify again, same rule as the in-app notification).
-- ---------------------------------------------------------------------
create or replace function private.push_on_story_like()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
begin
  if new.first_liked_at is null or (tg_op = 'UPDATE' and old.first_liked_at is not null) then
    return null;
  end if;
  select s.author_id into owner from public.stories s where s.id = new.story_id;
  if owner is not null and owner <> new.viewer_id then
    perform private.send_push(
      array[owner], new.viewer_id, private.push_name(new.viewer_id), 'liked your story',
      '/notifications', 'story-like:' || new.story_id);
  end if;
  return null;
exception when others then
  raise warning 'push_on_story_like failed: %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists push_on_story_like on public.story_views;
create trigger push_on_story_like
  after insert or update on public.story_views
  for each row execute function private.push_on_story_like();

-- ---------------------------------------------------------------------
-- LAST STEP (once, by you; not part of the migration because it holds a secret):
--
--   insert into private.push_config (id, function_url, webhook_secret)
--   values (true,
--           'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/send-push',
--           '<the same value as the PUSH_WEBHOOK_SECRET secret>')
--   on conflict (id) do update
--     set function_url = excluded.function_url, webhook_secret = excluded.webhook_secret;
--
-- To pause all push notifications:  delete from private.push_config;
-- ---------------------------------------------------------------------
