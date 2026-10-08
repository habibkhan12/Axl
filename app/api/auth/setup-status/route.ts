import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAdmin } from "@/lib/server-admin";

export const dynamic = "force-dynamic";

/**
 * Used only by the login screen to decide between "Sign in" (default) and the
 * one-time "Create the owner account" screen (when the database has zero users).
 * Never hangs the UI — the client falls back to Sign in if this fails.
 */
export async function GET() {
  const admin = getAdmin();
  if (admin) {
    const { count } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true });
    return NextResponse.json({ configured: true, hasOwner: (count ?? 0) > 0 });
  }

  // Service key not configured yet — ask the security-definer RPC instead.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json({ configured: false, hasOwner: null });
  }
  const anon = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await anon.rpc("has_any_user");
  return NextResponse.json({ configured: false, hasOwner: error ? null : data === true });
}
