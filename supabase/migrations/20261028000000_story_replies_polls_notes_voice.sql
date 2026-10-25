-- =====================================================================
-- Ediraa: story replies + quick reactions, polls, notes, voice messages
-- Run in Supabase SQL Editor AFTER 20261027000000_story_highlights.sql.
-- Safe to run more than once. Nothing existing is removed or renamed.
--
--  1. messages gets optional story / voice columns. Clients can NOT write
--     them directly (the INSERT grant is unchanged); only the functions
--     send_story_reply() and send_voice_message() below can.
--  2. send_story_reply(): a text reply or one of the quick emoji reactions
--     on someone's story. It lands in your normal 1:1 chat with them, so the
--     existing chat + push notification triggers deliver it.
--  3. send_voice_message() + a "voice" storage bucket.
--  4. polls / poll_options / poll_votes: a 2-option poll on a post or a story.
--     Vote counts are kept by a trigger, so everyone sees live percentages
--     without anyone being able to see who voted what.
--  5. notes: one short (max 60 characters) status per person for 24 hours,
--     visible to the people who follow them.
--  6. push_on_message(): clearer push text for replies, reactions and voice.
--
--  FIX: the length check in send_story_reply() used a CASE ... THEN inside an
--  IF condition. PL/pgSQL ends an IF condition at the first THEN, which gave
--  "syntax error at end of input". The limit is now computed in v_max first.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. messages: optional story + voice columns
-- ---------------------------------------------------------------------
alter table public.messages add column if not exists story_id      uuid;
alter table public.messages add column if not exists story_thumb   text;
alter table public.messages add column if not exists story_kind    text;
alter table public.messages add column if not exists audio_url     text;
alter table public.messages add column if not exists audio_seconds integer;

alter table public.messages drop constraint if exists messages_story_kind_check;
alter table public.messages
  add constraint messages_story_kind_check
  check (story_kind is null or story_kind in ('reply', 'reaction'));

alter table public.messages drop constraint if exists messages_audio_seconds_check;
alter table public.messages
  add constraint messages_audio_seconds_check
  check (audio_seconds is null or audio_seconds between 1 and 600);

-- ---------------------------------------------------------------------
-- 2. Story reply / quick reaction
--    Same rule as the stories policy: the story must be live (24 h) and I
--    must follow its author. Returns the conversation id to open.
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
         case when coalesce(s.media_type, 'image') = 'image' then s.image_url end
    into v_author, v_thumb
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

  v_conv := public.get_or_create_dm(v_author);

  insert into public.messages (conversation_id, sender_id, body, story_id, story_thumb, story_kind)
  values (v_conv, v_me, v_body, p_story_id, v_thumb, p_kind);

  return v_conv;
end;
$$;

