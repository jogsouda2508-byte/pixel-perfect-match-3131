-- =====================================================================
-- Gicco chat: Community hub (events, alerts, skill swap, polls & quiz, ask a local).
-- Run in Supabase Dashboard -> SQL Editor (or `supabase db push`). Safe to run more than once.
-- Reads and sensitive writes (RSVPs, votes, quiz answers) go through functions at the bottom.
-- =====================================================================

create or replace function public.community_norm(t text) returns text
language sql immutable as $$ select lower(regexp_replace(btrim(coalesce(t, '')), '\s+', ' ', 'g')) $$;

create or replace function public.community_skills_match(a text, b text) returns boolean
language sql immutable as $$
  select case
    when public.community_norm(a) = '' or public.community_norm(b) = '' then false
    when public.community_norm(a) = public.community_norm(b) then true
    else length(public.community_norm(a)) >= 4 and length(public.community_norm(b)) >= 4
         and (position(public.community_norm(a) in public.community_norm(b)) > 0
              or position(public.community_norm(b) in public.community_norm(a)) > 0)
  end $$;

create or replace function public.community_person(p uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', pr.id, 'name', coalesce(nullif(pr.full_name, ''), pr.username),
                            'username', pr.username, 'avatar_url', pr.avatar_url)
  from public.profiles pr where pr.id = p $$;

