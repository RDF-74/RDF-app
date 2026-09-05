-- Phase 1: RE:CORDARE Manager の管理者プロフィール最小構造
-- Supabase SQL Editor で実行後、認証済みユーザーの UUID を使って管理者行を1件作成してください。
create table if not exists public.manager_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('admin', 'staff')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.manager_profiles enable row level security;

create policy "Manager users can read their own profile"
  on public.manager_profiles for select to authenticated
  using ((select auth.uid()) = id);

-- 管理者作成例（<AUTH_USER_UUID> は Supabase Auth のユーザーIDに置換）
-- insert into public.manager_profiles (id, display_name, role, is_active)
-- values ('<AUTH_USER_UUID>', '管理者', 'admin', true);
