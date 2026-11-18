-- =====================================================================
-- Delete my account (Google Play requires this, in the app and on a web page).
-- Run in Supabase Dashboard -> SQL Editor (or `supabase db push`). Safe to run more than once.
--
-- delete_my_account() removes the signed-in person's login. Every table that points at the
-- profile or the login (posts, comments, stories, follows, chats they sent, push tokens, listings,
-- bookings, blocks, close friends ...) is set to "on delete cascade", so their data goes with it.
-- Reports they SENT are removed; reports ABOUT them keep the row with the person cleared.
-- The app removes their uploaded files from storage first (see src/lib/account.ts).
-- =====================================================================

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Please sign in first'; end if;
  delete from auth.users where id = uid;
end $$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
