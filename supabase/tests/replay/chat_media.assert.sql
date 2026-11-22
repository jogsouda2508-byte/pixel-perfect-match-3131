-- Private chat: who can read messages and chat media, enforced with ASSERT.
-- Runs inside one transaction and rolls back. Uses the real migrations replayed by run.sh.
begin;
grant select on storage.objects to authenticated, anon;
grant insert on storage.objects to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.local', '{"username":"anna","full_name":"Anna"}'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.local', '{"username":"bela","full_name":"Bela"}'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.local', '{"username":"chen","full_name":"Chen"}'),
  ('00000000-0000-0000-0000-00000000000d', 'd@test.local', '{"username":"dara","full_name":"Dara"}');

-- conv1 = Anna + Bela.  conv2 = Chen + Dara.  Chen is an OUTSIDER to conv1.
insert into public.conversations (id) values
  ('c0000000-0000-4000-8000-000000000001'), ('c0000000-0000-4000-8000-000000000002');
insert into public.conversation_participants (conversation_id, user_id) values
  ('c0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-00000000000a'),
  ('c0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-00000000000b'),
  ('c0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-00000000000c'),
  ('c0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-00000000000d');

-- files already sitting in storage (as the service would have stored them)
insert into storage.objects (bucket_id, name, owner) values
  ('chat-media', '00000000-0000-0000-0000-00000000000a/11111111-1111-1111-1111-111111111111.jpg', '00000000-0000-0000-0000-00000000000a'), -- photo, will be sent in conv1
  ('chat-media', '00000000-0000-0000-0000-00000000000a/22222222-2222-2222-2222-222222222222.pdf', '00000000-0000-0000-0000-00000000000a'), -- document, will be sent in conv1
  ('chat-media', '00000000-0000-0000-0000-00000000000a/33333333-3333-3333-3333-333333333333.jpg', '00000000-0000-0000-0000-00000000000a'), -- uploaded, NEVER sent
  ('voice',      '00000000-0000-0000-0000-00000000000a/44444444-4444-4444-4444-444444444444.webm','00000000-0000-0000-0000-00000000000a'), -- voice note, will be sent in conv1
  ('chat-media', '00000000-0000-0000-0000-00000000000c/55555555-5555-5555-5555-555555555555.png', '00000000-0000-0000-0000-00000000000c'), -- Chen's photo, sent in conv2
  ('chat-media', '00000000-0000-0000-0000-00000000000b/66666666-6666-6666-6666-666666666666.jpg', '00000000-0000-0000-0000-00000000000b'); -- Bela's, never sent

-- a test helper: runs a statement as the CURRENT role and returns the error text (or 'ok')
create function public.zz_err(q text) returns text language plpgsql as $$
begin execute q; return 'ok'; exception when others then return sqlerrm; end $$;
 grant execute on function public.zz_err(text) to authenticated, anon;

-- ===== 1. configuration ==========================================================================
do $$
declare v_mimes text[];
begin
  assert (select public from storage.buckets where id = 'chat-media') = false, 'chat-media must be private';
  assert (select public from storage.buckets where id = 'voice') = false,      'voice must be private';

  select allowed_mime_types into v_mimes from storage.buckets where id = 'chat-media';
  assert 'image/jpeg' = any (v_mimes) and 'application/pdf' = any (v_mimes) and 'video/mp4' = any (v_mimes),
    'normal photos, PDFs and videos are allowed';
  assert not ('image/svg+xml' = any (v_mimes)),                         'SVG (can carry scripts) is not allowed';
  assert not ('text/html' = any (v_mimes)),                             'HTML is not allowed';
  assert not ('application/vnd.android.package-archive' = any (v_mimes)), 'APKs are not allowed';
  assert not ('application/x-msdownload' = any (v_mimes)),              'programs are not allowed';

  assert not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                       and policyname in ('chat_media_public_read', 'voice_public_read')),
    'the public read rules are gone';
  assert not exists (select 1 from pg_policies
                      where schemaname = 'storage' and tablename = 'objects' and cmd in ('SELECT', 'ALL')
                        and (roles && array['public', 'anon']::name[])
                        and (coalesce(qual, '') ~ '(chat-media|voice)')),
    'no rule lets signed-out visitors read chat media';
end $$;

