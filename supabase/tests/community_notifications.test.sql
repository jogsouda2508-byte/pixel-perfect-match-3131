-- Local test for 20261105000000_community_notifications.sql (NOT a migration). Run on a THROWAWAY
-- database only: it creates and deletes test users and clears private.push_config.
\set ON_ERROR_STOP on
create schema if not exists net;
create table if not exists net.calls (id serial primary key, url text, headers jsonb, body jsonb);
select not exists (select 1 from pg_extension where extname = 'pg_net') as need_stub \gset
\if :need_stub
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
  headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language plpgsql as
  $$ begin insert into net.calls (url, headers, body) values (url, headers, body); return 1; end $$;
\endif
create or replace function t_ok(label text, cond boolean) returns void language plpgsql as
$$ begin if cond is not true then raise exception 'FAIL: %', label; end if; raise notice 'PASS: %', label; end $$;
create or replace function t_calls() returns bigint language sql as $$ select count(*) from net.calls $$;
create or replace function t_last() returns jsonb language sql as $$ select body from net.calls order by id desc limit 1 $$;
create or replace function t_rcpt() returns text language sql as $$
  select coalesce(string_agg(right(x, 2), ',' order by x), '') from jsonb_array_elements_text(t_last()->'recipient_ids') x $$;

delete from private.push_config; truncate net.calls;
delete from auth.users where email like '%@cn.local';
insert into auth.users (id, email, raw_user_meta_data)
select ('00000000-0000-0000-0000-0000000000' || n)::uuid, 'u' || n || '@cn.local',
       jsonb_build_object('full_name', 'U' || n, 'username', 'cn_u' || n)
from unnest(array['a1','a2','a3','a4','a5','a6','a7']) n;
-- a1 author/host, a2 nearby, a3 nearby but no device, a4 far away, a5 alerts off, a6 events off, a7 nearby
update public.profiles set location = case right(id::text, 2) when 'a4' then 'Bidar' else 'Whitefield, Bengaluru' end
 where id::text like '00000000-0000-0000-0000-0000000000a%';
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
select id, 'https://push.example/' || id, 'k', 'a' from auth.users
 where email like '%@cn.local' and right(id::text, 2) <> 'a3';
update public.profiles set full_name = full_name where false;
select public.set_community_notify_prefs(true, true) where false;
-- prefs are set directly (the function needs a signed-in user)
insert into public.community_notify_prefs (user_id, alerts, events) values
 ('00000000-0000-0000-0000-0000000000a5', false, true), ('00000000-0000-0000-0000-0000000000a6', true, false);

-- not configured => nothing sent, alert still saved
insert into public.community_alerts (id, author_id, kind, title, locality)
 values ('00000000-0000-0000-0000-0000000000f0','00000000-0000-0000-0000-0000000000a1','power','Test cut','Whitefield');
select t_ok('not configured: no call, alert still saved',
  t_calls() = 0 and exists (select 1 from public.community_alerts where id = '00000000-0000-0000-0000-0000000000f0'));
delete from public.community_alerts where id = '00000000-0000-0000-0000-0000000000f0';

insert into private.push_config values (true, 'https://proj.supabase.co/functions/v1/send-push', 's3cret');

-- alert
insert into public.community_alerts (id, author_id, kind, title, locality)
 values ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000a1','power','Power cut','Whitefield');
select t_ok('alert: one call with the secret header',
  (select count(*) = 1 and bool_and(headers->>'x-push-secret' = 's3cret') from net.calls));
select t_ok('alert: nearby + device + alerts on only (a2, a6, a7); not author, far, no device, alerts off (a5)',
  t_rcpt() = 'a2,a6,a7');
select t_ok('alert: sender is the author', t_last()->>'sender_id' = '00000000-0000-0000-0000-0000000000a1');
select t_ok('alert: title icon, unconfirmed body, Alerts tab, own tag',
  t_last()->>'title' = '⚡ Power cut' and t_last()->>'body' = 'Reported in Whitefield. Not confirmed yet.'
  and t_last()->>'url' = '/community?tab=alerts' and t_last()->>'tag' = 'community-alert:00000000-0000-0000-0000-0000000000f1');
