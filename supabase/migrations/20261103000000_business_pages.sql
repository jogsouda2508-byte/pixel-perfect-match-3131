-- =====================================================================
-- Gicco chat: business pages (info, opening hours, price list, reviews).
-- Run in Supabase Dashboard -> SQL Editor (or `supabase db push`).
-- Safe to run more than once.
--
--   business_info      one row per business account: category, phone, WhatsApp,
--                      address, opening hours (7 days, as JSON)
--   business_services  the price list (rupees)
--   business_reviews   one review per person per business, owner can reply
--
-- The app talks to these through the functions at the bottom:
--   get_business_page, get_business_directory, get_business_categories,
--   reply_to_business_review
-- =====================================================================

-- ------------------------------------------------------------ business_info
create table if not exists public.business_info (
  owner_id   uuid primary key references public.profiles (id) on delete cascade,
  category   text,
  phone      text,
  whatsapp   text,
  address    text,
  hours      jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint business_info_phone_chk    check (phone    is null or phone    ~ '^[6-9][0-9]{9}$'),
  constraint business_info_whatsapp_chk check (whatsapp is null or whatsapp ~ '^[6-9][0-9]{9}$'),
  constraint business_info_category_chk check (category is null or char_length(category) between 1 and 40),
  constraint business_info_address_chk  check (address  is null or char_length(address)  <= 200),
  constraint business_info_hours_chk    check (jsonb_typeof(hours) = 'array' and jsonb_array_length(hours) <= 7)
);

alter table public.business_info enable row level security;

drop policy if exists "business_info_select" on public.business_info;
create policy "business_info_select" on public.business_info
  for select to authenticated using (true);

-- Only business accounts can have business info, and only their own.
drop policy if exists "business_info_insert_own" on public.business_info;
create policy "business_info_insert_own" on public.business_info
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.account_type = 'business')
  );

drop policy if exists "business_info_update_own" on public.business_info;
create policy "business_info_update_own" on public.business_info
  for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "business_info_delete_own" on public.business_info;
create policy "business_info_delete_own" on public.business_info
  for delete to authenticated using (owner_id = auth.uid());

-- -------------------------------------------------------- business_services
create table if not exists public.business_services (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  name        text not null,
  price       numeric(10,2) not null,
  price_from  boolean not null default false,
  description text,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  constraint business_services_name_chk  check (char_length(btrim(name)) between 1 and 60),
  constraint business_services_price_chk check (price >= 0 and price <= 9999999),
  constraint business_services_desc_chk  check (description is null or char_length(description) <= 120)
);
create index if not exists business_services_owner_idx on public.business_services (owner_id, sort_order);

alter table public.business_services enable row level security;

drop policy if exists "business_services_select" on public.business_services;
create policy "business_services_select" on public.business_services
  for select to authenticated using (true);

drop policy if exists "business_services_write_own" on public.business_services;
create policy "business_services_write_own" on public.business_services
  for all to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.account_type = 'business')
  );

-- Keep price lists reasonable (50 items per business).
create or replace function public.business_services_limit()
returns trigger language plpgsql as $$
begin
  if (select count(*) from public.business_services where owner_id = new.owner_id) >= 50 then
    raise exception 'A price list can have at most 50 items';
  end if;
  return new;
end;
$$;
drop trigger if exists business_services_limit_trg on public.business_services;
create trigger business_services_limit_trg
  before insert on public.business_services
  for each row execute function public.business_services_limit();

-- --------------------------------------------------------- business_reviews
create table if not exists public.business_reviews (
  business_id uuid not null references public.profiles (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id) on delete cascade,
  rating      smallint not null,
  body        text not null default '',
  owner_reply text,
  replied_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (business_id, reviewer_id),
  constraint business_reviews_rating_chk check (rating between 1 and 5),
  constraint business_reviews_body_chk   check (char_length(body) <= 500),
  constraint business_reviews_reply_chk  check (owner_reply is null or char_length(owner_reply) <= 500),
  constraint business_reviews_self_chk   check (business_id <> reviewer_id)
);
create index if not exists business_reviews_business_idx on public.business_reviews (business_id, created_at desc);

alter table public.business_reviews enable row level security;

-- Reviewers can only change their stars and text. The owner's reply is written
-- through reply_to_business_review() below, never directly.
revoke all on public.business_reviews from anon, authenticated;
grant select on public.business_reviews to authenticated;
grant insert (business_id, reviewer_id, rating, body) on public.business_reviews to authenticated;
grant update (rating, body, updated_at) on public.business_reviews to authenticated;
grant delete on public.business_reviews to authenticated;

drop policy if exists "business_reviews_select" on public.business_reviews;
create policy "business_reviews_select" on public.business_reviews
  for select to authenticated using (true);

-- Not your own shop, and only for business accounts.
drop policy if exists "business_reviews_insert" on public.business_reviews;
create policy "business_reviews_insert" on public.business_reviews
  for insert to authenticated
  with check (
    reviewer_id = auth.uid()
    and business_id <> auth.uid()
    and exists (select 1 from public.profiles p where p.id = business_id and p.account_type = 'business')
  );

