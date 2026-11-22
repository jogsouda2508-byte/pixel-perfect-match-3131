-- =====================================================================
-- Privacy + account deletion hardening. Safe to run more than once.
-- Run in Supabase Dashboard -> SQL Editor (or `supabase db push`), AFTER
-- 20261113000000_delete_account.sql. Nothing here changes existing data.
--
-- 1. delete_my_account() now
--      * needs a RECENT sign-in (my_session_is_fresh(): session < 10 minutes old), so a stolen or
--        left-open session cannot erase an account. The app asks for the password first;
--        accounts that signed in with Google are asked to sign in again.
--      * hands a group you created to another member instead of destroying the group
--        (and its chat) for everybody else. A group with nobody else in it is deleted.
--      * removes chat rooms that nobody is left in.
--    Everything else still goes through "on delete cascade" (see the replay test
--    supabase/tests/replay/delete_account.assert.sql, which fails if a new table that points
--    at a profile or login is added without cascade / set null).
-- 2. get_login_emails(text) is not used by the app (log-in is by username) but lets anyone
--    holding the public key turn a mailbox into the account emails behind it. Closed.
-- =====================================================================

-- "Did this person sign in recently?" The app asks this BEFORE it deletes any uploaded files,
-- so a stale session is turned away without losing anything. A session row's created_at only
-- moves when the person actually signs in (refreshing the access token does not), so it is the
-- right clock. Tokens that carry no session id fall back to the token's own issue time.
create or replace function public.my_session_is_fresh()
returns boolean
language plpgsql
security definer
stable
set search_path = public, auth
as $$
declare
  v_claims  jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  v_session uuid;
  v_started timestamptz;
begin
  if auth.uid() is null then return false; end if;
  begin
    v_session := nullif(v_claims ->> 'session_id', '')::uuid;
  exception when others then
    v_session := null;
  end;
  if v_session is not null then
    select s.created_at into v_started
    from auth.sessions s
    where s.id = v_session and s.user_id = auth.uid();
  elsif (v_claims ->> 'iat') ~ '^[0-9]+$' then
    v_started := to_timestamp((v_claims ->> 'iat')::bigint);
  end if;
  return v_started is not null and v_started >= now() - interval '10 minutes';
end $$;

revoke all on function public.my_session_is_fresh() from public, anon;
grant execute on function public.my_session_is_fresh() to authenticated;

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid     uuid := auth.uid();
  v_heir  uuid;
  v_group record;
  v_convs uuid[];
begin
  if uid is null then raise exception 'Please sign in first'; end if;

  if not public.my_session_is_fresh() then
    raise exception 'reauth_required'
      using hint = 'Sign in again, then delete the account within 10 minutes.';
  end if;

  -- Groups this person created: give each one to the longest-standing other member (admins
  -- first) so the other members keep their group and chat. No other member -> the group is
  -- deleted with the account (cascade).
  for v_group in select g.id from public.groups g where g.created_by = uid loop
    select m.user_id into v_heir
    from public.group_members m
    where m.group_id = v_group.id and m.user_id <> uid
    order by (m.role = 'admin') desc, m.created_at asc
    limit 1;
    if v_heir is not null then
      update public.groups set created_by = v_heir where id = v_group.id;
      update public.group_members set role = 'admin'
        where group_id = v_group.id and user_id = v_heir;
    end if;
  end loop;

  select coalesce(array_agg(cp.conversation_id), '{}') into v_convs
  from public.conversation_participants cp where cp.user_id = uid;

  delete from auth.users where id = uid;
  if not found then raise exception 'account_not_found'; end if;

  -- Chats that nobody is in any more (both people deleted their accounts).
  delete from public.conversations c
  where c.id = any (v_convs)
    and not exists (
      select 1 from public.conversation_participants p where p.conversation_id = c.id
    );
end $$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- 2. Unused email lookup that anon could call.
revoke all on function public.get_login_emails(text) from public, anon, authenticated;
