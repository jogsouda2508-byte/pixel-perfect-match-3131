-- =====================================================================
-- Ediraa: post location + tagged people
-- Run in Supabase SQL Editor AFTER 20261018000000_activity_vs_messages.sql.
-- Safe to run more than once.
--
--  1. posts gets four optional location columns (provider place id, name,
--     readable address, city). Exact device coordinates are never stored.
--  2. post_tags stores tagged people by user id (never by display name).
--  3. set_post_tags() is the ONLY way to write tags. It checks, on the
--     server, that the caller owns the post and that every tagged person
--     exists and is allowed to see the post (so a "Friends" post can only
--     tag mutual friends, a "Local Community" post only people in the same
--     community). Re-running it never creates duplicate tags/notifications.
--  4. get_notifications() gains a 'tag' kind ("X tagged you in a post").
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Location columns on posts
-- ---------------------------------------------------------------------
alter table public.posts
  add column if not exists location_place_id text,
  add column if not exists location_name     text,
  add column if not exists location_address  text,
  add column if not exists location_city     text;

alter table public.posts drop constraint if exists posts_location_check;
alter table public.posts
  add constraint posts_location_check check (
    (location_place_id is null and location_name is null
       and location_address is null and location_city is null)
    or (
      location_place_id is not null and location_name is not null
      and char_length(btrim(location_place_id)) between 1 and 120
      and char_length(btrim(location_name))     between 1 and 160
      and (location_address is null or char_length(location_address) <= 300)
      and (location_city    is null or char_length(location_city)    <= 120)
    )
  );

-- ---------------------------------------------------------------------
-- 2. post_tags
-- ---------------------------------------------------------------------
create table if not exists public.post_tags (
  post_id        uuid        not null references public.posts (id)    on delete cascade,
  tagged_user_id uuid        not null references public.profiles (id) on delete cascade,
  tagged_by      uuid        not null references public.profiles (id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (post_id, tagged_user_id),
  constraint post_tags_no_self_tag check (tagged_user_id <> tagged_by)
);

create index if not exists post_tags_tagged_user_idx
  on public.post_tags (tagged_user_id, created_at desc);

alter table public.post_tags enable row level security;

-- Anyone who can see the post can see who is tagged in it (the sub-select on
-- posts is filtered by the posts policy, same trick as post_likes).
drop policy if exists "post_tags_select_visible" on public.post_tags;
create policy "post_tags_select_visible"
  on public.post_tags for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_tags.post_id));

-- A tagged person can remove their own tag; the post author can remove any tag.
-- There is deliberately NO insert/update policy: tags are written only through
-- set_post_tags() below, which does the permission checks.
drop policy if exists "post_tags_delete_own_or_author" on public.post_tags;
create policy "post_tags_delete_own_or_author"
  on public.post_tags for delete to authenticated
  using (
    tagged_user_id = auth.uid()
    or exists (select 1 from public.posts p
               where p.id = post_tags.post_id and p.author_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- 3. set_post_tags(post, user ids) -> number of tags on the post afterwards
--    Errors (exception messages the client maps to text):
--      not_authenticated | post_not_found | too_many_tags
--    People who can't be tagged (missing account, not onboarded, yourself,
--    or someone who could not see the post) are skipped silently so one bad
--    id never blocks the rest.
-- ---------------------------------------------------------------------
create or replace function public.set_post_tags(p_post_id uuid, p_user_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  me      uuid := auth.uid();
  wanted  uuid[];
  total   integer;
begin
  if me is null then
    raise exception 'not_authenticated';
  end if;

  if not exists (select 1 from public.posts p where p.id = p_post_id and p.author_id = me) then
    raise exception 'post_not_found';
  end if;

  -- de-duplicate, drop nulls and yourself
  select coalesce(array_agg(distinct u), '{}')
    into wanted
  from unnest(coalesce(p_user_ids, '{}')) as u
  where u is not null and u <> me;

  if coalesce(array_length(wanted, 1), 0) > 20 then
    raise exception 'too_many_tags';
  end if;

  -- keep only accounts that exist, finished onboarding and may see this post
  select coalesce(array_agg(pr.id), '{}')
    into wanted
  from public.profiles pr
  where pr.id = any (wanted)
    and pr.onboarding_completed
    and public.can_view_post(p_post_id, pr.id);

  -- remove tags that are no longer wanted
  delete from public.post_tags t
  where t.post_id = p_post_id
    and not (t.tagged_user_id = any (wanted));

  -- add new ones; existing tags are left untouched (no duplicates, and the
  -- notification is derived from the row so a retry can't notify twice)
  insert into public.post_tags (post_id, tagged_user_id, tagged_by)
  select p_post_id, u, me from unnest(wanted) as u
  on conflict (post_id, tagged_user_id) do nothing;

  select count(*) into total from public.post_tags where post_id = p_post_id;
  return total;
end;
$$;

revoke all on function public.set_post_tags(uuid, uuid[]) from public, anon;
grant execute on function public.set_post_tags(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Notifications: add the 'tag' kind (same columns as before, so this is a
--    plain replace). Notifications are derived from rows, so there is no
--    separate table to de-duplicate.
-- ---------------------------------------------------------------------
create or replace function public.get_notifications(p_limit int default 30)
returns table (
  kind            text,
  actor_id        uuid,
  actor_name      text,
  actor_username  text,
  actor_avatar    text,
  post_id         uuid,
  snippet         text,
  created_at      timestamptz,
  i_follow_actor  boolean,
  conversation_id uuid
)
language sql
stable
set search_path = public
as $$
  with n as (
    select 'like'::text as kind, l.user_id as actor_id, l.post_id,
           left(p.content, 80) as snippet, l.created_at, null::uuid as conversation_id
    from public.post_likes l
    join public.posts p on p.id = l.post_id
    where p.author_id = auth.uid() and l.user_id <> auth.uid()
    union all
    select 'comment', c.author_id, c.post_id, left(c.content, 120), c.created_at, null::uuid
    from public.post_comments c
    join public.posts p on p.id = c.post_id
    where p.author_id = auth.uid() and c.author_id <> auth.uid()
    union all
    select 'follow', f.follower_id, null::uuid, null::text, f.created_at, null::uuid
    from public.follows f
    where f.following_id = auth.uid()
    union all
    -- posts/videos other people shared with me in chat
    select 'share', m.sender_id, m.shared_post_id,
           coalesce(sp.media_type, 'post'), m.created_at, m.conversation_id
    from public.messages m
    join public.conversation_participants cp
      on cp.conversation_id = m.conversation_id and cp.user_id = auth.uid()
    left join public.posts sp on sp.id = m.shared_post_id
    where m.shared_post_id is not null and m.sender_id <> auth.uid()
    union all
    -- people who tagged me in a post I can see
    select 'tag', t.tagged_by, t.post_id, left(tp.content, 80), t.created_at, null::uuid
    from public.post_tags t
    join public.posts tp on tp.id = t.post_id
    where t.tagged_user_id = auth.uid() and t.tagged_by <> auth.uid()
  )
  select
    n.kind, n.actor_id, a.full_name, a.username, a.avatar_url,
    n.post_id, n.snippet, n.created_at,
    exists (select 1 from public.follows f
            where f.follower_id = auth.uid() and f.following_id = n.actor_id),
    n.conversation_id
  from n
  join public.profiles a on a.id = n.actor_id
  order by n.created_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;

revoke all on function public.get_notifications(int) from public, anon;
grant execute on function public.get_notifications(int) to authenticated;
