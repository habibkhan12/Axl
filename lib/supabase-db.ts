"use client";
import type { Database } from "./types";
import { getSupabase } from "./supabase";
import type { Transaction } from "./types";

export async function loadCloudDb(): Promise<Database> {
  const sb = getSupabase();
  const [tx, cats, vehs, pms, profiles, settings] = await Promise.all([
    sb.from("transactions").select("*").order("txn_date", { ascending: false }),
    sb.from("categories").select("*"),
    sb.from("vehicles").select("*"),
    sb.from("payment_methods").select("*"),
    sb.from("profiles").select("*"),
    sb.from("app_settings").select("*").eq("id", 1).maybeSingle(),
  ]);

  if (tx.error) throw tx.error;
  if (cats.error) throw cats.error;
  if (vehs.error) throw vehs.error;
  if (pms.error) throw pms.error;
  if (profiles.error) throw profiles.error;
  if (settings.error) throw settings.error;

  // Postgres numerics can arrive as strings via PostgREST — coerce targets to numbers
  // so strict comparisons in the diff-sync effect don't churn.
  const num = (v: unknown, fallback: number) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  return {
    transactions: (tx.data ?? []) as unknown as Database["transactions"],
    categories: (cats.data ?? []) as unknown as Database["categories"],
    vehicles: (vehs.data ?? []) as unknown as Database["vehicles"],
    payment_methods: (pms.data ?? []) as unknown as Database["payment_methods"],
    parties: [],
    users: (profiles.data ?? []).map((p: { id: string; name: string; role: string }) => ({
      id: p.id,
      name: p.name || "User",
      email: "",
      role: p.role as "owner" | "editor" | "viewer",
    })),
    settings: {
      monthly_income_target: num(settings?.data?.monthly_income_target, 163350),
      monthly_profit_target: num(settings?.data?.monthly_profit_target, 0),
      monthly_expense_target: num(settings?.data?.monthly_expense_target, 0),
      active_user_id: "cloud",
    },
  };
}

// Push any local transactions that don't exist in the cloud (by id) — idempotent migration
// fallbackUserId remaps local-only authors (seed ids like "u_owner") to the signed-in
// profile so the created_by foreign key to profiles is satisfied.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function syncLocalToCloud(local: Database, fallbackUserId?: string): Promise<{ pushed: number; errors: string[] }> {
  const sb = getSupabase();
  const errors: string[] = [];
  let pushed = 0;

  const { data: existing, error: exErr } = await sb.from("transactions").select("id");
  if (exErr) throw exErr;
  const existingIds = new Set((existing ?? []).map((r: { id: string }) => r.id));

  const missing = local.transactions.filter((t) => !existingIds.has(t.id));
  if (missing.length > 0) {
    const rows = missing
      .map((t) => ({
        ...t,
        created_by: UUID_RE.test(t.created_by) ? t.created_by : (fallbackUserId ?? ""),
      }))
      .filter((t) => UUID_RE.test(t.created_by));
    if (rows.length === 0) {
      errors.push("No valid author for local entries — sign in and retry.");
      return { pushed, errors };
    }
    // chunk to stay under request limits
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const { error } = await sb.from("transactions").insert(chunk);
      if (error) errors.push(error.message);
      else pushed += chunk.length;
    }
  }

  // Reference data — upsert anything missing by id
  const { error: cErr } = await sb.from("categories").upsert(local.categories, { onConflict: "id" });
  if (cErr) errors.push(cErr.message);
  const { error: vErr } = await sb.from("vehicles").upsert(local.vehicles, { onConflict: "id" });
  if (vErr) errors.push(vErr.message);
  const { error: pErr } = await sb.from("payment_methods").upsert(local.payment_methods, { onConflict: "id" });
  if (pErr) errors.push(pErr.message);

  // Sync all three monthly targets, not just income.
  if (local.settings && (local.settings.monthly_income_target || local.settings.monthly_profit_target || local.settings.monthly_expense_target)) {
    const { error: sErr } = await sb.from("app_settings").upsert({
      id: 1,
      monthly_income_target: local.settings.monthly_income_target,
      monthly_profit_target: local.settings.monthly_profit_target ?? 0,
      monthly_expense_target: local.settings.monthly_expense_target ?? 0,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });
    if (sErr) errors.push(sErr.message);
  }

  return { pushed, errors };
}

// Per-mutation writes used by the provider
export async function insertTransaction(t: Transaction): Promise<string | null> {
  const { error } = await getSupabase().from("transactions").insert({ ...t });
  return error ? error.message : null;
}

export async function updateTransactionRow(id: string, patch: Record<string, unknown>): Promise<string | null> {
  const { error } = await getSupabase().from("transactions").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  return error ? error.message : null;
}

export async function deleteTransactionRow(id: string): Promise<string | null> {
  const { error } = await getSupabase().from("transactions").delete().eq("id", id);
  return error ? error.message : null;
}

export async function upsertRow(table: "categories" | "vehicles" | "payment_methods", row: Record<string, unknown>): Promise<string | null> {
  const { error } = await getSupabase().from(table).upsert(row, { onConflict: "id" });
  return error ? error.message : null;
}

export async function deleteRow(table: "categories" | "vehicles" | "payment_methods", id: string): Promise<string | null> {
  const { error } = await getSupabase().from(table).delete().eq("id", id);
  return error ? error.message : null;
}

export async function updateSettings(settings: { monthly_income_target: number; monthly_profit_target?: number; monthly_expense_target?: number }): Promise<string | null> {
  const row: Record<string, unknown> = { id: 1, updated_at: new Date().toISOString() };
  row.monthly_income_target = settings.monthly_income_target;
  if (settings.monthly_profit_target != null) row.monthly_profit_target = settings.monthly_profit_target;
  if (settings.monthly_expense_target != null) row.monthly_expense_target = settings.monthly_expense_target;
  const { error } = await getSupabase().from("app_settings").upsert(row, { onConflict: "id" });
  return error ? error.message : null;
}
