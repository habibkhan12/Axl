/**
 * Build supabase/production-preload.sql:
 *   1) wipe all DATA tables (keeps auth.users, profiles, app_settings)
 *   2) preload categories, vehicles (full registry + Salik), payment methods,
 *      transactions (Sep + Oct 2026) and the 24 dues accounts.
 * Run: node scripts/build-preload.mjs
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const XLSX = createRequire(import.meta.url)("xlsx");

const OCT = "C:/Users/OK/Downloads/Inc & Exp Oct 2026.xlsx";
const SEP = "C:/Users/OK/Downloads/Income___Expense__Sep_2026_-_Dashboard.xlsx";

const q = (v) => v == null ? "null" : "'" + String(v).replace(/'/g, "''") + "'";
const money = (v) => (Math.round(Number(v) * 100) / 100).toFixed(2);

/** Excel stores UAE midnight as 23:59:48 UAE = T19:59:48Z — local date = UTC date + 1 day. */
function localDate(iso) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function sheet(file, name) {
  const wb = XLSX.readFile(file, { cellDates: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null, raw: true });
}

/* ── Reference data ──────────────────────────────────────────────────────── */

const CATEGORIES = [
  ["c_materials", "Materials", "expense"],
  ["c_fuel", "Fuel", "expense"],
  ["c_manpower", "Man Power", "expense"],
  ["c_utilities", "Utilities", "expense"],
  ["c_vehicles", "Vehicles", "expense"],
  ["c_villa1", "Villa 01", "expense"],
  ["c_villa2", "Villa 02", "expense"],
  ["c_villa3", "Villa 03", "expense"],
  ["c_personal", "Personal", "expense"],
  ["c_charity", "Charity", "expense"],
  ["c_stationary", "Stationary", "expense"],
  ["c_grocery", "Grocery", "expense"],
  ["c_publicity", "Publicity", "expense"],
  ["c_ministry", "Ministry", "expense"],
  ["c_general", "General Income", "income"],
];
const catOf = (t) => {
  const key = (t ?? "").trim().toLowerCase().replace(/\s+/g, "");
  const map = {
    materials: "c_materials", fuel: "c_fuel", manpower: "c_manpower",
    utilities: "c_utilities", vehicles: "c_vehicles", villa01: "c_villa1",
    villa02: "c_villa2", villa03: "c_villa3", personal: "c_personal",
    charity: "c_charity", stationary: "c_stationary", grocery: "c_grocery",
    publicity: "c_publicity", ministry: "c_ministry",
  };
  return map[key] ?? null; // null → Personal (flagged for review)
};
const unclassified = catOf("") ?? "c_personal";

const METHODS = ["ADCB", "CASH", "POS", "Janata", "Cheque"];
/** Returns the payment_methods *id* (pm_*) — the column is an FK to that table. */
const methodOf = (m) => {
  const key = (m ?? "").trim().toUpperCase();
  const hit = METHODS.find((x) => x.toUpperCase() === key) ?? "CASH";
  return "pm_" + hit.toLowerCase();
};

/* ── Vehicles (from Data (1).xlsx, with corrected Salik mapping) ─────────── */