truncate net.calls;
insert into public.community_alerts (author_id, kind, title, locality)
 values ('00000000-0000-0000-0000-0000000000a1','water','Bidar water','Bidar');
select t_ok('alert in another area goes to that area only', t_rcpt() = 'a4');

-- confirmations
truncate net.calls;
insert into public.community_alert_votes values ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000a2','confirm');
select t_ok('1 confirmation: nothing yet', t_calls() = 0);
insert into public.community_alert_votes values ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000a7','confirm');
select t_ok('2nd confirmation: one confirmed call, same tag (replaces the alert)',
  t_calls() = 1 and t_last()->>'tag' = 'community-alert:00000000-0000-0000-0000-0000000000f1'
  and t_last()->>'body' = 'Confirmed by 2 neighbours in Whitefield' and left(t_last()->>'title', 1) = '✅');
select t_ok('confirmed: nearby except the person who just confirmed (author included)', t_rcpt() = 'a1,a2,a6');
insert into public.community_alert_votes values ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000a5','confirm');
select t_ok('3rd confirmation: no second announcement', t_calls() = 1);
select t_ok('alert remembers it was announced',
  (select announced_at is not null from public.community_alerts where id = '00000000-0000-0000-0000-0000000000f1'));

-- disputes block the announcement
truncate net.calls;
insert into public.community_alerts (id, author_id, kind, title, locality)
 values ('00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000a1','road','Road shut','Whitefield');
truncate net.calls;
insert into public.community_alert_votes values
 ('00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000a5','dispute'),
 ('00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000a6','dispute'),
 ('00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000a2','confirm'),
 ('00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000a7','confirm');
select t_ok('2 confirm vs 2 dispute: not announced', t_calls() = 0);
insert into public.community_alert_votes values ('00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000a4','confirm');
select t_ok('3 confirm vs 2 dispute: announced', t_calls() = 1);

-- resolved alert
insert into public.community_alerts (id, author_id, kind, title, locality, resolved_at)
 values ('00000000-0000-0000-0000-0000000000f3','00000000-0000-0000-0000-0000000000a1','other','Done','Whitefield', now());
truncate net.calls;
insert into public.community_alert_votes values
 ('00000000-0000-0000-0000-0000000000f3','00000000-0000-0000-0000-0000000000a2','confirm'),
 ('00000000-0000-0000-0000-0000000000f3','00000000-0000-0000-0000-0000000000a7','confirm');
select t_ok('resolved alert: confirmations send nothing', t_calls() = 0);

-- spam guard (author a2 posts 4 alerts within an hour)
truncate net.calls;
insert into public.community_alerts (author_id, kind, title, locality)
 select '00000000-0000-0000-0000-0000000000a2', 'other', 'Spam ' || g, 'Whitefield' from generate_series(1, 3) g;
select t_ok('first 3 alerts in an hour notify', t_calls() = 3);
insert into public.community_alerts (author_id, kind, title, locality)
 values ('00000000-0000-0000-0000-0000000000a2', 'other', 'Spam 4', 'Whitefield');
select t_ok('4th alert in an hour: saved, nobody notified',
  t_calls() = 3 and exists (select 1 from public.community_alerts where title = 'Spam 4'));

-- events
truncate net.calls;
insert into public.community_events (id, host_id, title, locality, venue, starts_at)
 values ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a1','Weekend cricket','Whitefield','Ground 2',
         date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' + interval '1 day 19 hours');
select t_ok('event: nearby with events on (a2, a7, a5); not host, far, no device, events off', t_rcpt() = 'a2,a5,a7');
select t_ok('event: title, Indian time body, Events tab, own tag',
  t_last()->>'title' = '📅 Weekend cricket' and t_last()->>'body' = 'Tomorrow, 7 PM · Ground 2'
  and t_last()->>'url' = '/community?tab=events' and t_last()->>'tag' = 'community-event:00000000-0000-0000-0000-0000000000e1');
