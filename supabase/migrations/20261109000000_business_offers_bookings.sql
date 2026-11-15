-- =====================================================================
-- Business offers and booking requests.
-- Run in Supabase Dashboard -> SQL Editor (or `supabase db push`). Safe to run more than once.
--
--   business_offers    time-limited deals a business posts on its page. Followers get a push.
--   business_bookings  a customer asks for a visit on a date and time; the business accepts or
--                      declines; both sides are notified. Written only through the functions below.
--
-- Needs 20261023000000_push_triggers.sql (private.send_push) and
-- 20261104000000_community.sql (community_person) to be run first.
-- =====================================================================

-- ------------------------------------------------------------- offers
create table if not exists public.business_offers (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.profiles (id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 3 and 60),
  details     text check (details is null or char_length(details) <= 200),
  badge       text check (badge is null or char_length(btrim(badge)) between 1 and 16),
  valid_until timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists business_offers_business_idx on public.business_offers (business_id, valid_until desc);

alter table public.business_offers enable row level security;
revoke all on public.business_offers from anon, authenticated;
grant select on public.business_offers to authenticated;
grant insert (business_id, title, details, badge, valid_until) on public.business_offers to authenticated;
grant delete on public.business_offers to authenticated;

drop policy if exists business_offers_select on public.business_offers;
create policy business_offers_select on public.business_offers
  for select to authenticated using (true);

drop policy if exists business_offers_insert_own on public.business_offers;
create policy business_offers_insert_own on public.business_offers
  for insert to authenticated
  with check (
    business_id = auth.uid()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.account_type = 'business')
  );

drop policy if exists business_offers_delete_own on public.business_offers;
create policy business_offers_delete_own on public.business_offers
  for delete to authenticated using (business_id = auth.uid());

-- At most 5 running offers per business; an offer runs for 1 hour to 60 days.
create or replace function public.business_offers_check()
returns trigger language plpgsql as $$
begin
  if new.valid_until <= now() + interval '1 hour' - interval '1 minute'
     or new.valid_until > now() + interval '60 days' then
    raise exception 'An offer can run for 1 hour up to 60 days';
  end if;
  if (select count(*) from public.business_offers
       where business_id = new.business_id and valid_until > now()) >= 5 then
    raise exception 'You can run 5 offers at a time. Remove one first.';
  end if;
  return new;
end $$;
drop trigger if exists business_offers_check_trg on public.business_offers;
create trigger business_offers_check_trg
  before insert on public.business_offers
  for each row execute function public.business_offers_check();

-- New offer -> push to the business's followers (400 per call, the Edge Function takes 500).
-- Spam guard: only the first 2 offers of a day are announced.
create or replace function private.push_on_business_offer()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  recipients uuid[];
  n int; i int := 1;
  v_name text; v_username text;
begin
  if (select count(*) from public.business_offers o
        where o.business_id = new.business_id and o.created_at > now() - interval '1 day') > 2 then
    return null;
  end if;
  select coalesce(nullif(btrim(p.full_name), ''), p.username), p.username
    into v_name, v_username from public.profiles p where p.id = new.business_id;

  select coalesce(array_agg(f.follower_id), '{}') into recipients
  from public.follows f
  where f.following_id = new.business_id
    and (exists (select 1 from public.push_subscriptions s where s.user_id = f.follower_id)
         or exists (select 1 from public.device_tokens d where d.user_id = f.follower_id));

  n := coalesce(array_length(recipients, 1), 0);
  while i <= n loop
    perform private.send_push(
      recipients[i : least(i + 399, n)],
      new.business_id,
      '🏷️ ' || v_name || ': ' || new.title,
      concat_ws(' · ', nullif(btrim(new.badge), ''), nullif(btrim(new.details), ''), 'ends ' || to_char(new.valid_until at time zone 'Asia/Kolkata', 'FMDD Mon')),
      '/u/' || v_username,
      'offer:' || new.id);
    i := i + 400;
  end loop;
  return null;
exception when others then
  raise warning 'push_on_business_offer failed: %', sqlerrm;
  return null;
end $$;
revoke all on function private.push_on_business_offer() from public, anon, authenticated;

drop trigger if exists push_on_business_offer on public.business_offers;
create trigger push_on_business_offer
  after insert on public.business_offers
  for each row execute function private.push_on_business_offer();

-- ----------------------------------------------------------- bookings
create table if not exists public.business_bookings (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.profiles (id) on delete cascade,
  customer_id  uuid not null references public.profiles (id) on delete cascade,
  service      text check (service is null or char_length(btrim(service)) between 1 and 60),
  requested_at timestamptz not null,
  note         text check (note is null or char_length(note) <= 200),
  status       text not null default 'pending'
                 check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  reply        text check (reply is null or char_length(reply) <= 200),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint business_bookings_self_chk check (business_id <> customer_id)
);
create index if not exists business_bookings_business_idx on public.business_bookings (business_id, requested_at);
create index if not exists business_bookings_customer_idx on public.business_bookings (customer_id, requested_at);

-- Nobody writes this table directly; the functions below do it. Each side can read its own rows.
alter table public.business_bookings enable row level security;
revoke all on public.business_bookings from anon, authenticated;
grant select on public.business_bookings to authenticated;
drop policy if exists business_bookings_select on public.business_bookings;
create policy business_bookings_select on public.business_bookings
  for select to authenticated using (business_id = auth.uid() or customer_id = auth.uid());