-- ------------------------------------------------------------------ events
create table if not exists public.community_events (
  id          uuid primary key default gen_random_uuid(),
  host_id     uuid not null references public.profiles (id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 3 and 100),
  description text check (description is null or char_length(description) <= 1000),
  category    text not null default 'Other' check (char_length(category) between 1 and 30),
  locality    text not null check (char_length(btrim(locality)) between 2 and 60),
  venue       text check (venue is null or char_length(venue) <= 120),
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  capacity    int check (capacity is null or capacity between 1 and 100000),
  cancelled   boolean not null default false,
  created_at  timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
create index if not exists community_events_starts_idx on public.community_events (starts_at);

create table if not exists public.community_event_rsvps (
  event_id   uuid not null references public.community_events (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  status     text not null check (status in ('going', 'interested')),
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

-- ------------------------------------------------------------------ alerts
create table if not exists public.community_alerts (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('power', 'water', 'road', 'safety', 'other')),
  title       text not null check (char_length(btrim(title)) between 3 and 80),
  details     text check (details is null or char_length(details) <= 300),
  locality    text not null check (char_length(btrim(locality)) between 2 and 60),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '12 hours',
  resolved_at timestamptz
);
create index if not exists community_alerts_created_idx on public.community_alerts (created_at desc);

create table if not exists public.community_alert_votes (
  alert_id   uuid not null references public.community_alerts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  vote       text not null check (vote in ('confirm', 'dispute')),
  created_at timestamptz not null default now(),
  primary key (alert_id, user_id)
);

-- -------------------------------------------------------------- skill swaps
create table if not exists public.community_skill_swaps (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  teach      text not null check (char_length(btrim(teach)) between 2 and 40),
  want       text not null check (char_length(btrim(want)) between 2 and 40),
  mode       text not null default 'either' check (mode in ('in_person', 'online', 'either')),
  note       text check (note is null or char_length(note) <= 200),
  locality   text not null check (char_length(btrim(locality)) between 2 and 60),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists community_skill_swaps_created_idx on public.community_skill_swaps (created_at desc);

-- --------------------------------------------------------- polls and quizzes
create table if not exists public.community_polls (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references public.profiles (id) on delete cascade,
  kind       text not null default 'poll' check (kind in ('poll', 'quiz')),
  question   text not null check (char_length(btrim(question)) between 5 and 100),
  locality   text check (locality is null or char_length(btrim(locality)) between 2 and 60),
  closes_at  timestamptz not null,
  created_at timestamptz not null default now()
);
create table if not exists public.community_poll_options (
  id       uuid primary key default gen_random_uuid(),
  poll_id  uuid not null references public.community_polls (id) on delete cascade,
  label    text not null check (char_length(btrim(label)) between 1 and 40),
  position int not null
);
create table if not exists public.community_poll_votes (
  poll_id    uuid not null references public.community_polls (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  option_id  uuid not null references public.community_poll_options (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);
create table if not exists public.community_quiz_keys (
  poll_id   uuid primary key references public.community_polls (id) on delete cascade,
  option_id uuid not null references public.community_poll_options (id) on delete cascade
);

-- --------------------------------------------------------------- ask a local
create table if not exists public.community_questions (
  id                 uuid primary key default gen_random_uuid(),
  author_id          uuid not null references public.profiles (id) on delete cascade,
  title              text not null check (char_length(btrim(title)) between 5 and 140),
  body               text check (body is null or char_length(body) <= 1000),
  category           text not null default 'Other' check (char_length(category) between 1 and 30),
  locality           text not null check (char_length(btrim(locality)) between 2 and 60),
  accepted_answer_id uuid,
  created_at         timestamptz not null default now()
);
create index if not exists community_questions_created_idx on public.community_questions (created_at desc);

create table if not exists public.community_answers (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.community_questions (id) on delete cascade,
  author_id   uuid not null references public.profiles (id) on delete cascade,
  body        text not null check (char_length(btrim(body)) between 2 and 1000),
  created_at  timestamptz not null default now()
);
create index if not exists community_answers_question_idx on public.community_answers (question_id);

do $$ begin
  alter table public.community_questions
    add constraint community_questions_accepted_fk foreign key (accepted_answer_id)
    references public.community_answers (id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists public.community_answer_helpful (
  answer_id  uuid not null references public.community_answers (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (answer_id, user_id)
);

-- ------------------------------------------------ row level security + grants
do $$
declare t text;
begin
  foreach t in array array['community_events','community_event_rsvps','community_alerts','community_alert_votes',
    'community_skill_swaps','community_polls','community_poll_options','community_poll_votes','community_quiz_keys',
    'community_questions','community_answers','community_answer_helpful']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- public-read tables: everyone signed in can read, people change only their own rows
grant select on public.community_events, public.community_alerts, public.community_skill_swaps,
  public.community_polls, public.community_poll_options, public.community_questions,
  public.community_answers to authenticated;

grant insert (host_id, title, description, category, locality, venue, starts_at, ends_at, capacity)
  on public.community_events to authenticated;
grant update (cancelled) on public.community_events to authenticated;
grant insert (author_id, kind, title, details, locality) on public.community_alerts to authenticated;
grant update (resolved_at) on public.community_alerts to authenticated;
grant insert (user_id, teach, want, mode, note, locality) on public.community_skill_swaps to authenticated;
grant update (active) on public.community_skill_swaps to authenticated;
grant insert (author_id, title, body, category, locality) on public.community_questions to authenticated;
grant insert (question_id, author_id, body) on public.community_answers to authenticated;
grant delete on public.community_events, public.community_alerts, public.community_skill_swaps,
  public.community_polls, public.community_questions, public.community_answers to authenticated;

do $$
declare r record;
begin
  for r in select * from (values
    ('community_events','host_id'), ('community_alerts','author_id'), ('community_skill_swaps','user_id'),
    ('community_polls','author_id'), ('community_questions','author_id'), ('community_answers','author_id')
  ) as v(tbl, owner_col)
  loop
    execute format('drop policy if exists %I on public.%I', r.tbl || '_select', r.tbl);
    execute format('create policy %I on public.%I for select to authenticated using (true)', r.tbl || '_select', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl || '_delete_own', r.tbl);
    execute format('create policy %I on public.%I for delete to authenticated using (%I = auth.uid())', r.tbl || '_delete_own', r.tbl, r.owner_col);
    if r.tbl <> 'community_polls' then
      execute format('drop policy if exists %I on public.%I', r.tbl || '_insert_own', r.tbl);
      execute format('create policy %I on public.%I for insert to authenticated with check (%I = auth.uid())', r.tbl || '_insert_own', r.tbl, r.owner_col);
    end if;
    if r.tbl in ('community_events','community_alerts','community_skill_swaps') then
      execute format('drop policy if exists %I on public.%I', r.tbl || '_update_own', r.tbl);
      execute format('create policy %I on public.%I for update to authenticated using (%I = auth.uid()) with check (%I = auth.uid())', r.tbl || '_update_own', r.tbl, r.owner_col, r.owner_col);
    end if;
  end loop;
end $$;

drop policy if exists community_poll_options_select on public.community_poll_options;
create policy community_poll_options_select on public.community_poll_options for select to authenticated using (true);

-- an answer can only be added to a question that exists (the foreign key does that), nothing more to check

-- =============================================================== functions
-- ---- events
create or replace function public.get_community_events(
  p_locality text, p_scope text default 'upcoming', p_category text default '', p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); res jsonb;
begin
  if uid is null then raise exception 'Please sign in first'; end if;
  select coalesce(jsonb_agg(x.j order by x.ord), '[]'::jsonb) into res from (
    select jsonb_build_object(
        'id', e.id, 'title', e.title, 'description', e.description, 'category', e.category,
        'locality', e.locality, 'venue', e.venue, 'starts_at', e.starts_at, 'ends_at', e.ends_at,
        'capacity', e.capacity, 'cancelled', e.cancelled,
        'host', public.community_person(e.host_id) || jsonb_build_object('is_business',
                  exists (select 1 from public.profiles h where h.id = e.host_id and h.account_type = 'business')),
        'going_count', (select count(*) from public.community_event_rsvps r where r.event_id = e.id and r.status = 'going'),
        'interested_count', (select count(*) from public.community_event_rsvps r where r.event_id = e.id and r.status = 'interested'),
        'my_status', (select r.status from public.community_event_rsvps r where r.event_id = e.id and r.user_id = uid),
        'is_mine', e.host_id = uid) as j,
      case when p_scope = 'past' then -extract(epoch from e.starts_at) else extract(epoch from e.starts_at) end as ord
    from public.community_events e
    where (case p_scope
        when 'past' then coalesce(e.ends_at, e.starts_at + interval '3 hours') < now() and not e.cancelled
        when 'hosting' then e.host_id = uid and coalesce(e.ends_at, e.starts_at + interval '3 hours') >= now()
        when 'going' then coalesce(e.ends_at, e.starts_at + interval '3 hours') >= now() and not e.cancelled
                          and exists (select 1 from public.community_event_rsvps r where r.event_id = e.id and r.user_id = uid)
        else coalesce(e.ends_at, e.starts_at + interval '3 hours') >= now() and not e.cancelled end)
      and (p_scope in ('going', 'hosting') or p_locality is null or public.community_norm(e.locality) = public.community_norm(p_locality))
      and (coalesce(p_category, '') = '' or e.category = p_category)
    order by ord
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  ) x;
  return res;
end $$;

create or replace function public.set_event_rsvp(p_event_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); ev public.community_events%rowtype; n int;
begin
  if uid is null then raise exception 'Please sign in first'; end if;
  select * into ev from public.community_events where id = p_event_id for update;
  if not found then raise exception 'Event not found'; end if;
  if p_status is null then
    delete from public.community_event_rsvps where event_id = p_event_id and user_id = uid;
  else
    if p_status not in ('going', 'interested') then raise exception 'Invalid response'; end if;
    if ev.cancelled then raise exception 'This event was cancelled'; end if;
    if coalesce(ev.ends_at, ev.starts_at + interval '3 hours') < now() then raise exception 'This event has ended'; end if;
    if p_status = 'going' and ev.capacity is not null then
      select count(*) into n from public.community_event_rsvps
        where event_id = p_event_id and status = 'going' and user_id <> uid;
      if n >= ev.capacity then raise exception 'This event is full'; end if;
    end if;
    insert into public.community_event_rsvps (event_id, user_id, status) values (p_event_id, uid, p_status)
      on conflict (event_id, user_id) do update set status = excluded.status;
  end if;
  select count(*) into n from public.community_event_rsvps where event_id = p_event_id and status = 'going';
  return jsonb_build_object('my_status', p_status, 'going_count', n);
end $$;

-- ---- alerts
create or replace function public.get_community_alerts(p_locality text, p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); res jsonb;
begin
  if uid is null then raise exception 'Please sign in first'; end if;
  select coalesce(jsonb_agg(x.j order by x.done, x.created_at desc), '[]'::jsonb) into res from (
    select y.created_at, (y.resolved_at is not null) as done, jsonb_build_object(
        'id', y.id, 'kind', y.kind, 'title', y.title, 'details', y.details, 'locality', y.locality,
        'created_at', y.created_at, 'expires_at', y.expires_at, 'resolved_at', y.resolved_at,
        'confirm_count', y.c, 'dispute_count', y.d,
        'status', case when y.resolved_at is not null then 'resolved'
                       when y.c >= 2 and y.c > y.d then 'confirmed'
                       when y.d >= 2 and y.d >= y.c then 'disputed'
                       else 'unconfirmed' end,
        'my_vote', (select v.vote from public.community_alert_votes v where v.alert_id = y.id and v.user_id = uid),
        'is_mine', y.author_id = uid,
        'author', public.community_person(y.author_id)) as j
    from (
      select a.*,
        (select count(*) from public.community_alert_votes v where v.alert_id = a.id and v.vote = 'confirm') as c,
        (select count(*) from public.community_alert_votes v where v.alert_id = a.id and v.vote = 'dispute') as d
      from public.community_alerts a
      where ((a.resolved_at is null and a.expires_at > now()) or a.resolved_at > now() - interval '3 hours')
        and (p_locality is null or public.community_norm(a.locality) = public.community_norm(p_locality))
      order by a.created_at desc
      limit least(greatest(coalesce(p_limit, 50), 1), 100)
    ) y
  ) x;
  return res;
end $$;

create or replace function public.vote_community_alert(p_alert_id uuid, p_vote text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); a public.community_alerts%rowtype;
begin
  if uid is null then raise exception 'Please sign in first'; end if;
  select * into a from public.community_alerts where id = p_alert_id;
  if not found then raise exception 'Alert not found'; end if;
  if a.author_id = uid then raise exception 'You posted this alert, so you can''t vote on it'; end if;
  if p_vote is null then
    delete from public.community_alert_votes where alert_id = p_alert_id and user_id = uid;
    return;
  end if;
  if p_vote not in ('confirm', 'dispute') then raise exception 'Invalid vote'; end if;
  if a.resolved_at is not null or a.expires_at <= now() then raise exception 'This alert is no longer active'; end if;
  insert into public.community_alert_votes (alert_id, user_id, vote) values (p_alert_id, uid, p_vote)
    on conflict (alert_id, user_id) do update set vote = excluded.vote;
end $$;

-- ---- skill swaps
create or replace function public.get_community_skill_swaps(p_locality text, p_query text default '', p_limit int default 60)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); res jsonb; q text := lower(btrim(coalesce(p_query, '')));
begin
  if uid is null then raise exception 'Please sign in first'; end if;
  select coalesce(jsonb_agg(x.j order by x.rank, x.created_at desc), '[]'::jsonb) into res from (
    select r.created_at,
      case when r.is_mine then 3 when r.t_you and r.w_you then 0 when r.t_you or r.w_you then 1 else 2 end as rank,
      jsonb_build_object(
        'id', r.id, 'teach', r.teach, 'want', r.want, 'mode', r.mode, 'note', r.note, 'locality', r.locality,
        'active', r.active, 'created_at', r.created_at, 'is_mine', r.is_mine,
        'match', case when r.is_mine then 'none' when r.t_you and r.w_you then 'perfect'
                      when r.t_you then 'teaches_you' when r.w_you then 'wants_you' else 'none' end,
        'person', public.community_person(r.user_id)) as j
    from (
      select s.*, s.user_id = uid as is_mine,
        exists (select 1 from public.community_skill_swaps m where m.user_id = uid and m.active
                and public.community_skills_match(s.teach, m.want)) as t_you,
        exists (select 1 from public.community_skill_swaps m where m.user_id = uid and m.active
                and public.community_skills_match(s.want, m.teach)) as w_you
      from public.community_skill_swaps s
      where (s.active or s.user_id = uid)
        and (p_locality is null or public.community_norm(s.locality) = public.community_norm(p_locality))
        and (q = '' or position(q in lower(s.teach)) > 0 or position(q in lower(s.want)) > 0)
      order by s.created_at desc
      limit least(greatest(coalesce(p_limit, 60), 1), 100)
    ) r
  ) x;
  return res;
end $$;

-- ---- polls and quizzes
create or replace function public.create_community_poll(
  p_question text, p_options text[], p_locality text default null, p_kind text default 'poll',
  p_correct_index int default null, p_hours int default 24)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); pid uuid; i int; opt_ids uuid[] := '{}'; oid uuid;
begin
  if uid is null then raise exception 'Please sign in first'; end if;
  if p_kind not in ('poll', 'quiz') then raise exception 'Invalid kind'; end if;
  if char_length(btrim(coalesce(p_question, ''))) < 5 then raise exception 'Write your question (at least 5 letters)'; end if;
  if p_options is null or coalesce(array_length(p_options, 1), 0) < 2 or array_length(p_options, 1) > 6 then
    raise exception 'A poll needs 2 to 6 options'; end if;
  if exists (select 1 from unnest(p_options) o where char_length(btrim(o)) not between 1 and 40) then
    raise exception 'Each option must be 1 to 40 letters'; end if;
  if (select count(distinct public.community_norm(o)) from unnest(p_options) o) <> array_length(p_options, 1) then
    raise exception 'Each option must be different'; end if;
  if p_kind = 'quiz' and (p_correct_index is null or p_correct_index < 0 or p_correct_index >= array_length(p_options, 1)) then
    raise exception 'Pick the right answer'; end if;
  if (select count(*) from public.community_polls where author_id = uid and created_at > now() - interval '1 day') >= 10 then
    raise exception 'You''ve reached today''s limit of 10 polls. Try again tomorrow.'; end if;

  insert into public.community_polls (author_id, kind, question, locality, closes_at)
  values (uid, p_kind, btrim(p_question), nullif(btrim(coalesce(p_locality, '')), ''),
          now() + make_interval(hours => least(greatest(coalesce(p_hours, 24), 1), 168)))
  returning id into pid;
  for i in 1 .. array_length(p_options, 1) loop
    insert into public.community_poll_options (poll_id, label, position) values (pid, btrim(p_options[i]), i - 1)
    returning id into oid;
    opt_ids := opt_ids || oid;
  end loop;
  if p_kind = 'quiz' then
    insert into public.community_quiz_keys (poll_id, option_id) values (pid, opt_ids[p_correct_index + 1]);
  end if;
  return pid;
end $$;

create or replace function public.vote_community_poll(p_poll_id uuid, p_option_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); p public.community_polls%rowtype;
begin
  if uid is null then raise exception 'Please sign in first'; end if;
  select * into p from public.community_polls where id = p_poll_id;
  if not found then raise exception 'Poll not found'; end if;
  if p.closes_at <= now() then raise exception 'This poll has closed'; end if;
  if not exists (select 1 from public.community_poll_options where id = p_option_id and poll_id = p_poll_id) then
    raise exception 'That option isn''t part of this poll'; end if;
  insert into public.community_poll_votes (poll_id, user_id, option_id) values (p_poll_id, uid, p_option_id)
    on conflict (poll_id, user_id) do nothing;   -- the first answer counts
end $$;

create or replace function public.get_community_polls(p_locality text, p_scope text default 'open', p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); res jsonb;
begin
  if uid is null then raise exception 'Please sign in first'; end if;
  select coalesce(jsonb_agg(x.j order by x.created_at desc), '[]'::jsonb) into res from (
    select y.created_at, jsonb_build_object(
        'id', y.id, 'kind', y.kind, 'question', y.question, 'locality', y.locality,
        'closes_at', y.closes_at, 'created_at', y.created_at, 'is_mine', y.author_id = uid,
        'author', public.community_person(y.author_id),
        'options', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label, 'position', o.position,
                      'votes', (select count(*) from public.community_poll_votes v where v.option_id = o.id)) order by o.position), '[]'::jsonb)
                    from public.community_poll_options o where o.poll_id = y.id),
        'total_votes', (select count(*) from public.community_poll_votes v where v.poll_id = y.id),
        'my_vote', y.my_vote,
        'correct_option_id', case when y.kind = 'quiz' and (y.my_vote is not null or y.closes_at <= now() or y.author_id = uid)
                                  then (select k.option_id from public.community_quiz_keys k where k.poll_id = y.id) end) as j
    from (
      select p.*, (select v.option_id from public.community_poll_votes v where v.poll_id = p.id and v.user_id = uid) as my_vote
      from public.community_polls p
      where (case p_scope when 'closed' then p.closes_at <= now() when 'mine' then p.author_id = uid else p.closes_at > now() end)
        and (p_locality is null or p.locality is null or public.community_norm(p.locality) = public.community_norm(p_locality))
      order by p.created_at desc
      limit least(greatest(coalesce(p_limit, 50), 1), 100)
    ) y
  ) x;
  return res;
end $$;

-- days in a row (Indian time) on which the person answered a poll or quiz
create or replace function public.get_poll_streak() returns int
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); today date := (now() at time zone 'Asia/Kolkata')::date; n int;
begin
  if uid is null then return 0; end if;
  with d as (select distinct (created_at at time zone 'Asia/Kolkata')::date as day
             from public.community_poll_votes where user_id = uid),
  g as (select day, day - (row_number() over (order by day))::int as grp from d),
  last_grp as (select grp, max(day) as last_day from g group by grp order by max(day) desc limit 1)
  select case when lg.last_day >= today - 1 then (select count(*) from g where g.grp = lg.grp) else 0 end
    into n from last_grp lg;
  return coalesce(n, 0);
