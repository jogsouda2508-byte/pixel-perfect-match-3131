-- Security regression suite. Replays AFTER every migration (see run.sh) and attacks the schema the
-- way a hostile user would: as a signed-out visitor, a stranger, a blocked user. Every check is
-- recorded; any check that does not hold makes the whole file fail with the list of what broke.
-- Also contains "still works" checks so a security fix can't silently break the app.
-- Runs inside one transaction and rolls back.
begin;
grant select on public.groups to authenticated;
grant select on storage.objects to authenticated, anon;
grant insert on storage.objects to authenticated;
create schema zz; grant usage on schema zz to public;
create table zz.res (label text, ok boolean); grant all on zz.res to public;
create function zz.chk(l text, ok boolean) returns void language sql as $$ insert into zz.res values (l, ok) $$;
-- must return 0 rows / raise / affect 0 rows
create function zz.denied(l text, q text) returns void language plpgsql as $$
declare n bigint;
begin
  begin execute q; get diagnostics n = row_count; perform zz.chk(l, n = 0);
  exception when others then perform zz.chk(l, true); end;
end $$;
create function zz.hidden(l text, q text) returns void language plpgsql as $$
declare n bigint;
begin
  begin execute 'select count(*) from ('||q||') s' into n; perform zz.chk(l, n = 0);
  exception when others then perform zz.chk(l, true); end;
end $$;
grant execute on all functions in schema zz to public;

insert into auth.users (id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000a1','alice@secret.test','{"username":"alice","full_name":"Alice"}'),
 ('00000000-0000-0000-0000-0000000000b1','bob@secret.test','{"username":"bob","full_name":"Bob"}'),
 ('00000000-0000-0000-0000-0000000000c1','carol@secret.test','{"username":"carol","full_name":"Carol"}'),
 ('00000000-0000-0000-0000-0000000000d1','priv@secret.test','{"username":"privy","full_name":"Privy"}'),
 ('00000000-0000-0000-0000-0000000000e1','xavier@secret.test','{"username":"xavier","full_name":"Xavier"}');
update public.profiles set onboarding_completed=true;
update public.profiles set is_private=true where username='privy';

-- seed (superuser, bypasses RLS)
insert into public.posts (id,author_id,content,audience) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','alice public','Public'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a1','alice friends only','Friends'),
 ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000d1','private-account post','Public');
insert into public.stories (id,author_id,image_url) values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','x.jpg');
insert into public.follows values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1') on conflict do nothing;
insert into public.blocks (blocker_id,blocked_id) values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e1');
insert into public.push_subscriptions (user_id,endpoint,p256dh,auth) values ('00000000-0000-0000-0000-0000000000a1','https://push.example/a','k','s');
insert into public.device_tokens (user_id,token,platform) values ('00000000-0000-0000-0000-0000000000a1',repeat('t',40),'android');
insert into public.notes values ('00000000-0000-0000-0000-0000000000a1','alice note',now());
insert into public.close_friends (owner_id,friend_id) values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1');
insert into public.saved_posts (user_id,post_id) values ('00000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-000000000001');
insert into public.reports (reporter_id,target_type,target_id,target_user_id,reason) values ('00000000-0000-0000-0000-0000000000a1','user','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c1','spam');
insert into public.conversations (id) values ('30000000-0000-0000-0000-000000000001');
insert into public.conversation_participants (conversation_id,user_id) values
 ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1'),
 ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1');
insert into public.messages (id,conversation_id,sender_id,body) values
 ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','secret dm');
insert into public.business_bookings (business_id,customer_id,service,requested_at) values ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000b1','cut',now());
insert into public.referrals (referred_id,referrer_id) values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1');
insert into public.follow_requests (requester_id,target_id) values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000d1');
insert into public.groups (id,name,created_by,is_private) values ('50000000-0000-0000-0000-000000000001','secret club','00000000-0000-0000-0000-0000000000a1',true);
insert into public.group_members (group_id,user_id,role) values ('50000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','admin'),('50000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','member');
insert into public.conversations (id,group_id) values ('30000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000001');
insert into public.conversation_participants (conversation_id,user_id) select '30000000-0000-0000-0000-000000000002', user_id from public.group_members where group_id='50000000-0000-0000-0000-000000000001' on conflict do nothing;
insert into public.messages (id,conversation_id,sender_id,body) values ('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a1','secret group msg');

-- ============ ANON ============
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$ declare t text; begin
  perform zz.chk('anon cannot read profiles',  not exists (select 1 from (select 1 from public.profiles limit 1) s) );
