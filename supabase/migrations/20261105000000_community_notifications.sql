-- =====================================================================
-- Community push notifications (step 2): nearby alerts and events.
-- Run in Supabase SQL Editor AFTER the chat push migrations (20261022 .. 20261024, 20261031)
-- and AFTER 20261104000000_community.sql. Safe to run more than once.
--
-- This REUSES the chat push system: every notification goes through private.send_push, so
-- the same Edge Function, the same devices (web push + Android) and the same on/off switch
-- (private.push_config) apply. Nothing new to deploy.
--
--   new alert in my area            -> nearby people ("Reported in Whitefield. Not confirmed yet.")
--   alert reaches 2 confirmations   -> nearby people, ONCE; replaces the first notification
--   new event in my area            -> nearby people ("Tomorrow, 7 PM . Whitefield")
--   event I joined is cancelled     -> everyone who said going / interested
--
-- Who counts as "nearby": the location in the person's profile, using the same rule as the
-- "Local" badge on answers (community_is_local). Only people who have a device registered.
-- Each person can switch alerts and events off (community_notify_prefs); default is on.
--
-- Safety rules (same as chat push):
--   * A push problem can NEVER block or fail the post, vote or cancel that caused it.
--   * Nothing is sent until private.push_config is filled in.
--   * Spam guard: a person's 4th alert (or event) within an hour is saved but nobody is told.
--   * One call to the Edge Function takes at most 500 people, so big areas are sent in groups of 400.
-- =====================================================================

do $$
begin
  if to_regprocedure('private.send_push(uuid[],uuid,text,text,text,text)') is null
     or to_regclass('public.push_subscriptions') is null
     or to_regclass('public.device_tokens') is null then
    raise exception 'Run the chat push migrations first (20261022000000_push_subscriptions, 20261023000000_push_triggers, 20261031000000_device_tokens).';
  end if;
  if to_regclass('public.community_alerts') is null or to_regclass('public.community_events') is null then
    raise exception 'Run 20261104000000_community.sql first.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Each person's choices. Read and written only through the two functions below.
-- ---------------------------------------------------------------------
create table if not exists public.community_notify_prefs (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  alerts     boolean not null default true,
  events     boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.community_notify_prefs enable row level security;
revoke all on public.community_notify_prefs from public, anon, authenticated;

-- remembers that "confirmed by neighbours" was already announced (so it is sent only once)
alter table public.community_alerts add column if not exists announced_at timestamptz;

create or replace function public.get_community_notify_prefs()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); r public.community_notify_prefs%rowtype;
begin
  if uid is null then raise exception 'Please sign in first'; end if;
  select * into r from public.community_notify_prefs where user_id = uid;
  return jsonb_build_object('alerts', coalesce(r.alerts, true), 'events', coalesce(r.events, true));
end $$;

