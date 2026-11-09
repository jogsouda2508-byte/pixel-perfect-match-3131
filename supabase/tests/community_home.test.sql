-- Local test for 20261106000000_community_home.sql (NOT a migration). THROWAWAY database only.
\set ON_ERROR_STOP on
create or replace function t_ok(label text, cond boolean) returns void language plpgsql as
$$ begin if cond is not true then raise exception 'FAIL: %', label; end if; raise notice 'PASS: %', label; end $$;

delete from auth.users where email like '%@ch.local';
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000b1','b1@ch.local','{"full_name":"Me","username":"ch_me"}'),
 ('00000000-0000-0000-0000-0000000000b2','b2@ch.local','{"full_name":"Neighbour","username":"ch_nb"}');

-- alerts: 2 active from the neighbour (one old), 1 of mine, 1 resolved, 1 other area
insert into public.community_alerts (author_id, kind, title, locality, created_at) values
 ('00000000-0000-0000-0000-0000000000b2','power','Power cut','Whitefield', now() - interval '10 minutes'),
 ('00000000-0000-0000-0000-0000000000b2','water','Old water','Whitefield', now() - interval '3 hours'),
 ('00000000-0000-0000-0000-0000000000b1','road','My alert','Whitefield', now() - interval '5 minutes'),
 ('00000000-0000-0000-0000-0000000000b2','other','Elsewhere','Bidar', now());
insert into public.community_alerts (author_id, kind, title, locality, resolved_at) values
 ('00000000-0000-0000-0000-0000000000b2','other','Fixed one','Whitefield', now());

-- events: weekend target computed independently of the function
create temp table tgt as
 select case when extract(dow from (now() at time zone 'Asia/Kolkata')) = 0
             then (now() at time zone 'Asia/Kolkata')::date
             else (select d::date from generate_series((now() at time zone 'Asia/Kolkata')::date,
                     (now() at time zone 'Asia/Kolkata')::date + 6, '1 day') d where extract(dow from d) = 6 limit 1) end as sat;
insert into public.community_events (host_id, title, locality, starts_at, created_at) values
 ('00000000-0000-0000-0000-0000000000b2','Weekend cricket','Whitefield',
    ((select sat from tgt) + time '23:00') at time zone 'Asia/Kolkata', now() - interval '1 hour'),
 ('00000000-0000-0000-0000-0000000000b1','My weekend meetup','Whitefield',
    ((select sat from tgt) + time '23:30') at time zone 'Asia/Kolkata', now() - interval '3 days'),
 ('00000000-0000-0000-0000-0000000000b2','Next week event','Whitefield',
    ((select sat from tgt) + 4 + time '10:00') at time zone 'Asia/Kolkata', now() - interval '2 days'),
 ('00000000-0000-0000-0000-0000000000b2','Cancelled one','Whitefield',
    ((select sat from tgt) + time '22:00') at time zone 'Asia/Kolkata', now());
update public.community_events set cancelled = true where title = 'Cancelled one';

set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
select public.get_community_home('Whitefield', now() - interval '1 day') as h \gset
select :'h'::jsonb as hj \gset
select t_ok('new alerts: others' active alerts in the area since the cut-off (not mine, not resolved, not other areas)',
  (:'hj'::jsonb->>'new_alerts')::int = 2);
select public.get_community_home('Whitefield', now() - interval '1 hour') as h2 \gset
select t_ok('new alerts: a later cut-off leaves only the recent one', (:'h2'::jsonb->>'new_alerts')::int = 1);
select t_ok('active alerts: 3 in Whitefield (mine included, resolved left out)', (:'hj'::jsonb->>'active_alerts')::int = 3);
select t_ok('top alert is the newest active one', :'hj'::jsonb->'top_alert'->>'title' = 'My alert');
select t_ok('new events: the neighbour''s weekend event only (not mine, not older, not cancelled)',
  (:'hj'::jsonb->>'new_events')::int = 1);
select t_ok('weekend events: the two on the weekend; not next week, not cancelled',
  (:'hj'::jsonb->>'weekend_events')::int = 2);
select t_ok('next event is the soonest upcoming one (cancelled never)',
  :'hj'::jsonb->'next_event'->>'title' in ('Weekend cricket', 'My weekend meetup'));
select t_ok('other area is separate', (public.get_community_home('Bidar', null)->>'active_alerts')::int = 1
  and (public.get_community_home('Bidar', null)->>'weekend_events')::int = 0);
select t_ok('everywhere (null) counts all areas', (public.get_community_home(null, null)->>'active_alerts')::int = 4);
select t_ok('cut-off is capped to 7 days',
  (public.get_community_home('Whitefield', now() - interval '60 days')->>'new_events')::int = 2);
select t_ok('empty area: zeros and nulls',
  public.get_community_home('Nowhere', null) = '{"new_alerts":0,"new_events":0,"active_alerts":0,"today_events":0,"weekend_events":0,"next_event":null,"top_alert":null}'::jsonb);
reset role;
set role anon;
do $$ begin
  begin perform public.get_community_home('x', null); perform t_ok('signed-out cannot call it', false);
  exception when insufficient_privilege then perform t_ok('signed-out cannot call it', true); end;
end $$;
reset role;

delete from public.community_alerts where author_id::text like '00000000-0000-0000-0000-0000000000b%';
delete from public.community_events where host_id::text like '00000000-0000-0000-0000-0000000000b%';
delete from auth.users where email like '%@ch.local';
