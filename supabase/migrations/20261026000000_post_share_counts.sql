-- =====================================================================
-- Share counts: how many times a post has been sent to someone.
--
-- Every share is one chat message carrying messages.shared_post_id (written
-- only by share_post_to_user()). Chat messages are private to their members,
-- so clients cannot count them directly. This SECURITY DEFINER function
-- returns ONLY the number, and only for posts the caller is allowed to see
-- (same rule as everywhere else), so it reveals nothing about who received it.
-- =====================================================================

create index if not exists messages_shared_post_idx
  on public.messages (shared_post_id)
  where shared_post_id is not null;

create or replace function public.get_post_share_count(p_post_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is not null and public.can_view_post(p_post_id, auth.uid())
      then (select count(*) from public.messages m where m.shared_post_id = p_post_id)
    else 0
  end;
$$;

revoke all on function public.get_post_share_count(uuid) from public, anon;
grant execute on function public.get_post_share_count(uuid) to authenticated;
