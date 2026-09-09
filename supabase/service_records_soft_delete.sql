-- RE:CORDARE Manager: 施工履歴の論理削除・30日復元
alter table public.service_records
  add column if not exists deleted_at timestamptz;

update public.service_records
set deleted_at = coalesce(deleted_at, updated_at, now())
where is_active = false
  and deleted_at is null;

alter table public.service_records
  drop constraint if exists service_records_reservation_id_key;

create unique index if not exists service_records_active_reservation_uidx
  on public.service_records (reservation_id)
  where is_active = true;

create index if not exists service_records_recent_deleted_idx
  on public.service_records (deleted_at desc)
  where is_active = false and deleted_at is not null;
