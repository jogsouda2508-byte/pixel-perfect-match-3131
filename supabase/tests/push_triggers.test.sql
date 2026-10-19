-- Local test for 20261023000000_push_triggers.sql (NOT a migration). Run on a THROWAWAY database only:
-- it creates and deletes test users and clears private.push_config.
-- Needs a throwaway Postgres with the migrations applied. If pg_net is missing (plain
-- Postgres), a stand-in net.http_post records calls in net.calls instead of sending them.
\set ON_ERROR_STOP on
create schema if not exists net;
create table if not exists net.calls (id serial primary key, url text, headers jsonb, body jsonb);
select not exists (select 1 from pg_extension where extname = 'pg_net') as need_stub \gset
\if :need_stub
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
  headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language plpgsql as
  $$ begin insert into net.calls (url, headers, body) values (url, headers, body); return 1; end $$;
\endif

create or replace function t_ok(label text, cond boolean) returns void language plpgsql as
$$ begin if cond is not true then raise exception 'FAIL: %', label; end if; raise notice 'PASS: %', label; end $$;
create or replace function t_calls() returns bigint language sql as $$ select count(*) from net.calls $$;

delete from private.push_config; truncate net.calls;
delete from public.conversations where id = '00000000-0000-0000-0000-0000000000e1';
delete from auth.users where email like '%@pushtest.local';
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000c1','ann@pushtest.local','{"full_name":"Ann","username":"ann_t"}'),
 ('00000000-0000-0000-0000-0000000000c2','bob@pushtest.local','{"full_name":"Bob","username":"bob_t"}'),
 ('00000000-0000-0000-0000-0000000000c3','cy@pushtest.local', '{"full_name":"Cy","username":"cy_t"}');
insert into public.posts (id, author_id, content) values
 ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000c1','Ann post');
insert into public.conversations (id) values ('00000000-0000-0000-0000-0000000000e1');
insert into public.conversation_participants (conversation_id, user_id) values
 ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000c1'),
 ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000c2'),
 ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000c3');

-- not configured => nothing is sent and nothing fails
insert into public.messages (conversation_id, sender_id, body)
 values ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000c1','before config');
select t_ok('no config: no call, message still saved',
  t_calls() = 0 and (select count(*) = 1 from public.messages where body = 'before config'));

insert into private.push_config values (true, 'https://proj.supabase.co/functions/v1/send-push', 's3cret');

-- chat message: everyone except the sender, tagged per conversation
insert into public.messages (conversation_id, sender_id, body)
 values ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000c1','hello team');
select t_ok('message: one call to the function URL with the secret header',
  (select count(*) = 1 and bool_and(url = 'https://proj.supabase.co/functions/v1/send-push')
          and bool_and(headers->>'x-push-secret' = 's3cret') from net.calls));
select t_ok('message: recipients = everyone but the sender',
  (select (select array_agg(x order by x) from jsonb_array_elements_text(body->'recipient_ids') x)
          = array['00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c3']
          and body->>'sender_id' = '00000000-0000-0000-0000-0000000000c1'
     from net.calls order by id desc limit 1));
select t_ok('message: title=sender name, body=text, url, chat tag',
  (select body->>'title' = 'Ann' and body->>'body' = 'hello team'
          and body->>'url' = '/chat/00000000-0000-0000-0000-0000000000e1'
          and body->>'tag' = 'chat:00000000-0000-0000-0000-0000000000e1'
     from net.calls order by id desc limit 1));
insert into public.messages (conversation_id, sender_id, body)
 values ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000c2','second');
select t_ok('repeated chat messages share ONE tag (so they replace each other)',
  (select count(distinct body->>'tag') = 1 from net.calls));

-- shared post
insert into public.messages (conversation_id, sender_id, body, shared_post_id)
 values ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000c2','x','00000000-0000-0000-0000-0000000000d1');
select t_ok('shared post message says so',
  (select body->>'body' = 'shared a post with you' from net.calls order by id desc limit 1));

