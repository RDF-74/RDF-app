create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

create table if not exists public.manager_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  enabled boolean not null default true,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists manager_push_subscriptions_user_idx
  on public.manager_push_subscriptions(user_id, enabled);

alter table public.manager_push_subscriptions enable row level security;
revoke all on table public.manager_push_subscriptions from anon, authenticated;
grant select, insert, update, delete on table public.manager_push_subscriptions to service_role;

create table if not exists public.manager_notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stock_enabled boolean not null default true,
  purchase_reminder_enabled boolean not null default true,
  purchase_reminder_days integer not null default 3
    check (purchase_reminder_days between 1 and 30),
  updated_at timestamptz not null default now()
);

alter table public.manager_notification_preferences enable row level security;
revoke all on table public.manager_notification_preferences from anon, authenticated;
grant select, insert, update on table public.manager_notification_preferences to authenticated;
grant select, insert, update, delete on table public.manager_notification_preferences to service_role;

drop policy if exists "Manager users manage own notification preferences"
  on public.manager_notification_preferences;
create policy "Manager users manage own notification preferences"
  on public.manager_notification_preferences
  for all
  to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.manager_profiles
      where id = (select auth.uid())
        and is_active
        and role in ('admin','staff')
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.manager_profiles
      where id = (select auth.uid())
        and is_active
        and role in ('admin','staff')
    )
  );

create table if not exists public.manager_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_date date not null,
  kind text not null,
  status text not null default 'sent',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, notification_date, kind)
);

alter table public.manager_notification_deliveries enable row level security;
revoke all on table public.manager_notification_deliveries from anon, authenticated;
grant select, insert, update, delete on table public.manager_notification_deliveries to service_role;

grant select on table public.manager_profiles to service_role;
grant select on table public.recordare_chemicals to service_role;
grant select on table public.chemical_purchase_orders to service_role;
grant select on table public.chemical_catalog_products to service_role;

create or replace function public.get_manager_notification_secret(p_name text)
returns text
language sql
security definer
set search_path = public, vault, pg_temp
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = p_name
  order by created_at desc
  limit 1;
$$;

revoke all on function public.get_manager_notification_secret(text) from public, anon, authenticated;
grant execute on function public.get_manager_notification_secret(text) to service_role;
