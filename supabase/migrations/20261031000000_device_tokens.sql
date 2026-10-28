-- =====================================================================
-- Gicco chat: Android push notifications (Firebase Cloud Messaging)
-- Run in Supabase SQL Editor (any time after the earlier migrations).
-- Safe to run more than once. Only ADDS things: web push (push_subscriptions) is untouched.
--
-- One row per installed Android app that agreed to get notifications. `token` is the FCM
-- registration token (unique). Each person can see and delete ONLY their own rows; the
-- send-push Edge Function reads every row with the service-role key.
-- =====================================================================

create table if not exists public.device_tokens (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  token      text        not null constraint device_tokens_token_length
                           check (char_length(token) between 20 and 4096),
  platform   text        not null default 'android'
                           constraint device_tokens_platform check (platform in ('android', 'ios')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint device_tokens_token_key unique (token)
);

create index if not exists device_tokens_user_idx on public.device_tokens (user_id);

alter table public.device_tokens enable row level security;

drop policy if exists "device_tokens_select_own" on public.device_tokens;
create policy "device_tokens_select_own"
  on public.device_tokens for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "device_tokens_delete_own" on public.device_tokens;
create policy "device_tokens_delete_own"
  on public.device_tokens for delete to authenticated
  using (user_id = auth.uid());

-- No insert / update policy: tokens are saved only through save_device_token() below.
revoke all on public.device_tokens from anon, authenticated;
grant select, delete on public.device_tokens to authenticated;

-- If this phone was used by someone else before (log out, log in as another person), the
-- token moves to the new person, so the old person stops getting notifications on it.
create or replace function public.save_device_token(
  p_token    text,
  p_platform text default 'android'
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
  if coalesce(p_token, '') = '' or char_length(p_token) < 20 or char_length(p_token) > 4096 then
    raise exception 'invalid_token';
  end if;
  if p_platform not in ('android', 'ios') then
    raise exception 'invalid_platform';
  end if;

  insert into public.device_tokens (user_id, token, platform)
  values (auth.uid(), p_token, p_platform)
  on conflict (token) do update
    set user_id = auth.uid(),
        platform = excluded.platform,
        updated_at = now();
end;
$$;

revoke all on function public.save_device_token(text, text) from public, anon;
grant execute on function public.save_device_token(text, text) to authenticated;