-- "Sat 21 Nov, 4:30 PM" in Indian time, for the notification texts.
create or replace function private.booking_when(p_ts timestamptz)
returns text language sql stable set search_path = public as $$
  select to_char(p_ts at time zone 'Asia/Kolkata', 'Dy FMDD Mon') || ', ' ||
         to_char(p_ts at time zone 'Asia/Kolkata', 'FMHH12:MI AM') $$;
revoke all on function private.booking_when(timestamptz) from public, anon, authenticated;

-- A customer asks a business for a visit. Returns the new booking's id.
create or replace function public.create_booking(
  p_business     uuid,
  p_service      text,
  p_requested_at timestamptz,
  p_note         text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_service text := nullif(btrim(coalesce(p_service, '')), '');
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
begin
  if uid is null then raise exception 'Please sign in first'; end if;
  if p_business = uid then raise exception 'You can''t book your own business'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_business and p.account_type = 'business') then
    raise exception 'This business can''t take bookings';
  end if;
  if p_requested_at is null or p_requested_at <= now() then
    raise exception 'Pick a time in the future';
  end if;
  if p_requested_at > now() + interval '90 days' then
    raise exception 'You can book up to 90 days ahead';
  end if;
  if v_service is not null and char_length(v_service) > 60 then raise exception 'That service name is too long'; end if;
  if v_note is not null and char_length(v_note) > 200 then raise exception 'Your note is too long'; end if;
  if (select count(*) from public.business_bookings b
       where b.business_id = p_business and b.customer_id = uid and b.status = 'pending') >= 3 then
    raise exception 'You already have 3 requests waiting for this business';
  end if;

  insert into public.business_bookings (business_id, customer_id, service, requested_at, note)
  values (p_business, uid, v_service, p_requested_at, v_note)
  returning id into v_id;

  begin
    perform private.send_push(
      array[p_business], uid,
      'New booking request',
      private.push_name(uid) || coalesce(' · ' || v_service, '') || ' · ' || private.booking_when(p_requested_at),
      '/business', 'booking:' || v_id);
  exception when others then
    raise warning 'create_booking push failed: %', sqlerrm;
  end;
  return v_id;
end $$;

-- The business accepts or declines a waiting request (the reply is optional).
create or replace function public.respond_to_booking(p_id uuid, p_accept boolean, p_reply text)
returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  b public.business_bookings%rowtype;
  v_reply text := nullif(btrim(coalesce(p_reply, '')), '');
begin
  if uid is null then raise exception 'Please sign in first'; end if;
  if v_reply is not null and char_length(v_reply) > 200 then raise exception 'Your reply is too long'; end if;
  select * into b from public.business_bookings where id = p_id and business_id = uid for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.status <> 'pending' then raise exception 'This request was already answered or cancelled'; end if;

  update public.business_bookings
     set status = case when p_accept then 'accepted' else 'declined' end,
         reply = v_reply, updated_at = now()
   where id = p_id;

  begin
    perform private.send_push(
      array[b.customer_id], uid,
      case when p_accept then '✅ Booking confirmed' else 'Booking declined' end,
      private.push_name(uid) || ' · ' || private.booking_when(b.requested_at) || coalesce(' · ' || v_reply, ''),
      '/business', 'booking:' || p_id);
  exception when others then
    raise warning 'respond_to_booking push failed: %', sqlerrm;
  end;
end $$;

-- The customer withdraws a waiting or accepted request.
create or replace function public.cancel_booking(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); b public.business_bookings%rowtype;
begin
  if uid is null then raise exception 'Please sign in first'; end if;
  select * into b from public.business_bookings where id = p_id and customer_id = uid for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.status not in ('pending', 'accepted') then raise exception 'This booking can''t be cancelled'; end if;

  update public.business_bookings set status = 'cancelled', updated_at = now() where id = p_id;

  begin
    perform private.send_push(
      array[b.business_id], uid,
      'Booking cancelled',
      private.push_name(uid) || ' · ' || private.booking_when(b.requested_at),
      '/business', 'booking:' || p_id);
  exception when others then
    raise warning 'cancel_booking push failed: %', sqlerrm;
  end;
end $$;

-- p_role 'business': requests people made to me. 'customer': my own requests.
-- Shows what is coming up, plus anything from the last 2 days.
create or replace function public.get_my_bookings(p_role text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); res jsonb;
begin
  if uid is null then raise exception 'Please sign in first'; end if;
  if p_role not in ('business', 'customer') then raise exception 'Invalid role'; end if;
  select coalesce(jsonb_agg(x.j order by x.requested_at), '[]'::jsonb) into res from (
    select b.requested_at, jsonb_build_object(
        'id', b.id, 'service', b.service, 'requested_at', b.requested_at, 'note', b.note,
        'status', b.status, 'reply', b.reply, 'created_at', b.created_at,
        'person', public.community_person(case when p_role = 'business' then b.customer_id else b.business_id end)
      ) as j
    from public.business_bookings b
    where (case when p_role = 'business' then b.business_id else b.customer_id end) = uid
      and b.requested_at > now() - interval '2 days'
    order by b.requested_at
    limit 100
  ) x;
  return res;
end $$;

revoke all on function public.create_booking(uuid, text, timestamptz, text) from public, anon;
revoke all on function public.respond_to_booking(uuid, boolean, text) from public, anon;
revoke all on function public.cancel_booking(uuid) from public, anon;
revoke all on function public.get_my_bookings(text) from public, anon;
grant execute on function public.create_booking(uuid, text, timestamptz, text) to authenticated;
grant execute on function public.respond_to_booking(uuid, boolean, text) to authenticated;
grant execute on function public.cancel_booking(uuid) to authenticated;
grant execute on function public.get_my_bookings(text) to authenticated;