revoke all on function public.send_story_reply(uuid, text, text) from public, anon;
grant execute on function public.send_story_reply(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Voice messages: storage bucket + send function
--    Files live in voice/<my user id>/<random>.<ext> (random names, like the
--    other media buckets); only I can upload to my own folder.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'voice', 'voice', true, 5242880,
  array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/x-m4a', 'video/webm', 'video/mp4']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "voice_public_read" on storage.objects;
create policy "voice_public_read"
  on storage.objects for select
  using (bucket_id = 'voice');

drop policy if exists "voice_insert_own_folder" on storage.objects;
create policy "voice_insert_own_folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'voice' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "voice_delete_own_folder" on storage.objects;
create policy "voice_delete_own_folder"
  on storage.objects for delete to authenticated
  using (bucket_id = 'voice' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.send_voice_message(
  p_conversation uuid,
  p_url          text,
  p_seconds      integer
)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me  uuid := auth.uid();
  v_row public.messages;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_conversation_member(p_conversation) then
    raise exception 'not_allowed';
  end if;
  if p_seconds is null or p_seconds < 1 or p_seconds > 600 then
    raise exception 'invalid_duration';
  end if;
  -- the file must be inside MY folder of the voice bucket
  if p_url is null or position('/voice/' || v_me::text || '/' in p_url) = 0 then
    raise exception 'invalid_audio';
  end if;

  insert into public.messages (conversation_id, sender_id, body, audio_url, audio_seconds)
  values (p_conversation, v_me, 'Voice message', p_url, p_seconds)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.send_voice_message(uuid, text, integer) from public, anon;
grant execute on function public.send_voice_message(uuid, text, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Polls (on a post or on a story): two options, one vote per person
-- ---------------------------------------------------------------------
create table if not exists public.polls (
  id         uuid        primary key default gen_random_uuid(),
  post_id    uuid        unique references public.posts (id) on delete cascade,
  story_id   uuid        unique references public.stories (id) on delete cascade,
  created_by uuid        not null references public.profiles (id) on delete cascade,
  question   text        not null check (char_length(btrim(question)) between 1 and 100),
  created_at timestamptz not null default now(),
  constraint polls_one_target check ((post_id is not null)::int + (story_id is not null)::int = 1)
);

create table if not exists public.poll_options (
  id         uuid     primary key default gen_random_uuid(),
  poll_id    uuid     not null references public.polls (id) on delete cascade,
  label      text     not null check (char_length(btrim(label)) between 1 and 40),
  position   smallint not null check (position in (0, 1)),
  vote_count integer  not null default 0,
  unique (poll_id, position),
  unique (id, poll_id)
);

create table if not exists public.poll_votes (
  poll_id    uuid        not null references public.polls (id) on delete cascade,
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  option_id  uuid        not null,
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id),
  foreign key (option_id, poll_id) references public.poll_options (id, poll_id) on delete cascade
);

alter table public.polls        enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes   enable row level security;

revoke all on public.polls, public.poll_options, public.poll_votes from anon, authenticated;
grant select on public.polls, public.poll_options to authenticated;
grant select, insert on public.poll_votes to authenticated;

-- A poll is visible to exactly the people who can see its post / story.
-- (These sub-selects run as the viewer, so the posts / stories policies apply.)
drop policy if exists "polls_select" on public.polls;
create policy "polls_select"
  on public.polls for select to authenticated
  using (
    (post_id is not null and exists (select 1 from public.posts p where p.id = polls.post_id))
    or (story_id is not null and exists (select 1 from public.stories s where s.id = polls.story_id))
  );

drop policy if exists "poll_options_select" on public.poll_options;
create policy "poll_options_select"
  on public.poll_options for select to authenticated
  using (exists (select 1 from public.polls pl where pl.id = poll_options.poll_id));

-- You can only ever read YOUR OWN vote row; totals come from poll_options.vote_count.
drop policy if exists "poll_votes_select_own" on public.poll_votes;
create policy "poll_votes_select_own"
  on public.poll_votes for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "poll_votes_insert_own" on public.poll_votes;
create policy "poll_votes_insert_own"
  on public.poll_votes for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.polls pl where pl.id = poll_votes.poll_id)
  );

create or replace function private.poll_vote_counter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.poll_options set vote_count = vote_count + 1 where id = new.option_id;
  return null;
end;
$$;
revoke all on function private.poll_vote_counter() from public, anon, authenticated;

drop trigger if exists poll_vote_counter on public.poll_votes;
create trigger poll_vote_counter
  after insert on public.poll_votes
  for each row execute function private.poll_vote_counter();

