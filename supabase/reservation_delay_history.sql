-- RE:CORDARE Manager: 予約遅延連絡履歴
create table if not exists public.reservation_delay_history (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete restrict,
  reason text not null check (reason in ('traffic','previous_service','weather','vehicle','other')),
  internal_note text,
  original_start_time time not null,
  new_arrival_time time not null,
  projected_end_time time,
  line_message text not null,
  line_sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists reservation_delay_history_reservation_idx
  on public.reservation_delay_history (reservation_id, created_at desc);

alter table public.reservation_delay_history enable row level security;
revoke all on table public.reservation_delay_history from anon, authenticated;
grant select, insert, update on table public.reservation_delay_history to authenticated;

drop policy if exists "Active manager users can read reservation delays" on public.reservation_delay_history;
drop policy if exists "Active manager users can create reservation delays" on public.reservation_delay_history;
drop policy if exists "Active manager users can update reservation delays" on public.reservation_delay_history;

create policy "Active manager users can read reservation delays"
  on public.reservation_delay_history for select to authenticated
  using (
    exists (
      select 1 from public.manager_profiles
      where id = (select auth.uid())
        and is_active = true
        and role in ('admin','staff')
    )
  );

create policy "Active manager users can create reservation delays"
  on public.reservation_delay_history for insert to authenticated
  with check (
    exists (
      select 1 from public.manager_profiles
      where id = (select auth.uid())
        and is_active = true
        and role in ('admin','staff')
    )
  );

create policy "Active manager users can update reservation delays"
  on public.reservation_delay_history for update to authenticated
  using (
    exists (
      select 1 from public.manager_profiles
      where id = (select auth.uid())
        and is_active = true
        and role in ('admin','staff')
    )
  )
  with check (
    exists (
      select 1 from public.manager_profiles
      where id = (select auth.uid())
        and is_active = true
        and role in ('admin','staff')
    )
  );