exception when others then perform zz.chk('anon cannot read profiles', true); end $$;
do $$ begin perform zz.chk('anon cannot learn a username''s email (get_login_email)', (select public.get_login_email('alice')) is null);
exception when others then perform zz.chk('anon cannot learn a username''s email (get_login_email)', true); end $$;
do $$ begin perform zz.chk('anon cannot learn emails by username (get_reset_emails)', coalesce(array_length(public.get_reset_emails('alice'),1),0)=0);
exception when others then perform zz.chk('anon cannot learn emails by username (get_reset_emails)', true); end $$;
do $$ begin perform zz.chk('anon cannot probe whether an email is registered (get_login_emails)', coalesce(array_length(public.get_login_emails('alice@secret.test'),1),0)=0);
exception when others then perform zz.chk('anon cannot probe whether an email is registered (get_login_emails)', true); end $$;
-- plan_signup_email stays open to visitors (the sign-up page needs it). It does reveal whether an
-- email is already registered: that is inherent to offering sign-up aliases and is listed in
-- docs/SECURITY-PATCH.md as residual risk (mitigate with CAPTCHA / Auth rate limits). What it must
-- never do is return an address the caller did not type.
do $$ declare r jsonb; begin
  r := public.plan_signup_email('alice@secret.test','newname');
  perform zz.chk('plan_signup_email only ever returns an address built from what the caller typed',
    (r->>'auth_email') is null or ((r->>'auth_email') like 'alice%@secret.test' and (r->>'auth_email') not like '%bob%'));
exception when others then perform zz.chk('plan_signup_email only ever returns an address built from what the caller typed', true); end $$;
select zz.hidden('anon cannot read posts','select 1 from public.posts');
select zz.hidden('anon cannot read messages','select 1 from public.messages');
select zz.hidden('anon cannot read follows','select 1 from public.follows');
select zz.denied('anon cannot insert posts',$q$insert into public.posts(author_id,content) values ('00000000-0000-0000-0000-0000000000a1','x')$q$);
reset role;

