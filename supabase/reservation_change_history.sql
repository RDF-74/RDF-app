-- RE:CORDARE Manager: 予約変更履歴とLINE通知状態
create table if not exists public.reservation_change_history (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  changed_by uuid references auth.users(id) on delete set null,
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  changed_at timestamptz not null default now(),
  line_sent_at timestamptz,
  line_message text
);

create index if not exists reservation_change_history_reservation_idx
  on public.reservation_change_history (reservation_id, changed_at desc);

alter table public.reservation_change_history enable row level security;
revoke all on table public.reservation_change_history from anon, authenticated;
grant select on table public.reservation_change_history to authenticated;
grant update (line_sent_at, line_message) on table public.reservation_change_history to authenticated;

drop policy if exists "Active manager users can read reservation change history" on public.reservation_change_history;
drop policy if exists "Active manager users can update reservation change history" on public.reservation_change_history;

create policy "Active manager users can read reservation change history"
  on public.reservation_change_history for select to authenticated
  using (
    exists (
      select 1 from public.manager_profiles
      where id = (select auth.uid())
        and is_active = true
        and role in ('admin', 'staff')
    )
  );

create policy "Active manager users can update reservation change history"
  on public.reservation_change_history for update to authenticated
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

create or replace function public.log_reservation_customer_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if row(
    old.vehicle_id,
    old.course_code,
    old.reservation_date,
    old.start_time,
    old.selected_options,
    old.selected_discounts,
    old.travel_zone,
    old.final_total
  ) is distinct from row(
    new.vehicle_id,
    new.course_code,
    new.reservation_date,
    new.start_time,
    new.selected_options,
    new.selected_discounts,
    new.travel_zone,
    new.final_total
  ) then
    insert into public.reservation_change_history (
      reservation_id,
      changed_by,
      before_snapshot,
      after_snapshot
    ) values (
      new.id,
      auth.uid(),
      jsonb_build_object(
        'vehicle_id', old.vehicle_id,
        'course_code', old.course_code,
        'reservation_date', old.reservation_date,
        'start_time', old.start_time,
        'selected_options', old.selected_options,
        'selected_discounts', old.selected_discounts,
        'travel_zone', old.travel_zone,
        'final_total', old.final_total
      ),
      jsonb_build_object(
        'vehicle_id', new.vehicle_id,
        'course_code', new.course_code,
        'reservation_date', new.reservation_date,
        'start_time', new.start_time,
        'selected_options', new.selected_options,
        'selected_discounts', new.selected_discounts,
        'travel_zone', new.travel_zone,
        'final_total', new.final_total
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists reservations_log_customer_change on public.reservations;
create trigger reservations_log_customer_change
after update of vehicle_id, course_code, reservation_date, start_time, selected_options, selected_discounts, travel_zone, final_total
on public.reservations
for each row execute function public.log_reservation_customer_change();

revoke all on function public.log_reservation_customer_change() from public, anon, authenticated;
