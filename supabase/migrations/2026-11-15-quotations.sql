-- ============================================================
-- AXL BOOKS — migration: quotations (projects)
-- Adds the quotes behind the Quotations tab and the link from
-- income/expense entries back to the quote they belong to.
--
-- Safe to run more than once. Additive only.
-- Apply in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- ============================================================

create table if not exists public.quotes (
  id text primary key,
  quote_no text not null,
  -- Client party id (public.parties). Kept unconstrained like transactions.party_id.
  client_id text,
  amount numeric not null check (amount >= 0),
  -- review | approved | completed | rejected
  status text not null default 'review' check (status in ('review','approved','completed','rejected')),
  quote_date date,
  notes text,
  created_at timestamptz not null default now()
);

-- Two quotes may not share a number (case-insensitive).
create unique index if not exists quotes_no_key on public.quotes (lower(quote_no));
create index if not exists quotes_status_idx on public.quotes (status);

-- Entries point at the quote (project) they belong to.
alter table public.transactions add column if not exists quote_id text;
create index if not exists transactions_quote_idx on public.transactions (quote_id);

alter table public.quotes enable row level security;

drop policy if exists quotes_read on public.quotes;
create policy quotes_read on public.quotes
  for select to authenticated using (true);

drop policy if exists quotes_write on public.quotes;
create policy quotes_write on public.quotes
  for all to authenticated
  using (public.my_role() in ('owner','editor'))
  with check (public.my_role() in ('owner','editor'));

-- Verify
-- select quote_no, status, amount from public.quotes order by quote_no;
-- select count(*) from public.transactions where quote_id is not null;
