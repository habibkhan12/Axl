"use client";
import type { Database } from "./types";
import { getSupabase } from "./supabase";

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

export async function updateSettings(settings: { monthly_income_target: number; monthly_profit_target?: number; monthly_expense_target?: number }): Promise<string | null> {
  const row: Record<string, unknown> = { id: 1, updated_at: new Date().toISOString() };
  row.monthly_income_target = settings.monthly_income_target;
  if (settings.monthly_profit_target != null) row.monthly_profit_target = settings.monthly_profit_target;
  if (settings.monthly_expense_target != null) row.monthly_expense_target = settings.monthly_expense_target;
  const { error } = await getSupabase().from("app_settings").upsert(row, { onConflict: "id" });
  return error ? error.message : null;
}