end $$;

-- ---- ask a local
create or replace function public.community_is_local(p_user uuid, p_locality text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles pr
    where pr.id = p_user and public.community_norm(pr.location) <> ''
      and (public.community_norm(pr.location) = public.community_norm(p_locality)
           or (length(public.community_norm(p_locality)) >= 3
               and position(public.community_norm(p_locality) in public.community_norm(pr.location)) > 0))) $$;

create or replace function public.get_community_questions(
  p_locality text, p_query text default '', p_filter text default 'new', p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); res jsonb; q text := lower(btrim(coalesce(p_query, '')));
begin
  if uid is null then raise exception 'Please sign in first'; end if;
  select coalesce(jsonb_agg(x.j order by x.created_at desc), '[]'::jsonb) into res from (
    select y.created_at, jsonb_build_object(
        'id', y.id, 'title', y.title, 'body', y.body, 'category', y.category, 'locality', y.locality,
        'created_at', y.created_at, 'is_mine', y.author_id = uid,
        'answered', y.accepted_answer_id is not null, 'answer_count', y.ac,
        'local_answer_count', (select count(*) from public.community_answers a
                               where a.question_id = y.id and public.community_is_local(a.author_id, y.locality)),
        'author', public.community_person(y.author_id)) as j
    from (
      select s.*, (select count(*) from public.community_answers a where a.question_id = s.id) as ac
      from public.community_questions s
      where (p_locality is null or public.community_norm(s.locality) = public.community_norm(p_locality))
        and (q = '' or position(q in lower(s.title)) > 0 or position(q in lower(coalesce(s.body, ''))) > 0)
        and (case p_filter when 'mine' then s.author_id = uid
                           when 'unanswered' then not exists (select 1 from public.community_answers a where a.question_id = s.id)
                           else true end)
      order by s.created_at desc
      limit least(greatest(coalesce(p_limit, 50), 1), 100)
    ) y
  ) x;
  return res;
