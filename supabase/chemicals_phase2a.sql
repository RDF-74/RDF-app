-- Phase 2A: 共通ケミカルカタログ、RE:CORDAREマイケミカル、購入・在庫履歴
create table if not exists public.chemical_catalog_products (
  id uuid primary key default gen_random_uuid(), manufacturer text not null, product_name text not null,
  normalized_name text not null, category text, status text not null default 'active' check (status in ('active','inactive')),
  notes text, official_info jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (manufacturer, normalized_name)
);
create table if not exists public.chemical_source_links (
  id uuid primary key default gen_random_uuid(), catalog_product_id uuid not null references public.chemical_catalog_products(id) on delete cascade,
  source_system text not null, source_chemical_id text not null, source_name text, match_status text not null default 'linked' check (match_status in ('linked','candidate','unmatched')),
  created_at timestamptz not null default now(), unique (source_system, source_chemical_id)
);
create table if not exists public.recordare_chemicals (
  id uuid primary key default gen_random_uuid(), catalog_product_id uuid not null references public.chemical_catalog_products(id),
  status text not null default 'active' check (status in ('active','paused')), category text, unit text not null default 'mL',
  usage_mode text not null default 'undiluted' check (usage_mode in ('undiluted','diluted')), standard_dilution_ratio numeric, standard_usage_amount numeric,
  usage_basis_type text check (usage_basis_type in ('vehicle_size','area','quantity','fixed','actual_only')), standard_for_future uuid, alternative_for_future uuid,
  purchase_store text, usual_purchase_capacity numeric, notes text, current_stock numeric check (current_stock >= 0), unknown_cost_stock numeric not null default 0 check (unknown_cost_stock >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (catalog_product_id)
);
create table if not exists public.chemical_purchases (
  id uuid primary key default gen_random_uuid(), recordare_chemical_id uuid not null references public.recordare_chemicals(id) on delete cascade,
  purchased_on date not null default current_date, capacity numeric not null check (capacity > 0), quantity integer not null default 1 check (quantity > 0),
  amount numeric, store text, notes text, unit_price_per_ml numeric, created_at timestamptz not null default now()
);
create table if not exists public.chemical_inventory_adjustments (
  id uuid primary key default gen_random_uuid(), recordare_chemical_id uuid not null references public.recordare_chemicals(id) on delete cascade,
  adjusted_on date not null default current_date, previous_stock numeric, new_stock numeric not null check (new_stock >= 0),
  reason text not null check (reason in ('initial','inventory','spill','discard','usage_missing','other')), amount numeric, notes text, price_amount numeric, created_at timestamptz not null default now()
);
create index if not exists chemical_purchases_chemical_date_idx on public.chemical_purchases(recordare_chemical_id, purchased_on desc);
create index if not exists chemical_adjustments_chemical_date_idx on public.chemical_inventory_adjustments(recordare_chemical_id, adjusted_on desc);
alter table public.chemical_catalog_products enable row level security; alter table public.chemical_source_links enable row level security; alter table public.recordare_chemicals enable row level security; alter table public.chemical_purchases enable row level security; alter table public.chemical_inventory_adjustments enable row level security;
grant select, insert, update on public.chemical_catalog_products, public.chemical_source_links, public.recordare_chemicals, public.chemical_purchases, public.chemical_inventory_adjustments to authenticated;
create policy "Active manager users manage chemical catalog" on public.chemical_catalog_products for all to authenticated using (exists (select 1 from public.manager_profiles where id=(select auth.uid()) and is_active and role in ('admin','staff'))) with check (exists (select 1 from public.manager_profiles where id=(select auth.uid()) and is_active and role in ('admin','staff')));
create policy "Active manager users manage chemical links" on public.chemical_source_links for all to authenticated using (exists (select 1 from public.manager_profiles where id=(select auth.uid()) and is_active and role in ('admin','staff'))) with check (exists (select 1 from public.manager_profiles where id=(select auth.uid()) and is_active and role in ('admin','staff')));
create policy "Active manager users manage chemicals" on public.recordare_chemicals for all to authenticated using (exists (select 1 from public.manager_profiles where id=(select auth.uid()) and is_active and role in ('admin','staff'))) with check (exists (select 1 from public.manager_profiles where id=(select auth.uid()) and is_active and role in ('admin','staff')));
create policy "Active manager users manage chemical purchases" on public.chemical_purchases for all to authenticated using (exists (select 1 from public.manager_profiles where id=(select auth.uid()) and is_active and role in ('admin','staff'))) with check (exists (select 1 from public.manager_profiles where id=(select auth.uid()) and is_active and role in ('admin','staff')));
create policy "Active manager users manage chemical adjustments" on public.chemical_inventory_adjustments for all to authenticated using (exists (select 1 from public.manager_profiles where id=(select auth.uid()) and is_active and role in ('admin','staff'))) with check (exists (select 1 from public.manager_profiles where id=(select auth.uid()) and is_active and role in ('admin','staff')));
