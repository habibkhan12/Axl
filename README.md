# AXL Books

Income & Expense platform for AXL Technical Services — a rebuild of the monthly
`Inc & Exp … .xlsx` workbook as a proper web app. Phase 1 runs entirely on
**localStorage** so you can start entering data today; the data layer is
designed to swap to **Supabase** (Postgres + Auth + RLS) without touching the UI.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. Data lives in your browser under the key
`axl-books-db-v1`. Use **Settings → Data tools** to download JSON backups and
restore them (e.g. to move data between machines or browsers).

Press **N** anywhere for Quick Entry. Enter saves and stays open for the next bill.

## What's inside

| Page | Purpose |
|---|---|
| `/` Dashboard | Period presets, KPI cards, monthly target ring (seeded at AED 163,350), daily income-vs-expense chart, category breakdown, payment-method mix |
| `/transactions` | Unified ledger (income + expense), 7 filters + full-text search over job refs, inline edit, delete, CSV export |
| `/fuel` | Per-vehicle fuel cards with daily bars, vehicle × day heatmap, drill-down; AED/Liter when you record liters |
| `/parties` | Ranked clients & suppliers for any month with drill-down, instant-create, merge duplicates |
| `/settings` | Monthly target, categories (14 from your workbook), 11 vehicles + Company, payment methods, users/roles, backups, demo data |

## Seeded reference data (from Sep 2026 workbook)

- **Categories (expense):** Materials, Fuel, Man Power, Utilities, Vehicles, Villa 01–03, Personal, Charity, Stationary, Grocery, Publicity, Ministry
- **Vehicles:** Rogue, Accord Silver, Accord Blue, Pathfinder, Avanza, Hilux 75011, Pickup 73516, Sedan 36975, Civic White, BMW, Company
- **Payment methods:** ADCB, CASH, POS, Janata, Cheque

## Swapping localStorage for Supabase

The app only talks to the types in `lib/types.ts` and the pure functions in
`lib/repo.ts` / `lib/analytics.ts`. To move to Supabase:

1. `npm i @supabase/supabase-js @supabase/ssr`
2. Create tables matching `lib/types.ts` 1:1:
   `parties`, `vehicles`, `categories`, `payment_methods`, `transactions`, `profiles`.
   Every row gets `id uuid default gen_random_uuid()`; transactions get FKs to the
   reference tables plus `created_by uuid references profiles` and
   `created_at/updated_at timestamptz`.
3. Enable RLS with policies per role (`owner` / `editor` / `viewer` — the role
   column already exists on `users`).
4. Replace `lib/local-db.tsx` with a provider that wraps Supabase queries; the
   pages, Quick Entry, charts and analytics stay untouched.
5. Receipt photos later: a `receipts` storage bucket; store the public URL in
   `transactions.receipt_url` (the column is already in the type).

## Roadmap

- **Phase 2:** month-over-month insights page, bulk paste entry, shareable month-end summary, richer fuel analytics
- **Phase 3:** per-job P&L via job refs (your `AY…` numbering), per-category budgets, audit log, PWA install
