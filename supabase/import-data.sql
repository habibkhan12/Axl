-- ============================================================
-- IMPORT: Data.xlsx (vehicles + utility accounts)
-- Run ONCE in Supabase SQL Editor.
-- Vehicles go into public.vehicles (with new registry columns);
-- utilities go into public.dues_accounts so the Dues & fines
-- page monitors them immediately.
-- ============================================================

-- ── 1. Extend the vehicle registry (idempotent) ────────────────────────────
alter table public.vehicles
  add column if not exists tc_number text,
  add column if not exists owner_name text,
  add column if not exists license_expiry date,
  add column if not exists insurance_expiry date,
  add column if not exists salik_mobile text,
  add column if not exists salik_account text,
  add column if not exists salik_tag text,
  add column if not exists salik_code text;

-- ── 2. Vehicles (11 from the sheet) ────────────────────────────────────────
-- License/insurance expiry dates decoded from Excel serials (1900 date system).
insert into public.vehicles (id, label, plate, tc_number, owner_name, license_expiry, insurance_expiry) values
  ('veh_01', 'Nissan Rogue 2017',         '85636 A AJM', '4070054504', 'Abdul Hannan Khan',                              '2027-06-17', '2027-07-17'),
  ('veh_02', 'Honda Accord 2013',         '90615 C AJM', '4080036902', 'Abdur Rahim Khan',                               '2026-09-16', '2026-10-16'),
  ('veh_03', 'Nissan Pathfinder 2016',    '50393 G DXB', '17042305',   'Farhad Khan',                                    '2026-09-12', '2026-10-12'),
  ('veh_04', 'BMW',                       '87164 C AJM', null,         'Farhad Khan',                                     null,         null),
  ('veh_05', 'Honda Civic 2008',          '62960 A AJM', '4190004445', 'Jubair',                                         '2027-09-21', '2027-10-21'),
  ('veh_06', 'Honda Accord 2013 (Ajman)', '64357 C AJM', '4130039205', 'Farhad Khan',                                    '2027-08-09', '2027-09-09'),
  ('veh_07', 'Honda Civic 2007',          '64206 C AJM', null,         'Johirul Islam',                                  '2027-08-12', '2027-09-12'),
  ('veh_08', 'Toyota Avanza 2017',        '29125 A AJM', null,         'Al Yasmeen Steel',                               '2027-06-08', '2027-07-08'),
  ('veh_09', 'Nissan Pickup 2003',        '36975 A AJM', '4070069399', 'Al Yasmeen Steel & Aluminium & Glass Works LLC', '2026-10-29', '2026-11-29'),
  ('veh_10', 'Mitsubishi Canter 2017',    '75011 A AJM', '4200026918', 'Al Taqwa Building Material Trading L.L.C',       '2027-02-01', '2027-03-01'),
  ('veh_11', 'Nissan MT 2008',            '73516 B AJM', null,         'Al Taqwa Building Material Trading L.L.C',       '2027-02-04', '2027-03-04')
on conflict (id) do nothing;

-- Salik registrations from the sheet (mobile / account / tag where given).
update public.vehicles set salik_mobile = '506863454' where id = 'veh_09'; -- 36975 A
update public.vehicles set salik_mobile = '506863454', salik_account = '34146905' where id = 'veh_08'; -- 29125 A
update public.vehicles set salik_mobile = '544498659' where id = 'veh_10'; -- 75011 A
update public.vehicles set salik_mobile = '501703820', salik_tag = '13114754', salik_code = '6016' where id = 'veh_02'; -- 90615 C
update public.vehicles set salik_account = '34146905', salik_tag = '13949823', salik_code = '8755' where id = 'veh_03'; -- 64357 C
update public.vehicles set salik_account = '34146905', salik_tag = '13949823', salik_code = '8242' where id = 'veh_04'; -- 64206 C

-- ── 3. Utility accounts → Dues & fines monitoring ─────────────────────────
-- ids are uuid, so they are auto-generated; (provider_key, label) is unique
-- so this script can be re-run safely without duplicating rows.
create unique index if not exists dues_accounts_provider_label_uq
  on public.dues_accounts (provider_key, label);