drop policy if exists "business_reviews_update_own" on public.business_reviews;
create policy "business_reviews_update_own" on public.business_reviews
  for update to authenticated
  using (reviewer_id = auth.uid()) with check (reviewer_id = auth.uid());

-- The reviewer can delete their review. The business owner cannot.
drop policy if exists "business_reviews_delete_own" on public.business_reviews;
create policy "business_reviews_delete_own" on public.business_reviews
  for delete to authenticated using (reviewer_id = auth.uid());

-- ------------------------------------------------------------- functions
-- Owner replies to a review (one reply per review, can be edited; empty text removes it).
create or replace function public.reply_to_business_review(p_reviewer_id uuid, p_reply text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reply text := nullif(btrim(coalesce(p_reply, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if v_reply is not null and char_length(v_reply) > 500 then
    raise exception 'Reply is too long';
  end if;
  update public.business_reviews
     set owner_reply = v_reply,
         replied_at  = case when v_reply is null then null else now() end
   where business_id = auth.uid()
     and reviewer_id = p_reviewer_id;
  if not found then
    raise exception 'Review not found';
  end if;
end;
$$;

-- Everything the profile needs in one call: info, price list, rating summary,
-- the caller's own review. (Reviews themselves are read from the table.)
create or replace function public.get_business_page(p_owner_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select case when auth.uid() is null or not exists (
           select 1 from public.profiles p where p.id = p_owner_id and p.account_type = 'business'
         ) then null
  else jsonb_build_object(
    'category',  bi.category,
    'phone',     bi.phone,
    'whatsapp',  bi.whatsapp,
    'address',   bi.address,
    'hours',     coalesce(bi.hours, '[]'::jsonb),
    'services',  coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', s.id, 'name', s.name, 'price', s.price,
                 'price_from', s.price_from, 'description', s.description)
               order by s.sort_order, s.created_at)
          from public.business_services s where s.owner_id = p_owner_id), '[]'::jsonb),
    'rating_avg',   (select round(avg(r.rating)::numeric, 1) from public.business_reviews r where r.business_id = p_owner_id),
    'rating_count', (select count(*) from public.business_reviews r where r.business_id = p_owner_id),
    'distribution', coalesce((
        select jsonb_object_agg(x.rating::text, x.n)
          from (select r.rating, count(*) as n from public.business_reviews r
                 where r.business_id = p_owner_id group by r.rating) x), '{}'::jsonb)
  ) end
  from (select 1) one
  left join public.business_info bi on bi.owner_id = p_owner_id;
$$;

-- Directory of businesses: search by name / username / category, optional category filter.
-- (Open-now is worked out in the app from the hours, in Indian time.)
create or replace function public.get_business_directory(
  p_query    text,
  p_category text,
  p_limit    integer
)
returns table (
  id           uuid,
  full_name    text,
  username     text,
  avatar_url   text,
  category     text,
  address      text,
  hours        jsonb,
  rating_avg   numeric,
  rating_count bigint
)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.full_name, p.username, p.avatar_url,
         bi.category, bi.address, coalesce(bi.hours, '[]'::jsonb),
         (select round(avg(r.rating)::numeric, 1) from public.business_reviews r where r.business_id = p.id),
         (select count(*) from public.business_reviews r where r.business_id = p.id)
    from public.profiles p
    left join public.business_info bi on bi.owner_id = p.id
   where auth.uid() is not null
     and p.account_type = 'business'
     and p.id <> auth.uid()
     and (p_category is null or p_category = '' or bi.category = p_category)
     and (
       p_query is null or btrim(p_query) = ''
       or p.full_name ilike '%' || btrim(p_query) || '%'
       or p.username  ilike '%' || btrim(p_query) || '%'
       or bi.category ilike '%' || btrim(p_query) || '%'
       or bi.address  ilike '%' || btrim(p_query) || '%'
     )
   order by (bi.owner_id is not null) desc, p.created_at desc
   limit least(coalesce(p_limit, 30), 100);
$$;

-- Categories that are actually in use (for the filter chips).
create or replace function public.get_business_categories()
returns table (category text, n bigint)
language sql
security definer
stable
set search_path = public
as $$
  select bi.category, count(*)::bigint
    from public.business_info bi
    join public.profiles p on p.id = bi.owner_id and p.account_type = 'business'
   where auth.uid() is not null and bi.category is not null
   group by bi.category
   order by count(*) desc, bi.category
   limit 20;
$$;

revoke all on function public.reply_to_business_review(uuid, text)         from public, anon;
revoke all on function public.get_business_page(uuid)                      from public, anon;
revoke all on function public.get_business_directory(text, text, integer)  from public, anon;
revoke all on function public.get_business_categories()                    from public, anon;
grant execute on function public.reply_to_business_review(uuid, text)         to authenticated;
grant execute on function public.get_business_page(uuid)                      to authenticated;
grant execute on function public.get_business_directory(text, text, integer)  to authenticated;
grant execute on function public.get_business_categories()                    to authenticated;
