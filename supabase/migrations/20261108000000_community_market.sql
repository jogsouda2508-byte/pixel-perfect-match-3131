-- =====================================================================
-- Community: Market (buy, sell and give away things in your locality).
-- Run in Supabase Dashboard -> SQL Editor (or `supabase db push`). Safe to run more than once.
--
--   community_listings   one row per item. Photos live in the public `media` bucket
--                        (<seller id>/market/...), their URLs are stored here.
--
-- Reads go through get_community_listings(). People change only their own rows:
-- they can add a listing, mark it sold (or available again) and delete it.
-- Needs 20261104000000_community.sql to be run first (community_norm, community_person).
-- =====================================================================

create table if not exists public.community_listings (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid not null references public.profiles (id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 3 and 80),
  description text check (description is null or char_length(description) <= 500),
  price       numeric(10,2) not null check (price >= 0 and price <= 9999999),  -- 0 means free
  category    text not null check (category in
                ('furniture', 'electronics', 'vehicles', 'clothes', 'home', 'books', 'kids', 'other')),
  condition   text not null check (condition in ('new', 'like_new', 'used')),
  locality    text not null check (char_length(btrim(locality)) between 2 and 60),
  image_urls  text[] not null default '{}'::text[]
                check (coalesce(array_length(image_urls, 1), 0) <= 4),
  created_at  timestamptz not null default now(),
  sold_at     timestamptz
);
create index if not exists community_listings_created_idx on public.community_listings (created_at desc);
create index if not exists community_listings_seller_idx  on public.community_listings (seller_id);

-- At most 20 items for sale at the same time per person.
create or replace function public.community_listings_limit()
returns trigger language plpgsql as $$
begin
  if (select count(*) from public.community_listings
       where seller_id = new.seller_id and sold_at is null) >= 20 then
    raise exception 'You can have 20 items for sale at a time. Mark some as sold or remove them first.';
  end if;
  return new;
end $$;
drop trigger if exists community_listings_limit_trg on public.community_listings;
create trigger community_listings_limit_trg
  before insert on public.community_listings
  for each row execute function public.community_listings_limit();

alter table public.community_listings enable row level security;
revoke all on public.community_listings from anon, authenticated;
grant select on public.community_listings to authenticated;
grant insert (seller_id, title, description, price, category, condition, locality, image_urls)
  on public.community_listings to authenticated;
grant update (sold_at) on public.community_listings to authenticated;
grant delete on public.community_listings to authenticated;

drop policy if exists community_listings_select on public.community_listings;
create policy community_listings_select on public.community_listings
  for select to authenticated using (true);

drop policy if exists community_listings_insert_own on public.community_listings;
create policy community_listings_insert_own on public.community_listings
  for insert to authenticated with check (seller_id = auth.uid());

drop policy if exists community_listings_update_own on public.community_listings;
create policy community_listings_update_own on public.community_listings
  for update to authenticated using (seller_id = auth.uid()) with check (seller_id = auth.uid());

drop policy if exists community_listings_delete_own on public.community_listings;
create policy community_listings_delete_own on public.community_listings
  for delete to authenticated using (seller_id = auth.uid());

-- ------------------------------------------------------------- reading
-- Items stay up for 30 days. Sold items stay visible (greyed out) for 2 more days.
-- p_locality null = everywhere; p_category null = all; p_query searches title and description.
create or replace function public.get_community_listings(
  p_locality text,
  p_query    text default '',
  p_category text default null,
  p_limit    int  default 60)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); res jsonb;
begin
  if uid is null then raise exception 'Please sign in first'; end if;
  select coalesce(jsonb_agg(x.j order by x.sold, x.created_at desc), '[]'::jsonb) into res from (
    select l.created_at, (l.sold_at is not null) as sold, jsonb_build_object(
        'id', l.id, 'title', l.title, 'description', l.description, 'price', l.price,
        'category', l.category, 'condition', l.condition, 'locality', l.locality,
        'image_urls', to_jsonb(l.image_urls), 'created_at', l.created_at, 'sold_at', l.sold_at,
        'is_mine', l.seller_id = uid,
        'seller', public.community_person(l.seller_id)) as j
    from public.community_listings l
    where ((l.sold_at is null and l.created_at > now() - interval '30 days')
           or l.sold_at > now() - interval '2 days')
      and (p_locality is null or public.community_norm(l.locality) = public.community_norm(p_locality))
      and (p_category is null or l.category = p_category)
      and (public.community_norm(p_query) = ''
           or position(public.community_norm(p_query) in public.community_norm(l.title)) > 0
           or position(public.community_norm(p_query) in public.community_norm(coalesce(l.description, ''))) > 0)
    order by l.created_at desc
    limit least(greatest(coalesce(p_limit, 60), 1), 100)
  ) x;
  return res;
end $$;

grant execute on function public.get_community_listings(text, text, text, int) to authenticated;
