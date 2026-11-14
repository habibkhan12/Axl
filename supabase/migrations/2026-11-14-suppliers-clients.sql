-- ============================================================
-- AXL BOOKS — migration: suppliers & clients
-- Adds the public.parties table used by the Suppliers and Clients tabs.
--
-- Safe to run more than once. Additive only — it does not touch existing rows.
-- Apply in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- ============================================================

create table if not exists public.parties (
  id text primary key,
  kind text not null check (kind in ('supplier','client')),
  name text not null,
  phone text,
  email text,
  notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists parties_kind_name_idx on public.parties (kind, name);

-- Each transaction keeps a pointer to its supplier/client. The column already
-- exists on newer installs; keep this here so older databases get it too.
alter table public.transactions add column if not exists party_id text;

alter table public.parties enable row level security;

drop policy if exists party_read on public.parties;
create policy party_read on public.parties
  for select to authenticated using (true);

drop policy if exists party_write on public.parties;
create policy party_write on public.parties
  for all to authenticated
  using (public.my_role() in ('owner','editor'))
  with check (public.my_role() in ('owner','editor'));

-- Verify: should return one row with kind = 'supplier' and one with 'client' after use.
-- select kind, count(*) from public.parties group by kind;