create or replace function public.create_poll(
  p_post_id  uuid,
  p_story_id uuid,
  p_question text,
  p_options  text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_poll uuid;
  v_q    text := btrim(coalesce(p_question, ''));
  v_a    text;
  v_b    text;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;
  if (p_post_id is null) = (p_story_id is null) then
    raise exception 'invalid_target';
  end if;
  if char_length(v_q) not between 1 and 100 then
    raise exception 'invalid_question';
  end if;
  if coalesce(array_length(p_options, 1), 0) <> 2 then
    raise exception 'invalid_options';
  end if;
  v_a := btrim(coalesce(p_options[1], ''));
  v_b := btrim(coalesce(p_options[2], ''));
  if char_length(v_a) not between 1 and 40 or char_length(v_b) not between 1 and 40 then
    raise exception 'invalid_options';
  end if;

  if p_post_id is not null then
    if not exists (select 1 from public.posts p where p.id = p_post_id and p.author_id = v_me) then
      raise exception 'not_allowed';
    end if;
  else
    if not exists (select 1 from public.stories s
                   where s.id = p_story_id and s.author_id = v_me
                     and s.created_at > now() - interval '24 hours') then
      raise exception 'not_allowed';
    end if;
  end if;

  insert into public.polls (post_id, story_id, created_by, question)
  values (p_post_id, p_story_id, v_me, v_q)
  returning id into v_poll;

  insert into public.poll_options (poll_id, label, position)
  values (v_poll, v_a, 0), (v_poll, v_b, 1);

  return v_poll;
end;
$$;

revoke all on function public.create_poll(uuid, uuid, text, text[]) from public, anon;
grant execute on function public.create_poll(uuid, uuid, text, text[]) to authenticated;

-- live percentages: the app listens to vote_count changes
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'poll_options'
     ) then
    alter publication supabase_realtime add table public.poll_options;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Notes: one short status per person, shown for 24 hours
-- ---------------------------------------------------------------------
create table if not exists public.notes (
  user_id    uuid        primary key references public.profiles (id) on delete cascade,
  body       text        not null check (char_length(btrim(body)) between 1 and 60),
  updated_at timestamptz not null default now()
);

alter table public.notes enable row level security;
revoke all on public.notes from anon, authenticated;
grant select, delete on public.notes to authenticated;

-- mine, or the note of someone I follow; never older than 24 hours
drop policy if exists "notes_select" on public.notes;
create policy "notes_select"
  on public.notes for select to authenticated
  using (
    updated_at > now() - interval '24 hours'
    and (
      user_id = auth.uid()
      or exists (select 1 from public.follows f
                 where f.follower_id = auth.uid() and f.following_id = notes.user_id)
    )
  );

drop policy if exists "notes_delete_own" on public.notes;
create policy "notes_delete_own"
  on public.notes for delete to authenticated
  using (user_id = auth.uid());

create or replace function public.set_note(p_body text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_at   timestamptz := now();
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;
  if char_length(v_body) not between 1 and 60 then
    raise exception 'invalid_note';
  end if;
  insert into public.notes (user_id, body, updated_at)
  values (v_me, v_body, v_at)
  on conflict (user_id) do update set body = excluded.body, updated_at = excluded.updated_at;
  return v_at;
end;
$$;

revoke all on function public.set_note(text) from public, anon;
grant execute on function public.set_note(text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Push text for the new kinds of message (everything else is as before)
-- ---------------------------------------------------------------------
create or replace function private.push_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipients  uuid[];
  shared_kind text;
  preview     text;
  group_name  text;
  title       text;
begin
  select coalesce(array_agg(cp.user_id), '{}') into recipients
  from public.conversation_participants cp
  where cp.conversation_id = new.conversation_id and cp.user_id <> new.sender_id;

  if new.shared_post_id is not null then
    select coalesce(sp.media_type, 'post') into shared_kind
    from public.posts sp where sp.id = new.shared_post_id;
    preview := case when shared_kind = 'video' then 'shared a video with you'
                    else 'shared a post with you' end;
  elsif new.story_kind = 'reaction' then
    preview := 'reacted ' || left(new.body, 16) || ' to your story';
  elsif new.story_kind = 'reply' then
    preview := 'replied to your story: ' || left(new.body, 80);
  elsif new.audio_url is not null then
    preview := 'sent you a voice message';
  else
    preview := left(new.body, 100);
  end if;

  select g.name into group_name
  from public.conversations c
  join public.groups g on g.id = c.group_id
  where c.id = new.conversation_id;

  title := private.push_name(new.sender_id);
  if group_name is not null then
    title := title || ' in ' || group_name;
  end if;

  perform private.send_push(
    recipients, new.sender_id, title, preview,
    '/chat/' || new.conversation_id, 'chat:' || new.conversation_id);
  return null;
exception when others then
  raise warning 'push_on_message failed: %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists push_on_message on public.messages;
create trigger push_on_message
  after insert on public.messages
  for each row execute function private.push_on_message();
