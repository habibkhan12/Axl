import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * SERVER-ONLY. Never import this from client components.
 * Uses the service_role key so account management goes through Supabase's
 * official Admin API instead of hand-written SQL into auth tables.
 */
export function getAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export type OwnerGate =
  | { ok: true; admin: SupabaseClient; userId: string }
  | { ok: false; status: 401 | 403 | 503; message: string };

/**
 * Verifies the caller is a signed-in user whose profile role is "owner".
 * Expects the Supabase access token in the Authorization header.
 */
export async function requireOwner(req: Request): Promise<OwnerGate> {
  const admin = getAdmin();
  if (!admin) {
    return { ok: false, status: 503, message: "ADMIN_NOT_CONFIGURED" };
  }
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return { ok: false, status: 401, message: "You are not signed in." };
  }
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    return { ok: false, status: 401, message: "Your session has expired — sign in again." };
  }
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profile?.role !== "owner") {
    return { ok: false, status: 403, message: "Only the owner can manage accounts." };
  }
  return { ok: true, admin, userId: data.user.id };
}

export type UserGate =
  | { ok: true; admin: SupabaseClient; userId: string; email: string }
  | { ok: false; status: 401 | 503; message: string };

/**
 * Signed-in gate for self-service routes (own profile, own password).
 * Unlike requireOwner this accepts any authenticated account.
 */
export async function requireUser(req: Request): Promise<UserGate> {
  const admin = getAdmin();
  if (!admin) return { ok: false, status: 503, message: "ADMIN_NOT_CONFIGURED" };
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, message: "You are not signed in." };
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return { ok: false, status: 401, message: "Your session has expired — sign in again." };
  return { ok: true, admin, userId: data.user.id, email: data.user.email ?? "" };
}

export type DuesGate =
  | { ok: true; admin: SupabaseClient; userId: string; role: string; tabAccess: Record<string, string> | null }
  | { ok: false; status: 401 | 403 | 503; message: string };

/**
 * Signed-in gate for dues routes. Dues access is granular per-tab:
 * owner/editor always pass; a custom (viewer) account passes depending on
 * profiles.tab_access.dues matching the requested level.
 */
export async function requireDues(req: Request, level: "view" | "edit"): Promise<DuesGate> {
  const admin = getAdmin();
  if (!admin) return { ok: false, status: 503, message: "ADMIN_NOT_CONFIGURED" };
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, message: "You are not signed in." };
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return { ok: false, status: 401, message: "Your session has expired — sign in again." };
  const { data: profile } = await admin
    .from("profiles")
    .select("role, tab_access")
    .eq("id", data.user.id)
    .maybeSingle();
  const role = profile?.role ?? "viewer";
  const tabAccess = (profile?.tab_access ?? null) as Record<string, string> | null;
  if (role === "owner" || role === "editor") return { ok: true, admin, userId: data.user.id, role, tabAccess };
  const granted = tabAccess?.dues ?? "none";
  const ok = level === "view" ? granted !== "none" : granted === "edit";
  if (!ok) return { ok: false, status: 403, message: "You do not have access to the Dues tab." };
  return { ok: true, admin, userId: data.user.id, role, tabAccess };
}
