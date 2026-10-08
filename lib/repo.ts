import type { Database, Transaction, Category, Vehicle, PaymentMethod, User } from "./types";
import type { TransactionInput } from "./store";

export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Transactions ────────────────────────────────────────────────────────────

export function addTransaction(db: Database, input: TransactionInput): Database {
  const now = new Date().toISOString();
  const t: Transaction = {
    id: uid("t"),
    kind: input.kind,
    txn_date: input.txn_date,
    amount: Math.abs(input.amount),
    party_id: input.party_id ?? null,
    category_id: input.category_id ?? null,
    payment_method_id: input.payment_method_id ?? null,
    vehicle_id: input.vehicle_id ?? null,
    fuel_liters: input.fuel_liters ?? null,
    job_ref: input.job_ref?.trim() ? input.job_ref.trim() : null,
    voucher_no: input.voucher_no?.trim() ? input.voucher_no.trim() : null,
    description: input.description?.trim() ? input.description.trim() : null,
    notes: input.notes?.trim() ? input.notes.trim() : null,
    receipt_url: input.receipt_url ?? null,
    created_by: input.created_by,
    created_at: now,
    updated_at: now,
  };
  return { ...db, transactions: [t, ...db.transactions] };
}

export function updateTransaction(db: Database, id: string, patch: Partial<TransactionInput>): Database {
  return {
    ...db,
    transactions: db.transactions.map((t) =>
      t.id === id ? { ...t, ...patch, amount: patch.amount != null ? Math.abs(patch.amount) : t.amount, updated_at: new Date().toISOString() } : t
    ),
  };
}

export function deleteTransaction(db: Database, id: string): Database {
  return { ...db, transactions: db.transactions.filter((t) => t.id !== id) };
}

// ─── Reference data CRUD ─────────────────────────────────────────────────────

export function upsertCategory(db: Database, cat: Category): Database {
  const exists = db.categories.some((c) => c.id === cat.id);
  return { ...db, categories: exists ? db.categories.map((c) => (c.id === cat.id ? cat : c)) : [...db.categories, cat] };
}

export function upsertVehicle(db: Database, v: Vehicle): Database {
  const exists = db.vehicles.some((x) => x.id === v.id);
  return { ...db, vehicles: exists ? db.vehicles.map((x) => (x.id === v.id ? v : x)) : [...db.vehicles, v] };
}

export function upsertPaymentMethod(db: Database, pm: PaymentMethod): Database {
  const exists = db.payment_methods.some((x) => x.id === pm.id);
  return { ...db, payment_methods: exists ? db.payment_methods.map((x) => (x.id === pm.id ? pm : x)) : [...db.payment_methods, pm] };
}

export function archiveRef(db: Database, table: "categories" | "vehicles" | "payment_methods", id: string, archived: boolean): Database {
  if (table === "categories") return { ...db, categories: db.categories.map((c) => (c.id === id ? { ...c, archived } : c)) };
  if (table === "vehicles") return { ...db, vehicles: db.vehicles.map((v) => (v.id === id ? { ...v, archived } : v)) };
  return { ...db, payment_methods: db.payment_methods.map((p) => (p.id === id ? { ...p, archived } : p)) };
}

// ─── Users & settings ────────────────────────────────────────────────────────

export function upsertUser(db: Database, u: User): Database {
  const exists = db.users.some((x) => x.id === u.id);
  return { ...db, users: exists ? db.users.map((x) => (x.id === u.id ? u : x)) : [...db.users, u] };
}

export function setActiveUser(db: Database, userId: string): Database {
  return { ...db, settings: { ...db.settings, active_user_id: userId } };
}

export function setMonthlyTarget(db: Database, target: number): Database {
  return { ...db, settings: { ...db.settings, monthly_income_target: target } };
}

export function activeUser(db: Database): User {
  return db.users.find((u) => u.id === db.settings.active_user_id) ?? db.users[0];
}
