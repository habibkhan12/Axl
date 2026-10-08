-- ============================================================
-- AXL BOOKS — Supabase schema
-- Run this ONCE in the Supabase dashboard:
-- SQL Editor → New query → paste all → Run
--
-- Account management (create staff / change roles / reset passwords)
-- is handled by the app's server routes using the service_role key —
-- no auth-table SQL lives here.
-- ============================================================

-- 1. PROFILES (mirrors auth.users 1:1)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  role text not null default 'viewer' check (role in ('owner','editor','viewer')),
  tab_access jsonb,
  created_at timestamptz not null default now()
);

-- Migration (run once if the table already exists from an older schema):
-- alter table public.profiles add column if not exists tab_access jsonb;

-- 2. APP SETTINGS (single row)
create table if not exists public.app_settings (
  id int primary key default 1 check (id = 1),
  monthly_income_target numeric not null default 0,
  monthly_profit_target numeric not null default 0,
  monthly_expense_target numeric not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id, monthly_income_target)
values (1, 163350) on conflict (id) do nothing;

-- Migration (run once if the table already exists from an older schema):
-- alter table public.app_settings
--   add column if not exists monthly_profit_target numeric not null default 0,
--   add column if not exists monthly_expense_target numeric not null default 0;

-- 3. REFERENCE DATA
create table if not exists public.categories (
  id text primary key,
  name text not null,
  kind text not null check (kind in ('income','expense')),
  archived boolean not null default false
);

create table if not exists public.vehicles (
  id text primary key,
  label text not null,
  plate text not null default '—',
  is_company boolean not null default false,
  archived boolean not null default false
);

create table if not exists public.payment_methods (
  id text primary key,
  name text not null,
  archived boolean not null default false
);

-- 4. TRANSACTIONS
create table if not exists public.transactions (
  id text primary key,
  kind text not null check (kind in ('income','expense')),
  txn_date date not null,
  amount numeric not null check (amount > 0),
  party_id text,
  category_id text references public.categories(id),
  payment_method_id text references public.payment_methods(id),
  vehicle_id text,
  fuel_liters numeric,
  job_ref text,
  voucher_no text,
  description text,
  notes text,
  receipt_url text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_txn_date on public.transactions (txn_date);
create index if not exists idx_txn_kind on public.transactions (kind);

-- ============================================================
-- HELPERS
-- ============================================================
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.has_any_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles);
$$;

-- Self-healing: creates a profile for the caller if missing.
-- The first profile ever created becomes the owner (bootstrap).
create or replace function public.ensure_my_profile(p_name text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_role text;
  v_id uuid := auth.uid();
begin
  if v_id is null then
    raise exception 'not authenticated';
  end if;

  insert into public.profiles (id, name, role)
  values (
    v_id,
    coalesce(p_name, split_part(coalesce((select email from auth.users where id = v_id), 'user'), '@', 1)),
    case when not exists (select 1 from public.profiles) then 'owner' else 'viewer' end
  )
  on conflict (id) do update set name = coalesce(nullif(excluded.name, ''), profiles.name);

  select role into v_role from public.profiles where id = v_id;
  return v_role;
end;
$$;

-- Trigger: new auth user -> empty profile (role upgraded by bootstrap)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(coalesce(new.email, 'user'), '@', 1)),
    'viewer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.categories enable row level security;
alter table public.vehicles enable row level security;
alter table public.payment_methods enable row level security;
alter table public.transactions enable row level security;

-- Profiles: users see the team; only owner edits
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated using (true);

-- Users may edit their own profile but NOT their own role
-- (my_role() reads the pre-update row, so this locks the current role in place)
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = public.my_role());

-- Bootstrap: when NO user exists yet, the first person to sign up claims owner
drop policy if exists profiles_bootstrap on public.profiles;
create policy profiles_bootstrap on public.profiles
  for update to authenticated
  using (not public.has_any_user()) with check (not public.has_any_user() and role = 'owner');

-- App settings: everyone reads; only owner writes
drop policy if exists settings_read on public.app_settings;
create policy settings_read on public.app_settings
  for select to authenticated using (true);

drop policy if exists settings_write on public.app_settings;
create policy settings_write on public.app_settings
  for all to authenticated
  using (public.my_role() = 'owner') with check (public.my_role() = 'owner');

-- Reference data: everyone reads; owner/editor write
drop policy if exists ref_read on public.categories;
create policy ref_read on public.categories for select to authenticated using (true);
drop policy if exists ref_write on public.categories;
create policy ref_write on public.categories for all to authenticated
  using (public.my_role() in ('owner','editor')) with check (public.my_role() in ('owner','editor'));

