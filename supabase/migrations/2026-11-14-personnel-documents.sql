-- ============================================================
-- AXL BOOKS — migration: personnel & document storage
-- Adds the staff records behind the Personnel tab, their documents, and the
-- private storage bucket that holds the uploaded files.
--
-- Safe to run more than once. Additive only — it does not touch existing rows.
-- Apply in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- ============================================================

-- 1. PEOPLE
create table if not exists public.staff (
  id text primary key,
  name text not null,
  phone text,
  notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

-- 2. THEIR DOCUMENTS
create table if not exists public.staff_documents (
  id text primary key,
  staff_id text not null references public.staff(id) on delete cascade,
  name text not null,
  expiry_date date,
  -- Object path inside the staff-documents bucket (cloud mode).
  file_path text,
  file_name text,
  file_type text,
  file_size bigint,
  -- Local-browser mode only; cloud rows always use file_path.
  file_data text,
  created_at timestamptz not null default now()
);

create index if not exists staff_documents_staff_idx on public.staff_documents (staff_id);
create index if not exists staff_documents_expiry_idx on public.staff_documents (expiry_date);

-- 3. ROW LEVEL SECURITY
alter table public.staff enable row level security;
alter table public.staff_documents enable row level security;

drop policy if exists staff_read on public.staff;
create policy staff_read on public.staff
  for select to authenticated using (true);
drop policy if exists staff_write on public.staff;
create policy staff_write on public.staff
  for all to authenticated
  using (public.my_role() in ('owner','editor'))
  with check (public.my_role() in ('owner','editor'));

drop policy if exists staff_docs_read on public.staff_documents;
create policy staff_docs_read on public.staff_documents
  for select to authenticated using (true);
drop policy if exists staff_docs_write on public.staff_documents;
create policy staff_docs_write on public.staff_documents
  for all to authenticated
  using (public.my_role() in ('owner','editor'))
  with check (public.my_role() in ('owner','editor'));

-- 4. PRIVATE STORAGE BUCKET FOR THE FILES
insert into storage.buckets (id, name, public)
values ('staff-documents', 'staff-documents', false)
on conflict (id) do nothing;

drop policy if exists staff_files_read on storage.objects;
create policy staff_files_read on storage.objects
  for select to authenticated
  using (bucket_id = 'staff-documents');

drop policy if exists staff_files_insert on storage.objects;
create policy staff_files_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'staff-documents' and public.my_role() in ('owner','editor'));

drop policy if exists staff_files_update on storage.objects;
create policy staff_files_update on storage.objects
  for update to authenticated
  using (bucket_id = 'staff-documents' and public.my_role() in ('owner','editor'))
  with check (bucket_id = 'staff-documents' and public.my_role() in ('owner','editor'));

drop policy if exists staff_files_delete on storage.objects;
create policy staff_files_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'staff-documents' and public.my_role() in ('owner','editor'));

-- Verify
-- select count(*) from public.staff;
-- select id, name, expiry_date, file_path from public.staff_documents order by expiry_date nulls last;
-- select id, public from storage.buckets where id = 'staff-documents';  -- public must be false
