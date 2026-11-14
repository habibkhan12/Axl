import type { Database, Transaction, Category, Vehicle, PaymentMethod, User, Party, PartyKind } from "./types";
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
    category_id: input.category_id ?? null,
    payment_method_id: input.payment_method_id ?? null,
    party_id: input.party_id ?? null,
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

export function upsertParty(db: Database, party: Party): Database {
  const exists = db.parties.some((p) => p.id === party.id);
  return { ...db, parties: exists ? db.parties.map((p) => (p.id === party.id ? party : p)) : [...db.parties, party] };
}

/** Case-insensitive lookup of a supplier/client by name. */
export function findParty(db: Database, kind: PartyKind, name: string): Party | undefined {
  const needle = name.trim().toLowerCase();
  if (!needle) return undefined;
  return db.parties.find((p) => p.kind === kind && !p.archived && p.name.trim().toLowerCase() === needle);
}

/**
 * Resolve a typed name to a party: reuse the existing record when the name
 * matches (ignoring case/spacing), otherwise create it on the spot.
 */
export function ensureParty(db: Database, kind: PartyKind, name: string): { db: Database; party: Party | null } {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) return { db, party: null };
  const existing = findParty(db, kind, trimmed);
  if (existing) return { db, party: existing };
  const party: Party = { id: uid("pt"), kind, name: trimmed, created_at: new Date().toISOString() };
  return { db: { ...db, parties: [...db.parties, party] }, party };
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

// ─── The seeded active user (cloud mode resolves authors via auth instead) ───
export function activeUser(db: Database): User {
  return db.users.find((u) => u.id === db.settings.active_user_id) ?? db.users[0];
}
