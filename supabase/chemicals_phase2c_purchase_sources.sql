create table if not exists public.chemical_purchase_sources (
  id uuid primary key default gen_random_uuid(),
  recordare_chemical_id uuid not null references public.recordare_chemicals(id) on delete cascade,
  capacity numeric not null check (capacity > 0),
  store_name text,
  product_url text,
  last_price numeric check (last_price is null or last_price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recordare_chemical_id, capacity)
);

create index if not exists chemical_purchase_sources_chemical_idx
  on public.chemical_purchase_sources(recordare_chemical_id, capacity);

alter table public.chemical_purchase_sources enable row level security;
revoke all on table public.chemical_purchase_sources from anon, authenticated;
grant select, insert, update on table public.chemical_purchase_sources to authenticated;

drop policy if exists "Active manager users manage chemical purchase sources"
  on public.chemical_purchase_sources;
create policy "Active manager users manage chemical purchase sources"
  on public.chemical_purchase_sources
  for all
  to authenticated
  using (
    exists (
      select 1 from public.manager_profiles
      where id = (select auth.uid())
        and is_active
        and role in ('admin','staff')
    )
  )
  with check (
    exists (
      select 1 from public.manager_profiles
      where id = (select auth.uid())
        and is_active
        and role in ('admin','staff')
    )
  );

alter table public.chemical_purchase_orders
  add column if not exists purchase_source_id uuid references public.chemical_purchase_sources(id) on delete set null,
  add column if not exists store_name text,
  add column if not exists product_url text,
  add column if not exists expected_package_price numeric
    check (expected_package_price is null or expected_package_price >= 0);


create or replace function public.update_chemical_purchase_source_last_price()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.amount is not null and new.quantity > 0 then
    update public.chemical_purchase_sources
       set last_price = new.amount / new.quantity,
           updated_at = now()
     where recordare_chemical_id = new.recordare_chemical_id
       and capacity = new.capacity
       and is_active;
  end if;
  return new;
end;
$$;

drop trigger if exists chemical_purchases_update_source_price on public.chemical_purchases;
create trigger chemical_purchases_update_source_price
after insert on public.chemical_purchases
for each row execute function public.update_chemical_purchase_source_last_price();
