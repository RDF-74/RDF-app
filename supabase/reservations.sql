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

-- Phase 2: 車両区分・料金・オプション・割引・出張料
alter table public.customer_vehicles
  add column if not exists size_class text;

alter table public.reservations
  add column if not exists vehicle_size_class text,
  add column if not exists selected_options jsonb not null default '[]'::jsonb,
  add column if not exists selected_discounts jsonb not null default '[]'::jsonb,
  add column if not exists travel_zone text,
  add column if not exists base_price integer,
  add column if not exists options_total integer not null default 0,
  add column if not exists travel_fee integer not null default 0,
  add column if not exists discount_total integer not null default 0,
  add column if not exists calculated_total integer,
  add column if not exists final_total integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'customer_vehicles_size_class_check'
      and conrelid = 'public.customer_vehicles'::regclass
  ) then
    alter table public.customer_vehicles
      add constraint customer_vehicles_size_class_check
      check (
        size_class is null or size_class in (
          'kei_compact','sedan_wagon','suv','minivan','large_hiace'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'reservations_vehicle_size_class_check'
      and conrelid = 'public.reservations'::regclass
  ) then
    alter table public.reservations
      add constraint reservations_vehicle_size_class_check
      check (
        vehicle_size_class is null or vehicle_size_class in (
          'kei_compact','sedan_wagon','suv','minivan','large_hiace'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'reservations_travel_zone_check'
      and conrelid = 'public.reservations'::regclass
  ) then
    alter table public.reservations
      add constraint reservations_travel_zone_check
      check (
        travel_zone is null or travel_zone in (
          'within_10','km10_20','km20_30','over_30'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'reservations_selected_options_array_check'
      and conrelid = 'public.reservations'::regclass
  ) then
    alter table public.reservations
      add constraint reservations_selected_options_array_check
      check (jsonb_typeof(selected_options) = 'array');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'reservations_selected_discounts_array_check'
      and conrelid = 'public.reservations'::regclass
  ) then
    alter table public.reservations
      add constraint reservations_selected_discounts_array_check
      check (jsonb_typeof(selected_discounts) = 'array');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'reservations_price_values_check'
      and conrelid = 'public.reservations'::regclass
  ) then
    alter table public.reservations
      add constraint reservations_price_values_check
      check (
        (base_price is null or base_price >= 0)
        and options_total >= 0
        and travel_fee >= 0
        and discount_total >= 0
        and (calculated_total is null or calculated_total >= 0)
        and (final_total is null or final_total >= 0)
      );
  end if;
end $$;


-- Phase 3: 準備・施工・片付け・予約枠
alter table public.reservations
  add column if not exists planned_prep_minutes integer,
  add column if not exists planned_service_minutes integer,
  add column if not exists planned_cleanup_minutes integer,
  add column if not exists planned_slot_minutes integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reservations_planned_minutes_check'
      and conrelid = 'public.reservations'::regclass
  ) then
    alter table public.reservations
      add constraint reservations_planned_minutes_check
      check (
        (planned_prep_minutes is null or planned_prep_minutes >= 0)
        and (planned_service_minutes is null or planned_service_minutes >= 0)
        and (planned_cleanup_minutes is null or planned_cleanup_minutes >= 0)
        and (planned_slot_minutes is null or planned_slot_minutes >= 0)
        and (
          planned_slot_minutes is null
          or planned_prep_minutes is null
          or planned_service_minutes is null
          or planned_cleanup_minutes is null
          or planned_slot_minutes = planned_prep_minutes + planned_service_minutes + planned_cleanup_minutes
        )
      );
  end if;
end $$;
