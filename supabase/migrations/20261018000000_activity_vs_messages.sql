-- =====================================================================
-- Ediraa: Instagram-style split
--   Bell (Notifications)  = likes, comments, follows ONLY
--   Messages (paper plane) = text messages + shared reels/posts
-- Run in Supabase SQL Editor AFTER 20261017000000_share_notifications.sql.
-- Safe to run more than once.
-- =====================================================================

-- Bell count no longer includes shares
create or replace function public.get_unread_notification_count()
returns bigint
language sql
stable
set search_path = public
as $$
  select count(*)
  from public.get_notifications(200) n
  where n.kind <> 'share'
    and n.created_at > (select pr.notifications_seen_at from public.profiles pr where pr.id = auth.uid());
$$;

-- Number of conversations that have an unread message FROM the other person
create or replace function public.get_unread_chat_count()
returns bigint
language sql
stable
set search_path = public
as $$
  select count(*)
  from public.conversation_participants cp
  where cp.user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.conversation_id = cp.conversation_id
        and m.sender_id <> auth.uid()
        and m.created_at > cp.last_read_at
    );
$$;

revoke all on function public.get_unread_notification_count() from public, anon;
revoke all on function public.get_unread_chat_count()         from public, anon;
grant execute on function public.get_unread_notification_count() to authenticated;
grant execute on function public.get_unread_chat_count()         to authenticated;