-- like / comment on Ann's post
truncate net.calls;
insert into public.post_likes (post_id, user_id) values ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000c2');
select t_ok('like -> post author only, opens the post',
  (select count(*) = 1 and bool_and(body->'recipient_ids' = '["00000000-0000-0000-0000-0000000000c1"]'::jsonb)
          and bool_and(body->>'url' = '/post/00000000-0000-0000-0000-0000000000d1') from net.calls));
truncate net.calls;
insert into public.post_likes (post_id, user_id) values ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000c1');
select t_ok('liking your OWN post sends nothing', t_calls() = 0);
insert into public.post_comments (post_id, author_id, content) values ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000c3','nice one');
select t_ok('comment -> author, snippet, comments link',
  (select body->>'body' = 'commented: nice one' and body->>'url' like '%?comments=true' from net.calls order by id desc limit 1));
truncate net.calls;
insert into public.post_comments (post_id, author_id, content) values ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000c1','self');
select t_ok('commenting on your OWN post sends nothing', t_calls() = 0);

-- follow, tag
insert into public.follows (follower_id, following_id) values ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c1');
select t_ok('follow -> the followed person, opens the follower profile',
  (select body->'recipient_ids' = '["00000000-0000-0000-0000-0000000000c1"]'::jsonb and body->>'url' = '/u/bob_t'
     from net.calls order by id desc limit 1));
truncate net.calls;
insert into public.post_tags (post_id, tagged_user_id, tagged_by) values ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-0000000000c1');
select t_ok('tag -> the tagged person',
  (select body->'recipient_ids' = '["00000000-0000-0000-0000-0000000000c3"]'::jsonb and body->>'body' = 'tagged you in a post'
     from net.calls order by id desc limit 1));

-- story like: only the first time
truncate net.calls;
insert into public.stories (id, author_id, image_url) values ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000c1','https://x/i.jpg');
insert into public.story_views (story_id, viewer_id, liked) values ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000c2', false);
select t_ok('a view alone sends nothing', t_calls() = 0);
update public.story_views set liked = true where viewer_id = '00000000-0000-0000-0000-0000000000c2';
select t_ok('first story like -> story owner', t_calls() = 1 and
  (select body->>'body' = 'liked your story' and body->'recipient_ids' = '["00000000-0000-0000-0000-0000000000c1"]'::jsonb from net.calls));
update public.story_views set liked = false where viewer_id = '00000000-0000-0000-0000-0000000000c2';
update public.story_views set liked = true  where viewer_id = '00000000-0000-0000-0000-0000000000c2';
select t_ok('unlike + like again does NOT notify again', t_calls() = 1);

-- a broken push must never break the action (only against the local stand-in; never touches real pg_net)
\if :need_stub
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
  headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language plpgsql as
  $$ begin raise exception 'network down'; end $$;
insert into public.messages (conversation_id, sender_id, body)
 values ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000c1','still saved');
select t_ok('push failure does not block saving the message',
  (select count(*) = 1 from public.messages where body = 'still saved'));
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
  headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language plpgsql as
  $$ begin insert into net.calls (url, headers, body) values (url, headers, body); return 1; end $$;
\endif

-- clients cannot read the secret or call the helper
set role authenticated;
do $$ begin
  begin perform * from private.push_config; perform t_ok('client cannot read push_config', false);
  exception when insufficient_privilege then perform t_ok('client cannot read push_config', true); end;
  begin perform private.send_push(array[gen_random_uuid()], null, 't', 'b', '/', 'x'); perform t_ok('client cannot call send_push', false);
  exception when insufficient_privilege then perform t_ok('client cannot call send_push', true); end;
end $$;
reset role;

-- clean up
delete from private.push_config;
delete from public.conversations where id = '00000000-0000-0000-0000-0000000000e1';
delete from auth.users where email like '%@pushtest.local';