-- ============ STRANGER (carol) ============
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',true);
set local role authenticated;
select zz.hidden('stranger cannot read others DMs','select 1 from public.messages where conversation_id=''30000000-0000-0000-0000-000000000001''');
select zz.hidden('stranger cannot read group messages','select 1 from public.messages where conversation_id=''30000000-0000-0000-0000-000000000002''');
select zz.hidden('stranger cannot see conversations','select 1 from public.conversations');
select zz.hidden('stranger cannot see participants','select 1 from public.conversation_participants');
select zz.hidden('stranger cannot see other people''s push subscriptions','select 1 from public.push_subscriptions');
select zz.hidden('stranger cannot see other people''s device tokens','select 1 from public.device_tokens');
select zz.hidden('stranger cannot read friends-only post','select 1 from public.posts where id=''10000000-0000-0000-0000-000000000002''');
select zz.hidden('stranger cannot read private-account posts','select 1 from public.posts where author_id=''00000000-0000-0000-0000-0000000000d1''');
select zz.hidden('stranger cannot see non-followed stories','select 1 from public.stories');
select zz.hidden('stranger cannot see close friends list','select 1 from public.close_friends');
select zz.hidden('stranger cannot see others'' blocks','select 1 from public.blocks');
select zz.hidden('stranger cannot see others'' saved posts','select 1 from public.saved_posts');
select zz.hidden('stranger cannot read others'' reports','select 1 from public.reports');
select zz.hidden('stranger cannot read others'' notes','select 1 from public.notes');
select zz.hidden('stranger cannot read others'' bookings','select 1 from public.business_bookings');
select zz.hidden('stranger cannot read others'' referrals','select 1 from public.referrals');
select zz.hidden('stranger cannot read private group','select 1 from public.groups where is_private');
select zz.hidden('stranger cannot read private group members','select 1 from public.group_members where group_id=''50000000-0000-0000-0000-000000000001''');
select zz.hidden('stranger cannot read account_emails','select 1 from public.account_emails');
select zz.hidden('stranger cannot read quiz answer keys','select 1 from public.community_quiz_keys');
select zz.hidden('stranger cannot read follow requests between other people','select 1 from public.follow_requests where requester_id<>''00000000-0000-0000-0000-0000000000c1'' and target_id<>''00000000-0000-0000-0000-0000000000c1''');
select zz.hidden('stranger cannot read story views','select 1 from public.story_views');
select zz.hidden('stranger cannot read reactions in others'' chats','select 1 from public.message_reactions');
-- writes
select zz.denied('stranger cannot post a message into someone else''s DM',$q$insert into public.messages(conversation_id,sender_id,body) values ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c1','hi')$q$);
select zz.denied('stranger cannot spoof sender in own DM-less insert',$q$insert into public.messages(conversation_id,sender_id,body) values ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','spoof')$q$);
select zz.denied('stranger cannot edit alice''s profile',$q$update public.profiles set bio='pwned' where username='alice'$q$);
select zz.denied('stranger cannot delete alice''s post',$q$delete from public.posts where author_id='00000000-0000-0000-0000-0000000000a1'$q$);
select zz.denied('stranger cannot impersonate a post author',$q$insert into public.posts(author_id,content) values ('00000000-0000-0000-0000-0000000000a1','fake')$q$);
select zz.denied('stranger cannot follow as someone else',$q$insert into public.follows values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1')$q$);
select zz.denied('stranger cannot follow a private account directly',$q$insert into public.follows values ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000d1')$q$);
select zz.denied('stranger cannot comment as someone else',$q$insert into public.post_comments(post_id,author_id,content) values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','fake')$q$);
select zz.denied('stranger cannot like on behalf of someone',$q$insert into public.post_likes(post_id,user_id) values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1')$q$);
select zz.denied('stranger cannot add themselves to a private group',$q$insert into public.group_members(group_id,user_id,role) values ('50000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c1','admin')$q$);
select zz.denied('stranger cannot add themselves to a conversation',$q$insert into public.conversation_participants(conversation_id,user_id) values ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c1')$q$);
select zz.denied('stranger cannot read-receipt someone else''s participant row',$q$update public.conversation_participants set last_read_at=now() where user_id='00000000-0000-0000-0000-0000000000a1'$q$);
select zz.denied('stranger cannot plant a story view as someone else',$q$insert into public.story_views(story_id,viewer_id) values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1')$q$);
select zz.denied('stranger cannot register a push token for someone else',$q$insert into public.device_tokens(user_id,token) values ('00000000-0000-0000-0000-0000000000a1','evil')$q$);
select zz.denied('stranger cannot subscribe push for someone else',$q$insert into public.push_subscriptions(user_id,endpoint,p256dh,auth) values ('00000000-0000-0000-0000-0000000000a1','https://evil','k','s')$q$);
select zz.denied('stranger cannot file a report as someone else',$q$insert into public.reports(reporter_id,target_type,target_id,reason) values ('00000000-0000-0000-0000-0000000000a1','user','00000000-0000-0000-0000-0000000000c1','x')$q$);
select zz.denied('stranger cannot forge a block',$q$insert into public.blocks values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1')$q$);
select zz.denied('stranger cannot forge a close friend',$q$insert into public.close_friends(owner_id,friend_id) values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000c1')$q$);
select zz.denied('stranger cannot create a referral row directly',$q$insert into public.referrals values ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1')$q$);
select zz.denied('stranger cannot create a booking directly as another customer',$q$insert into public.business_bookings(business_id,customer_id,service,requested_at) values ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000b1','x',now())$q$);
-- RPC abuse
select zz.denied('react_to_message in a chat you are not in',$q$select public.react_to_message('40000000-0000-0000-0000-000000000001','👍')$q$);
select zz.denied('edit someone else''s message',$q$select public.edit_message('40000000-0000-0000-0000-000000000001','pwned')$q$);
select zz.denied('delete someone else''s message',$q$select public.delete_message('40000000-0000-0000-0000-000000000001')$q$);
select zz.denied('send_chat_message into a chat you are not in',$q$select public.send_chat_message('30000000-0000-0000-0000-000000000001','hi',null,null,null,null,null,null,null)$q$);
select zz.denied('join a private group without invite',$q$select public.join_group('50000000-0000-0000-0000-000000000001')$q$);
select zz.denied('invite people into a group you are not in',$q$select public.invite_to_group('50000000-0000-0000-0000-000000000001', array['00000000-0000-0000-0000-0000000000c1']::uuid[])$q$);
select zz.denied('remove a member from a group you do not admin',$q$select public.remove_group_member('50000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1')$q$);
select zz.denied('reply to a story you cannot see',$q$select public.send_story_reply('20000000-0000-0000-0000-000000000001','hello','reply')$q$);
select zz.denied('share a post you cannot see (friends-only)',$q$select public.share_post_to_user('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000b1')$q$);
select zz.denied('tag people on someone else''s post',$q$select public.set_post_tags('10000000-0000-0000-0000-000000000001', array['00000000-0000-0000-0000-0000000000b1']::uuid[])$q$);
select zz.denied('respond to a booking that is not yours',$q$select public.respond_to_booking((select id from public.business_bookings limit 1),true,'x')$q$);
select zz.denied('cancel a booking that is not yours',$q$select public.cancel_booking((select id from public.business_bookings limit 1))$q$);
do $$ begin perform public.record_video_view('10000000-0000-0000-0000-000000000002'); end $$;
reset role;
do $$ begin perform zz.chk('record_video_view on invisible post inserts nothing', (select count(*) from public.post_video_views)=0); end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',true);
set local role authenticated;
do $$ begin perform zz.chk('share count of an invisible post is 0', public.get_post_share_count('10000000-0000-0000-0000-000000000002')=0); end $$;
reset role;

-- ============ BLOCKED USER (xavier, blocked by alice) ============
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e1',true);
set local role authenticated;
select zz.hidden('blocked user cannot see blocker''s posts','select 1 from public.posts where author_id=''00000000-0000-0000-0000-0000000000a1''');
select zz.denied('blocked user cannot follow blocker',$q$insert into public.follows values ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a1')$q$);
select zz.denied('blocked user cannot open a DM with blocker',$q$select public.get_or_create_dm('00000000-0000-0000-0000-0000000000a1')$q$);
select zz.denied('blocked user cannot send follow request to blocker',$q$select public.send_follow_request('00000000-0000-0000-0000-0000000000a1')$q$);
reset role;

-- ============ OWNER (alice) must still work ============
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);
set local role authenticated;
do $$ begin perform zz.chk('alice can read her DM', (select count(*) from public.messages where conversation_id='30000000-0000-0000-0000-000000000001')=1); end $$;
do $$ begin perform zz.chk('alice can see her own push subscription', (select count(*) from public.push_subscriptions)=1); end $$;
do $$ begin perform zz.chk('alice can read the private group', (select count(*) from public.groups where id='50000000-0000-0000-0000-000000000001')=1); end $$;
reset role;


-- ====================================================================================
-- Fix verification
-- ====================================================================================

-- ---- who may call what (catalog level) --------------------------------------------
-- signed-out visitors: exactly the three sign-up/invite RPCs, nothing else
do $$ declare f text; begin
  select string_agg(p.proname, ', ' order by p.proname) into f
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind in ('f','p')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not in ('get_referrer','is_username_available','plan_signup_email');
  perform zz.chk('signed-out visitors can call ONLY the 3 sign-up RPCs (found: '||coalesce(f,'none extra')||')', f is null);
end $$;
do $$ declare f text; begin
  select string_agg(p.proname, ', ') into f
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  perform zz.chk('trigger functions are not callable by clients (found: '||coalesce(f,'none')||')', f is null);
end $$;
do $$ declare f text; begin
  select string_agg(p.proname, ', ') into f
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%');
  perform zz.chk('every SECURITY DEFINER function pins its search_path (found: '||coalesce(f,'none')||')', f is null);
end $$;
do $$ declare f text; begin
  select string_agg(c.relname, ', ') into f
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public','private') and c.relkind in ('r','p') and not c.relrowsecurity;
  perform zz.chk('every table in public/private has row level security on (found: '||coalesce(f,'none')||')', f is null);
end $$;
do $$ declare f text; begin
  select string_agg(c.relname, ', ') into f
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p')
     and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
          or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'));
  perform zz.chk('signed-out role holds no table privileges (found: '||coalesce(f,'none')||')', f is null);
end $$;
do $$ declare f text; begin
  select string_agg(p.policyname||' on '||p.tablename, ', ') into f from pg_policies p
   where p.schemaname = 'public' and ('anon' = any(p.roles) or 'public' = any(p.roles));
  perform zz.chk('no public-schema policy applies to signed-out visitors (found: '||coalesce(f,'none')||')', f is null);
end $$;
-- no regression, in both directions:
--  (a) signed-in users keep EXECUTE on every function the app calls
--  (b) internal helpers that take arbitrary user ids stay uncallable (they would let anyone ask
--      "can X see this post?" / "did A block B?" about other people)
do $$ declare f text; begin
  select string_agg(p.proname, ', ') into f
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind in ('f','p') and p.prorettype <> 'trigger'::regtype
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and p.proname not in ('get_login_email','get_reset_emails','get_login_emails','auth_throttle_hit',
                           'blocked_between','is_profile_visible_for','can_view_post')
     and not has_function_privilege('authenticated', p.oid, 'execute');
  perform zz.chk('signed-in users keep EXECUTE on every app function (missing: '||coalesce(f,'none')||')', f is null);
end $$;
do $$ declare f text; begin
  select string_agg(p.proname, ', ') into f
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('blocked_between','is_profile_visible_for','can_view_post')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'));
  perform zz.chk('helpers that take arbitrary user ids stay uncallable by clients (exposed: '||coalesce(f,'none')||')', f is null);
end $$;
do $$ begin
  perform zz.chk('signed-in users cannot call the email lookups', not has_function_privilege('authenticated','public.get_login_email(text)','execute')
    and not has_function_privilege('authenticated','public.get_reset_emails(text)','execute')
    and not has_function_privilege('authenticated','public.get_login_emails(text)','execute'));
  perform zz.chk('the server (service_role) can still call the email lookups', has_function_privilege('service_role','public.get_login_email(text)','execute')
    and has_function_privilege('service_role','public.get_reset_emails(text)','execute'));
  perform zz.chk('the auth throttle exists', to_regprocedure('public.auth_throttle_hit(text,integer,interval)') is not null);
  perform zz.chk('clients cannot call the auth throttle', to_regprocedure('public.auth_throttle_hit(text,integer,interval)') is null
    or (not has_function_privilege('authenticated','public.auth_throttle_hit(text,integer,interval)','execute')
        and not has_function_privilege('anon','public.auth_throttle_hit(text,integer,interval)','execute')));
end $$;

-- ---- storage ---------------------------------------------------------------------
insert into storage.objects (bucket_id, name) values
  ('chat-media', '00000000-0000-0000-0000-0000000000a1/dm-photo.jpg'),
  ('voice',      '00000000-0000-0000-0000-0000000000a1/note.webm'),
  ('avatars',    '00000000-0000-0000-0000-0000000000a1/avatar.jpg'),
  ('media',      '00000000-0000-0000-0000-0000000000a1/post.jpg'),
  ('videos',     '00000000-0000-0000-0000-0000000000a1/clip.mp4');
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select zz.hidden('signed-out visitor cannot LIST chat-media files',$q$select 1 from storage.objects where bucket_id='chat-media'$q$);
select zz.hidden('signed-out visitor cannot LIST voice notes',$q$select 1 from storage.objects where bucket_id='voice'$q$);
select zz.hidden('signed-out visitor cannot LIST avatars/media/videos',$q$select 1 from storage.objects where bucket_id in ('avatars','media','videos')$q$);
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',true);
set local role authenticated;
select zz.hidden('stranger cannot LIST other people''s chat-media',$q$select 1 from storage.objects where bucket_id='chat-media'$q$);
select zz.hidden('stranger cannot LIST other people''s voice notes',$q$select 1 from storage.objects where bucket_id='voice'$q$);
select zz.hidden('stranger cannot LIST other people''s avatars/media/videos',$q$select 1 from storage.objects where bucket_id in ('avatars','media','videos')$q$);
select zz.denied('stranger cannot delete another user''s chat file',$q$delete from storage.objects where bucket_id='chat-media'$q$);
select zz.denied('stranger cannot write into another user''s folder',$q$insert into storage.objects(bucket_id,name) values ('chat-media','00000000-0000-0000-0000-0000000000a1/evil.jpg')$q$);
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);
set local role authenticated;
do $$ declare n bigint; begin
  perform zz.chk('owner can still list their own files in every bucket (upsert/remove/account deletion need it)',
    (select count(*) from storage.objects where bucket_id in ('chat-media','voice','avatars','media','videos')) = 5);
  insert into storage.objects(bucket_id,name) values ('chat-media','00000000-0000-0000-0000-0000000000a1/new.png');
  get diagnostics n = row_count;
  perform zz.chk('owner can still upload into their own folder', n = 1);
end $$;
reset role;
do $$ declare m text[]; begin
  select allowed_mime_types into m from storage.buckets where id = 'chat-media';
  perform zz.chk('chat-media has a file-type allow-list', m is not null and array_length(m,1) > 5);
  perform zz.chk('chat-media refuses HTML, SVG and JavaScript', not (m && array['text/html','image/svg+xml','application/javascript','text/javascript','application/xhtml+xml']));
  perform zz.chk('chat-media still accepts photos, PDFs and Office files', m @> array['image/jpeg','image/png','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
  perform zz.chk('every bucket has a size limit', not exists (select 1 from storage.buckets where file_size_limit is null));
  perform zz.chk('every bucket except chat-media/voice-style types is MIME-restricted', not exists (select 1 from storage.buckets where allowed_mime_types is null));
end $$;

-- ---- profiles: system columns ---------------------------------------------------
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000f1','dora@secret.test','{"username":"dora"}');
update public.profiles set onboarding_completed = true, created_at = now() - interval '30 days' where username = 'dora';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000f1',true);
set local role authenticated;
update public.profiles set created_at = now(), bio = 'hello' where id = auth.uid();
do $$ begin
  perform zz.chk('a person can still edit their own bio', (select bio from public.profiles where id = auth.uid()) = 'hello');
  perform zz.chk('a person cannot rewrite their own created_at', (select created_at from public.profiles where id = auth.uid()) < now() - interval '29 days');
  perform zz.chk('referral window cannot be reset by editing created_at', public.claim_referral('alice') = 'too_late');
end $$;
reset role;
-- internal (definer / service) code can still change it
update public.profiles set created_at = now() - interval '40 days' where username = 'dora';
do $$ begin perform zz.chk('the server itself can still change created_at', (select created_at from public.profiles where username='dora') < now() - interval '39 days'); end $$;

-- ---- throttle ------------------------------------------------------------------
set local role service_role;
do $$ declare a boolean; b boolean; c boolean; d boolean; begin
  if to_regprocedure('public.auth_throttle_hit(text,integer,interval)') is null then return; end if;
  a := public.auth_throttle_hit('t:1', 2, interval '1 minute');
  b := public.auth_throttle_hit('t:1', 2, interval '1 minute');
  c := public.auth_throttle_hit('t:1', 2, interval '1 minute');
  d := public.auth_throttle_hit('t:2', 2, interval '1 minute');
  perform zz.chk('throttle allows up to the limit', a and b);
  perform zz.chk('throttle refuses past the limit', not c);
  perform zz.chk('throttle keys are independent', d);
  perform zz.chk('throttle refuses an empty key', not public.auth_throttle_hit('', 5, interval '1 minute'));
end $$;
reset role;
set local role authenticated;
select zz.hidden('signed-in users cannot read the throttle table','select * from private.auth_throttle');
reset role;
set local role anon;
select zz.hidden('signed-out visitors cannot read the throttle table','select * from private.auth_throttle');
reset role;

-- ---- app still works: triggers fire and common RPCs run for signed-in users ----------
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);
set local role authenticated;
do $$ declare conv uuid; n bigint; begin
  conv := public.get_or_create_dm('00000000-0000-0000-0000-0000000000b1');
  perform zz.chk('get_or_create_dm works', conv is not null);
  perform public.send_chat_message(conv, 'hello bob', null,null,null,null,null,null,null);
  perform zz.chk('send_chat_message works and its trigger fires (last_message_preview set)',
    (select last_message_preview from public.conversations where id = conv) is not null);
  perform zz.chk('create_group works', public.create_group('club2','d',false,array[]::uuid[]) is not null);
  perform zz.chk('get_people works', (select count(*) from public.get_people('',false,false,10)) >= 0);
  insert into public.follows values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000c1');
  get diagnostics n = row_count;
  perform zz.chk('follow insert works and the block trigger does not interfere', n = 1);
end $$;
reset role;

-- ---- sign-up still works with the trigger function locked down -----------------------
-- Supabase's auth service is NOT a superuser. Prove the on-signup trigger (handle_new_user, whose
-- EXECUTE was revoked from every client role) still creates the profile when a plain role inserts.
create role zz_auth_service nologin;
grant usage on schema auth, public to zz_auth_service;
grant insert, select on auth.users to zz_auth_service;
set local role zz_auth_service;
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000f9','newbie@secret.test','{"username":"newbie","full_name":"New Bie"}');
reset role;
do $$ begin perform zz.chk('sign-up trigger still creates the profile when run by a non-superuser',
  exists (select 1 from public.profiles where username = 'newbie')); end $$;

-- ====================================================================================
do $$
declare bad text; total int; nbad int;
begin
  select count(*), count(*) filter (where not ok), string_agg(label, E'\n  - ') filter (where not ok)
    into total, nbad, bad from zz.res;
  raise notice 'security suite: % checks, % failed', total, nbad;
  assert nbad = 0, E'security checks FAILED:\n  - ' || bad;
end $$;
rollback;
