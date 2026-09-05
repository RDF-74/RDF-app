-- RE:CORDARE Manager: 予約管理
create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  vehicle_id uuid not null references public.customer_vehicles(id) on delete restrict,
  course_code text not null check (course_code in ('rinseless', 'maintenance', 'standard', 'reset_coat')),
  reservation_date date not null,
  start_time time not null,
  status text not null default 'confirmed' check (status in ('tentative', 'confirmed', 'completed', 'cancelled')),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reservations_active_datetime_idx on public.reservations (is_active, reservation_date, start_time);
create index if not exists reservations_customer_idx on public.reservations (customer_id);
create index if not exists reservations_vehicle_idx on public.reservations (vehicle_id);

drop trigger if exists reservations_set_updated_at on public.reservations;
create trigger reservations_set_updated_at
before update on public.reservations
for each row execute function public.set_manager_updated_at();

alter table public.reservations enable row level security;
revoke all on table public.reservations from anon, authenticated;
grant select, insert, update on table public.reservations to authenticated;

create policy "Active manager users can read reservations"
  on public.reservations for select to authenticated
  using (
    exists (
      select 1 from public.manager_profiles
      where id = (select auth.uid())
        and is_active = true
        and role in ('admin', 'staff')
    )
  );

create policy "Active manager users can create reservations"
  on public.reservations for insert to authenticated
  with check (
    exists (
      select 1 from public.manager_profiles
      where id = (select auth.uid())
        and is_active = true
        and role in ('admin', 'staff')
    )
  );

create policy "Active manager users can update reservations"
  on public.reservations for update to authenticated
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
