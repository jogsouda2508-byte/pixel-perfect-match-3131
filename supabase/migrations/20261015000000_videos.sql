-- =====================================================================
-- Ediraa: short videos in the existing posts system
-- Safe to run more than once.
-- =====================================================================

alter table public.posts
  add column if not exists media_type text not null default 'image',
  add column if not exists video_url text,
  add column if not exists thumbnail_url text,
  add column if not exists duration_seconds numeric;

alter table public.posts
  drop constraint if exists posts_media_type_check,
  add constraint posts_media_type_check check (media_type in ('image', 'video'));

alter table public.posts
  drop constraint if exists posts_video_fields_check,
  add constraint posts_video_fields_check check (
    (media_type = 'image' and video_url is null and duration_seconds is null)
    or (media_type = 'video' and video_url is not null and duration_seconds between 0 and 60)
  );

alter table public.posts drop constraint if exists posts_not_empty;
alter table public.posts
  add constraint posts_not_empty check (
    (media_type = 'video' and video_url is not null)
    or (media_type = 'image' and (char_length(btrim(content)) > 0 or image_url is not null))
  );

drop policy if exists "posts_insert_own" on public.posts;
create policy "posts_insert_own"
  on public.posts for insert to authenticated
  with check (author_id = auth.uid());

create index if not exists posts_video_created_idx
  on public.posts (created_at desc)
  where media_type = 'video';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'videos',
  'videos',
  true,
  52428800,
  array['video/mp4', 'video/webm', 'video/quicktime']
)
on conflict (id) do update
  set public = true,
      file_size_limit = 52428800,
      allowed_mime_types = array['video/mp4', 'video/webm', 'video/quicktime'];

drop policy if exists "videos_public_read" on storage.objects;
create policy "videos_public_read"
  on storage.objects for select
  using (bucket_id = 'videos');

drop policy if exists "videos_insert_own_folder" on storage.objects;
create policy "videos_insert_own_folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "videos_update_own_folder" on storage.objects;
create policy "videos_update_own_folder"
  on storage.objects for update to authenticated
  using (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "videos_delete_own_folder" on storage.objects;
create policy "videos_delete_own_folder"
  on storage.objects for delete to authenticated
  using (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.get_video_feed(p_limit int default 10, p_offset int default 0)
returns table (
  id uuid,
  author_id uuid,
  content text,
  image_url text,
  audience text,
  created_at timestamptz,
  media_type text,
  video_url text,
  thumbnail_url text,
  duration_seconds numeric,
  author_name text,
  author_username text,
  author_avatar text,
  author_account_type text,
  like_count bigint,
  comment_count bigint,
  liked_by_me boolean,
  is_following boolean
)
language sql
stable
set search_path = public
as $$
  select
    p.id,
    p.author_id,
    p.content,
    p.image_url,
    p.audience,
    p.created_at,
    p.media_type,
    p.video_url,
    p.thumbnail_url,
    p.duration_seconds,
    a.full_name,
    a.username,
    a.avatar_url,
    a.account_type,
    (select count(*) from public.post_likes l where l.post_id = p.id),
    (select count(*) from public.post_comments c where c.post_id = p.id),
    exists (
      select 1 from public.post_likes l
      where l.post_id = p.id and l.user_id = auth.uid()
    ),
    exists (
      select 1 from public.follows f
      where f.follower_id = auth.uid() and f.following_id = p.author_id
    )
  from public.posts p
  join public.profiles a on a.id = p.author_id
  where p.media_type = 'video'
  order by p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 10), 30))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.get_video_feed(int, int) from public, anon;
grant execute on function public.get_video_feed(int, int) to authenticated;
