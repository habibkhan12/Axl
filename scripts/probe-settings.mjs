/**
 * One-off diagnostic: probe the live Supabase app_settings table.
 * Usage: node scripts/probe-settings.mjs
 * Reads SUPABASE keys from .env.local. Run from project root.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => {
  const m = env.match(new RegExp("^\\s*" + k + "\\s*=\\s*\"?([^\"\\n\\r]*)\"?\\s*$", "m"));
  return m ? m[1].trim() : null;
};
const url = get("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = get("SUPABASE_SERVICE_ROLE_KEY") || get("SUPABASE_SERVICE_KEY") || get("NEXT_PUBLIC_SUPABASE_ANON_KEY");
console.log("URL:", url, "| key type:", get("SUPABASE_SERVICE_ROLE_KEY") ? "service" : get("SUPABASE_SERVICE_KEY") ? "service(alt)" : "anon");

const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

// 1. Current row
const { data: row, error: rErr } = await sb.from("app_settings").select("*").eq("id", 1).maybeSingle();
console.log("\n--- app_settings row (id=1) ---");
console.log("error:", rErr ? JSON.stringify(rErr, null, 2) : "none");
console.log("row:", JSON.stringify(row, null, 2));

// 2. Try updating with the two new columns to surface the real PostgREST error
const { error: uErr } = await sb
  .from("app_settings")
  .upsert({ id: 1, monthly_profit_target: 123, monthly_expense_target: 456 }, { onConflict: "id" });
console.log("\n--- upsert with new columns ---");
console.log("error:", uErr ? JSON.stringify(uErr, null, 2) : "none");

// 3. Re-read to confirm if anything landed
const { data: row2 } = await sb.from("app_settings").select("*").eq("id", 1).maybeSingle();
console.log("\n--- re-read after upsert attempt ---");
console.log("row:", JSON.stringify(row2, null, 2));

// 4. profiles tab_access probe
const { data: prof, error: pErr } = await sb.from("profiles").select("id, name, role, tab_access").limit(10);
console.log("\n--- profiles ---");
console.log("error:", pErr ? JSON.stringify(pErr, null, 2) : "none");
console.log("rows:", JSON.stringify(prof, null, 2));