const VEHICLES = [
  // id, label, plate, tc, owner, lic, ins, salik_mobile, salik_account, salik_tag, salik_code
  ["veh_01", "Nissan Rogue 2017", "85636 A AJM", "4070054504", "Abdul Hannan Khan", "2027-06-17", "2027-07-17", null, null, null, null],
  ["veh_02", "Honda Accord 2013", "90615 C AJM", "4080036902", "Abdur Rahim Khan", "2026-09-16", "2026-10-16", "501703820", null, "13114754", "6016"],
  ["veh_03", "Nissan Pathfinder 2016", "50393 G DXB", "17042305", "Farhad Khan", "2026-09-12", "2026-10-12", null, null, null, null],
  ["veh_04", "BMW", "87164 C AJM", null, "Farhad Khan", null, null, null, null, null, null],
  ["veh_05", "Honda Civic 2008", "62960 A AJM", "4190004445", "Jubair", "2027-09-21", "2027-10-21", null, null, null, null],
  ["veh_06", "Honda Accord 2013 (Ajman)", "64357 C AJM", "4130039205", "Farhad Khan", "2027-08-09", "2027-09-09", null, "34146905", "13949823", "8755"],
  ["veh_07", "Honda Civic 2007", "64206 C AJM", null, "Johirul Islam", "2027-08-12", "2027-09-12", null, "34146905", "13949823", "8242"],
  ["veh_08", "Toyota Avanza 2017", "29125 A AJM", null, "Al Yasmeen Steel", "2027-06-08", "2027-07-08", "506863454", "34146905", null, null],
  ["veh_09", "Nissan Pickup 2003", "36975 A AJM", "4070069399", "Al Yasmeen Steel & Aluminium & Glass Works LLC", "2026-10-29", "2026-11-29", "506863454", null, null, null],
  ["veh_10", "Mitsubishi Canter 2017", "75011 A AJM", "4200026918", "Al Taqwa Building Material Trading L.L.C", "2027-02-01", "2027-03-01", "544498659", null, null, null],
  ["veh_11", "Nissan MT 2008", "73516 B AJM", null, "Al Taqwa Building Material Trading L.L.C", "2027-02-04", "2027-03-04", null, null, null, null],
  ["veh_company", "Company (shared)", "—", null, null, null, null, null, null, null, null],
];
const COMPANY_ID = "veh_company";
// plate → vehicle id (also accept bare number, e.g. "BMW 87164")
const PLATES = VEHICLES.map((v) => [v[2], v[0]]);
const PLATE_NUMS = VEHICLES.map((v) => [v[2].split(/\s+/)[0], v[0]]);

function vehicleOf(desc) {
  const d = String(desc ?? "").trim();
  if (!d) return null;
  if (/^company$/i.test(d)) return COMPANY_ID; // shared-vehicle fuel rows
  for (const [plate, id] of PLATES) if (d.toUpperCase().startsWith(plate.toUpperCase())) return id;
  for (const [num, id] of PLATE_NUMS) {
    const re = new RegExp("(^|[^0-9])" + num + "([^0-9]|$)", "i");
    if (re.test(d) && d.length - num.length < 40) return id;
  }
  return null;
}

/* ── Dues accounts (24, matching the live Dues & fines tab) ─────────────── */

const DUES = [
  ["etihad_we", "Al Yasmeen Steel & Aluminium & Glass", { account_number: "220000056180" }],
  ["etihad_we", "Camp - Al Yasmeen", { account_number: "101150022317" }],
  ["etihad_we", "Al Taqwa Building Materials Branch 01", { account_number: "221000634902" }],
  ["etihad_we", "Habib - Villa 02", { account_number: "220000064817" }],
  ["etihad_we", "Hannan - Villa 03", { account_number: "221000774580" }],
  ["etihad_we", "Abdur Rahim - Villa 01", { account_number: "221000751378" }],
  ["ajman_sewerage", "Al Yasmeen Steel & Aluminium & Glass", { account_number: "5380069820" }],
  ["ajman_sewerage", "Camp - Al Yasmeen", { account_number: "179947526" }],
  ["ajman_sewerage", "Al Taqwa Building Materials Branch 01", { account_number: "3960258361" }],
  ["ajman_sewerage", "Habib - Villa 02", { account_number: "6918773665" }],
  ["ajman_sewerage", "Hannan - Villa 03", { account_number: "3058236192" }],
  ["ajman_sewerage", "Abdur Rahim - Villa 01", { account_number: "9823209070" }],
  ["du", "Du — account 6288828", { account_number: "6288828" }],
  ["salik", "Salik — 36975 A (Nissan Pickup 2003)", { plate_emirate: "Ajman", plate_code: "A", plate_number: "36975", registered_mobile: "506863454" }],
  ["salik", "Salik — 29125 A (Toyota Avanza 2017)", { plate_emirate: "Ajman", plate_code: "A", plate_number: "29125", registered_mobile: "506863454" }],
  ["salik", "Salik — 75011 A (Mitsubishi Canter 2017)", { plate_emirate: "Ajman", plate_code: "A", plate_number: "75011", registered_mobile: "544498659" }],
  ["salik", "Salik — 90615 C (Honda Accord 2013)", { plate_emirate: "Ajman", plate_code: "C", plate_number: "90615", registered_mobile: "501703820" }],
  ["dubai_police", "Dubai Police — 85636 A AJM (Nissan Rogue 2017)", { tc_number: "4070054504", plate_number: "85636" }],
  ["dubai_police", "Dubai Police — 90615 C AJM (Honda Accord 2013)", { tc_number: "4080036902", plate_number: "90615" }],
  ["dubai_police", "Dubai Police — 50393 G DXB (Nissan Pathfinder 2016)", { tc_number: "17042305", plate_number: "50393" }],
  ["dubai_police", "Dubai Police — 62960 A AJM (Honda Civic 2008)", { tc_number: "4190004445", plate_number: "62960" }],
  ["dubai_police", "Dubai Police — 64357 C AJM (Honda Accord 2013 Ajman)", { tc_number: "4130039205", plate_number: "64357" }],
  ["dubai_police", "Dubai Police — 36975 A AJM (Nissan Pickup 2003)", { tc_number: "4070069399", plate_number: "36975" }],
  ["dubai_police", "Dubai Police — 75011 A AJM (Mitsubishi Canter 2017)", { tc_number: "4200026918", plate_number: "75011" }],
];