end $$;

create or replace function public.get_community_question(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); s public.community_questions%rowtype;
begin
  if uid is null then raise exception 'Please sign in first'; end if;
  select * into s from public.community_questions where id = p_id;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', s.id, 'title', s.title, 'body', s.body, 'category', s.category, 'locality', s.locality,
    'created_at', s.created_at, 'is_mine', s.author_id = uid, 'accepted_answer_id', s.accepted_answer_id,
    'author', public.community_person(s.author_id),
    'answers', (select coalesce(jsonb_agg(z.j order by z.acc desc, z.loc desc, z.h desc, z.created_at), '[]'::jsonb) from (
        select a.created_at, (a.id = s.accepted_answer_id) as acc,
          public.community_is_local(a.author_id, s.locality) as loc,
          (select count(*) from public.community_answer_helpful h where h.answer_id = a.id) as h,
          jsonb_build_object('id', a.id, 'body', a.body, 'created_at', a.created_at, 'is_mine', a.author_id = uid,
            'accepted', a.id = s.accepted_answer_id, 'is_local', public.community_is_local(a.author_id, s.locality),
            'helpful_count', (select count(*) from public.community_answer_helpful h where h.answer_id = a.id),
            'my_helpful', exists (select 1 from public.community_answer_helpful h where h.answer_id = a.id and h.user_id = uid),
            'author', public.community_person(a.author_id)) as j
        from public.community_answers a where a.question_id = s.id) z));
