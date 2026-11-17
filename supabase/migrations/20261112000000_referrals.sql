-- =====================================================================
-- Invite links and referrals.
-- Run in Supabase Dashboard -> SQL Editor (or `supabase db push`). Safe to run more than once.
--
-- Everyone's invite link is  <site>/signup?ref=<their username>  (usernames can't be changed, so
-- the link never breaks). When a new person finishes setting up their profile, the app calls
-- claim_referral() with the code it remembered from the link. That records who invited whom
-- (once per person, never yourself, only for accounts made in the last 7 days) and sends the
-- inviter a push notification, if the push migration has been run.
-- =====================================================================

create table if not exists public.referrals (
  referred_id uuid primary key references public.profiles (id) on delete cascade,
  referrer_id uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint referrals_no_self check (referred_id <> referrer_id)
);
create index if not exists referrals_referrer_idx on public.referrals (referrer_id, created_at desc);

alter table public.referrals enable row level security;
revoke all on public.referrals from anon, authenticated;
grant select on public.referrals to authenticated;

-- You can read who joined through YOUR link. Nobody can write directly: only claim_referral() does.
drop policy if exists referrals_select_own on public.referrals;
create policy referrals_select_own on public.referrals
  for select to authenticated using (referrer_id = auth.uid());

-- Who is behind a code? Lets the sign-up page say "Asha invited you" before anyone is signed in.
-- Returns only the name and picture shown on their public profile.
create or replace function public.get_referrer(p_code text)
returns table (username text, full_name text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select p.username, p.full_name, p.avatar_url
  from public.profiles p
  where p.username = lower(btrim(p_code))
    and p.onboarding_completed
  limit 1 $$;
revoke all on function public.get_referrer(text) from public;
grant execute on function public.get_referrer(text) to anon, authenticated;

-- Records the invite. Returns: ok | already | self | unknown_code | too_late
-- Anything but 'ok' is final, so the app forgets the code.
create or replace function public.claim_referral(p_code text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_me       uuid := auth.uid();
  v_referrer uuid;
  v_created  timestamptz;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;

  select p.created_at into v_created from public.profiles p where p.id = v_me and p.onboarding_completed;
  if v_created is null then raise exception 'profile_not_ready'; end if;

  select p.id into v_referrer from public.profiles p
   where p.username = lower(btrim(coalesce(p_code, ''))) and p.onboarding_completed;
  if v_referrer is null then return 'unknown_code'; end if;
  if v_referrer = v_me then return 'self'; end if;
  if exists (select 1 from public.referrals r where r.referred_id = v_me) then return 'already'; end if;
  if v_created < now() - interval '7 days' then return 'too_late'; end if;

  insert into public.referrals (referred_id, referrer_id) values (v_me, v_referrer)
  on conflict (referred_id) do nothing;
  if not found then return 'already'; end if;
  return 'ok';
end $$;
revoke all on function public.claim_referral(text) from public, anon;
grant execute on function public.claim_referral(text) to authenticated;

-- Tell the inviter. Same safety rule as the other push triggers: a push problem never blocks anything.
create or replace function public.push_on_referral()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uname text;
begin
  select p.username into uname from public.profiles p where p.id = new.referred_id;
  perform private.send_push(
    array[new.referrer_id], new.referred_id, private.push_name(new.referred_id),
    'joined SabZone with your invite',
    case when uname is null then '/notifications' else '/u/' || uname end,
    'referral:' || new.referred_id);
  return null;
exception when others then
  raise warning 'push_on_referral failed: %', sqlerrm;
  return null;
end $$;
revoke all on function public.push_on_referral() from public, anon, authenticated;

drop trigger if exists push_on_referral on public.referrals;
create trigger push_on_referral after insert on public.referrals
  for each row execute function public.push_on_referral();