/* ── Transactions ────────────────────────────────────────────────────────── */

const txns = [];
const review = [];
let n = 0;
const nextId = () => "t_p" + String(++n).padStart(5, "0");

function jobRefSplit(desc) {
  const m = String(desc ?? "").match(/^(AY\s*\d{3,6})\s*(.*)$/i);
  if (m) return [m[1].toUpperCase().replace(/\s+/g, ""), m[2].replace(/^\((.*)\)$/, "$1").trim() || m[1].toUpperCase()];
  return [null, (desc ?? "").trim()];
}

function addInc(rows, month) {
  for (const r of rows) {
    if (!r.Date || r.Amount == null) continue; // total rows
    if (Number(r.Amount) <= 0) {
      review.push({ month, sl: r["Sl.No"], supplier: r.Client, desc: r.Decription, note: "0/negative amount — placeholder row skipped" });
      continue;
    }
    const [jobRef, desc] = jobRefSplit(r.Decription);
    const notes = [];
    if (r.Client != null && String(r.Client).trim()) notes.push("Client: " + String(r.Client).trim());
    if (r.Collected != null && String(r.Collected).trim()) notes.push("Collected by " + String(r.Collected).trim());
    if (r.__EMPTY != null && String(r.__EMPTY).trim()) notes.push("Via: " + String(r.__EMPTY).trim());
    txns.push({
      id: nextId(), kind: "income", txn_date: localDate(r.Date), amount: money(r.Amount),
      category_id: "c_general", payment_method_id: methodOf(r.MOP), vehicle_id: null,
      job_ref: jobRef, voucher_no: r["Invoice/ Receipt Voucher"] != null ? String(r["Invoice/ Receipt Voucher"]) : null,
      description: desc || jobRef || month + " income", notes: notes.join(" · ") || null,
    });
  }
}

function addExp(rows, month) {
  for (const r of rows) {
    if (!r.Date) continue; // total rows
    if (r.Amount != null && Number(r.Amount) <= 0) {
      review.push({ month, sl: r["Sl. No."], supplier: r.Supplier, desc: r.Decription, note: "0/negative amount — placeholder row skipped" });
      continue;
    }
    if (r.Amount == null) {
      review.push({ month, sl: r["Sl. No."], supplier: r.Supplier, desc: r.Decription, remark: r.Remark });
      continue;
    }
    const type = (r.TYPE ?? "").trim();
    const categoryId = catOf(type) ?? unclassified;
    if (!type) review.push({ month, sl: r["Sl. No."], supplier: r.Supplier, desc: r.Decription, note: "no TYPE → Personal" });
    const descParts = [];
    if (r.Decription != null && String(r.Decription).trim()) descParts.push(String(r.Decription).trim());
    if (r.Remark != null && String(r.Remark).trim()) descParts.push(String(r.Remark).trim());
    const notes = [];
    if (r.Supplier != null && String(r.Supplier).trim()) notes.push("Supplier: " + String(r.Supplier).trim());
    const paidBy = (r["Paid By"] ?? "").trim();
    const method = methodOf(paidBy);
    if (paidBy && !METHODS.some((m) => m.toUpperCase() === paidBy.toUpperCase())) notes.push("Paid by " + paidBy);
    txns.push({
      id: nextId(), kind: "expense", txn_date: localDate(r.Date), amount: money(r.Amount),
      category_id: categoryId, payment_method_id: method, vehicle_id: vehicleOf(r.Decription),
      job_ref: null, voucher_no: r["Invoice/ Receipt Voucher"] != null ? String(r["Invoice/ Receipt Voucher"]) : null,
      description: descParts.join(" — ") || String(r.Supplier ?? month + " expense"), notes: notes.join(" · ") || null,
    });
  }
}

