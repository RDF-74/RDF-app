-- RE:CORDARE Manager: 顧客・車両管理
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) > 0),
  phone text,
  line_display_name text,
  contact_method text not null default 'line' check (contact_method in ('line', 'phone', 'other')),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_vehicles (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  manufacturer text not null check (char_length(trim(manufacturer)) > 0),
  model text not null check (char_length(trim(model)) > 0),
  color text not null check (char_length(trim(color)) > 0),
  plate_last4 text check (plate_last4 is null or plate_last4 ~ '^[0-9]{4}$'),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customers_active_name_idx on public.customers (is_active, name);
create index if not exists customer_vehicles_customer_active_idx on public.customer_vehicles (customer_id, is_active);

create or replace function public.set_manager_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_manager_updated_at() from public;

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
before update on public.customers
for each row execute function public.set_manager_updated_at();

drop trigger if exists customer_vehicles_set_updated_at on public.customer_vehicles;
create trigger customer_vehicles_set_updated_at
before update on public.customer_vehicles
for each row execute function public.set_manager_updated_at();

alter table public.customers enable row level security;
alter table public.customer_vehicles enable row level security;

create policy "Active manager users can manage customers"
  on public.customers for all to authenticated
  using (
    exists (
      select 1 from public.manager_profiles
      where id = (select auth.uid())
        and is_active = true
        and role in ('admin', 'staff')
    )
  )
  with check (
    exists (
      select 1 from public.manager_profiles
      where id = (select auth.uid())
        and is_active = true
        and role in ('admin', 'staff')
    )
  );

create policy "Active manager users can manage customer vehicles"
  on public.customer_vehicles for all to authenticated
  using (
    exists (
      select 1 from public.manager_profiles
      where id = (select auth.uid())
        and is_active = true
        and role in ('admin', 'staff')
    )
  )
  with check (
    exists (
      select 1 from public.manager_profiles
      where id = (select auth.uid())
        and is_active = true
        and role in ('admin', 'staff')
    )
  );

grant select, insert, update on table public.customers to authenticated;
grant select, insert, update on table public.customer_vehicles to authenticated;
