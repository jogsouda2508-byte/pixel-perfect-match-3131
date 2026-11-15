-- =====================================================================
-- Push notifications for private-account follow requests
-- Run in Supabase SQL Editor AFTER 20261023000000_push_triggers.sql and
-- 20261021000000_private_accounts.sql. Safe to run more than once.
--
-- The in-app notification list already shows these two events (get_notifications has
-- 'follow_request' and 'follow_accepted'), but nothing pushed them to the phone / browser:
--
--   someone asks to follow my private account  -> I get "<name> wants to follow you"
--                                                 (tap opens /notifications, where I accept)
--   my request is accepted                     -> I get "<name> accepted your follow request"
--                                                 (tap opens their profile)
--
-- It also stops one duplicate: accepting a request inserts a row in `follows`, which used to
-- send the accepting person a "started following you" push for a request they had just
-- answered. push_on_follow now skips follows that come from a pending request.
--
-- Same safety rules as the other push triggers: a push problem never blocks the action.
-- =====================================================================

create or replace function private.push_on_follow_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uname text;
begin
  -- new pending request (first ask, or asking again after a decline / accepted-then-unfollowed)
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status is distinct from 'pending') then
    perform private.send_push(
      array[new.target_id], new.requester_id, private.push_name(new.requester_id),
      'wants to follow you', '/notifications', 'follow-request:' || new.requester_id);

  -- the account I asked accepted me
  elsif new.status = 'accepted' and tg_op = 'UPDATE' and old.status = 'pending' then
    select p.username into uname from public.profiles p where p.id = new.target_id;
    perform private.send_push(
      array[new.requester_id], new.target_id, private.push_name(new.target_id),
      'accepted your follow request',
      case when uname is null then '/notifications' else '/u/' || uname end,
      'follow-accepted:' || new.target_id);
  end if;
  return null;
exception when others then
  raise warning 'push_on_follow_request failed: %', sqlerrm;
  return null;
end;
$$;

revoke all on function private.push_on_follow_request() from public, anon, authenticated;

drop trigger if exists push_on_follow_request on public.follow_requests;
create trigger push_on_follow_request
  after insert or update of status on public.follow_requests
  for each row execute function private.push_on_follow_request();

-- push_on_follow: same as before, plus "not when this follow is the answer to a pending request"
-- (respond_follow_request inserts the follow BEFORE it marks the request accepted, and
-- accept_pending_requests_when_public does the same, so the request is still 'pending' here).
create or replace function private.push_on_follow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uname text;
begin
  if exists (select 1 from public.follow_requests r
             where r.requester_id = new.follower_id
               and r.target_id = new.following_id
               and r.status = 'pending') then
    return null;
  end if;

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

revoke all on function private.push_on_follow() from public, anon, authenticated;
