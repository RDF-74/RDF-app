create table if not exists public.service_chemical_usages (
  id uuid primary key default gen_random_uuid(),
  service_record_id uuid not null references public.service_records(id) on delete cascade,
  service_step_id uuid not null references public.service_steps(id) on delete cascade,
  recordare_chemical_id uuid not null references public.recordare_chemicals(id),
  usage_status text not null default 'unrecorded' check (usage_status in ('recorded','unrecorded','unused')),
  actual_amount numeric check (actual_amount is null or actual_amount > 0),
  stock_applied_amount numeric not null default 0 check (stock_applied_amount >= 0),
  unknown_cost_applied_amount numeric not null default 0 check (unknown_cost_applied_amount >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_step_id, recordare_chemical_id),
  check (
    (usage_status = 'recorded' and actual_amount is not null and actual_amount > 0)
    or
    (usage_status in ('unrecorded','unused') and actual_amount is null)
  )
);

create index if not exists service_chemical_usages_record_idx
  on public.service_chemical_usages(service_record_id, created_at);
create index if not exists service_chemical_usages_step_idx
  on public.service_chemical_usages(service_step_id);

alter table public.service_chemical_usages enable row level security;
revoke all on table public.service_chemical_usages from anon, authenticated;
grant select on table public.service_chemical_usages to authenticated;

drop policy if exists "Active manager users read service chemical usages"
  on public.service_chemical_usages;
create policy "Active manager users read service chemical usages"
  on public.service_chemical_usages
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

create or replace function public.save_service_chemical_usage(
  p_service_record_id uuid,
  p_service_step_id uuid,
  p_recordare_chemical_id uuid,
  p_usage_status text,
  p_actual_amount numeric default null,
  p_notes text default null
) returns public.service_chemical_usages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_step_record_id uuid;
  v_existing public.service_chemical_usages%rowtype;
  v_has_existing boolean := false;
  v_chemical public.recordare_chemicals%rowtype;
  v_restored_stock numeric;
  v_restored_unknown numeric;
  v_new_stock numeric;
  v_new_unknown numeric;
  v_new_applied numeric := 0;
  v_new_unknown_applied numeric := 0;
  v_result public.service_chemical_usages%rowtype;
begin
  if not exists (
    select 1 from public.manager_profiles
    where id = auth.uid()
      and is_active
      and role in ('admin','staff')
  ) then
    raise exception 'Manager権限がありません。' using errcode = '42501';
  end if;

  if p_usage_status not in ('recorded','unrecorded','unused') then
    raise exception '使用状態が不正です。';
  end if;

  if p_usage_status = 'recorded' then
    if p_actual_amount is null or p_actual_amount <= 0 then
      raise exception '実使用量を入力してください。';
    end if;
  else
    p_actual_amount := null;
  end if;

  select service_record_id
    into v_step_record_id
    from public.service_steps
   where id = p_service_step_id;

  if not found or v_step_record_id <> p_service_record_id then
    raise exception '施工工程と施工記録が一致しません。';
  end if;

  select *
    into v_existing
    from public.service_chemical_usages
   where service_step_id = p_service_step_id
     and recordare_chemical_id = p_recordare_chemical_id
   for update;
  v_has_existing := found;

  select *
    into v_chemical
    from public.recordare_chemicals
   where id = p_recordare_chemical_id
   for update;

  if not found then
    raise exception 'ケミカルが見つかりません。';
  end if;

  if v_chemical.current_stock is null then
    if v_has_existing and v_existing.stock_applied_amount > 0 then
      raise exception '在庫状態が不整合です。先に在庫を確認してください。';
    end if;
    v_new_applied := 0;
    v_new_unknown_applied := 0;
  else
    v_restored_stock :=
      v_chemical.current_stock
      + case when v_has_existing then v_existing.stock_applied_amount else 0 end;

    v_restored_unknown := least(
      v_restored_stock,
      v_chemical.unknown_cost_stock
      + case when v_has_existing then v_existing.unknown_cost_applied_amount else 0 end
    );

    if p_usage_status = 'recorded' then
      if v_restored_stock < p_actual_amount then
        raise exception '在庫が不足しています。現在在庫を確認してください。';
      end if;

      v_new_stock := v_restored_stock - p_actual_amount;
      v_new_unknown := least(v_restored_unknown, v_new_stock);
      v_new_applied := p_actual_amount;
      v_new_unknown_applied := greatest(0, v_restored_unknown - v_new_unknown);
    else
      v_new_stock := v_restored_stock;
      v_new_unknown := v_restored_unknown;
    end if;

    update public.recordare_chemicals
       set current_stock = v_new_stock,
           unknown_cost_stock = v_new_unknown,
           updated_at = now()
     where id = p_recordare_chemical_id;
  end if;

  insert into public.service_chemical_usages (
    service_record_id, service_step_id, recordare_chemical_id,
    usage_status, actual_amount, stock_applied_amount,
    unknown_cost_applied_amount, notes
  ) values (
    p_service_record_id, p_service_step_id, p_recordare_chemical_id,
    p_usage_status, p_actual_amount, v_new_applied,
    v_new_unknown_applied, nullif(btrim(coalesce(p_notes, '')), '')
  )
  on conflict (service_step_id, recordare_chemical_id)
  do update set
    service_record_id = excluded.service_record_id,
    usage_status = excluded.usage_status,
    actual_amount = excluded.actual_amount,
    stock_applied_amount = excluded.stock_applied_amount,
    unknown_cost_applied_amount = excluded.unknown_cost_applied_amount,
    notes = excluded.notes,
    updated_at = now()
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.save_service_chemical_usage(
  uuid, uuid, uuid, text, numeric, text
) from public, anon;
grant execute on function public.save_service_chemical_usage(
  uuid, uuid, uuid, text, numeric, text
) to authenticated;
