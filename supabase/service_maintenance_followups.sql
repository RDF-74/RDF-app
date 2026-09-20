-- RE:CORDARE Manager: 施工後メンテナンス案内（30/45/60/90日）
create table if not exists public.service_maintenance_followups (
  id uuid primary key default gen_random_uuid(),
  service_record_id uuid not null references public.service_records(id) on delete cascade,
  day_offset integer not null check (day_offset in (30,45,60,90)),
  due_on date not null,
  notified_at timestamptz,
  sent_at timestamptz,
  message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_record_id, day_offset)
);

create index if not exists service_maintenance_followups_pending_idx
  on public.service_maintenance_followups (due_on, sent_at, notified_at);

alter table public.service_maintenance_followups enable row level security;
revoke all on table public.service_maintenance_followups from anon, authenticated;
grant select, update on table public.service_maintenance_followups to authenticated;

drop policy if exists "Active managers can read maintenance followups" on public.service_maintenance_followups;
drop policy if exists "Active managers can update maintenance followups" on public.service_maintenance_followups;

create policy "Active managers can read maintenance followups"
on public.service_maintenance_followups
for select
to authenticated
using (
  exists (
    select 1 from public.manager_profiles
    where id = (select auth.uid())
      and is_active
      and role in ('admin','staff')
  )
);

create policy "Active managers can update maintenance followups"
on public.service_maintenance_followups
for update
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

drop trigger if exists service_maintenance_followups_set_updated_at on public.service_maintenance_followups;
create trigger service_maintenance_followups_set_updated_at
before update on public.service_maintenance_followups
for each row execute function public.set_manager_updated_at();

create or replace function public.sync_service_maintenance_followups()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  completed_date date;
begin
  if new.status = 'completed'
     and (
       tg_op = 'INSERT'
       or old.status is distinct from 'completed'
       or old.actual_completed_at is distinct from new.actual_completed_at
     ) then
    completed_date := (coalesce(new.actual_completed_at, now()) at time zone 'Asia/Tokyo')::date;

    insert into public.service_maintenance_followups (service_record_id, day_offset, due_on)
    values
      (new.id, 30, completed_date + 30),
      (new.id, 45, completed_date + 45),
      (new.id, 60, completed_date + 60),
      (new.id, 90, completed_date + 90)
    on conflict (service_record_id, day_offset)
    do update set
      due_on = excluded.due_on,
      notified_at = null,
      message = null,
      updated_at = now()
    where public.service_maintenance_followups.sent_at is null;

  elsif tg_op = 'UPDATE'
        and old.status = 'completed'
        and new.status <> 'completed' then
    delete from public.service_maintenance_followups
    where service_record_id = new.id
      and sent_at is null;
  end if;

  return new;
end;
$$;

drop trigger if exists service_records_sync_maintenance_followups on public.service_records;
create trigger service_records_sync_maintenance_followups
after insert or update of status, actual_completed_at on public.service_records
for each row execute function public.sync_service_maintenance_followups();
