-- RE:CORDARE Manager: 施工記録（予約スナップショット）
create table if not exists public.service_records (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null unique references public.reservations(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  vehicle_id uuid not null references public.customer_vehicles(id) on delete restrict,

  customer_name text not null,
  vehicle_manufacturer text not null,
  vehicle_model text not null,
  vehicle_color text,
  vehicle_plate_last4 text,

  course_code text not null check (course_code in ('rinseless', 'maintenance', 'standard', 'reset_coat')),
  service_date date not null,
  planned_start_time time not null,
  planned_prep_minutes integer,
  planned_service_minutes integer,
  planned_cleanup_minutes integer,
  planned_slot_minutes integer,

  vehicle_size_class text,
  selected_options jsonb not null default '[]'::jsonb,
  selected_discounts jsonb not null default '[]'::jsonb,
  travel_zone text,
  base_price integer,
  options_total integer not null default 0,
  travel_fee integer not null default 0,
  discount_total integer not null default 0,
  calculated_total integer,
  planned_total integer,
  reservation_notes text,

  status text not null default 'planned' check (status in ('planned', 'in_progress', 'completed', 'cancelled')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists service_records_active_date_idx
  on public.service_records (is_active, service_date, planned_start_time);
create index if not exists service_records_customer_idx
  on public.service_records (customer_id);
create index if not exists service_records_vehicle_idx
  on public.service_records (vehicle_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'service_records_minutes_check'
      and conrelid = 'public.service_records'::regclass
  ) then
    alter table public.service_records
      add constraint service_records_minutes_check
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

  if not exists (
    select 1 from pg_constraint
    where conname = 'service_records_vehicle_size_class_check'
      and conrelid = 'public.service_records'::regclass
  ) then
    alter table public.service_records
      add constraint service_records_vehicle_size_class_check
      check (
        vehicle_size_class is null or vehicle_size_class in (
          'kei_compact','sedan_wagon','suv','minivan','large_hiace'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'service_records_travel_zone_check'
      and conrelid = 'public.service_records'::regclass
  ) then
    alter table public.service_records
      add constraint service_records_travel_zone_check
      check (
        travel_zone is null or travel_zone in (
          'within_10','km10_20','km20_30','over_30'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'service_records_json_arrays_check'
      and conrelid = 'public.service_records'::regclass
  ) then
    alter table public.service_records
      add constraint service_records_json_arrays_check
      check (
        jsonb_typeof(selected_options) = 'array'
        and jsonb_typeof(selected_discounts) = 'array'
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'service_records_price_values_check'
      and conrelid = 'public.service_records'::regclass
  ) then
    alter table public.service_records
      add constraint service_records_price_values_check
      check (
        (base_price is null or base_price >= 0)
        and options_total >= 0
        and travel_fee >= 0
        and discount_total >= 0
        and (calculated_total is null or calculated_total >= 0)
        and (planned_total is null or planned_total >= 0)
      );
  end if;
end $$;

drop trigger if exists service_records_set_updated_at on public.service_records;
create trigger service_records_set_updated_at
before update on public.service_records
for each row execute function public.set_manager_updated_at();

alter table public.service_records enable row level security;
revoke all on table public.service_records from anon, authenticated;
grant select, insert, update on table public.service_records to authenticated;

drop policy if exists "Active manager users can read service records" on public.service_records;
drop policy if exists "Active manager users can create service records" on public.service_records;
drop policy if exists "Active manager users can update service records" on public.service_records;

create policy "Active manager users can read service records"
  on public.service_records for select to authenticated
  using (
    exists (
      select 1 from public.manager_profiles
      where id = (select auth.uid())
        and is_active = true
        and role in ('admin', 'staff')
    )
  );

create policy "Active manager users can create service records"
  on public.service_records for insert to authenticated
  with check (
    exists (
      select 1 from public.manager_profiles
      where id = (select auth.uid())
        and is_active = true
        and role in ('admin', 'staff')
    )
  );

create policy "Active manager users can update service records"
  on public.service_records for update to authenticated
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
