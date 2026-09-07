alter table public.service_chemical_usages
  add column if not exists unit_cost_per_ml numeric
    check (unit_cost_per_ml is null or unit_cost_per_ml >= 0),
  add column if not exists known_cost_amount numeric not null default 0
    check (known_cost_amount >= 0),
  add column if not exists cost_status text not null default 'not_applicable'
    check (cost_status in ('known','partial','unknown','not_applicable'));

with acquisition_costs as (
  select
    p.recordare_chemical_id,
    p.amount::numeric as cost_amount,
    (p.capacity * p.quantity)::numeric as volume
  from public.chemical_purchases p
  where p.amount is not null
  union all
  select
    a.recordare_chemical_id,
    a.price_amount::numeric as cost_amount,
    a.new_stock::numeric as volume
  from public.chemical_inventory_adjustments a
  where a.reason = 'initial'
    and a.price_amount is not null
    and a.new_stock > 0
),
cost_basis as (
  select
    recordare_chemical_id,
    sum(cost_amount) / nullif(sum(volume), 0) as unit_cost_per_ml
  from acquisition_costs
  where volume > 0
  group by recordare_chemical_id
),
calculated as (
  select
    u.id,
    cb.unit_cost_per_ml,
    greatest(
      coalesce(u.actual_amount, 0) - u.unknown_cost_applied_amount,
      0
    ) as known_usage_amount
  from public.service_chemical_usages u
  left join cost_basis cb
    on cb.recordare_chemical_id = u.recordare_chemical_id
)
update public.service_chemical_usages u
set
  unit_cost_per_ml = case
    when u.usage_status = 'recorded' then c.unit_cost_per_ml
    else u.unit_cost_per_ml
  end,
  known_cost_amount = case
    when u.usage_status = 'recorded'
      and c.unit_cost_per_ml is not null
      then c.known_usage_amount * c.unit_cost_per_ml
    else 0
  end,
  cost_status = case
    when u.usage_status <> 'recorded' then 'not_applicable'
    when u.unknown_cost_applied_amount > 0
      and c.unit_cost_per_ml is not null
      and c.known_usage_amount > 0 then 'partial'
    when u.unknown_cost_applied_amount > 0 then 'unknown'
    when c.unit_cost_per_ml is not null then 'known'
    else 'unknown'
  end
from calculated c
where c.id = u.id;

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
  v_unit_cost numeric;
  v_known_usage_amount numeric := 0;
  v_known_cost_amount numeric := 0;
  v_cost_status text := 'not_applicable';
  v_result public.service_chemical_usages%rowtype;
begin
  if not exists (
    select 1
    from public.manager_profiles
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

  if v_has_existing and v_existing.unit_cost_per_ml is not null then
    v_unit_cost := v_existing.unit_cost_per_ml;
  else
    select sum(x.cost_amount) / nullif(sum(x.volume), 0)
      into v_unit_cost
      from (
        select
          p.amount::numeric as cost_amount,
          (p.capacity * p.quantity)::numeric as volume
        from public.chemical_purchases p
        where p.recordare_chemical_id = p_recordare_chemical_id
          and p.amount is not null
        union all
        select
          a.price_amount::numeric as cost_amount,
          a.new_stock::numeric as volume
        from public.chemical_inventory_adjustments a
        where a.recordare_chemical_id = p_recordare_chemical_id
          and a.reason = 'initial'
          and a.price_amount is not null
          and a.new_stock > 0
      ) x
      where x.volume > 0;
  end if;

  if p_usage_status = 'recorded' then
    v_known_usage_amount := greatest(
      p_actual_amount - v_new_unknown_applied,
      0
    );

    if v_unit_cost is not null then
      v_known_cost_amount := v_known_usage_amount * v_unit_cost;
    end if;

    if v_new_unknown_applied > 0
      and v_unit_cost is not null
      and v_known_usage_amount > 0 then
      v_cost_status := 'partial';
    elsif v_new_unknown_applied > 0 then
      v_cost_status := 'unknown';
    elsif v_unit_cost is not null then
      v_cost_status := 'known';
    else
      v_cost_status := 'unknown';
    end if;
  else
    v_known_cost_amount := 0;
    v_cost_status := 'not_applicable';
  end if;

  insert into public.service_chemical_usages (
    service_record_id,
    service_step_id,
    recordare_chemical_id,
    usage_status,
    actual_amount,
    stock_applied_amount,
    unknown_cost_applied_amount,
    unit_cost_per_ml,
    known_cost_amount,
    cost_status,
    notes
  ) values (
    p_service_record_id,
    p_service_step_id,
    p_recordare_chemical_id,
    p_usage_status,
    p_actual_amount,
    v_new_applied,
    v_new_unknown_applied,
    v_unit_cost,
    v_known_cost_amount,
    v_cost_status,
    nullif(btrim(coalesce(p_notes, '')), '')
  )
  on conflict (service_step_id, recordare_chemical_id)
  do update set
    service_record_id = excluded.service_record_id,
    usage_status = excluded.usage_status,
    actual_amount = excluded.actual_amount,
    stock_applied_amount = excluded.stock_applied_amount,
    unknown_cost_applied_amount = excluded.unknown_cost_applied_amount,
    unit_cost_per_ml = excluded.unit_cost_per_ml,
    known_cost_amount = excluded.known_cost_amount,
    cost_status = excluded.cost_status,
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
