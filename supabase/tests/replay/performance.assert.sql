-- Performance guards, enforced with ASSERT. Runs inside one transaction and rolls back.
-- Covers 20261117000000_backend_performance.sql and 20261117000001_rls_initplan.sql.
begin;

-- ---- 1. No policy still calls auth.uid() once per row.
do $$
declare bad text;
begin
  select string_agg(format('%s.%s / %s', schemaname, tablename, policyname), ', ') into bad
  from pg_policies
  where schemaname in ('public', 'storage')
    and (coalesce(qual, '') ~* '(?<!select )auth\.uid\(\)'
         or coalesce(with_check, '') ~* '(?<!select )auth\.uid\(\)');
  assert bad is null, 'policies with a bare auth.uid() (use (select auth.uid())): ' || coalesce(bad, '');
end $$;

-- ---- 2. Every foreign key has an index that starts with its column (delete + join speed).
do $$
declare bad text;
begin
  select string_agg(format('%s(%s)', c.conrelid::regclass, a.attname), ', ') into bad
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.contype = 'f'
    and c.connamespace = 'public'::regnamespace
    and not exists (
      select 1 from pg_index i
      where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1] and i.indisvalid
    );
  assert bad is null, 'foreign keys without a leading index: ' || coalesce(bad, '');
end $$;

-- ---- 3. The cheaper unread count gives the same answer as the old way
--         (the notification list, shares left out, newer than "seen").
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.local', '{"username":"asha","full_name":"Asha"}'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.local', '{"username":"ravi","full_name":"Ravi"}'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.local', '{"username":"meena","full_name":"Meena"}'),
  ('00000000-0000-0000-0000-00000000000d', 'd@test.local', '{"username":"zedd","full_name":"Zed"}');

update public.profiles set notifications_seen_at = now() - interval '1 day'
  where username = 'asha';

insert into public.posts (id, author_id, content) values
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'hello');
insert into public.post_likes (post_id, user_id, created_at) values
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', now()),
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', now()),                       -- my own like: no
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', now() - interval '2 days');   -- before "seen": no
insert into public.post_comments (post_id, author_id, content) values
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 'nice');
insert into public.follows (follower_id, following_id) values
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000d');
insert into public.follow_requests (requester_id, target_id, status) values
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a', 'pending');
insert into public.follow_requests (requester_id, target_id, status, responded_at) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000d', 'accepted', now());
-- a shared post in chat: shows in the list, never in the count
insert into public.conversations (id) values ('50000000-0000-0000-0000-000000000001');
insert into public.conversation_participants (conversation_id, user_id) values
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a'),
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b');
insert into public.messages (conversation_id, sender_id, body, shared_post_id) values
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'Shared post',
   '40000000-0000-0000-0000-000000000001');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$
declare v_new bigint; v_old bigint;
begin
  v_new := public.get_unread_notification_count();
  select count(*) into v_old
  from public.get_notifications(200) n
  where n.kind <> 'share'
    and n.created_at > (select pr.notifications_seen_at from public.profiles pr where pr.id = auth.uid());
  assert v_new > 0, 'the seeded notifications should be counted';
  assert v_new = v_old, format('unread count changed: new %s, old way %s', v_new, v_old);
end $$;
reset role;

-- nothing is newer than "seen" -> zero, both ways
update public.profiles set notifications_seen_at = now() + interval '1 hour' where username = 'asha';
set local role authenticated;
do $$ begin
  assert public.get_unread_notification_count() = 0, 'nothing newer than seen -> 0';
end $$;
reset role;

-- ---- 4. Still closed to the public key.
set local role anon;
do $$ begin
  perform public.get_unread_notification_count();
  raise exception 'anon can call get_unread_notification_count';
exception when insufficient_privilege then null; end $$;
reset role;

rollback;
