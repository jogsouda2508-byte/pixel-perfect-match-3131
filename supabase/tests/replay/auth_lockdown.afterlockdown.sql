-- Runs AFTER supabase/manual/auth_lockdown.sql has been applied (see run.sh).
do $$
declare fn text; role_name text; v_id uuid := gen_random_uuid();
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    foreach fn in array array[
      'public.get_login_email(text)', 'public.get_login_emails(text)', 'public.get_reset_emails(text)',
      'public.plan_signup_email(text, text)', 'public.is_username_available(text)'] loop
      assert not has_function_privilege(role_name, fn, 'execute'),
        role_name || ' can still call ' || fn || ' after the lock-down';
    end loop;
  end loop;

  foreach fn in array array[
    'public.get_login_email(text)', 'public.get_login_emails(text)', 'public.get_reset_emails(text)',
    'public.plan_signup_email(text, text)', 'public.is_username_available(text)'] loop
    assert has_function_privilege('service_role', fn, 'execute'), 'service_role lost ' || fn;
  end loop;

  -- and the functions still work for the service role
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_id, 'lock.test@example.com', jsonb_build_object('username', 'lock_test', 'full_name', 'Lock Test'));
  set local role service_role;
  assert public.get_login_email('lock_test') = 'lock.test@example.com', 'service role can still resolve a username';
  assert public.is_username_available('lock_test') = false, 'taken username is reported';
  assert public.is_username_available('free_name_1') = true, 'free username is reported';
  reset role;

  -- a real client (anon) is refused outright
  set local role anon;
  begin
    perform public.get_login_email('lock_test');
    assert false, 'anon could still read an email';
  exception when insufficient_privilege then null;
  end;
  reset role;
end $$;