insert into public.dues_accounts (provider_key, label, fields, active) values
  -- Etihad Water & Electricity (E & W)
  ('etihad_we',      'Al Yasmeen Steel & Aluminium & Glass', '{"account_number": "220000056180"}'::jsonb, true),
  ('etihad_we',      'Camp - Al Yasmeen',                    '{"account_number": "101150022317"}'::jsonb, true),
  ('etihad_we',      'Al Taqwa Building Materials Branch 01','{"account_number": "221000634902"}'::jsonb, true),
  ('etihad_we',      'Habib - Villa 02',                     '{"account_number": "220000064817"}'::jsonb, true),
  ('etihad_we',      'Hannan - Villa 03',                    '{"account_number": "221000774580"}'::jsonb, true),
  ('etihad_we',      'Abdur Rahim - Villa 01',               '{"account_number": "221000751378"}'::jsonb, true),
  -- Ajman Sewerage
  ('ajman_sewerage', 'Al Yasmeen Steel & Aluminium & Glass', '{"account_number": "5380069820"}'::jsonb, true),
  ('ajman_sewerage', 'Camp - Al Yasmeen',                    '{"account_number": "179947526"}'::jsonb, true),
  ('ajman_sewerage', 'Al Taqwa Building Materials Branch 01','{"account_number": "3960258361"}'::jsonb, true),
  ('ajman_sewerage', 'Habib - Villa 02',                     '{"account_number": "6918773665"}'::jsonb, true),
  ('ajman_sewerage', 'Hannan - Villa 03',                    '{"account_number": "3058236192"}'::jsonb, true),
  ('ajman_sewerage', 'Abdur Rahim - Villa 01',               '{"account_number": "9823209070"}'::jsonb, true),
  -- du (mobile/account 6288828 — 7-digit, confirm with du which line this is)
  ('du',             'Du — account 6288828',                 '{"account_number": "6288828"}'::jsonb, true)
on conflict (provider_key, label) do nothing;

-- ── 4. Per-vehicle Salik & Dubai Police monitoring ────────────────────────
-- These drive the automation: Salik balance checks use plate + registered
-- mobile; Dubai Police fines checks use the traffic code (TC) number.
insert into public.dues_accounts (provider_key, label, fields, active) values
  -- Salik (only rows with a registered mobile can be balance-checked)
  ('salik', 'Salik — 36975 A (Nissan Pickup 2003)',       '{"plate_emirate": "Ajman", "plate_code": "A", "plate_number": "36975", "registered_mobile": "506863454"}'::jsonb, true),
  ('salik', 'Salik — 29125 A (Toyota Avanza 2017)',       '{"plate_emirate": "Ajman", "plate_code": "A", "plate_number": "29125", "registered_mobile": "506863454"}'::jsonb, true),
  ('salik', 'Salik — 75011 A (Mitsubishi Canter 2017)',   '{"plate_emirate": "Ajman", "plate_code": "A", "plate_number": "75011", "registered_mobile": "544498659"}'::jsonb, true),
  ('salik', 'Salik — 90615 C (Honda Accord 2013)',        '{"plate_emirate": "Ajman", "plate_code": "C", "plate_number": "90615", "registered_mobile": "501703820"}'::jsonb, true),
  -- Dubai Police fines by traffic code
  ('dubai_police', 'Dubai Police — 85636 A AJM (Nissan Rogue 2017)',       '{"tc_number": "4070054504", "plate_number": "85636"}'::jsonb, true),
  ('dubai_police', 'Dubai Police — 90615 C AJM (Honda Accord 2013)',       '{"tc_number": "4080036902", "plate_number": "90615"}'::jsonb, true),
  ('dubai_police', 'Dubai Police — 50393 G DXB (Nissan Pathfinder 2016)',  '{"tc_number": "17042305", "plate_number": "50393"}'::jsonb, true),
  ('dubai_police', 'Dubai Police — 62960 A AJM (Honda Civic 2008)',        '{"tc_number": "4190004445", "plate_number": "62960"}'::jsonb, true),
  ('dubai_police', 'Dubai Police — 64357 C AJM (Honda Accord 2013 Ajman)', '{"tc_number": "4130039205", "plate_number": "64357"}'::jsonb, true),
  ('dubai_police', 'Dubai Police — 36975 A AJM (Nissan Pickup 2003)',      '{"tc_number": "4070069399", "plate_number": "36975"}'::jsonb, true),
  ('dubai_police', 'Dubai Police — 75011 A AJM (Mitsubishi Canter 2017)',  '{"tc_number": "4200026918", "plate_number": "75011"}'::jsonb, true)
on conflict (provider_key, label) do nothing;
