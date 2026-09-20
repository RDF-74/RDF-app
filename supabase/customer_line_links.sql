-- RE:CORDARE Manager: 顧客とLINEの恒久連携状態
create table if not exists public.customer_line_links (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  linked_at timestamptz not null default now(),
  link_source text not null default 'reservation',
  updated_at timestamptz not null default now()
);

alter table public.customer_line_links enable row level security;
revoke all on table public.customer_line_links from anon, authenticated;
grant select, insert, update, delete on table public.customer_line_links to authenticated;

drop policy if exists "Active managers can read customer line links" on public.customer_line_links;
drop policy if exists "Active managers can insert customer line links" on public.customer_line_links;
drop policy if exists "Active managers can update customer line links" on public.customer_line_links;
drop policy if exists "Active managers can delete customer line links" on public.customer_line_links;

create policy "Active managers can read customer line links"
on public.customer_line_links for select to authenticated
using (exists (
  select 1 from public.manager_profiles
  where id=(select auth.uid()) and is_active and role in ('admin','staff')
));

create policy "Active managers can insert customer line links"
on public.customer_line_links for insert to authenticated
with check (exists (
  select 1 from public.manager_profiles
  where id=(select auth.uid()) and is_active and role in ('admin','staff')
));

create policy "Active managers can update customer line links"
on public.customer_line_links for update to authenticated
using (exists (
  select 1 from public.manager_profiles
  where id=(select auth.uid()) and is_active and role in ('admin','staff')
))
with check (exists (
  select 1 from public.manager_profiles
  where id=(select auth.uid()) and is_active and role in ('admin','staff')
));

create policy "Active managers can delete customer line links"
on public.customer_line_links for delete to authenticated
using (exists (
  select 1 from public.manager_profiles
  where id=(select auth.uid()) and is_active and role in ('admin','staff')
));

drop trigger if exists customer_line_links_set_updated_at on public.customer_line_links;
create trigger customer_line_links_set_updated_at
before update on public.customer_line_links
for each row execute function public.set_manager_updated_at();