-- ===== 2. the path reader =========================================================================
do $$
declare a text := '00000000-0000-0000-0000-00000000000a';
begin
  assert public.chat_media_path('chat-media', a || '/x1.jpg') = a || '/x1.jpg',                       'bare path';
  assert public.chat_media_path('chat-media', 'https://p.supabase.co/storage/v1/object/public/chat-media/' || a || '/x1.jpg') = a || '/x1.jpg', 'public-style address';
  assert public.chat_media_path('chat-media', 'https://p.supabase.co/storage/v1/object/sign/chat-media/' || a || '/x1.jpg?token=abc') = a || '/x1.jpg', 'signed address with a query';
  assert public.chat_media_path('chat-media', 'https://p.supabase.co/storage/v1/object/public/voice/' || a || '/x1.jpg') is null,        'other bucket';
  assert public.chat_media_path('voice', 'https://p.supabase.co/storage/v1/object/public/voice/' || a || '/x.webm') = a || '/x.webm',  'voice bucket';
  assert public.chat_media_path('chat-media', 'https://evil.example/?u=/storage/v1/object/public/chat-media/' || a || '/x1.jpg') is null, 'look-alike address';
  assert public.chat_media_path('chat-media', 'https://p.supabase.co/storage/v1/object/public/chat-media/' || a || '/../x.jpg') is null, 'dot-dot';
  assert public.chat_media_path('chat-media', a || '/..') is null,                                   'dot-dot file';
  assert public.chat_media_path('chat-media', a || '/.hidden') is null,                              'leading dot';
  assert public.chat_media_path('chat-media', upper(a) || '/x.jpg') is null,                         'upper-case id';
  assert public.chat_media_path('chat-media', 'not-a-uuid/x.jpg') is null,                           'not an id';
  assert public.chat_media_path('chat-media', a || '/a b.jpg') is null,                              'space in name';
  assert public.chat_media_path('chat-media', a || '/x.jpg/y') is null,                              'extra folder';
  assert public.chat_media_path('chat-media', null) is null,                                         'null';
end $$;

-- ===== 3. sending (Anna, member of conv1) ==========================================================
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$
declare
  a    text := '00000000-0000-0000-0000-00000000000a';
  b    text := '00000000-0000-0000-0000-00000000000b';
  c1   uuid := 'c0000000-0000-4000-8000-000000000001';
  base text := 'https://p.supabase.co/storage/v1/object/public/';
begin
  -- the three normal ways to attach something succeed
  perform public.send_chat_message(c1, '', null, base || 'chat-media/' || a || '/11111111-1111-1111-1111-111111111111.jpg', 100, 100);
  perform public.send_chat_message(c1, 'the file', null, null, null, null, a || '/22222222-2222-2222-2222-222222222222.pdf', 'plan.pdf', 1000);
  perform public.send_voice_message(c1, base || 'voice/' || a || '/44444444-4444-4444-4444-444444444444.webm', 5);
  perform public.send_chat_message(c1, 'plain text hello');

  -- and the bad ones are refused
  assert public.zz_err(format($q$select public.send_chat_message(%L,'',null,%L)$q$, c1,
      'https://evil.example/?u=/storage/v1/object/public/chat-media/' || a || '/11111111-1111-1111-1111-111111111111.jpg')) = 'invalid_media', 'foreign address';
  assert public.zz_err(format($q$select public.send_chat_message(%L,'',null,%L)$q$, c1,
      base || 'chat-media/' || b || '/66666666-6666-6666-6666-666666666666.jpg')) = 'invalid_media', 'someone else''s file';
  assert public.zz_err(format($q$select public.send_chat_message(%L,'',null,%L)$q$, c1,
      base || 'chat-media/' || a || '/../' || b || '/66666666-6666-6666-6666-666666666666.jpg')) = 'invalid_media', 'dot-dot trick';
  assert public.zz_err(format($q$select public.send_chat_message(%L,'',null,%L)$q$, c1,
      base || 'voice/' || a || '/44444444-4444-4444-4444-444444444444.webm')) = 'invalid_media', 'voice file as a photo';
  assert public.zz_err(format($q$select public.send_chat_message(%L,'x',null,%L,null,null,%L)$q$, c1,
      a || '/11111111-1111-1111-1111-111111111111.jpg', a || '/22222222-2222-2222-2222-222222222222.pdf')) = 'invalid_media', 'photo and file together';
  assert public.zz_err(format($q$select public.send_voice_message(%L,%L,5)$q$, c1,
      base || 'chat-media/' || a || '/11111111-1111-1111-1111-111111111111.jpg')) = 'invalid_audio', 'photo as a voice note';
  assert public.zz_err(format($q$select public.send_voice_message(%L,%L,5)$q$, c1,
      base || 'voice/' || b || '/44444444-4444-4444-4444-444444444444.webm')) = 'invalid_audio', 'someone else''s voice note';