create or replace function public.set_community_notify_prefs(p_alerts boolean, p_events boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Please sign in first'; end if;
  insert into public.community_notify_prefs (user_id, alerts, events, updated_at)
  values (uid, coalesce(p_alerts, true), coalesce(p_events, true), now())
  on conflict (user_id) do update
    set alerts = excluded.alerts, events = excluded.events, updated_at = now();
  return jsonb_build_object('alerts', coalesce(p_alerts, true), 'events', coalesce(p_events, true));
end $$;

revoke all on function public.get_community_notify_prefs() from public, anon;
revoke all on function public.set_community_notify_prefs(boolean, boolean) from public, anon;
grant execute on function public.get_community_notify_prefs() to authenticated;
grant execute on function public.set_community_notify_prefs(boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Helpers (private: nobody but the trigger functions can call them)
-- ---------------------------------------------------------------------

-- "Tomorrow, 7 PM" / "Today, 6:30 PM" / "Sat 15 Nov, 7 PM" in Indian time
create or replace function private.community_when(p_ts timestamptz)
returns text language sql stable set search_path = public as $$
  select case
           when (p_ts at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date then 'Today'
           when (p_ts at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date + 1 then 'Tomorrow'
           else to_char(p_ts at time zone 'Asia/Kolkata', 'Dy FMDD Mon')
         end
         || ', ' ||
         case when extract(minute from p_ts at time zone 'Asia/Kolkata') = 0
              then to_char(p_ts at time zone 'Asia/Kolkata', 'FMHH12 AM')
              else to_char(p_ts at time zone 'Asia/Kolkata', 'FMHH12:MI AM') end $$;

create or replace function private.community_alert_emoji(p_kind text)
returns text language sql immutable as $$
  select case p_kind when 'power' then '⚡' when 'water' then '💧' when 'road' then '🚧'
                     when 'safety' then '⚠️' else '📢' end $$;

-- Sends to everyone in the list, 400 at a time (the Edge Function accepts at most 500 per call).
create or replace function private.community_push(
  p_recipients uuid[], p_sender uuid, p_title text, p_body text, p_url text, p_tag text)
returns void language plpgsql security definer set search_path = public as $$
declare n int := coalesce(array_length(p_recipients, 1), 0); i int := 1;
begin
  while i <= n loop
    perform private.send_push(p_recipients[i : least(i + 399, n)], p_sender, p_title, p_body, p_url, p_tag);
    i := i + 400;
  end loop;
end $$;

-- People who live near p_locality, have a device, and want this kind of notification.
-- p_kind is 'alerts' or 'events'. Nobody in p_exclude is included.
create or replace function private.community_nearby(p_locality text, p_kind text, p_exclude uuid[])
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(pr.id), '{}')
  from public.profiles pr
  left join public.community_notify_prefs np on np.user_id = pr.id
  where public.community_norm(pr.location) <> ''
    and (public.community_norm(pr.location) = public.community_norm(p_locality)
         or (length(public.community_norm(p_locality)) >= 3
             and position(public.community_norm(p_locality) in public.community_norm(pr.location)) > 0))
    and (case p_kind when 'alerts' then coalesce(np.alerts, true) else coalesce(np.events, true) end)
    and not (pr.id = any (coalesce(p_exclude, '{}')))
    and (exists (select 1 from public.push_subscriptions s where s.user_id = pr.id)
         or exists (select 1 from public.device_tokens d where d.user_id = pr.id)) $$;

revoke all on function private.community_when(timestamptz) from public, anon, authenticated;
revoke all on function private.community_alert_emoji(text) from public, anon, authenticated;
revoke all on function private.community_push(uuid[], uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function private.community_nearby(text, text, uuid[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. New alert -> nearby people (not the author). tag = community-alert:<id>
-- ---------------------------------------------------------------------
create or replace function private.push_on_community_alert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.resolved_at is not null or new.expires_at <= now() then return null; end if;
  -- spam guard: more than 3 alerts from one person in an hour are saved but not announced
  if (select count(*) from public.community_alerts a
        where a.author_id = new.author_id and a.created_at > now() - interval '1 hour') > 3 then
    return null;
  end if;
  perform private.community_push(
    private.community_nearby(new.locality, 'alerts', array[new.author_id]),
    new.author_id,
    private.community_alert_emoji(new.kind) || ' ' || new.title,
    'Reported in ' || new.locality || '. Not confirmed yet.',
    '/community?tab=alerts',
    'community-alert:' || new.id);
  return null;
exception when others then
  raise warning 'push_on_community_alert failed: %', sqlerrm;
  return null;
end $$;

drop trigger if exists push_on_community_alert on public.community_alerts;
create trigger push_on_community_alert
  after insert on public.community_alerts
  for each row execute function private.push_on_community_alert();

-- ---------------------------------------------------------------------
-- 2. Alert reaches "confirmed" (2+ confirmations and more confirms than disputes, the same
--    rule get_community_alerts uses) -> ONE announcement, same tag, so it replaces the first.
-- ---------------------------------------------------------------------
create or replace function private.push_on_community_alert_vote()
returns trigger language plpgsql security definer set search_path = public as $$
declare a public.community_alerts%rowtype; c int; d int;
begin
  if new.vote <> 'confirm' then return null; end if;
  select * into a from public.community_alerts where id = new.alert_id for update;
  if not found or a.announced_at is not null or a.resolved_at is not null or a.expires_at <= now() then
    return null;
  end if;
  select count(*) filter (where vote = 'confirm'), count(*) filter (where vote = 'dispute')
    into c, d from public.community_alert_votes where alert_id = a.id;
  if c < 2 or c <= d then return null; end if;

  update public.community_alerts set announced_at = now() where id = a.id;
  perform private.community_push(
    private.community_nearby(a.locality, 'alerts', array[new.user_id]),
    new.user_id,
    '✅ ' || private.community_alert_emoji(a.kind) || ' ' || a.title,
    'Confirmed by ' || c || ' neighbours in ' || a.locality,
    '/community?tab=alerts',
    'community-alert:' || a.id);
  return null;
exception when others then
  raise warning 'push_on_community_alert_vote failed: %', sqlerrm;
  return null;
end $$;

drop trigger if exists push_on_community_alert_vote on public.community_alert_votes;
create trigger push_on_community_alert_vote
  after insert or update on public.community_alert_votes
  for each row execute function private.push_on_community_alert_vote();

-- ---------------------------------------------------------------------
-- 3. New event -> nearby people with events on (not the host). tag = community-event:<id>
-- ---------------------------------------------------------------------
create or replace function private.push_on_community_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cancelled or coalesce(new.ends_at, new.starts_at + interval '3 hours') < now() then return null; end if;
  if (select count(*) from public.community_events e
        where e.host_id = new.host_id and e.created_at > now() - interval '1 hour') > 3 then
    return null;
  end if;
  perform private.community_push(
    private.community_nearby(new.locality, 'events', array[new.host_id]),
    new.host_id,
    '📅 ' || new.title,
    private.community_when(new.starts_at) || ' · ' || coalesce(nullif(btrim(new.venue), ''), new.locality),
    '/community?tab=events',
    'community-event:' || new.id);
  return null;
exception when others then
  raise warning 'push_on_community_event failed: %', sqlerrm;
  return null;
end $$;

drop trigger if exists push_on_community_event on public.community_events;
create trigger push_on_community_event
  after insert on public.community_events
  for each row execute function private.push_on_community_event();

-- ---------------------------------------------------------------------
-- 4. Event cancelled -> everyone who said going or interested (not the host, not people with
--    events switched off). Same tag as the "new event" push, so it replaces it.
-- ---------------------------------------------------------------------
create or replace function private.push_on_community_event_cancel()
returns trigger language plpgsql security definer set search_path = public as $$
declare recipients uuid[];
begin
  if not new.cancelled or old.cancelled then return null; end if;
  if coalesce(new.ends_at, new.starts_at + interval '3 hours') < now() then return null; end if;

  select coalesce(array_agg(r.user_id), '{}') into recipients
  from public.community_event_rsvps r
  left join public.community_notify_prefs np on np.user_id = r.user_id
  where r.event_id = new.id and r.user_id <> new.host_id and coalesce(np.events, true)
    and (exists (select 1 from public.push_subscriptions s where s.user_id = r.user_id)
         or exists (select 1 from public.device_tokens d where d.user_id = r.user_id));

  perform private.community_push(
    recipients, new.host_id,
    '❌ Cancelled: ' || new.title,
    'Was planned for ' || private.community_when(new.starts_at),
    '/community?tab=events',
    'community-event:' || new.id);
  return null;
exception when others then
  raise warning 'push_on_community_event_cancel failed: %', sqlerrm;
  return null;
end $$;

drop trigger if exists push_on_community_event_cancel on public.community_events;
create trigger push_on_community_event_cancel
  after update of cancelled on public.community_events
  for each row execute function private.push_on_community_event_cancel();
