"use client";
import type { Database } from "./types";
import { getSupabase } from "./supabase";

/**
 * Database objects the deployed project is missing. Set on every cloud load so
 * the UI can say exactly what to run instead of failing with a raw Postgres error.
 */
let schemaIssues: string[] = [];

export function getSchemaIssues(): string[] {
  return schemaIssues;
}

export const PARTIES_SQL = "supabase/migrations/2026-11-14-suppliers-clients.sql";
export const PERSONNEL_SQL = "supabase/migrations/2026-11-14-personnel-documents.sql";
export const QUOTES_SQL = "supabase/migrations/2026-11-15-quotations.sql";

export async function loadCloudDb(): Promise<Database> {
  schemaIssues = [];
  const sb = getSupabase();
  const [tx, cats, vehs, pms, partiesRes, quotesRes, staffRes, staffDocsRes, otRes, leaveRes, payRes, profiles, settings] = await Promise.all([
    sb.from("transactions").select("*").order("txn_date", { ascending: false }),
    sb.from("categories").select("*"),
    sb.from("vehicles").select("*"),
    sb.from("payment_methods").select("*"),
    sb.from("parties").select("*"),
    sb.from("quotes").select("*"),
    sb.from("staff").select("*"),
    sb.from("staff_documents").select("*"),
    sb.from("staff_overtime").select("*"),
    sb.from("staff_leaves").select("*"),
    sb.from("staff_transactions").select("*"),
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

  // The parties table arrives with the suppliers/clients migration — don't take
  // the whole app down if a database has not run it yet, but say so in the UI.
  if (partiesRes.error) {
    console.warn("parties table unavailable:", partiesRes.error.message);
    schemaIssues.push(
      "Suppliers & Clients need a one-time database update: the public.parties table is missing. " +
        "Run " + PARTIES_SQL + " in the Supabase SQL editor, then reload."
    );
  }

  // Quotations arrive with their own migration.
  if (quotesRes.error) {
    console.warn("quotes table unavailable:", quotesRes.error.message);
    schemaIssues.push(
      "Quotations need a one-time database update: the public.quotes table and the transactions.quote_id column are missing. " +
        "Run " + QUOTES_SQL + " in the Supabase SQL editor, then reload."
    );
  }

  // Personnel tables / storage bucket arrive with their own migration.
  if (staffRes.error || staffDocsRes.error || otRes.error || leaveRes.error || payRes.error) {
    console.warn(
      "employee tables unavailable:",
      staffRes.error?.message ?? staffDocsRes.error?.message ?? otRes.error?.message ?? leaveRes.error?.message ?? payRes.error?.message
    );
    schemaIssues.push(
      "The Employee tab needs a one-time database update: the public.staff / staff_documents / staff_overtime / staff_leaves / " +
        "staff_transactions tables and the staff-documents storage bucket are missing. Run " + PERSONNEL_SQL +
        " in the Supabase SQL editor, then reload."
    );
  }

  return {
    transactions: (tx.data ?? []) as unknown as Database["transactions"],
    parties: (partiesRes.error ? [] : partiesRes.data ?? []) as unknown as Database["parties"],
    quotes: ((quotesRes.error ? [] : quotesRes.data ?? []) as unknown as Database["quotes"]).map((q) => ({
      ...q,
      amount: num(q.amount, 0),
    })),
    staff: (staffRes.error ? [] : staffRes.data ?? []) as unknown as Database["staff"],
    staff_documents: (staffDocsRes.error ? [] : staffDocsRes.data ?? []) as unknown as Database["staff_documents"],
    staff_overtime: ((otRes.error ? [] : otRes.data ?? []) as unknown as Database["staff_overtime"]).map((r) => ({
      ...r,
      hours: num(r.hours, 0),
    })),
    staff_leaves: (leaveRes.error ? [] : leaveRes.data ?? []) as unknown as Database["staff_leaves"],
    staff_transactions: ((payRes.error ? [] : payRes.data ?? []) as unknown as Database["staff_transactions"]).map((r) => ({
      ...r,
      amount: num(r.amount, 0),
    })),
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
