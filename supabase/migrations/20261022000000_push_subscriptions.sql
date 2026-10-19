-- =====================================================================
-- Ediraa / Gicco chat: Web Push subscriptions
-- Run in Supabase SQL Editor AFTER 20261021000000_story_like_notifications.sql.
-- Safe to run more than once.
--
-- One row per browser/device that agreed to get notifications (endpoint is
-- unique). Each person can see, add and delete ONLY their own rows. The
-- send-push Edge Function reads every row with the service-role key (which
-- bypasses RLS); the browser never sees anyone else's subscription.
-- =====================================================================

create table if not exists public.push_subscriptions (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  endpoint   text        not null constraint push_subscriptions_endpoint_length
                           check (char_length(endpoint) between 10 and 2048),
  p256dh     text        not null,
  auth       text        not null,
  user_agent text,
  created_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_key unique (endpoint)
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_select_own" on public.push_subscriptions;
create policy "push_subscriptions_select_own"
  on public.push_subscriptions for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "push_subscriptions_insert_own" on public.push_subscriptions;
create policy "push_subscriptions_insert_own"
  on public.push_subscriptions for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "push_subscriptions_delete_own" on public.push_subscriptions;
create policy "push_subscriptions_delete_own"
  on public.push_subscriptions for delete to authenticated
  using (user_id = auth.uid());

-- No update policy: a subscription is replaced, never edited in place by the client.
revoke all on public.push_subscriptions from anon;
grant select, insert, delete on public.push_subscriptions to authenticated;

-- ---------------------------------------------------------------------
-- save_push_subscription: the app calls this to register THIS browser for the
-- signed-in person. If the same browser was registered by someone else before
-- (shared computer: log out, log in as another person), the subscription moves
-- to the new person, so the old person stops getting notifications on it.
-- Calling it again with the same endpoint just refreshes the keys.
-- ---------------------------------------------------------------------
create or replace function public.save_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if coalesce(p_endpoint, '') = '' or coalesce(p_p256dh, '') = ''
     or coalesce(p_auth, '') = '' then
    raise exception 'invalid_subscription';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id    = auth.uid(),
        p256dh     = excluded.p256dh,
        auth       = excluded.auth,
        user_agent = excluded.user_agent;
end;
$$;

revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
