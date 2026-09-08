create table if not exists public.recordare_chemical_step_standards (
  id uuid primary key default gen_random_uuid(),
  recordare_chemical_id uuid not null references public.recordare_chemicals(id) on delete cascade,
  course_code text not null default 'all'
    check (course_code in ('all','rinseless','maintenance','standard','reset_coat')),
  step_key text not null,
  standard_usage_amount numeric
    check (standard_usage_amount is null or standard_usage_amount > 0),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recordare_chemical_id, course_code, step_key)
);

create index if not exists recordare_chemical_step_standards_step_idx
  on public.recordare_chemical_step_standards(course_code, step_key, is_active);

alter table public.recordare_chemical_step_standards enable row level security;
revoke all on table public.recordare_chemical_step_standards from anon, authenticated;
grant select, insert, update, delete on table public.recordare_chemical_step_standards to authenticated;

drop policy if exists "Active manager users manage chemical step standards"
  on public.recordare_chemical_step_standards;
create policy "Active manager users manage chemical step standards"
  on public.recordare_chemical_step_standards
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