addInc(sheet(SEP, "Inc"), "September");
addInc(sheet(OCT, "Inc"), "October");
addExp(sheet(SEP, "Exp"), "September");
addExp(sheet(OCT, "Exp"), "October");
txns.sort((a, b) => (a.txn_date < b.txn_date ? -1 : a.txn_date > b.txn_date ? 1 : a.id < b.id ? -1 : 1));

/* ── Cross-check: Exp fuel rows vs Fuel Exp daily sheet ──────────────────── */
function fuelCheck(file, label) {
  const exp = sheet(file, "Exp").filter((r) => (r.TYPE ?? "").trim().toLowerCase() === "fuel" && r.Date && r.Amount != null);
  const fuel = sheet(file, "Fuel Exp").filter((r) => r["Column 1"] && Number(r.Total ?? 0) !== 0);
  const fuelSum = fuel.reduce((s, r) => s + Number(r.Total), 0);
  const expSum = exp.reduce((s, r) => s + Number(r.Amount), 0);
  console.log(`${label}: Exp fuel rows=${exp.length} sum=${expSum.toFixed(2)} | Fuel sheet sum=${fuelSum.toFixed(2)} | diff=${(expSum - fuelSum).toFixed(2)}`);
  const noVeh = exp.filter((r) => !vehicleOf(r.Decription));
  if (noVeh.length) console.log(`  ⚠ ${noVeh.length} fuel rows without a vehicle:`, noVeh.map((r) => JSON.stringify(r.Decription)).join(" | "));
}
fuelCheck(SEP, "SEP");
fuelCheck(OCT, "OCT");

/* ── Emit SQL ────────────────────────────────────────────────────────────── */