end $$;
reset role;

-- Chen sends a photo in conv2
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
set local role authenticated;
do $$ begin
  perform public.send_chat_message('c0000000-0000-4000-8000-000000000002', '', null,
    '00000000-0000-0000-0000-00000000000c/55555555-5555-5555-5555-555555555555.png', 50, 50);
end $$;
reset role;

-- ===== 4. who can read the files ====================================================================
-- Bela (member of conv1): the 3 attachments Anna sent, but not Anna's unsent upload
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
do $$
declare a text := '00000000-0000-0000-0000-00000000000a';
begin
  assert (select count(*) from storage.objects where name in (
      a || '/11111111-1111-1111-1111-111111111111.jpg', a || '/22222222-2222-2222-2222-222222222222.pdf',
      a || '/44444444-4444-4444-4444-444444444444.webm')) = 3,                   'a member can read what was sent to the chat';
  assert (select count(*) from storage.objects where name = a || '/33333333-3333-3333-3333-333333333333.jpg') = 0,
    'a member cannot read a file that was uploaded but never sent';
  assert public.can_read_chat_media('chat-media', a || '/44444444-4444-4444-4444-444444444444.webm') = false,
    'a voice file is not readable as chat-media';
  assert (select count(*) from storage.objects where name like '%55555555%') = 0, 'a member cannot read another chat''s file';
end $$;
reset role;

-- Chen (outsider to conv1): nothing of Anna's, but his own and his own chat's
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
set local role authenticated;
do $$
declare a text := '00000000-0000-0000-0000-00000000000a';
begin
  assert (select count(*) from storage.objects where name like a || '/%') = 0, 'an outsider reads none of Anna''s files';
  assert (select count(*) from storage.objects where name like '%55555555%') = 1, 'Chen reads his own photo';
  assert public.can_read_chat_media('chat-media', a || '/11111111-1111-1111-1111-111111111111.jpg') = false, 'can_read says no to an outsider';
end $$;
reset role;

-- Dara (member of conv2 only): Chen's photo yes, Anna's no
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from storage.objects where name like '%55555555%') = 1,                    'the other member of conv2 reads Chen''s photo';
  assert (select count(*) from storage.objects where name like '00000000-0000-0000-0000-00000000000a/%') = 0, 'but none of conv1''s';
end $$;
reset role;

-- Anna (owner): everything of hers, including the unsent upload
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from storage.objects where name like '00000000-0000-0000-0000-00000000000a/%') = 4, 'the owner reads all her uploads';
end $$;
reset role;

-- a signed-out visitor
set local role anon;
do $$ begin
  assert (select count(*) from storage.objects) = 0, 'signed-out visitors read nothing';
  assert public.zz_err($q$select public.can_read_chat_media('chat-media','x')$q$) like '%permission denied%', 'signed-out visitors cannot even ask';
end $$;
reset role;

-- ===== 5. uploads and deletes =======================================================================
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$
declare a text := '00000000-0000-0000-0000-00000000000a'; b text := '00000000-0000-0000-0000-00000000000b';
begin
  assert public.zz_err(format($q$insert into storage.objects (bucket_id,name,owner) values ('chat-media',%L,%L)$q$,
    a || '/77777777-7777-7777-7777-777777777777.jpg', a)) = 'ok',                                   'upload into my own folder';
  assert public.zz_err(format($q$insert into storage.objects (bucket_id,name,owner) values ('chat-media',%L,%L)$q$,
    b || '/88888888-8888-8888-8888-888888888888.jpg', a)) like '%row-level security%',              'not into someone else''s folder';
  assert public.zz_err(format($q$insert into storage.objects (bucket_id,name,owner) values ('chat-media',%L,%L)$q$,
    a || '/../' || b || '/x.jpg', a)) like '%row-level security%',                                  'not with a dot-dot name';
  assert public.zz_err(format($q$insert into storage.objects (bucket_id,name,owner) values ('chat-media',%L,%L)$q$,
    a || '/two words.jpg', a)) like '%row-level security%',                                         'not with an odd file name';
  assert public.zz_err(format($q$insert into storage.objects (bucket_id,name,owner) values ('voice',%L,%L)$q$,
    a || '/99999999-9999-9999-9999-999999999999.webm', a)) = 'ok',                                  'voice upload into my own folder';
  assert public.zz_err(format($q$insert into storage.objects (bucket_id,name,owner) values ('voice',%L,%L)$q$,
    b || '/99999999-9999-9999-9999-999999999998.webm', a)) like '%row-level security%',             'voice: not into someone else''s folder';
  assert public.zz_err($q$update storage.objects set name = name || 'x' where bucket_id = 'chat-media'$q$) like '%cannot be renamed or swapped%'
     and (select count(*) from storage.objects where name like '%jpgx') = 0,                        'a file cannot be renamed or swapped (no update rule)';
