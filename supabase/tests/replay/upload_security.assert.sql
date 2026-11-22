-- Upload-security policies (20261116000000 / 20261116000001), enforced with ASSERT.
-- Runs inside one transaction and rolls back.
begin;

-- the stub gives the API roles no table rights on storage.objects; real Supabase does.
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.objects to anon;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@test.local', '{"username":"sender","full_name":"Sender"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'b@test.local', '{"username":"friend","full_name":"Friend"}'),
  ('00000000-0000-0000-0000-0000000000c3', 'c@test.local', '{"username":"outsider","full_name":"Outsider"}');

-- ---- bucket settings --------------------------------------------------------------------------
do $$ begin
  assert (select public from storage.buckets where id = 'chat-media') = false, 'chat-media is private';
  assert (select public from storage.buckets where id = 'voice') = false,      'voice is private';
  assert (select public from storage.buckets where id = 'media'),              'media stays public';
  assert (select public from storage.buckets where id = 'avatars'),            'avatars stays public';
  assert (select public from storage.buckets where id = 'videos'),             'videos stays public';
  assert (select allowed_mime_types from storage.buckets where id = 'chat-media') is not null,
         'chat-media now has a mime allow-list';
  assert not ((select allowed_mime_types from storage.buckets where id = 'chat-media')
              && array['text/html', 'image/svg+xml', 'application/vnd.android.package-archive',
                       'application/x-msdownload', 'application/octet-stream']),
         'html / svg / apk / exe / unknown types are not allowed in chat-media';
  assert (select file_size_limit from storage.buckets where id = 'chat-media') = 15728640, 'size limit kept';
end $$;

-- ---- a private conversation with a photo and a voice note -----------------------------------
insert into public.conversations (id) values ('11111111-1111-1111-1111-111111111111');
insert into public.conversation_participants (conversation_id, user_id) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000a1'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000b2');

insert into storage.objects (bucket_id, name, owner) values
  ('chat-media', '00000000-0000-0000-0000-0000000000a1/photo.jpg', '00000000-0000-0000-0000-0000000000a1'),
  ('chat-media', '00000000-0000-0000-0000-0000000000a1/orphan.jpg', '00000000-0000-0000-0000-0000000000a1'),
  ('voice',      '00000000-0000-0000-0000-0000000000a1/note.webm',  '00000000-0000-0000-0000-0000000000a1'),
  ('media',      '00000000-0000-0000-0000-0000000000a1/posts/p.jpg','00000000-0000-0000-0000-0000000000a1');

insert into public.messages (conversation_id, sender_id, body, image_url) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000a1', 'pic',
   'https://x.supabase.co/storage/v1/object/public/chat-media/00000000-0000-0000-0000-0000000000a1/photo.jpg');
insert into public.messages (conversation_id, sender_id, body, audio_url, audio_seconds) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000a1', 'Voice message',
   'https://x.supabase.co/storage/v1/object/public/voice/00000000-0000-0000-0000-0000000000a1/note.webm', 3);

-- ---- the sender -----------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from storage.objects where bucket_id = 'chat-media') = 2, 'sender sees their own chat files';
  assert (select count(*) from storage.objects where bucket_id = 'voice') = 1,      'sender sees their own voice note';
  assert (select count(*) from storage.objects where bucket_id = 'media') = 1,      'owner can read own public-bucket files';
end $$;

-- uploads: allowed types go through, everything else is refused by the extension rule
do $$ declare me text := '00000000-0000-0000-0000-0000000000a1'; begin
  insert into storage.objects (bucket_id, name, owner) values ('chat-media', me || '/ok.pdf', me::uuid);
  insert into storage.objects (bucket_id, name, owner) values ('chat-media', me || '/OK2.JPG', me::uuid);
  insert into storage.objects (bucket_id, name, owner) values ('media', me || '/posts/ok.webp', me::uuid);
  insert into storage.objects (bucket_id, name, owner) values ('videos', me || '/ok.mp4', me::uuid);
  insert into storage.objects (bucket_id, name, owner) values ('avatars', me || '/avatar.jpg', me::uuid);
  insert into storage.objects (bucket_id, name, owner) values ('voice', me || '/ok.m4a', me::uuid);
end $$;
do $$
declare me text := '00000000-0000-0000-0000-0000000000a1'; bad text[][] := array[
  array['chat-media', 'evil.html'], array['chat-media', 'evil.svg'], array['chat-media', 'run.exe'],
  array['chat-media', 'app.apk'],   array['chat-media', 'noextension'], array['chat-media', 'x.pdf.html'],
  array['media', 'posts/evil.svg'], array['media', 'posts/evil.html'], array['media', 'posts/evil.js'],
  array['avatars', 'avatar.svg'],   array['videos', 'evil.html'],      array['videos', 'evil.exe'],
  array['voice', 'evil.html']];
  i int; refused boolean;
begin
  for i in 1 .. array_length(bad, 1) loop
    refused := false;
    begin
      insert into storage.objects (bucket_id, name, owner) values (bad[i][1], me || '/' || bad[i][2], me::uuid);
    exception when insufficient_privilege or check_violation then refused := true; end;
    assert refused, format('upload of %s/%s should be refused', bad[i][1], bad[i][2]);
  end loop;
end $$;
-- still cannot write into somebody else's folder
do $$ declare refused boolean := false; begin
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('chat-media', '00000000-0000-0000-0000-0000000000b2/x.pdf', '00000000-0000-0000-0000-0000000000a1');
  exception when insufficient_privilege or check_violation then refused := true; end;
  assert refused, 'cannot upload into another person''s folder';
end $$;
reset role;

-- ---- the person the photo was sent to --------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
set local role authenticated;
do $$ begin
  assert exists (select 1 from storage.objects where name = '00000000-0000-0000-0000-0000000000a1/photo.jpg'),
         'conversation member can read the photo in their chat';
  assert exists (select 1 from storage.objects where name = '00000000-0000-0000-0000-0000000000a1/note.webm'),
         'conversation member can read the voice note';
  assert not exists (select 1 from storage.objects where name = '00000000-0000-0000-0000-0000000000a1/orphan.jpg'),
         'a file that was never sent in a conversation stays private to its owner';
  assert not exists (select 1 from storage.objects where bucket_id = 'media'),
         'other people can no longer LIST the public media bucket';
end $$;
reset role;

-- ---- somebody who is not in the conversation -------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c3', true);
set local role authenticated;
do $$ begin
  assert not exists (select 1 from storage.objects where bucket_id in ('chat-media', 'voice')),
         'an outsider sees no chat files';
  assert not public.can_read_chat_object('chat-media', '00000000-0000-0000-0000-0000000000a1/photo.jpg'),
         'can_read_chat_object is false for an outsider';
end $$;
reset role;

-- ---- signed out --------------------------------------------------------------------------------
set local role anon;
do $$ begin
  assert not exists (select 1 from storage.objects),
         'anonymous visitors can list nothing in any bucket';
end $$;
do $$ begin
  perform public.can_read_chat_object('chat-media', 'x');
  raise exception 'anon was allowed to call can_read_chat_object';
exception when insufficient_privilege then null; end $$;
reset role;

-- ---- the path helper (also what the indexes use) --------------------------------------------
do $$ begin
  assert public.storage_object_path('https://x.supabase.co/storage/v1/object/public/chat-media/u/a.jpg?v=1', 'chat-media') = 'u/a.jpg';
  assert public.storage_object_path('https://x.supabase.co/storage/v1/object/public/voice/u/a.webm', 'chat-media') is null;
  assert public.storage_object_path(null, 'voice') is null;
end $$;

rollback;
