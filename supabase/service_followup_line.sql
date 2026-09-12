create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

create table if not exists public.service_followup_lines (
  id uuid primary key default gen_random_uuid(),
  service_record_id uuid not null unique references public.service_records(id) on delete cascade,
  due_at timestamptz not null,
  reminder_due_at timestamptz not null,
  first_notified_at timestamptz,
  reminder_notified_at timestamptz,
  sent_at timestamptz,
  message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists service_followup_lines_pending_idx
  on public.service_followup_lines(sent_at, due_at, reminder_due_at);

drop trigger if exists service_followup_lines_set_updated_at on public.service_followup_lines;
create trigger service_followup_lines_set_updated_at
before update on public.service_followup_lines
for each row execute function public.set_manager_updated_at();

alter table public.service_followup_lines enable row level security;
revoke all on table public.service_followup_lines from anon, authenticated;
grant select, insert, update on table public.service_followup_lines to authenticated;
grant select, insert, update, delete on table public.service_followup_lines to service_role;

drop policy if exists "Active manager users manage service followup lines" on public.service_followup_lines;
create policy "Active manager users manage service followup lines"
  on public.service_followup_lines
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

create or replace function public.sync_service_followup_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  completed_at timestamptz;
begin
  if new.status = 'completed'
     and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    completed_at := coalesce(new.actual_completed_at, now());
    insert into public.service_followup_lines (
      service_record_id,
      due_at,
      reminder_due_at
    ) values (
      new.id,
      completed_at + interval '30 minutes',
      completed_at + interval '150 minutes'
    )
    on conflict (service_record_id) do update
      set due_at = excluded.due_at,
          reminder_due_at = excluded.reminder_due_at,
          first_notified_at = null,
          reminder_notified_at = null,
          message = null,
          updated_at = now()
      where public.service_followup_lines.sent_at is null;
  elsif tg_op = 'UPDATE'
        and old.status = 'completed'
        and new.status <> 'completed' then
    delete from public.service_followup_lines
    where service_record_id = new.id
      and sent_at is null;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_service_followup_line() from public, anon, authenticated;

drop trigger if exists service_records_sync_followup_line on public.service_records;
create trigger service_records_sync_followup_line
after insert or update of status on public.service_records
for each row execute function public.sync_service_followup_line();

-- 今日のテスト施工など、直近24時間にすでに完了した施工も対象にする。
insert into public.service_followup_lines (service_record_id, due_at, reminder_due_at)
select
  id,
  actual_completed_at + interval '30 minutes',
  actual_completed_at + interval '150 minutes'
from public.service_records
where status = 'completed'
  and is_active = true
  and actual_completed_at is not null
  and actual_completed_at >= now() - interval '24 hours'
on conflict (service_record_id) do nothing;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job where jobname = 'recordare-service-followup-notifications-5min'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
end $$;

select cron.schedule(
  'recordare-service-followup-notifications-5min',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := 'https://upfdeicmzckflquexyhn.supabase.co/functions/v1/service-followup-notifications',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', public.get_manager_notification_secret('manager_notification_cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 20000
    );
  $$
);
