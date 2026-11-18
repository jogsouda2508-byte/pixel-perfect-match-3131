-- Referral behaviour, enforced with ASSERT. Runs inside one transaction and rolls back.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.local', '{"username":"asha","full_name":"Asha"}'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.local', '{"username":"ravi","full_name":"Ravi"}'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.local', '{"username":"oldtimer","full_name":"Old"}'),
  ('00000000-0000-0000-0000-00000000000d', 'd@test.local', '{"username":"nosy","full_name":"Nosy"}'),
  ('00000000-0000-0000-0000-00000000000e', 'e@test.local', '{"username":"fresh","full_name":"Fresh"}');
update public.profiles set onboarding_completed = true where username <> 'fresh';
update public.profiles set created_at = now() - interval '30 days' where username = 'oldtimer';

-- ---- signed-out visitor (the sign-up page) -------------------------------------------------
set local role anon;
do $$ begin
  assert (select username from public.get_referrer('asha')) = 'asha',            'anon sees the referrer card';
  assert (select username from public.get_referrer('  @ASHA ')) = 'asha',        'code is normalised like the app does';
  assert not exists (select 1 from public.get_referrer('@@asha')),               'only ONE leading @ is dropped';
  assert not exists (select 1 from public.get_referrer('nobody')),               'unknown code -> no card';
  assert not exists (select 1 from public.get_referrer('fresh')),                'unfinished profile is not exposed';
end $$;
do $$ begin
  perform public.claim_referral('asha');
  raise exception 'anon was allowed to claim';
exception when insufficient_privilege then null; end $$;
reset role;

-- ---- the new user claims ---------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
do $$ begin
  assert public.claim_referral('@Asha') = 'ok',        'first claim is recorded';
  assert public.claim_referral('asha')  = 'already',   'a person can only be referred once';
  assert public.claim_referral('zzzzz') = 'unknown_code', 'the code is validated before the already-referred check';
end $$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
set local role authenticated;
do $$ begin assert public.claim_referral('asha') = 'too_late', 'accounts older than 7 days cannot claim'; end $$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ begin assert public.claim_referral('asha') = 'self', 'cannot refer yourself'; end $$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
do $$ begin assert public.claim_referral('qq_nobody') = 'unknown_code', 'unknown code'; end $$;
reset role;

-- ---- privacy / RLS ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.referrals) = 1, 'the inviter sees who joined through their link';
end $$;
do $$ begin
  insert into public.referrals (referred_id, referrer_id)
  values ('00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000a');
  raise exception 'direct INSERT into referrals was allowed';
exception when insufficient_privilege then null; end $$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
do $$ begin assert (select count(*) from public.referrals) = 0, 'strangers cannot see other people''s referrals'; end $$;
reset role;

rollback;
