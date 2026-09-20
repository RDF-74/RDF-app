do $$
declare existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname in (
      'recordare-manager-day-before-19-jst',
      'recordare-manager-day-before-21-jst',
      'recordare-manager-start-reminder-minute'
    )
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
end $$;

select cron.schedule(
  'recordare-manager-day-before-19-jst',
  '0 10 * * *',
  $cron$
    select net.http_post(
      url := 'https://upfdeicmzckflquexyhn.supabase.co/functions/v1/manager-notifications',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', public.get_manager_notification_secret('manager_notification_cron_secret')
      ),
      body := '{"action":"reservation-day-before","phase":"19"}'::jsonb,
      timeout_milliseconds := 20000
    )
    where exists (
      select 1
      from public.reservations r
      where r.is_active
        and r.status = 'confirmed'
        and r.reservation_date = ((now() at time zone 'Asia/Tokyo')::date + 1)
        and r.day_before_line_sent_at is null
    );
  $cron$
);

select cron.schedule(
  'recordare-manager-day-before-21-jst',
  '0 12 * * *',
  $cron$
    select net.http_post(
      url := 'https://upfdeicmzckflquexyhn.supabase.co/functions/v1/manager-notifications',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', public.get_manager_notification_secret('manager_notification_cron_secret')
      ),
      body := '{"action":"reservation-day-before","phase":"21"}'::jsonb,
      timeout_milliseconds := 20000
    )
    where exists (
      select 1
      from public.reservations r
      where r.is_active
        and r.status = 'confirmed'
        and r.reservation_date = ((now() at time zone 'Asia/Tokyo')::date + 1)
        and r.day_before_line_sent_at is null
    );
  $cron$
);

select cron.schedule(
  'recordare-manager-start-reminder-minute',
  '* * * * *',
  $cron$
    select net.http_post(
      url := 'https://upfdeicmzckflquexyhn.supabase.co/functions/v1/manager-notifications',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', public.get_manager_notification_secret('manager_notification_cron_secret')
      ),
      body := '{"action":"reservation-start-due"}'::jsonb,
      timeout_milliseconds := 20000
    )
    where exists (
      select 1
      from public.reservations r
      where r.is_active
        and r.status = 'confirmed'
        and ((r.reservation_date + r.start_time) at time zone 'Asia/Tokyo')
          between now() + interval '119 minutes' and now() + interval '121 minutes'
    );
  $cron$
);
