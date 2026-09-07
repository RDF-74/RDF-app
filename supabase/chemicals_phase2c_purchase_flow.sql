create table if not exists public.chemical_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  recordare_chemical_id uuid not null references public.recordare_chemicals(id) on delete cascade,
  capacity numeric not null check (capacity > 0),
  quantity integer not null default 1 check (quantity > 0),
  status text not null default 'planned' check (status in ('planned','ordered','received')),
  planned_on date not null default current_date,
  ordered_at timestamptz,
  received_at timestamptz,
  received_purchase_id uuid references public.chemical_purchases(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chemical_purchase_orders_active_idx
  on public.chemical_purchase_orders(status, created_at);
create index if not exists chemical_purchase_orders_chemical_idx
  on public.chemical_purchase_orders(recordare_chemical_id, created_at);

alter table public.chemical_purchase_orders enable row level security;
revoke all on table public.chemical_purchase_orders from anon, authenticated;
grant select, insert, update on table public.chemical_purchase_orders to authenticated;

drop policy if exists "Active manager users manage chemical purchase orders"
  on public.chemical_purchase_orders;
create policy "Active manager users manage chemical purchase orders"
  on public.chemical_purchase_orders
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

create or replace function public.receive_chemical_purchase_order(
  p_order_id uuid,
  p_purchased_on date default current_date,
  p_amount numeric default null,
  p_store text default null,
  p_notes text default null
) returns public.chemical_purchase_orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.chemical_purchase_orders%rowtype;
  v_chemical public.recordare_chemicals%rowtype;
  v_total numeric;
  v_purchase_id uuid;
  v_result public.chemical_purchase_orders%rowtype;
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

  if p_amount is not null and p_amount < 0 then
    raise exception '支払金額が不正です。';
  end if;

  select *
    into v_order
    from public.chemical_purchase_orders
   where id = p_order_id
   for update;

  if not found then
    raise exception '購入予定が見つかりません。';
  end if;

  if v_order.status <> 'ordered' then
    raise exception '注文済みの購入予定だけ入荷できます。';
  end if;

  select *
    into v_chemical
    from public.recordare_chemicals
   where id = v_order.recordare_chemical_id
   for update;

  if not found then
    raise exception 'ケミカルが見つかりません。';
  end if;

  v_total := v_order.capacity * v_order.quantity;

  insert into public.chemical_purchases (
    recordare_chemical_id,
    purchased_on,
    capacity,
    quantity,
    amount,
    store,
    notes,
    unit_price_per_ml
  ) values (
    v_order.recordare_chemical_id,
    coalesce(p_purchased_on, current_date),
    v_order.capacity,
    v_order.quantity,
    p_amount,
    nullif(btrim(coalesce(p_store, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    case when p_amount is null then null else p_amount / v_total end
  )
  returning id into v_purchase_id;

  update public.recordare_chemicals
     set current_stock = coalesce(current_stock, 0) + v_total,
         unknown_cost_stock = least(
           coalesce(current_stock, 0) + v_total,
           coalesce(unknown_cost_stock, 0) + case when p_amount is null then v_total else 0 end
         ),
         updated_at = now()
   where id = v_order.recordare_chemical_id;

  update public.chemical_purchase_orders
     set status = 'received',
         received_at = now(),
         received_purchase_id = v_purchase_id,
         updated_at = now()
   where id = p_order_id
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.receive_chemical_purchase_order(
  uuid, date, numeric, text, text
) from public, anon;
grant execute on function public.receive_chemical_purchase_order(
  uuid, date, numeric, text, text
) to authenticated;
