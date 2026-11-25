-- Tests for 20261119000000_auth_release_stale_signups.sql
do $$
declare v_plan jsonb; v_id uuid; v_n integer;
begin
  -- a fresh unverified sign-up still holds its name (nothing changes for people mid-verification)
  insert into auth.users (email, email_confirmed_at, raw_user_meta_data)
  values ('stale1@gmail.com', null, '{"username":"stale_one","full_name":"S"}') returning id into v_id;
  assert not public.is_username_available('stale_one'), 'fresh unverified name is still held';
  assert (public.plan_signup_email('stale1@gmail.com','stale_one')->>'reason') = 'username_taken',
    'fresh unverified name is still taken';

  -- after 2 hours without verifying, the name is free again and the planner lets the retry through
  update auth.users set created_at = now() - interval '3 hours' where id = v_id;
  assert public.is_username_available('stale_one'), 'stale unverified name is available';
  v_plan := public.plan_signup_email('stale1@gmail.com','stale_one');
  assert (v_plan->>'ok')::boolean, 'retry with the same username is accepted: ' || v_plan::text;
  assert not exists (select 1 from public.profiles where username = 'stale_one'), 'stale profile removed';
  assert not exists (select 1 from auth.users where id = v_id), 'stale auth user removed';

  -- a VERIFIED account is never released, however old
  insert into auth.users (email, email_confirmed_at, created_at, raw_user_meta_data)
  values ('ok1@gmail.com', now(), now() - interval '30 days', '{"username":"verified_one","full_name":"V"}');
  assert not public.is_username_available('verified_one'), 'verified name stays taken';
  assert (public.plan_signup_email('x@gmail.com','verified_one')->>'reason') = 'username_taken', 'verified stays taken';
  assert exists (select 1 from public.profiles where username = 'verified_one'), 'verified profile untouched';

  -- a phone-verified account (no email confirmation) is never released
  insert into auth.users (email, email_confirmed_at, phone_confirmed_at, created_at, raw_user_meta_data)
  values ('ph1@gmail.com', null, now(), now() - interval '30 days', '{"username":"phone_one","full_name":"P"}');
  assert not public.is_username_available('phone_one'), 'phone-verified name stays taken';

  -- bulk purge touches only stale unverified rows, and only the service role may call it
  insert into auth.users (email, email_confirmed_at, created_at, raw_user_meta_data)
  values ('stale2@gmail.com', null, now() - interval '5 hours', '{"username":"stale_two","full_name":"S2"}');
  v_n := public.purge_stale_signups();
  assert v_n = 1, 'purge removed exactly the stale one: ' || v_n;
  assert exists (select 1 from public.profiles where username in ('verified_one','phone_one')), 'purge kept real accounts';
  assert not has_function_privilege('anon', 'public.purge_stale_signups()', 'execute'), 'anon cannot purge';
  assert not has_function_privilege('authenticated', 'public.purge_stale_signups()', 'execute'), 'users cannot purge';
  assert has_function_privilege('service_role', 'public.purge_stale_signups()', 'execute'), 'service role can purge';

  -- the grants the gateway relies on are unchanged
  assert has_function_privilege('service_role', 'public.plan_signup_email(text,text)', 'execute'), 'service role keeps plan_signup_email';
  assert has_function_privilege('service_role', 'public.is_username_available(text)', 'execute'), 'service role keeps is_username_available';
end $$;