end $$;

create or replace function public.toggle_answer_helpful(p_answer_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); owner uuid;
begin
  if uid is null then raise exception 'Please sign in first'; end if;
  select author_id into owner from public.community_answers where id = p_answer_id;
  if not found then raise exception 'Answer not found'; end if;
  if owner = uid then raise exception 'You can''t mark your own answer as helpful'; end if;
  if exists (select 1 from public.community_answer_helpful where answer_id = p_answer_id and user_id = uid) then
    delete from public.community_answer_helpful where answer_id = p_answer_id and user_id = uid;
    return false;
  end if;
  insert into public.community_answer_helpful (answer_id, user_id) values (p_answer_id, uid);
  return true;
end $$;

create or replace function public.accept_community_answer(p_question_id uuid, p_answer_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); owner uuid;
begin
  if uid is null then raise exception 'Please sign in first'; end if;
  select author_id into owner from public.community_questions where id = p_question_id;
  if not found then raise exception 'Question not found'; end if;
  if owner <> uid then raise exception 'Only the person who asked can pick an answer'; end if;
  if p_answer_id is not null and not exists
     (select 1 from public.community_answers where id = p_answer_id and question_id = p_question_id) then
    raise exception 'Answer not found'; end if;
  update public.community_questions set accepted_answer_id = p_answer_id where id = p_question_id;
end $$;

-- ------------------------------------------------------- who can call what
do $$
declare f text;
begin
  foreach f in array array[
    'community_person(uuid)', 'community_is_local(uuid,text)',
    'get_community_events(text,text,text,int)', 'set_event_rsvp(uuid,text)',
    'get_community_alerts(text,int)', 'vote_community_alert(uuid,text)',
    'get_community_skill_swaps(text,text,int)',
    'create_community_poll(text,text[],text,text,int,int)', 'vote_community_poll(uuid,uuid)',
    'get_community_polls(text,text,int)', 'get_poll_streak()',
    'get_community_questions(text,text,text,int)', 'get_community_question(uuid)',
    'toggle_answer_helpful(uuid)', 'accept_community_answer(uuid,uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
