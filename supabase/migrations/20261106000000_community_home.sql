-- =====================================================================
-- Community on Home: the dot/count on the Community icon and the "what's happening near you" strip.
-- Run in Supabase SQL Editor AFTER 20261104000000_community.sql. Safe to run more than once.
--
-- ONE small read-only function, get_community_home, gives the Home screen everything it needs in a
-- single call, using the same "same area" rule as the Community screen (so the numbers match what
-- a person sees when they open it):
--   new_alerts      active alerts from other people posted after p_since
--   new_events      upcoming events from other people posted after p_since
--   active_alerts   all active alerts in the area
--   today_events    events starting today (Indian time) that are not over
--   weekend_events  events on this weekend (the rest of it, if it is Saturday or Sunday now)
--   next_event      the soonest upcoming event            { id, title, starts_at }
--   top_alert       the newest active alert               { id, kind, title }
-- p_since is "when the person last opened Community" (the app keeps it on the device); capped to 7 days.
-- p_locality null = everywhere, like the Community screen.
-- =====================================================================

do $$
begin
  if to_regclass('public.community_events') is null or to_regclass('public.community_alerts') is null then
    raise exception 'Run 20261104000000_community.sql first.';
  end if;
end $$;

create or replace function public.get_community_home(p_locality text, p_since timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  uid   uuid := auth.uid();
  since timestamptz := greatest(coalesce(p_since, now() - interval '1 day'), now() - interval '7 days');
  today date := (now() at time zone 'Asia/Kolkata')::date;
  dow   int  := extract(dow from now() at time zone 'Asia/Kolkata')::int;   -- 0 = Sunday ... 6 = Saturday
  w_start timestamptz; w_end timestamptz;
  new_a int; new_e int; act_a int; today_e int; wk_e int; nxt jsonb; top jsonb;
begin
  if uid is null then raise exception 'Please sign in first'; end if;

  if dow = 6 then
    w_start := now();                                   w_end := (today + 2)::timestamp at time zone 'Asia/Kolkata';
  elsif dow = 0 then
    w_start := now();                                   w_end := (today + 1)::timestamp at time zone 'Asia/Kolkata';
  else
    w_start := (today + (6 - dow))::timestamp at time zone 'Asia/Kolkata';
    w_end   := (today + (6 - dow) + 2)::timestamp at time zone 'Asia/Kolkata';
  end if;

  select count(*) filter (where a.author_id <> uid and a.created_at > since), count(*)
    into new_a, act_a
  from public.community_alerts a
  where a.resolved_at is null and a.expires_at > now()
    and (p_locality is null or public.community_norm(a.locality) = public.community_norm(p_locality));

  select case when a.id is null then null else jsonb_build_object('id', a.id, 'kind', a.kind, 'title', a.title) end
    into top
  from (select id, kind, title from public.community_alerts a
        where a.resolved_at is null and a.expires_at > now()
          and (p_locality is null or public.community_norm(a.locality) = public.community_norm(p_locality))
        order by a.created_at desc limit 1) a;

  select count(*) filter (where e.host_id <> uid and e.created_at > since),
         count(*) filter (where (e.starts_at at time zone 'Asia/Kolkata')::date = today),
         count(*) filter (where coalesce(e.ends_at, e.starts_at + interval '3 hours') >= w_start and e.starts_at < w_end)
    into new_e, today_e, wk_e
  from public.community_events e
  where not e.cancelled and coalesce(e.ends_at, e.starts_at + interval '3 hours') >= now()
    and (p_locality is null or public.community_norm(e.locality) = public.community_norm(p_locality));

  select jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at) into nxt
  from public.community_events e
  where not e.cancelled and coalesce(e.ends_at, e.starts_at + interval '3 hours') >= now()
    and (p_locality is null or public.community_norm(e.locality) = public.community_norm(p_locality))
  order by e.starts_at limit 1;

  return jsonb_build_object(
    'new_alerts', coalesce(new_a, 0), 'new_events', coalesce(new_e, 0),
    'active_alerts', coalesce(act_a, 0), 'today_events', coalesce(today_e, 0),
    'weekend_events', coalesce(wk_e, 0), 'next_event', nxt, 'top_alert', top);
end $$;

revoke all on function public.get_community_home(text, timestamptz) from public, anon;
grant execute on function public.get_community_home(text, timestamptz) to authenticated;
