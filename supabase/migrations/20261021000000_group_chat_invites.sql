-- =====================================================================
-- Gicco: group chat + invitations. Safe to run more than once.
-- Run AFTER 20261014000000_chat.sql and 20261013000000_saved_groups.sql.
--
-- Flow: create_group() makes the group, its chat room and pending invites.
-- Invited people see Accept / Decline. Accepting adds them to the group AND
-- the chat room, so every message reaches every member. Nobody can add
-- themselves to a group directly any more; everything goes through the
-- functions below.
-- =====================================================================

-- 1. Columns ----------------------------------------------------------
alter table public.groups
  add column if not exists is_private boolean not null default false;

alter table public.conversations
  add column if not exists group_id uuid references public.groups (id) on delete cascade;

create unique index if not exists conversations_group_id_key
  on public.conversations (group_id) where group_id is not null;

-- 2. Pending invitations (a row is deleted once accepted or declined) --
create table if not exists public.group_invites (
  group_id   uuid        not null references public.groups (id) on delete cascade,
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  invited_by uuid        not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists group_invites_user_idx on public.group_invites (user_id);
alter table public.group_invites enable row level security;

-- 3. Helpers (security definer so policies never recurse) -------------
create or replace function public.is_group_member(g uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.group_members m where m.group_id = g and m.user_id = auth.uid());
$$;

create or replace function public.can_see_group(g uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.groups x
    where x.id = g
      and (
        not x.is_private
        or x.created_by = auth.uid()
        or exists (select 1 from public.group_members m where m.group_id = g and m.user_id = auth.uid())
        or exists (select 1 from public.group_invites i where i.group_id = g and i.user_id = auth.uid())
      )
  );
$$;

-- 4. Row-level security ----------------------------------------------
drop policy if exists "groups_select_authenticated" on public.groups;
drop policy if exists "groups_select_visible" on public.groups;
create policy "groups_select_visible" on public.groups
  for select to authenticated using (public.can_see_group(id));

drop policy if exists "group_members_select_authenticated" on public.group_members;
drop policy if exists "group_members_select_visible" on public.group_members;
create policy "group_members_select_visible" on public.group_members
  for select to authenticated using (public.can_see_group(group_id));

-- No more direct inserts/deletes on members: use the functions.
drop policy if exists "group_members_join_self" on public.group_members;
drop policy if exists "group_members_leave_self" on public.group_members;
revoke insert, update, delete on public.group_members from anon, authenticated;

drop policy if exists "group_invites_select_involved" on public.group_invites;
create policy "group_invites_select_involved" on public.group_invites
  for select to authenticated using (user_id = auth.uid() or invited_by = auth.uid());
revoke all on public.group_invites from anon, authenticated;
grant select on public.group_invites to authenticated;

-- 5. Existing groups get a chat room too ------------------------------
insert into public.conversations (group_id)
select g.id from public.groups g
where not exists (select 1 from public.conversations c where c.group_id = g.id);

insert into public.conversation_participants (conversation_id, user_id)
select c.id, m.user_id
from public.group_members m join public.conversations c on c.group_id = m.group_id
on conflict do nothing;

-- 6. A group's chat must never be mistaken for a 1:1 DM ---------------
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

-- 7. Actions ----------------------------------------------------------
drop function if exists public.create_group(text, text);

create or replace function public.create_group(
  p_name        text,
  p_description text    default '',
  p_is_private  boolean default false,
  p_invitees    uuid[]  default '{}'
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
  v_conv uuid;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;

  insert into public.groups (name, description, created_by, is_private)
  values (btrim(p_name), btrim(coalesce(p_description, '')), v_me, coalesce(p_is_private, false))
  returning id into v_id;

  insert into public.group_members (group_id, user_id, role) values (v_id, v_me, 'admin');
  insert into public.conversations (group_id) values (v_id) returning id into v_conv;
  insert into public.conversation_participants (conversation_id, user_id) values (v_conv, v_me);

  insert into public.group_invites (group_id, user_id, invited_by)
  select v_id, u.id, v_me
  from (select distinct x as id from unnest(coalesce(p_invitees, '{}')) x) u
  where u.id <> v_me and exists (select 1 from public.profiles p where p.id = u.id)
  limit 100;

  return v_id;
end;
$$;

create or replace function public.invite_to_group(p_group uuid, p_users uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_group_member(p_group) then raise exception 'not_member'; end if;

  insert into public.group_invites (group_id, user_id, invited_by)
  select p_group, u.id, auth.uid()
  from (select distinct x as id from unnest(coalesce(p_users, '{}')) x) u
  where u.id <> auth.uid()
    and exists (select 1 from public.profiles p where p.id = u.id)
    and not exists (select 1 from public.group_members m where m.group_id = p_group and m.user_id = u.id)
  limit 100
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.respond_group_invite(p_group uuid, p_accept boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_conv uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  delete from public.group_invites where group_id = p_group and user_id = auth.uid();
  if not found then raise exception 'no_invite'; end if;

  if p_accept then
    insert into public.group_members (group_id, user_id, role)
    values (p_group, auth.uid(), 'member') on conflict do nothing;
    select id into v_conv from public.conversations where group_id = p_group;
    if v_conv is not null then
      insert into public.conversation_participants (conversation_id, user_id)
      values (v_conv, auth.uid()) on conflict do nothing;
    end if;
  end if;
  return p_accept;
end;
$$;

create or replace function public.join_group(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_conv uuid; v_private boolean;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select is_private into v_private from public.groups where id = p_group;
  if not found then raise exception 'group_not_found'; end if;
  if v_private then raise exception 'private_group'; end if;

  insert into public.group_members (group_id, user_id, role)
  values (p_group, auth.uid(), 'member') on conflict do nothing;
  delete from public.group_invites where group_id = p_group and user_id = auth.uid();
  select id into v_conv from public.conversations where group_id = p_group;
  if v_conv is not null then
    insert into public.conversation_participants (conversation_id, user_id)
    values (v_conv, auth.uid()) on conflict do nothing;
  end if;
end;
$$;

create or replace function public.leave_group(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from public.group_members where group_id = p_group and user_id = auth.uid();
  if not found then raise exception 'not_member'; end if;
  if v_role = 'admin' then raise exception 'admin_cannot_leave'; end if;

  delete from public.group_members where group_id = p_group and user_id = auth.uid();
  delete from public.conversation_participants cp
  using public.conversations c
  where c.group_id = p_group and cp.conversation_id = c.id and cp.user_id = auth.uid();
end;
$$;

create or replace function public.remove_group_member(p_group uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.group_members
    where group_id = p_group and user_id = auth.uid() and role = 'admin'
  ) then raise exception 'admins_only'; end if;
  if p_user = auth.uid() then raise exception 'admin_cannot_leave'; end if;

  delete from public.group_members where group_id = p_group and user_id = p_user;
  delete from public.conversation_participants cp
  using public.conversations c
  where c.group_id = p_group and cp.conversation_id = c.id and cp.user_id = p_user;
end;
$$;

-- 8. Reads ------------------------------------------------------------
drop function if exists public.get_groups(text, boolean, int);
drop function if exists public.get_groups(text, boolean, int, uuid);
drop function if exists public.get_my_group_invites();

create or replace function public.get_groups(
  p_query     text    default null,
  p_mine_only boolean default false,
  p_limit     int     default 30,
  p_group     uuid    default null
)
returns table (
  id uuid, name text, description text, created_by uuid, created_at timestamptz,
  is_private boolean, member_count bigint, is_member boolean, my_role text,
  has_invite boolean, conversation_id uuid, member_preview jsonb
)
language sql stable set search_path = public as $$
  select
    g.id, g.name, g.description, g.created_by, g.created_at, g.is_private,
    (select count(*) from public.group_members m where m.group_id = g.id),
    public.is_group_member(g.id),
    (select m.role from public.group_members m where m.group_id = g.id and m.user_id = auth.uid()),
    exists (select 1 from public.group_invites i where i.group_id = g.id and i.user_id = auth.uid()),
    (select c.id from public.conversations c where c.group_id = g.id and public.is_group_member(g.id)),
    (select coalesce(jsonb_agg(jsonb_build_object('name', x.full_name, 'avatar_url', x.avatar_url)), '[]'::jsonb)
     from (select p.full_name, p.avatar_url
           from public.group_members m join public.profiles p on p.id = m.user_id
           where m.group_id = g.id
           order by (m.role = 'admin') desc, m.created_at limit 3) x)
  from public.groups g
  where public.can_see_group(g.id)
    and (p_group is null or g.id = p_group)
    and (
      p_query is null or btrim(p_query) = ''
      or g.name ilike '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
    )
    and (not p_mine_only or public.is_group_member(g.id))
  order by public.is_group_member(g.id) desc, g.created_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;

create or replace function public.get_my_group_invites()
returns table (
  group_id uuid, group_name text, description text, is_private boolean, member_count bigint,
  invited_by uuid, inviter_name text, inviter_username text, inviter_avatar text, created_at timestamptz,
  member_preview jsonb
)
language sql stable set search_path = public as $$
  select i.group_id, g.name, g.description, g.is_private,
         (select count(*) from public.group_members m where m.group_id = g.id),
         i.invited_by, p.full_name, p.username, p.avatar_url, i.created_at,
         (select coalesce(jsonb_agg(jsonb_build_object('name', x.full_name, 'avatar_url', x.avatar_url)), '[]'::jsonb)
     from (select p.full_name, p.avatar_url
           from public.group_members m join public.profiles p on p.id = m.user_id
           where m.group_id = g.id
           order by (m.role = 'admin') desc, m.created_at limit 3) x)
  from public.group_invites i
  join public.groups g on g.id = i.group_id
  join public.profiles p on p.id = i.invited_by
  where i.user_id = auth.uid()
  order by i.created_at desc;
$$;

create or replace function public.get_group_members(p_group uuid)
returns table (user_id uuid, full_name text, username text, avatar_url text, role text, joined_at timestamptz)
language sql stable set search_path = public as $$
  select m.user_id, p.full_name, p.username, p.avatar_url, m.role, m.created_at
  from public.group_members m
  join public.profiles p on p.id = m.user_id
  where m.group_id = p_group and public.can_see_group(p_group)
  order by (m.role = 'admin') desc, m.created_at;
$$;

-- 9. Permissions ------------------------------------------------------
revoke all on function
  public.is_group_member(uuid), public.can_see_group(uuid),
  public.create_group(text, text, boolean, uuid[]), public.invite_to_group(uuid, uuid[]),
  public.respond_group_invite(uuid, boolean), public.join_group(uuid), public.leave_group(uuid),
  public.remove_group_member(uuid, uuid), public.get_groups(text, boolean, int, uuid),
  public.get_my_group_invites(), public.get_group_members(uuid), public.get_or_create_dm(uuid)
from public, anon;

grant execute on function
  public.is_group_member(uuid), public.can_see_group(uuid),
  public.create_group(text, text, boolean, uuid[]), public.invite_to_group(uuid, uuid[]),
  public.respond_group_invite(uuid, boolean), public.join_group(uuid), public.leave_group(uuid),
  public.remove_group_member(uuid, uuid), public.get_groups(text, boolean, int, uuid),
  public.get_my_group_invites(), public.get_group_members(uuid), public.get_or_create_dm(uuid)
to authenticated;
