-- Account deletion, enforced with ASSERT. Runs inside one transaction and rolls back.
begin;

-- ---- 1. Guard for future tables: anything that points at a person must cascade or set null,
--         otherwise deleting an account fails or leaves that person's data behind.
do $$
declare bad text;
begin
  select string_agg(format('%s.%s', c.conrelid::regclass, a.attname), ', ') into bad
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
  where c.contype = 'f'
    and c.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass)
    and c.confdeltype not in ('c', 'n');
  assert bad is null, 'foreign keys to a person without cascade/set null: ' || coalesce(bad, '');
end $$;

-- ---- 2. Fixtures: asha (deleter), ravi (member), meena (admin), zed (a stranger).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.local', '{"username":"asha","full_name":"Asha"}'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.local', '{"username":"ravi","full_name":"Ravi"}'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.local', '{"username":"meena","full_name":"Meena"}'),
  ('00000000-0000-0000-0000-00000000000d', 'd@test.local', '{"username":"zedd","full_name":"Zed"}');

insert into public.follows (follower_id, following_id) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000d');

-- group 1: made by asha, ravi (member) and meena (admin) are in it -> goes to meena
-- group 2: made by asha, nobody else -> deleted
insert into public.groups (id, name, created_by) values
  ('10000000-0000-0000-0000-000000000001', 'Shared group', '00000000-0000-0000-0000-00000000000a'),
  ('10000000-0000-0000-0000-000000000002', 'Solo group',   '00000000-0000-0000-0000-00000000000a');
insert into public.group_members (group_id, user_id, role) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'admin'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'member'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 'admin'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'admin');

-- chats: asha<->ravi (ravi stays), asha<->zed is irrelevant; asha-only room
insert into public.conversations (id) values
  ('20000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002');
insert into public.conversation_participants (conversation_id, user_id) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a'),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a');
insert into public.messages (conversation_id, sender_id, body) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'from asha'),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'from ravi'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'note to self');

-- ---- 3. Not signed in, or signed in long ago -> refused, nothing changes.
set local role anon;
do $$ begin
  perform public.delete_my_account();
  raise exception 'anon was allowed to delete';
exception when insufficient_privilege then null; end $$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ begin
  perform public.delete_my_account();
  raise exception 'a token with no session or issue time was accepted';
exception when others then
  assert sqlerrm = 'reauth_required', 'stale/unknown session must be refused, got: ' || sqlerrm;
end $$;
reset role;

insert into auth.sessions (id, user_id, created_at) values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', now() - interval '2 hours');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000000a","session_id":"30000000-0000-0000-0000-000000000001"}', true);
set local role authenticated;
do $$ begin
  perform public.delete_my_account();
  raise exception 'a 2-hour-old session was accepted';
exception when others then
  assert sqlerrm = 'reauth_required', 'old session must be refused, got: ' || sqlerrm;
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.profiles where username = 'asha'), 'refused deletion changed nothing';
end $$;

-- ---- 4. Someone else's fresh session id does not count.
insert into auth.sessions (id, user_id, created_at) values
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', now());
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000000a","session_id":"30000000-0000-0000-0000-000000000002"}', true);
set local role authenticated;
do $$ begin
  perform public.delete_my_account();
  raise exception 'another person''s session was accepted';
exception when others then
  assert sqlerrm = 'reauth_required', 'foreign session must be refused, got: ' || sqlerrm;
end $$;
reset role;

-- the app's pre-flight check agrees with the refusals above (and is closed to the public key)
set local role authenticated;
do $$ begin assert public.my_session_is_fresh() = false, 'foreign session is not fresh'; end $$;
reset role;
set local role anon;
do $$ begin
  perform public.my_session_is_fresh();
  raise exception 'anon can call my_session_is_fresh';
exception when insufficient_privilege then null; end $$;
reset role;

-- ---- 5. Fresh sign-in -> works.
insert into auth.sessions (id, user_id, created_at) values
  ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', now() - interval '1 minute');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000000a","session_id":"30000000-0000-0000-0000-000000000003"}', true);
set local role authenticated;
do $$ begin assert public.my_session_is_fresh() = true, 'a 1-minute-old session is fresh'; end $$;
select public.delete_my_account();
reset role;

do $$ begin
  assert not exists (select 1 from auth.users    where id = '00000000-0000-0000-0000-00000000000a'), 'login removed';
  assert not exists (select 1 from public.profiles where username = 'asha'),                         'profile removed';
  assert not exists (select 1 from public.follows
                     where '00000000-0000-0000-0000-00000000000a' in (follower_id, following_id)),    'follows removed both ways';
  assert exists (select 1 from public.follows
                 where follower_id = '00000000-0000-0000-0000-00000000000b'
                   and following_id = '00000000-0000-0000-0000-00000000000d'),                        'other people''s follows untouched';
  assert not exists (select 1 from public.messages where body in ('from asha', 'note to self')),     'her messages removed';
  assert exists (select 1 from public.messages where body = 'from ravi'),                             'ravi''s message kept';
  assert not exists (select 1 from public.conversations where id = '20000000-0000-0000-0000-000000000002'),
                     'a chat nobody is left in is removed';
  assert exists (select 1 from public.conversations where id = '20000000-0000-0000-0000-000000000001'),
                     'a chat someone is still in is kept';
  assert (select created_by from public.groups where id = '10000000-0000-0000-0000-000000000001')
         = '00000000-0000-0000-0000-00000000000c',                                                   'shared group goes to its other admin';
  assert (select count(*) from public.group_members where group_id = '10000000-0000-0000-0000-000000000001') = 2,
                     'shared group keeps its other members';
  assert not exists (select 1 from public.groups where id = '10000000-0000-0000-0000-000000000002'), 'a group with nobody else is deleted';
  assert exists (select 1 from public.profiles where username in ('ravi', 'meena', 'zedd')),         'other accounts untouched';
end $$;

-- ---- 6. The unused email lookup is closed to the public key.
set local role anon;
do $$ begin
  perform public.get_login_emails('a@test.local');
  raise exception 'anon can still look up account emails by mailbox';
exception when insufficient_privilege then null; end $$;
reset role;

rollback;
