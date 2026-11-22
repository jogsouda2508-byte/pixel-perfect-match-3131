-- =====================================================================
-- Row-level-security speed-up: evaluate auth.uid() once per query, not once per row.
-- Safe to run more than once. Changes WHO can see or do WHAT: nothing.
-- Run in Supabase Dashboard -> SQL Editor (or `supabase db push`). Details and rollback:
-- docs/BACKEND-PERFORMANCE.md
--
-- Every policy in this app wrote `auth.uid()` directly. Postgres then calls that function again
-- for every row it checks. Written as `(select auth.uid())` it is evaluated once per query (an
-- "InitPlan") and the planner can use the value like a constant, which matters most on the big
-- tables: posts, messages, post_likes, post_comments, follows, stories.
-- Supabase documents this as the standard fix: https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
--
-- How it is done: instead of re-typing 120 policies (and drifting from what the earlier
-- migrations really left behind), this reads the policies that exist, replaces each bare
-- auth.uid() with (select auth.uid()) and re-applies them with ALTER POLICY. The command, the
-- roles and the permissive/restrictive kind are never touched. Before it finishes it checks that
-- the number of policies and each policy's name, command, roles and kind are exactly what they
-- were; if not, it raises an error and the whole migration is rolled back.
-- New policies written after this one should use (select auth.uid()) too; the replay test
-- supabase/tests/replay/performance.assert.sql fails on a bare one.
-- =====================================================================

do $$
declare
  -- an auth.uid() that is not already directly after "select " (so a second run does nothing)
  pat     constant text := '(?<!select )auth\.uid\(\)';
  pol     record;
  v_using text;
  v_check text;
  v_done  int := 0;
  v_skip  int := 0;
  v_before text;
  v_after  text;
begin
  select md5(coalesce(string_agg(
           concat_ws('|', schemaname, tablename, policyname, cmd, permissive, roles::text),
           ',' order by schemaname, tablename, policyname), ''))
    into v_before
  from pg_policies where schemaname in ('public', 'storage');

  for pol in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname in ('public', 'storage')
      and (coalesce(qual, '') ~* pat or coalesce(with_check, '') ~* pat)
    order by schemaname, tablename, policyname
  loop
    v_using := case when pol.qual is null then null
                    else regexp_replace(pol.qual, pat, '(select auth.uid())', 'gi') end;
    v_check := case when pol.with_check is null then null
                    else regexp_replace(pol.with_check, pat, '(select auth.uid())', 'gi') end;
    begin
      execute format(
        'alter policy %I on %I.%I%s%s',
        pol.policyname, pol.schemaname, pol.tablename,
        case when v_using is null then '' else ' using (' || v_using || ')' end,
        case when v_check is null then '' else ' with check (' || v_check || ')' end
      );
      v_done := v_done + 1;
    exception when insufficient_privilege then
      -- e.g. a policy on a table this role does not own: leave it as it was
      v_skip := v_skip + 1;
      raise notice 'left unchanged (not the owner): %.% / %',
        pol.schemaname, pol.tablename, pol.policyname;
    end;
  end loop;

  select md5(coalesce(string_agg(
           concat_ws('|', schemaname, tablename, policyname, cmd, permissive, roles::text),
           ',' order by schemaname, tablename, policyname), ''))
    into v_after
  from pg_policies where schemaname in ('public', 'storage');

  if v_before is distinct from v_after then
    raise exception 'rls_initplan: the set of policies changed (%, %); rolled back', v_before, v_after;
  end if;

  raise notice 'rls_initplan: % policies rewritten, % left unchanged', v_done, v_skip;
end $$;
