-- =====================================================================
-- Block, mute and report.
-- Run in Supabase Dashboard -> SQL Editor (or `supabase db push`). Safe to run more than once.
--
--   blocks   A blocks B: neither can see the other's posts, stories, comments or community items,
--            neither can follow, message or request the other, and any follow between them
--            (and Close Friends entries) is removed. B is never told.
--   mutes    A mutes B: B's posts and stories are hidden from A's feed and story row. B can
--            still see A, and nothing is removed.
--   reports  Someone reports a person, post, comment, story or message. Rows are only readable by
--            you (your own reports); review them in Supabase -> Table Editor -> reports.
--
-- Needs the earlier migrations (profiles, follows, posts, chat). Community / business / Close
-- Friends tables are covered only if they exist, so the order of those does not matter.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. blocks
-- ---------------------------------------------------------------------
create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_no_self check (blocker_id <> blocked_id)
);
create index if not exists blocks_blocked_idx on public.blocks (blocked_id);

alter table public.blocks enable row level security;
revoke all on public.blocks from anon, authenticated;
grant select, insert, delete on public.blocks to authenticated;

-- Only I can see or change the people I have blocked. (The other person can never read this.)
drop policy if exists blocks_select_own on public.blocks;
create policy blocks_select_own on public.blocks
  for select to authenticated using (blocker_id = auth.uid());
drop policy if exists blocks_insert_own on public.blocks;
create policy blocks_insert_own on public.blocks
  for insert to authenticated with check (blocker_id = auth.uid());
drop policy if exists blocks_delete_own on public.blocks;
create policy blocks_delete_own on public.blocks
  for delete to authenticated using (blocker_id = auth.uid());

-- Is there a block between these two people, in either direction? Internal: not callable by clients.
create or replace function public.blocked_between(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.blocks b
                 where (b.blocker_id = p_a and b.blocked_id = p_b)
                    or (b.blocker_id = p_b and b.blocked_id = p_a)) $$;
revoke all on function public.blocked_between(uuid, uuid) from public, anon, authenticated;

