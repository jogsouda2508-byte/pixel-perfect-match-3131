-- =====================================================================
-- Ediraa: public / private accounts + follow requests
-- Run in Supabase SQL Editor AFTER 20261020000000_story_likes.sql.
-- Safe to run more than once.
--
-- How it works
--   * profiles.is_private  (default false = public).
--   * PUBLIC account  : anyone can follow instantly (as before).
--   * PRIVATE account : a "Follow" becomes a follow REQUEST. The person
--       only becomes a follower when the account owner accepts. Until then
--       they cannot see that account's posts, videos or stories.
--   * Posts (and so likes, comments, tags, saved, shares, feeds, trending)
--       hide a private author's posts from everyone except the author and
--       accepted followers. This is done once, in the posts policy and in
--       can_view_post(), so every feature that already respects post
--       visibility respects privacy too.
--   * Stories were already followers-only, and followers of a private
--       account are only people it accepted, so stories need no change.
--   * Profile basics (name, photo, bio, counts) stay visible so people can
--       find the account and request to follow it.
--   * Switching a private account to public accepts every pending request.
--   * Notifications (all derived from rows, so retries never duplicate):
--       follow_request   -> to the private account: "X wants to follow you"
--       follow_accepted  -> to the requester:       "X accepted your request"
--       follow           -> to the account: "X started following you"
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. profiles.is_private
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists is_private boolean not null default false;

