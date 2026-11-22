-- Tests for 20261116000000_auth_gateway.sql: counters, lockouts, and who may call what.
-- Runs after every migration has been replayed (see run.sh). Any failing ASSERT fails the run.

do $$
declare r record; i integer;
begin
  -- ---------------------------------------------------------- fixed-window rate limit
  for i in 1..3 loop
    select * into r from public.auth_gw_rate_hit('t:rl', 3, 60);
    assert r.allowed and r.retry_after = 0, format('hit %s should be allowed', i);
  end loop;
  select * into r from public.auth_gw_rate_hit('t:rl', 3, 60);
  assert not r.allowed, '4th hit must be refused';
  assert r.retry_after between 1 and 60, 'retry_after must be within the window: ' || r.retry_after;

  select * into r from public.auth_gw_rate_hit('t:other', 3, 60);
  assert r.allowed, 'another key is not affected';

  -- the window rolls over
  update private.auth_rate_limits set window_start = now() - interval '2 minutes' where key = 't:rl';
  select * into r from public.auth_gw_rate_hit('t:rl', 3, 60);
  assert r.allowed, 'a new window starts after it expires';
  assert (select hits from private.auth_rate_limits where key = 't:rl') = 1, 'counter restarts at 1';

  -- ---------------------------------------------------------- lockout with doubling
  select * into r from public.auth_gw_lock_status('t:lock');
  assert not r.locked, 'unknown key is not locked';

  for i in 1..4 loop
    select * into r from public.auth_gw_lock_fail('t:lock', 5, 30, 200, 900);
    assert not r.locked, format('failure %s of 5 must not lock yet', i);
  end loop;
  select * into r from public.auth_gw_lock_fail('t:lock', 5, 30, 200, 900);
  assert r.locked and r.retry_after = 30, 'threshold reached: locked for the base time, got ' || r.retry_after;
  select * into r from public.auth_gw_lock_status('t:lock');
  assert r.locked and r.retry_after between 1 and 30, 'status shows the lock';

  select * into r from public.auth_gw_lock_fail('t:lock', 5, 30, 200, 900);
  assert r.retry_after = 60, 'next failure doubles the lock: ' || r.retry_after;
  select * into r from public.auth_gw_lock_fail('t:lock', 5, 30, 200, 900);
  assert r.retry_after = 120, 'doubles again: ' || r.retry_after;
  select * into r from public.auth_gw_lock_fail('t:lock', 5, 30, 200, 900);
  assert r.retry_after = 200, 'capped at the maximum: ' || r.retry_after;

  perform public.auth_gw_lock_clear('t:lock');
  select * into r from public.auth_gw_lock_status('t:lock');
  assert not r.locked, 'a good attempt clears the lock';

  -- old failures fall out of the window
  for i in 1..4 loop perform public.auth_gw_lock_fail('t:win', 5, 30, 200, 900); end loop;
  update private.auth_lockouts set first_fail = now() - interval '1 hour' where key = 't:win';
  select * into r from public.auth_gw_lock_fail('t:win', 5, 30, 200, 900);
  assert not r.locked and (select fails from private.auth_lockouts where key = 't:win') = 1,
    'failures older than the window are forgotten';

  -- ---------------------------------------------------------- bad arguments are refused
  begin perform public.auth_gw_rate_hit('', 3, 60); assert false, 'empty key accepted';
  exception when raise_exception then null; end;
  begin perform public.auth_gw_rate_hit('k', 0, 60); assert false, 'limit 0 accepted';
  exception when raise_exception then null; end;
  begin perform public.auth_gw_rate_hit('k', 3, 999999); assert false, 'huge window accepted';
  exception when raise_exception then null; end;
  begin perform public.auth_gw_lock_fail('k', 5, 100, 50, 900); assert false, 'max below base accepted';
  exception when raise_exception then null; end;

  -- ---------------------------------------------------------- housekeeping
  update private.auth_rate_limits set window_start = now() - interval '3 days' where key = 't:other';
  assert public.auth_gw_cleanup() >= 1, 'cleanup removes stale rows';
  assert not exists (select 1 from private.auth_rate_limits where key = 't:other'), 'stale counter gone';
end $$;

-- ------------------------------------------------------------ who may call what
do $$
declare fn text; role_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    foreach fn in array array[
      'public.auth_gw_rate_hit(text, integer, integer)',
      'public.auth_gw_lock_status(text)',
      'public.auth_gw_lock_fail(text, integer, integer, integer, integer)',
      'public.auth_gw_lock_clear(text)',
      'public.auth_gw_cleanup()'] loop
      assert not has_function_privilege(role_name, fn, 'execute'), role_name || ' must not run ' || fn;
      assert has_function_privilege('service_role', fn, 'execute'), 'service_role must run ' || fn;
    end loop;
    assert not has_table_privilege(role_name, 'private.auth_rate_limits', 'select'), role_name || ' reads counters';
    assert not has_table_privilege(role_name, 'private.auth_lockouts', 'select'), role_name || ' reads lockouts';
  end loop;

  -- the gateway must keep access to the sign-in helpers after the lock-down
  foreach fn in array array[
    'public.get_login_email(text)', 'public.get_reset_emails(text)',
    'public.plan_signup_email(text, text)', 'public.is_username_available(text)'] loop
    assert has_function_privilege('service_role', fn, 'execute'), 'service_role must run ' || fn;
  end loop;
end $$;
