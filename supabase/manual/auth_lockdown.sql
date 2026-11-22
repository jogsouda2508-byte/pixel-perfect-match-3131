-- =====================================================================
-- LOCK-DOWN: stop the browser from looking up people's emails.      *** RUN THIS LAST ***
--
-- Why: today anyone holding the public key can call these functions without logging in:
--     get_login_email(username)   -> returns that person's real email address
--     get_reset_emails(text)      -> returns email addresses for a username or an email
--     get_login_emails(email)     -> returns every account address behind a mailbox
--     plan_signup_email(email, u) -> reveals whether an email already has accounts
--     is_username_available(u)    -> unlimited username probing
-- After this script only the Edge Function (service role) can call them.
--
-- Order (see docs/AUTH-SECURITY.md):
--   1. run supabase/migrations/20261116000000_auth_gateway.sql
--   2. deploy the auth-gateway Edge Function and set its secrets
--   3. ship the new web app and Android app, and wait until people have updated
--   4. run THIS file.
-- Older app versions call these functions directly, so they stop being able to log in or sign up
-- the moment this script runs. This file is deliberately NOT in supabase/migrations/, so
-- `supabase db push` never runs it by accident.
--
-- Safe to run more than once. To undo, run the grants at the bottom.
-- =====================================================================

do $$
begin
  if to_regprocedure('public.auth_gw_rate_hit(text, integer, integer)') is null then
    raise exception 'Run supabase/migrations/20261116000000_auth_gateway.sql first.';
  end if;
end $$;

revoke all on function public.get_login_email(text)         from public, anon, authenticated;
revoke all on function public.get_login_emails(text)        from public, anon, authenticated;
revoke all on function public.get_reset_emails(text)        from public, anon, authenticated;
revoke all on function public.plan_signup_email(text, text) from public, anon, authenticated;
revoke all on function public.is_username_available(text)   from public, anon, authenticated;

grant execute on function public.get_login_email(text)         to service_role;
grant execute on function public.get_login_emails(text)        to service_role;
grant execute on function public.get_reset_emails(text)        to service_role;
grant execute on function public.plan_signup_email(text, text) to service_role;
grant execute on function public.is_username_available(text)   to service_role;

-- ---------------------------------------------------------------------------------------------
-- UNDO (only if you must roll back to the old app behaviour):
--   grant execute on function public.get_login_email(text)         to anon, authenticated;
--   grant execute on function public.get_login_emails(text)        to anon, authenticated;
--   grant execute on function public.get_reset_emails(text)        to anon, authenticated;
--   grant execute on function public.plan_signup_email(text, text) to anon, authenticated;
--   grant execute on function public.is_username_available(text)  to anon, authenticated;
