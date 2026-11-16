-- =====================================================================
-- Close Friends: share a story with a chosen list instead of all followers.
-- Run in Supabase Dashboard -> SQL Editor (or `supabase db push`). Safe to run more than once.
--
--   close_friends               my list: one row per follower I picked
--   stories.close_friends_only  true = only people on my list (and me) can see the story
--
-- The story visibility rule (stories_select_active) is replaced, so everything that reads stories
-- as the viewer (viewing, views, likes, polls) follows it automatically. send_story_reply runs as
-- the database owner, so it gets its own check below.
-- =====================================================================

create table if not exists public.close_friends (
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  friend_id  uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, friend_id),
  constraint close_friends_no_self check (owner_id <> friend_id)
);
create index if not exists close_friends_friend_idx on public.close_friends (friend_id);

alter table public.close_friends enable row level security;
revoke all on public.close_friends from anon, authenticated;
grant select, insert, delete on public.close_friends to authenticated;

-- Only I can see or change my list. (A friend is never told they are on it.)
drop policy if exists close_friends_select_own on public.close_friends;
create policy close_friends_select_own on public.close_friends
  for select to authenticated using (owner_id = auth.uid());

-- Only people who follow me can be added.
drop policy if exists close_friends_insert_own on public.close_friends;
create policy close_friends_insert_own on public.close_friends
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and exists (select 1 from public.follows f
                where f.follower_id = close_friends.friend_id and f.following_id = auth.uid())
  );

drop policy if exists close_friends_delete_own on public.close_friends;
create policy close_friends_delete_own on public.close_friends
  for delete to authenticated using (owner_id = auth.uid());

-- Is the signed-in person on p_owner's list? Runs as the owner of the database so a friend can
-- be checked without being able to read the list itself.
create or replace function public.is_close_friend_of(p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.close_friends cf
                 where cf.owner_id = p_owner and cf.friend_id = auth.uid()) $$;
revoke all on function public.is_close_friend_of(uuid) from public, anon;
grant execute on function public.is_close_friend_of(uuid) to authenticated;

alter table public.stories add column if not exists close_friends_only boolean not null default false;

-- Same rule as before (live for 24 hours; mine, or from someone I follow) plus: a Close Friends
-- story is only for the people on the author's list.
drop policy if exists "stories_select_active" on public.stories;
create policy "stories_select_active"
  on public.stories for select to authenticated
  using (
    created_at > now() - interval '24 hours'
    and (
      author_id = auth.uid()
      or (
        exists (select 1 from public.follows f
                where f.follower_id = auth.uid() and f.following_id = stories.author_id)
        and (not close_friends_only or public.is_close_friend_of(stories.author_id))
      )
    )
  );

-- When someone is taken off my list, or stops following me, they stop seeing my Close Friends
-- stories without anything else to do: the policy above checks both every time.

-- ---------------------------------------------------------------------
-- Story replies (same function as 20261028000000_story_replies_polls_notes_voice.sql, plus the
-- Close Friends check).
-- ---------------------------------------------------------------------
create or replace function public.send_story_reply(
  p_story_id uuid,
  p_body     text,
  p_kind     text default 'reply'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_author uuid;
  v_thumb  text;
  v_cf     boolean;
  v_body   text := btrim(coalesce(p_body, ''));
  v_conv   uuid;
  v_max    integer;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;
  if p_kind is null or p_kind not in ('reply', 'reaction') then
    raise exception 'invalid_kind';
  end if;

  v_max := case when p_kind = 'reaction' then 16 else 2000 end;
  if v_body = '' or char_length(v_body) > v_max then
    raise exception 'invalid_message';
  end if;

  select s.author_id,
         case when coalesce(s.media_type, 'image') = 'image' then s.image_url end,
         s.close_friends_only
    into v_author, v_thumb, v_cf
  from public.stories s
  where s.id = p_story_id
    and s.created_at > now() - interval '24 hours';

  if v_author is null then
    raise exception 'story_unavailable';
  end if;
  if v_author = v_me then
    raise exception 'own_story';
  end if;
  if not exists (select 1 from public.follows f
                 where f.follower_id = v_me and f.following_id = v_author) then
    raise exception 'not_allowed';
  end if;
  -- a Close Friends story can only be answered by the people on the list
  if v_cf and not public.is_close_friend_of(v_author) then
    raise exception 'not_allowed';
  end if;

  v_conv := public.get_or_create_dm(v_author);

  insert into public.messages (conversation_id, sender_id, body, story_id, story_thumb, story_kind)
  values (v_conv, v_me, v_body, p_story_id, v_thumb, p_kind);

  return v_conv;
end;
$$;

revoke all on function public.send_story_reply(uuid, text, text) from public, anon;
grant execute on function public.send_story_reply(uuid, text, text) to authenticated;
