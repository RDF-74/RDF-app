-- RE:CORDARE Manager: 予約キャンセル履歴
alter table public.reservations
  add column if not exists cancellation_reason text,
  add column if not exists cancellation_note text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_line_sent_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reservations_cancellation_reason_check'
      and conrelid = 'public.reservations'::regclass
  ) then
    alter table public.reservations
      add constraint reservations_cancellation_reason_check
      check (
        cancellation_reason is null
        or cancellation_reason in ('customer','weather','recordare','duplicate','other')
      );
  end if;
end $$;