-- Same, for the signed-in person. Used by the row-level rules below; returns only yes/no.
create or replace function public.is_blocked_with(p_other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.blocked_between(auth.uid(), p_other) $$;
revoke all on function public.is_blocked_with(uuid) from public, anon;
grant execute on function public.is_blocked_with(uuid) to authenticated;

-- 'mine' = I blocked them, 'theirs' = they blocked me, 'none'. (If both, 'mine'.)
create or replace function public.block_state(p_other uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.blocks where blocker_id = auth.uid() and blocked_id = p_other) then 'mine'
    when exists (select 1 from public.blocks where blocker_id = p_other and blocked_id = auth.uid()) then 'theirs'
    else 'none'
  end $$;
revoke all on function public.block_state(uuid) from public, anon;
grant execute on function public.block_state(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Hide content between blocked people.
--    RESTRICTIVE rules are ANDed with the existing rules, so nothing already there is rewritten.
--    A table that does not exist yet is skipped.
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('posts',                 'author_id'),
      ('post_comments',         'author_id'),
      ('post_likes',            'user_id'),
      ('stories',               'author_id'),
      ('notes',                 'user_id'),
      ('business_reviews',      'reviewer_id'),
      ('community_events',      'host_id'),
      ('community_alerts',      'author_id'),
      ('community_skill_swaps', 'user_id'),
      ('community_polls',       'author_id'),
      ('community_questions',   'author_id'),
      ('community_answers',     'author_id'),
      ('community_listings',    'seller_id')
    ) as t(tbl, col)
  loop
    if to_regclass('public.' || r.tbl) is not null then
      execute format('drop policy if exists %I on public.%I', r.tbl || '_hide_blocked', r.tbl);
      execute format(
        'create policy %I on public.%I as restrictive for select to authenticated using (not public.is_blocked_with(%I))',
        r.tbl || '_hide_blocked', r.tbl, r.col);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. No following, requesting or messaging across a block.
--    Triggers (not policies) so they also cover the functions that write as the database owner.
-- ---------------------------------------------------------------------
create or replace function public.follows_block_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.blocked_between(new.follower_id, new.following_id) then
    raise exception 'blocked';
  end if;
  return new;
end $$;
drop trigger if exists follows_block_check on public.follows;
create trigger follows_block_check before insert on public.follows
  for each row execute function public.follows_block_check();

create or replace function public.follow_requests_block_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.blocked_between(new.requester_id, new.target_id) then
    raise exception 'blocked';
  end if;
  return new;
end $$;
drop trigger if exists follow_requests_block_check on public.follow_requests;
create trigger follow_requests_block_check before insert on public.follow_requests
  for each row execute function public.follow_requests_block_check();

-- A one-to-one chat stops working both ways while a block exists. Group chats are not affected.
create or replace function public.messages_block_check()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_group uuid;
  v_other uuid;
begin
  select c.group_id into v_group from public.conversations c where c.id = new.conversation_id;
  if v_group is not null then
    return new;
  end if;
  select cp.user_id into v_other
  from public.conversation_participants cp
  where cp.conversation_id = new.conversation_id and cp.user_id <> new.sender_id
  limit 1;
  if v_other is not null and public.blocked_between(new.sender_id, v_other) then
    raise exception 'blocked';
  end if;
  return new;
end $$;
drop trigger if exists messages_block_check on public.messages;
create trigger messages_block_check before insert on public.messages
  for each row execute function public.messages_block_check();

-- Opening a chat with someone you can't message fails up front (instead of making an empty chat).
-- Same function as 20261021000000_group_chat_invites.sql, plus the block check.
create or replace function public.get_or_create_dm(other_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_pair_key text;
  v_conversation uuid;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;
  if other_user is null or other_user = v_me then raise exception 'invalid_recipient'; end if;
  if not exists (select 1 from public.profiles p where p.id = other_user) then
    raise exception 'recipient_not_found';
  end if;
  if public.blocked_between(v_me, other_user) then raise exception 'blocked'; end if;

  v_pair_key := least(v_me::text, other_user::text) || ':' || greatest(v_me::text, other_user::text);
  perform pg_advisory_xact_lock(hashtextextended(v_pair_key, 0));

  select c.id into v_conversation
  from public.conversations c
  where c.group_id is null
    and exists (select 1 from public.conversation_participants cp where cp.conversation_id = c.id and cp.user_id = v_me)
    and exists (select 1 from public.conversation_participants cp where cp.conversation_id = c.id and cp.user_id = other_user)
    and (select count(*) from public.conversation_participants cp where cp.conversation_id = c.id) = 2
  order by c.created_at
  limit 1;

  if v_conversation is not null then return v_conversation; end if;

  insert into public.conversations default values returning id into v_conversation;
  insert into public.conversation_participants (conversation_id, user_id)
  values (v_conversation, v_me), (v_conversation, other_user);
  return v_conversation;
end;
$$;
revoke all on function public.get_or_create_dm(uuid) from public, anon;
grant execute on function public.get_or_create_dm(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Blocking someone removes every tie between you, right away.
-- ---------------------------------------------------------------------
create or replace function public.blocks_cleanup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.follows f
   where (f.follower_id = new.blocker_id and f.following_id = new.blocked_id)
      or (f.follower_id = new.blocked_id and f.following_id = new.blocker_id);
  delete from public.follow_requests fr
   where (fr.requester_id = new.blocker_id and fr.target_id = new.blocked_id)
      or (fr.requester_id = new.blocked_id and fr.target_id = new.blocker_id);
  if to_regclass('public.close_friends') is not null then
    delete from public.close_friends cf
     where (cf.owner_id = new.blocker_id and cf.friend_id = new.blocked_id)
        or (cf.owner_id = new.blocked_id and cf.friend_id = new.blocker_id);
  end if;
  delete from public.mutes m
   where m.muter_id = new.blocker_id and m.muted_id = new.blocked_id;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 5. mutes (created before the cleanup trigger is attached, which refers to it)
-- ---------------------------------------------------------------------
create table if not exists public.mutes (
  muter_id   uuid not null references public.profiles (id) on delete cascade,
  muted_id   uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id),
  constraint mutes_no_self check (muter_id <> muted_id)
);
create index if not exists mutes_muted_idx on public.mutes (muted_id);

alter table public.mutes enable row level security;
revoke all on public.mutes from anon, authenticated;
grant select, insert, delete on public.mutes to authenticated;

drop policy if exists mutes_select_own on public.mutes;
create policy mutes_select_own on public.mutes
  for select to authenticated using (muter_id = auth.uid());
drop policy if exists mutes_insert_own on public.mutes;
create policy mutes_insert_own on public.mutes
  for insert to authenticated with check (muter_id = auth.uid());
drop policy if exists mutes_delete_own on public.mutes;
create policy mutes_delete_own on public.mutes
  for delete to authenticated using (muter_id = auth.uid());

drop trigger if exists blocks_cleanup on public.blocks;
create trigger blocks_cleanup after insert on public.blocks
  for each row execute function public.blocks_cleanup();

-- ---------------------------------------------------------------------
-- 6. People search leaves out anyone you have blocked or who has blocked you.
--    Same function as 20261012000000_posts_feed.sql, plus one condition.
-- ---------------------------------------------------------------------
create or replace function public.get_people(
  p_query            text    default null,
  p_business_only    boolean default false,
  p_exclude_followed boolean default false,
  p_limit            int     default 20
)
returns table (
  id            uuid,
  full_name     text,
  username      text,
  avatar_url    text,
  account_type  text,
  mutual_count  bigint,
  is_following  boolean
)
language sql
stable
set search_path = public
as $$
  select
    p.id, p.full_name, p.username, p.avatar_url, p.account_type,
    (select count(*)
       from public.follows mine
       join public.follows theirs
         on theirs.follower_id = mine.following_id and theirs.following_id = p.id
      where mine.follower_id = auth.uid()),
    exists (select 1 from public.follows f
            where f.follower_id = auth.uid() and f.following_id = p.id)
  from public.profiles p
  where p.id <> auth.uid()
    and p.onboarding_completed
    and not public.is_blocked_with(p.id)
    and (not p_business_only or p.account_type = 'business')
    and (not p_exclude_followed or not exists (
          select 1 from public.follows f
          where f.follower_id = auth.uid() and f.following_id = p.id))
    and (
      p_query is null or btrim(p_query) = ''
      or p.full_name ilike '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
      or p.username  ilike '%' || replace(replace(replace(ltrim(btrim(p_query), '@'), '\', '\\'), '%', '\%'), '_', '\_') || '%'
    )
  order by 6 desc, p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;
revoke all on function public.get_people(text, boolean, boolean, int) from public;
grant execute on function public.get_people(text, boolean, boolean, int) to authenticated;

-- ---------------------------------------------------------------------
-- 7. reports
-- ---------------------------------------------------------------------
create table if not exists public.reports (
  id             uuid primary key default gen_random_uuid(),
  reporter_id    uuid not null references public.profiles (id) on delete cascade,
  target_type    text not null check (target_type in ('user', 'post', 'comment', 'story', 'message')),
  target_id      uuid not null,
  target_user_id uuid references public.profiles (id) on delete set null,
  reason         text not null check (reason in
                   ('spam', 'harassment', 'hate', 'nudity', 'violence', 'scam', 'false_info', 'self_harm', 'other')),
  details        text check (details is null or char_length(details) <= 500),
  status         text not null default 'open' check (status in ('open', 'reviewed', 'actioned', 'dismissed')),
  created_at     timestamptz not null default now(),
  -- one report per person per thing: reporting it again changes nothing
  constraint reports_one_per_target unique (reporter_id, target_type, target_id),
  constraint reports_not_self check (target_user_id is null or target_user_id <> reporter_id)
);
create index if not exists reports_status_idx on public.reports (status, created_at desc);
create index if not exists reports_target_idx on public.reports (target_type, target_id);

alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;
grant select, insert on public.reports to authenticated;

drop policy if exists reports_select_own on public.reports;
create policy reports_select_own on public.reports
  for select to authenticated using (reporter_id = auth.uid());
drop policy if exists reports_insert_own on public.reports;
create policy reports_insert_own on public.reports
  for insert to authenticated
  with check (reporter_id = auth.uid() and status = 'open');

-- At most 30 reports a day per person, so the queue can't be flooded.
create or replace function public.reports_rate_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.reports r
       where r.reporter_id = new.reporter_id and r.created_at > now() - interval '24 hours') >= 30 then
    raise exception 'too_many_reports';
  end if;
  return new;
end $$;
drop trigger if exists reports_rate_limit on public.reports;
create trigger reports_rate_limit before insert on public.reports
  for each row execute function public.reports_rate_limit();