end $$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
do $$
declare n int;
begin
  delete from storage.objects where name like '00000000-0000-0000-0000-00000000000a/%';
  get diagnostics n = row_count;
  assert n = 0, 'a member cannot delete someone else''s file';
end $$;
reset role;

-- ===== 6. messages: only the people in the conversation =============================================
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
set local role authenticated;
do $$
declare
  c1 uuid := 'c0000000-0000-4000-8000-000000000001';
  m  uuid;
begin
  assert (select count(*) from public.messages where conversation_id = c1) = 0,                'an outsider reads no messages';
  assert (select count(*) from public.conversations where id = c1) = 0,                        'an outsider cannot see the conversation';
  assert (select count(*) from public.conversation_participants where conversation_id = c1) = 0, 'an outsider cannot see who is in it';
  assert public.zz_err(format($q$insert into public.messages (conversation_id, sender_id, body) values (%L, %L, 'hi')$q$, c1,
    '00000000-0000-0000-0000-00000000000c')) like '%row-level security%',                      'an outsider cannot post';
  assert public.zz_err(format($q$select public.send_chat_message(%L,'hi')$q$, c1)) = 'not_allowed', 'an outsider cannot post through send_chat_message';
  assert public.zz_err(format($q$select public.send_voice_message(%L,%L,5)$q$, c1,
    '00000000-0000-0000-0000-00000000000c/44444444-4444-4444-4444-444444444444.webm')) = 'not_allowed', 'nor a voice note';

  reset role;
  select id into m from public.messages where conversation_id = c1 order by created_at limit 1;
  set local role authenticated;
  assert public.zz_err(format($q$select public.react_to_message(%L, 'x')$q$, m)) = 'not_allowed',  'an outsider cannot react';
  assert public.zz_err(format($q$select public.edit_message(%L, 'hacked')$q$, m)) = 'not_allowed',  'an outsider cannot edit';
  assert public.zz_err(format($q$select public.delete_message(%L)$q$, m)) = 'not_allowed',          'an outsider cannot delete';
  assert (select count(*) from public.message_reactions where conversation_id = c1) = 0,            'an outsider reads no reactions';
end $$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
do $$
declare
  c1 uuid := 'c0000000-0000-4000-8000-000000000001';
  m  uuid;
begin
  assert (select count(*) from public.messages where conversation_id = c1) = 4, 'a member reads the conversation';
  assert public.zz_err(format($q$insert into public.messages (conversation_id, sender_id, body) values (%L, %L, 'as anna')$q$, c1,
    '00000000-0000-0000-0000-00000000000a')) like '%row-level security%',                       'a member cannot post as someone else';
  assert public.zz_err(format($q$insert into public.messages (conversation_id, sender_id, body, image_url) values (%L, %L, 'x', 'https://evil.example/x.jpg')$q$, c1,
    '00000000-0000-0000-0000-00000000000b')) like '%permission denied%',                        'media columns cannot be set directly';
  assert public.zz_err(format($q$update public.messages set body = 'edited' where conversation_id = %L$q$, c1)) like '%permission denied%',
    'messages cannot be updated directly';
  reset role;
  select id into m from public.messages where conversation_id = c1 and sender_id = '00000000-0000-0000-0000-00000000000a' order by created_at limit 1;
  set local role authenticated;
  assert public.zz_err(format($q$select public.edit_message(%L, 'hacked')$q$, m)) = 'not_allowed', 'a member cannot edit someone else''s message';
  assert public.zz_err(format($q$select public.delete_message(%L)$q$, m)) = 'not_allowed',         'a member cannot delete someone else''s message';
end $$;
reset role;

-- ===== 7. leaving the conversation ends access =======================================================
delete from public.conversation_participants
 where conversation_id = 'c0000000-0000-4000-8000-000000000001'
   and user_id = '00000000-0000-0000-0000-00000000000b';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from storage.objects where name like '00000000-0000-0000-0000-00000000000a/%') = 0, 'someone who left can no longer read the media';
  assert (select count(*) from public.messages where conversation_id = 'c0000000-0000-4000-8000-000000000001') = 0, 'nor the messages';
end $$;
reset role;

rollback;