const L = [];
L.push(`-- ============================================================`);
L.push(`-- AXL BOOKS — PRODUCTION CLEANUP + PRELOAD`);
L.push(`-- Generated ${new Date().toISOString()} from the Sep/Oct 2026 workbooks`);
L.push(`-- + Data (1).xlsx (vehicle registry & dues accounts).`);
L.push(`--`);
L.push(`-- • Wipes ALL data tables (transactions, categories, vehicles,`);
L.push(`--   payment_methods, dues_accounts, dues_checks).`);
L.push(`-- • KEEPS auth.users, public.profiles (accounts) and app_settings.`);
L.push(`-- • Re-seeds reference data + ${txns.length} transactions + ${DUES.length} dues accounts.`);
L.push(`-- • Wrap: runs in one transaction — all or nothing.`);
L.push(`-- Run ONCE in Supabase SQL Editor.`);
L.push(`-- ============================================================`);
L.push(``);
L.push(`begin;`);
L.push(``);
L.push(`-- ── 1. CLEANUP (data only — accounts untouched) ───────────────────────────`);
L.push(`delete from public.dues_checks;`);
L.push(`delete from public.dues_accounts;`);
L.push(`delete from public.transactions;`);
L.push(`delete from public.categories;`);
L.push(`delete from public.vehicles;`);
L.push(`delete from public.payment_methods;`);
L.push(``);
L.push(`-- app_settings kept (targets are config, not data). Optional reset:`);
L.push(`-- update public.app_settings set monthly_income_target = 163350,`);
L.push(`--   monthly_profit_target = 0, monthly_expense_target = 0, updated_at = now() where id = 1;`);
L.push(``);
L.push(`-- ── 2. Vehicle registry columns (idempotent guard) ────────────────────────`);
L.push(`alter table public.vehicles`);
L.push(`  add column if not exists tc_number text,`);
L.push(`  add column if not exists owner_name text,`);
L.push(`  add column if not exists license_expiry date,`);
L.push(`  add column if not exists insurance_expiry date,`);
L.push(`  add column if not exists salik_mobile text,`);
L.push(`  add column if not exists salik_account text,`);
L.push(`  add column if not exists salik_tag text,`);
L.push(`  add column if not exists salik_code text;`);
L.push(``);
L.push(`-- ── 3. Reference data ─────────────────────────────────────────────────────`);
L.push(`insert into public.categories (id, name, kind, archived) values`);
L.push(CATEGORIES.map((c) => `  (${q(c[0])}, ${q(c[1])}, ${q(c[2])}, false)`).join(",\n") + ";");
L.push(``);
L.push(`insert into public.payment_methods (id, name, archived) values`);
L.push(METHODS.map((m, i) => `  (${q("pm_" + m.toLowerCase())}, ${q(m)}, false)`).join(",\n") + ";");
L.push(``);
L.push(`insert into public.vehicles (id, label, plate, is_company, tc_number, owner_name, license_expiry, insurance_expiry, salik_mobile, salik_account, salik_tag, salik_code) values`);
L.push(VEHICLES.map((v) => `  (${q(v[0])}, ${q(v[1])}, ${q(v[2])}, ${v[0] === COMPANY_ID ? "true" : "false"}, ${v.slice(3, 7).map(q).join(", ")}, ${v.slice(7).map(q).join(", ")})`).join(",\n") + ";");
L.push(``);
L.push(`-- ── 4. Transactions (Sep + Oct 2026) ─────────────────────────────────────`);
L.push(`insert into public.transactions (id, kind, txn_date, amount, category_id, payment_method_id, vehicle_id, fuel_liters, job_ref, voucher_no, description, notes, created_by) values`);
L.push(txns.map((t) => {
  const createdBy = `(select id from public.profiles where role = 'owner' order by created_at limit 1)`;
  return `  (${[q(t.id), q(t.kind), q(t.txn_date), t.amount, q(t.category_id), q(t.payment_method_id), t.vehicle_id ? q(t.vehicle_id) : "null", "null", q(t.job_ref), t.voucher_no ? q(t.voucher_no) : "null", q(t.description), t.notes ? q(t.notes) : "null", createdBy].join(", ")})`;
}).join(",\n") + ";");
L.push(``);
L.push(`-- ── 5. Dues & fines monitoring (24 accounts) ─────────────────────────────`);
L.push(`create unique index if not exists dues_accounts_provider_label_uq`);
L.push(`  on public.dues_accounts (provider_key, label);`);
L.push(``);
L.push(`insert into public.dues_accounts (provider_key, label, fields, active) values`);
L.push(DUES.map(([k, label, fields]) => `  (${q(k)}, ${q(label)}, ${q(JSON.stringify(fields))}::jsonb, true)`).join(",\n") + `;`);
L.push(``);
L.push(`-- ── 6. Verification ───────────────────────────────────────────────────────`);
L.push(`select 'transactions' t, count(*) n, sum(amount) total from public.transactions`);
L.push(`union all select 'income', count(*), sum(amount) from public.transactions where kind = 'income'`);
L.push(`union all select 'expense', count(*), sum(amount) from public.transactions where kind = 'expense'`);
L.push(`union all select 'categories', count(*), null from public.categories`);
L.push(`union all select 'vehicles', count(*), null from public.vehicles`);
L.push(`union all select 'payment_methods', count(*), null from public.payment_methods`);
L.push(`union all select 'dues_accounts', count(*), null from public.dues_accounts;`);
L.push(``);
L.push(`commit;`);

if (review.length) {
  L.push(``);
  L.push(`-- ── REVIEW (rows skipped — verify manually, then uncomment) ──────────────`);
  for (const r of review) L.push(`-- · ${r.month} Sl.${r.sl ?? "?"}: ${r.supplier ?? ""} — ${r.desc ?? ""}${r.remark ? " (" + r.remark + ")" : ""}${r.note ? " [" + r.note + "]" : ""}`);
  L.push(`--   (The "New Broadway" Oct Sl.40 row is blank in the sheet because the`);
  L.push(`--    AED 1315.65 is outstanding — the sheet's own total excludes it.)`);
}

writeFileSync("supabase/production-preload.sql", L.join("\n") + "\n");

const income = txns.filter((t) => t.kind === "income");
const expense = txns.filter((t) => t.kind === "expense");
const sum = (a) => a.reduce((s, t) => s + Number(t.amount), 0);
console.log("Wrote supabase/production-preload.sql");
console.log(`transactions: ${txns.length} (income ${income.length} = ${sum(income).toFixed(2)} AED · expense ${expense.length} = ${sum(expense).toFixed(2)} AED)`);
console.log(`expected: Sep inc 104561.50 + Oct inc 34620.00 | Sep exp 91062.29 + Oct exp 30763.68`);
console.log(`review rows: ${review.length}`);