drop policy if exists veh_read on public.vehicles;
create policy veh_read on public.vehicles for select to authenticated using (true);
drop policy if exists veh_write on public.vehicles;
create policy veh_write on public.vehicles for all to authenticated
  using (public.my_role() in ('owner','editor')) with check (public.my_role() in ('owner','editor'));

drop policy if exists pm_read on public.payment_methods;
create policy pm_read on public.payment_methods for select to authenticated using (true);
drop policy if exists pm_write on public.payment_methods;
create policy pm_write on public.payment_methods for all to authenticated
  using (public.my_role() in ('owner','editor')) with check (public.my_role() in ('owner','editor'));

-- Transactions: everyone reads; owner/editor write; viewer is read-only at DB level
drop policy if exists txn_read on public.transactions;
create policy txn_read on public.transactions for select to authenticated using (true);

drop policy if exists txn_insert on public.transactions;
create policy txn_insert on public.transactions for insert to authenticated
  with check (public.my_role() in ('owner','editor'));

drop policy if exists txn_update on public.transactions;
create policy txn_update on public.transactions for update to authenticated
  using (public.my_role() in ('owner','editor'))
  with check (public.my_role() in ('owner','editor'));

drop policy if exists txn_delete on public.transactions;
create policy txn_delete on public.transactions for delete to authenticated
  using (public.my_role() in ('owner','editor'));

-- ============================================================
-- SEED REFERENCE DATA (from the Sep 2026 workbook)
-- ============================================================
insert into public.categories (id, name, kind, archived) values
  ('c_materials','Materials','expense',false),
  ('c_fuel','Fuel','expense',false),
  ('c_manpower','Man Power','expense',false),
  ('c_utilities','Utilities','expense',false),
  ('c_vehicles','Vehicles','expense',false),
  ('c_villa1','Villa 01','expense',false),
  ('c_villa2','Villa 02','expense',false),
  ('c_villa3','Villa 03','expense',false),
  ('c_personal','Personal','expense',false),
  ('c_charity','Charity','expense',false),
  ('c_stationary','Stationary','expense',false),
  ('c_grocery','Grocery','expense',false),
  ('c_publicity','Publicity','expense',false),
  ('c_ministry','Ministry','expense',false),
  ('c_general','General Income','income',false)
on conflict (id) do nothing;

insert into public.vehicles (id, label, plate, is_company, archived) values
  ('v_rogue','Rogue','85636 A AJM',false,false),
  ('v_accord_silver','Accord Silver','90615 C AJM',false,false),
  ('v_accord_blue','Accord Blue','64357 C AJM',false,false),
  ('v_pathfinder','Pathfinder','50393 G DXB',false,false),
  ('v_avanza','Avanza','29125 A AJM',false,false),
  ('v_75011','Hilux 75011','75011 A AJM',false,false),
  ('v_73516','Pickup 73516','73516 B AJM',false,false),
  ('v_36975','Sedan 36975','36975 A',false,false),
  ('v_civic','Civic White','64206 C AJM',false,false),
  ('v_bmw','BMW','87164',false,false),
  ('v_company','Company','—',true,false)
on conflict (id) do nothing;

insert into public.payment_methods (id, name, archived) values
  ('pm_adcb','ADCB',false),
  ('pm_cash','CASH',false),
  ('pm_pos','POS',false),
  ('pm_janata','Janata',false),
  ('pm_cheque','Cheque',false)
on conflict (id) do nothing;

-- ============================================================
-- 9. DUES & FINES MONITORING
-- Monitored accounts on external UAE portals (Salik, Dubai Police,
-- du, e&, EtihadWE, Ajman Sewerage, EVG) + checker-run history.
-- The provider catalog itself lives in code (lib/dues-providers.ts).
-- ============================================================
create table if not exists public.dues_accounts (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null,
  label text not null,
  fields jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dues_checks (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.dues_accounts(id) on delete cascade,
  checked_at timestamptz not null default now(),
  status text not null check (status in ('ok','manual','error')),
  amount_due numeric,
  message text,
  extra jsonb
);

create index if not exists dues_checks_account_idx on public.dues_checks (account_id, checked_at desc);

alter table public.dues_accounts enable row level security;
alter table public.dues_checks enable row level security;

-- Reads: any signed-in user (page-level visibility is enforced per-tab by the app).
-- Writes: service-role API routes only (bypass RLS) — no client-write policies.
create policy "dues_accounts_read_all" on public.dues_accounts
  for select to authenticated using (true);
create policy "dues_checks_read_all" on public.dues_checks
  for select to authenticated using (true);

-- Migration (run once for existing installs): extended vehicle registry fields
alter table public.vehicles
  add column if not exists tc_number text,
  add column if not exists owner_name text,
  add column if not exists license_expiry date,
  add column if not exists insurance_expiry date;