truncate net.calls;
insert into public.community_events (host_id, title, locality, starts_at, ends_at)
 values ('00000000-0000-0000-0000-0000000000a1','Old event','Whitefield', now() - interval '5 hours', now() - interval '4 hours');
select t_ok('event already over: saved, nobody notified', t_calls() = 0);

-- cancel
insert into public.community_event_rsvps values
 ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a2','going'),
 ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a5','interested'),
 ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a6','going');
truncate net.calls;
update public.community_events set cancelled = true where id = '00000000-0000-0000-0000-0000000000e1';
select t_ok('cancelled: RSVPs only (a2, a5), not host, not events-off a6, not a7 who did not RSVP', t_rcpt() = 'a2,a5');
select t_ok('cancelled: wording, Events tab, same tag as the new-event push',
  t_last()->>'title' = '❌ Cancelled: Weekend cricket' and t_last()->>'body' = 'Was planned for Tomorrow, 7 PM'
  and t_last()->>'tag' = 'community-event:00000000-0000-0000-0000-0000000000e1');
update public.community_events set cancelled = true where id = '00000000-0000-0000-0000-0000000000e1';
select t_ok('cancelling again sends nothing', t_calls() = 1);

-- big area: 1000 people in groups of 400, 400, 200
truncate net.calls;
select private.community_push(array(select gen_random_uuid() from generate_series(1, 1000)), null, 't', 'b', '/', 'x');
select t_ok('1000 people go out in groups of 400, 400, 200',
  (select array_agg(jsonb_array_length(body->'recipient_ids') order by id) = array[400,400,200] from net.calls));
truncate net.calls;
select private.community_push('{}', null, 't', 'b', '/', 'x');
select t_ok('nobody to tell: no call', t_calls() = 0);

-- push failure never breaks the post
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
  headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language plpgsql as
  $$ begin raise exception 'push service down'; end $$;
insert into public.community_alerts (id, author_id, kind, title, locality)
 values ('00000000-0000-0000-0000-0000000000f9','00000000-0000-0000-0000-0000000000a7','other','Still saved','Whitefield');
select t_ok('push failure: alert still saved', exists (select 1 from public.community_alerts where id = '00000000-0000-0000-0000-0000000000f9'));
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
  headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language plpgsql as
  $$ begin insert into net.calls (url, headers, body) values (url, headers, body); return 1; end $$;

-- time wording
select t_ok('time: hour / minutes / morning',
  private.community_when('2030-01-05 13:30:00+00') like '%7 PM' and private.community_when('2030-01-05 14:00:00+00') like '%7:30 PM'
  and private.community_when('2030-01-05 03:30:00+00') like '%9 AM');

-- preferences: default on, save, read back
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a7';
select t_ok('choices: nothing saved yet = both on', public.get_community_notify_prefs() = '{"alerts":true,"events":true}'::jsonb);
select public.set_community_notify_prefs(false, true);
select t_ok('choices: read back', public.get_community_notify_prefs() = '{"alerts":false,"events":true}'::jsonb);
do $$ begin
  begin perform * from public.community_notify_prefs; perform t_ok('client cannot read the table directly', false);
  exception when insufficient_privilege then perform t_ok('client cannot read the table directly', true); end;
  begin perform private.community_nearby('x', 'alerts', '{}'); perform t_ok('client cannot call the helper', false);
  exception when insufficient_privilege then perform t_ok('client cannot call the helper', true); end;
end $$;
reset role;

-- clean up
delete from private.push_config;
delete from public.community_alerts where author_id::text like '00000000-0000-0000-0000-0000000000a%';
delete from public.community_events where host_id::text like '00000000-0000-0000-0000-0000000000a%';
delete from auth.users where email like '%@cn.local';
