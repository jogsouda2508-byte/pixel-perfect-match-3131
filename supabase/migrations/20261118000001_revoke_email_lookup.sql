-- Security fix S1 (Critical): stop turning a username into an email address for the public.
--
-- get_login_email('alice') returned alice's real email address to ANYONE holding the public anon
-- key (and to every signed-in user), no password needed. get_reset_emails('alice') did the same
-- and also accepted an email address. That is an account-enumeration and phishing/spam gift.
--
-- The app now does these lookups on the server, in the `auth-lookup` edge function, which runs as
-- the service role and never sends an email address back to the browser.
--
-- !! APPLY THIS FILE LAST. Order of rollout (full steps in docs/SECURITY-PATCH.md):
--      1. apply 20261118000000_security_hardening.sql
--      2. deploy the edge function:  supabase functions deploy auth-lookup
--      3. ship the app version that calls it (it falls back to the old RPCs until step 4)
--      4. apply THIS file
--    If this file is applied before steps 2 and 3, username login and "forgot password" stop
--    working until they are done.

revoke execute on function public.get_login_email(text)  from public, anon, authenticated;
revoke execute on function public.get_reset_emails(text) from public, anon, authenticated;
grant  execute on function public.get_login_email(text)  to service_role;
grant  execute on function public.get_reset_emails(text) to service_role;
