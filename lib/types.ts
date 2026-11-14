// ─── Domain types — mirror the future Supabase schema 1:1 ───────────────────

export type Kind = "income" | "expense";
export type Role = "owner" | "editor" | "viewer";

/** Per-tab access level. "none" = tab hidden entirely. */
export type TabAccess = "none" | "view" | "edit";
export type TabKey = "dashboard" | "transactions" | "suppliers" | "clients" | "fleet" | "personnel" | "dues" | "settings";

/** What tabs a non-admin account can see/edit. Admin always sees everything. */
export interface TabAccessMap {
  dashboard?: TabAccess;
  transactions?: TabAccess;
  suppliers?: TabAccess;
  clients?: TabAccess;
  fleet?: TabAccess;
  personnel?: TabAccess;
  dues?: TabAccess;
}
export interface Vehicle {
  id: string;
  label: string; // "Accord Silver"
  plate: string; // "90615 C AJM"
  is_company?: boolean; // the "COMPANY" pseudo-vehicle
  archived?: boolean;
  // Extended registry (imported from Data.xlsx) — editable on the Fleet page.
  tc_number?: string | null;
  owner_name?: string | null;
  license_expiry?: string | null; // ISO date
  insurance_expiry?: string | null; // ISO date
  // Salik registration (drives automated balance checks on the Dues page).
  salik_mobile?: string | null;
  salik_account?: string | null;
  salik_tag?: string | null;
  salik_code?: string | null;
}

/** A supplier (paid on expenses) or a client (paid us on income). */
export type PartyKind = "supplier" | "client";

export interface Party {
  id: string;
  kind: PartyKind;
  name: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  archived?: boolean;
  created_at?: string;
}

export interface Category {
  id: string;
  name: string; // "Fuel", "Materials", "Villa 01"…
  kind: Kind; // categories are per-kind (Income uses its own set)
  archived?: boolean;
}

export interface PaymentMethod {
  id: string;
  name: string; // "ADCB", "CASH", "POS", "Janata"
  archived?: boolean;
}

export interface Transaction {
  id: string;
  kind: Kind;
  txn_date: string; // ISO yyyy-mm-dd (business date)
  amount: number; // always positive
  category_id?: string | null;
  payment_method_id?: string | null;
  /** Supplier on an expense, client on an income entry. */
  party_id?: string | null;
  vehicle_id?: string | null; // only meaningful for Fuel / Vehicles
  fuel_liters?: number | null;
  job_ref?: string | null; // "AY12017"
  voucher_no?: string | null;
  description?: string | null;
  notes?: string | null; // replaces cell comments
  receipt_url?: string | null;
  created_by: string; // user id
  created_at: string; // ISO timestamp
  updated_at: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Settings {
  monthly_income_target: number;
  monthly_profit_target?: number; // optional so pre-existing localStorage dbs load fine
  monthly_expense_target?: number;
  active_user_id: string; // localStorage stand-in for auth.session
}

/** A staff member tracked on the Personnel tab. */
export interface StaffMember {
  id: string;
  name: string;
  phone?: string | null;
  notes?: string | null;
  archived?: boolean;
  created_at?: string;
}

/** A document (passport, visa, licence…) attached to a staff member. */
export interface StaffDocument {
  id: string;
  staff_id: string;
  name: string;
  expiry_date?: string | null;
  /** Object path in the `staff-documents` Supabase Storage bucket. */
  file_path?: string | null;
  file_name?: string | null;
  file_type?: string | null;
  file_size?: number | null;
  /** Local mode only (no Supabase): the file as a data URL. Cloud rows use file_path. */
  file_data?: string | null;
  created_at?: string;
}

export interface Database {
  vehicles: Vehicle[];
  parties: Party[];
  staff: StaffMember[];
  staff_documents: StaffDocument[];
  categories: Category[];
  payment_methods: PaymentMethod[];
  transactions: Transaction[];
  users: User[];
  settings: Settings;
}

export type TableName = Exclude<keyof Database, "settings">;

// ─── Dues & fines monitoring ────────────────────────────────────────────────

/** A monitored bill/fine account on an external portal (EVG, Salik, du, …). */
export interface DuesAccount {
  id: string;
  provider_key: string;
  label: string;
  fields: Record<string, string>;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

export type DuesCheckStatus = "ok" | "manual" | "error";

/** One checker run against a portal. */
export interface DuesCheck {
  id: string;
  account_id: string;
  checked_at: string;
  status: DuesCheckStatus;
  amount_due?: number | null;
  message?: string | null;
  extra?: Record<string, unknown> | null;
}
