-- RE:CORDARE Manager: 施工ごとの支払い状態
alter table public.service_records
  add column if not exists payment_status text,
  add column if not exists paid_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'service_records_payment_status_check'
      and conrelid = 'public.service_records'::regclass
  ) then
    alter table public.service_records
      add constraint service_records_payment_status_check
      check (payment_status is null or payment_status in ('unpaid','paid'));
  end if;
end $$;