-- ---------------------------------------------------------------------
-- 2. follow_requests
--    Written ONLY by the functions below (no insert/update/delete policy).
--    status 'accepted' rows are kept so the requester can be notified.
-- ---------------------------------------------------------------------
create table if not exists public.follow_requests (
  requester_id uuid        not null references public.profiles (id) on delete cascade,
  target_id    uuid        not null references public.profiles (id) on delete cascade,
  status       text        not null default 'pending' check (status in ('pending', 'accepted')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  primary key (requester_id, target_id),
  constraint follow_requests_no_self check (requester_id <> target_id)
);

create index if not exists follow_requests_target_idx
  on public.follow_requests (target_id, status, created_at desc);
create index if not exists follow_requests_requester_idx
  on public.follow_requests (requester_id, status);

alter table public.follow_requests enable row level security;

drop policy if exists "follow_requests_select_involved" on public.follow_requests;
create policy "follow_requests_select_involved"
  on public.follow_requests for select to authenticated
  using (requester_id = auth.uid() or target_id = auth.uid());

-- ---------------------------------------------------------------------
-- 3. follows: you can still follow a PUBLIC account directly, but a private
--    account can only be followed through an accepted request.
-- ---------------------------------------------------------------------
drop policy if exists "follows_insert_own" on public.follows;
create policy "follows_insert_own"
  on public.follows for insert to authenticated
  with check (
    follower_id = auth.uid()
    and exists (select 1 from public.profiles t
                where t.id = follows.following_id and not t.is_private)
  );

-- ---------------------------------------------------------------------
-- 4. Visibility helpers
--    is_profile_visible_for(owner, viewer): may `viewer` see `owner`'s content?
--      yes if it is their own, the account is public, or viewer follows it.
--    SECURITY DEFINER, but NOT callable by clients (the 2-argument form would
--    let people probe other users' relationships).
--    is_profile_visible(owner): same for the signed-in user; used by policies.
-- ---------------------------------------------------------------------
create or replace function public.is_profile_visible_for(p_owner uuid, p_viewer uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select p_owner = p_viewer
    or not exists (select 1 from public.profiles o where o.id = p_owner and o.is_private)
    or exists (select 1 from public.follows f
               where f.follower_id = p_viewer and f.following_id = p_owner);
$$;

revoke all on function public.is_profile_visible_for(uuid, uuid) from public, anon, authenticated;

create or replace function public.is_profile_visible(p_owner uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_profile_visible_for(p_owner, auth.uid());
$$;

revoke all on function public.is_profile_visible(uuid) from public, anon;
grant execute on function public.is_profile_visible(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. posts policy: same rules as before, but a private author's posts are
--    only visible to the author and accepted followers.
-- ---------------------------------------------------------------------
drop policy if exists "posts_select_visible" on public.posts;
create policy "posts_select_visible"
  on public.posts for select to authenticated
  using (
    author_id = auth.uid()
    or (
      public.is_profile_visible(posts.author_id)
      and (
        audience = 'Public'
        or (
          audience = 'Friends'
          and exists (select 1 from public.follows f
                      where f.follower_id = auth.uid() and f.following_id = posts.author_id)
          and exists (select 1 from public.follows f
                      where f.follower_id = posts.author_id and f.following_id = auth.uid())
        )
        or (
          audience = 'Local Community'
          and exists (select 1
                      from public.profiles me, public.profiles au
                      where me.id = auth.uid() and au.id = posts.author_id
                        and me.location is not null
                        and lower(btrim(me.location)) = lower(btrim(au.location)))
        )
      )
    )
  );

-- Same rule for ANY user (used by sharing and tagging). KEEP IN SYNC with the policy above.
create or replace function public.can_view_post(p_post_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.posts p
    where p.id = p_post_id
      and (
        p.author_id = p_user_id
        or (
          public.is_profile_visible_for(p.author_id, p_user_id)
          and (
            p.audience = 'Public'
            or (
              p.audience = 'Friends'
              and exists (select 1 from public.follows f
                          where f.follower_id = p_user_id and f.following_id = p.author_id)
              and exists (select 1 from public.follows f
                          where f.follower_id = p.author_id and f.following_id = p_user_id)
            )
            or (
              p.audience = 'Local Community'
              and exists (select 1
                          from public.profiles me, public.profiles au
                          where me.id = p_user_id and au.id = p.author_id
                            and me.location is not null
                            and lower(btrim(me.location)) = lower(btrim(au.location)))
            )
          )
        )
      )
  );
$$;

revoke all on function public.can_view_post(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. send_follow_request(target) -> 'following' | 'requested'
--    Public target  : follows immediately.
--    Private target : creates a pending request (asking twice changes nothing,
--                     so there is only ever one notification).
--    Errors: not_authenticated | invalid_target | user_not_found
-- ---------------------------------------------------------------------
create or replace function public.send_follow_request(p_target uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me        uuid := auth.uid();
  v_private boolean;
begin
  if me is null then
    raise exception 'not_authenticated';
  end if;
  if p_target is null or p_target = me then
    raise exception 'invalid_target';
  end if;

  select pr.is_private into v_private
  from public.profiles pr
  where pr.id = p_target and pr.onboarding_completed;
  if not found then
    raise exception 'user_not_found';
  end if;

  if exists (select 1 from public.follows f
             where f.follower_id = me and f.following_id = p_target) then
    return 'following';
  end if;

  if not v_private then
    insert into public.follows (follower_id, following_id)
    values (me, p_target)
    on conflict do nothing;
    delete from public.follow_requests
    where requester_id = me and target_id = p_target;
    return 'following';
  end if;

  insert into public.follow_requests (requester_id, target_id, status, created_at)
  values (me, p_target, 'pending', now())
  on conflict (requester_id, target_id) do update
    set status = 'pending', created_at = now(), responded_at = null
    where public.follow_requests.status <> 'pending';
  return 'requested';
end;
$$;

revoke all on function public.send_follow_request(uuid) from public, anon;
grant execute on function public.send_follow_request(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 7. cancel_follow_request(target): withdraw my pending request.
-- ---------------------------------------------------------------------
create or replace function public.cancel_follow_request(p_target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  delete from public.follow_requests
  where requester_id = auth.uid() and target_id = p_target and status = 'pending';
end;
$$;

revoke all on function public.cancel_follow_request(uuid) from public, anon;
grant execute on function public.cancel_follow_request(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 8. respond_follow_request(requester, accept) -> 'accepted' | 'declined'
--    Only the account that was asked can answer. Declining deletes the request
--    quietly (the requester is not told, and may ask again later).
--    Errors: not_authenticated | request_not_found
-- ---------------------------------------------------------------------
create or replace function public.respond_follow_request(p_requester uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not_authenticated';
  end if;

  if not exists (select 1 from public.follow_requests r
                 where r.requester_id = p_requester and r.target_id = me and r.status = 'pending') then
    raise exception 'request_not_found';
  end if;

  if p_accept then
    insert into public.follows (follower_id, following_id)
    values (p_requester, me)
    on conflict do nothing;
    update public.follow_requests
       set status = 'accepted', responded_at = now()
     where requester_id = p_requester and target_id = me;
    return 'accepted';
  end if;

  delete from public.follow_requests
  where requester_id = p_requester and target_id = me;
  return 'declined';
end;
$$;

revoke all on function public.respond_follow_request(uuid, boolean) from public, anon;
grant execute on function public.respond_follow_request(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 9. Going from private to public accepts everyone who was waiting.
-- ---------------------------------------------------------------------
create or replace function public.accept_pending_requests_when_public()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.is_private and not new.is_private then
    insert into public.follows (follower_id, following_id)
    select r.requester_id, new.id
    from public.follow_requests r
    where r.target_id = new.id and r.status = 'pending'
    on conflict do nothing;

    update public.follow_requests
       set status = 'accepted', responded_at = now()
     where target_id = new.id and status = 'pending';
  end if;
  return new;
end;
$$;

revoke all on function public.accept_pending_requests_when_public() from public, anon, authenticated;

drop trigger if exists profiles_accept_pending_when_public on public.profiles;
create trigger profiles_accept_pending_when_public
  after update of is_private on public.profiles
  for each row execute function public.accept_pending_requests_when_public();

-- ---------------------------------------------------------------------
-- 10. get_notifications: + 'follow_request' and 'follow_accepted'
--     (same columns as before, so a plain replace)
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
    union all
    -- people who liked one of my (still active) stories
    select 'story_like', sl.user_id, null::uuid, null::text, sl.created_at, null::uuid
    from public.story_likes sl
    join public.stories s on s.id = sl.story_id
    where s.author_id = auth.uid() and sl.user_id <> auth.uid()
    union all
    -- someone is asking to follow me (shown until I accept or decline)
    select 'follow_request', fr.requester_id, null::uuid, null::text, fr.created_at, null::uuid
    from public.follow_requests fr
    where fr.target_id = auth.uid() and fr.status = 'pending'
    union all
    -- an account I asked to follow accepted me (only while I still follow it)
    select 'follow_accepted', fr.target_id, null::uuid, null::text,
           coalesce(fr.responded_at, fr.created_at), null::uuid
    from public.follow_requests fr
    where fr.requester_id = auth.uid() and fr.status = 'accepted'
      and exists (select 1 from public.follows f
                  where f.follower_id = auth.uid() and f.following_id = fr.target_id)
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
