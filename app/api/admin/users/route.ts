import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/server-admin";

export const dynamic = "force-dynamic";

/**
 * Account management for the admin, through Supabase's official Admin API.
 *   GET    /api/admin/users                → every account (email, name, role, dates)
 *   POST   /api/admin/users                → create account (any role, incl. another admin)
 *   PATCH  /api/admin/users                → change role / name / password
 *   DELETE /api/admin/users?userId=…       → delete account
 * Every call must carry the caller's access token; the server re-verifies
 * the owner role on each request. Only an admin can mint another admin.
 */

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function friendly(message: string): string {
  if (/already registered|already exists|duplicate key/i.test(message))
    return "That email already has an account.";
  if (/invalid email/i.test(message)) return "That email address looks invalid.";
  if (/rate limit|too many/i.test(message))
    return "Too many requests — wait a minute and try again.";
  if (/password/i.test(message) && /at least|short|6/i.test(message))
    return "Password must be at least 6 characters.";
  return message;
}

const ROLES = ["owner", "editor", "viewer"] as const;

/** GET → full account list straight from Supabase auth (emails included). */
export async function GET(req: Request) {
  const gate = await requireOwner(req);
  if (!gate.ok) return json(gate.status, { error: gate.message });

  const { data, error: listErr } = await gate.admin.auth.admin.listUsers({ perPage: 200 });
  if (listErr) return json(400, { error: friendly(listErr.message) });

  // avatar_url is a newer column — fall back to a plain select if absent.
  let profRows: { id: string; name: string | null; role: string | null; tab_access: Record<string, string> | null; avatar_url: string | null }[] = [];
  {
    const sel = await gate.admin.from("profiles").select("id, name, role, tab_access, avatar_url");
    if (sel.error && /column|avatar_url/i.test(sel.error.message)) {
      const fallback = await gate.admin.from("profiles").select("id, name, role, tab_access");
      profRows = (fallback.data ?? []).map((r) => ({ ...(r as { id: string; name: string | null; role: string | null; tab_access: Record<string, string> | null }), avatar_url: null }));
    } else {
      profRows = (sel.data ?? []) as typeof profRows;
    }
  }

  const profMap = new Map(profRows.map((p) => [p.id, p]));
  const users = (data?.users ?? []).map((u) => {
    const p = profMap.get(u.id);
    return {
      id: u.id,
      email: u.email ?? "",
      name: p?.name || u.user_metadata?.name || u.email?.split("@")[0] || "User",
      role: (p?.role as string) ?? "viewer",
      avatar_url: (p?.avatar_url as string | null) ?? null,
      tab_access: (p?.tab_access as Record<string, string> | null) ?? null,
      confirmed: !!u.email_confirmed_at,
      last_sign_in: u.last_sign_in_at ?? null,
      created_at: u.created_at ?? null,
      has_profile: !!p,
    };
  });
  return json(200, { users });
}

export async function POST(req: Request) {
  const gate = await requireOwner(req);
  if (!gate.ok) return json(gate.status, { error: gate.message });

  let body: { email?: string; password?: string; name?: string; role?: string; tab_access?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid request." });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const name = String(body.name ?? "").trim() || email.split("@")[0];
  const role = String(body.role ?? "");

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(400, { error: "Enter a valid email address." });
  }
  if (password.length < 6) {
    return json(400, { error: "Password must be at least 6 characters." });
  }
  if (!ROLES.includes(role as (typeof ROLES)[number])) {
    return json(400, { error: "Pick a role: admin, editor, or viewer." });
  }

  const { data, error } = await gate.admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });
  if (error || !data.user) {
    return json(400, { error: friendly(error?.message ?? "Could not create the account.") });
  }

  const { error: pErr } = await gate.admin
    .from("profiles")
    .upsert({ id: data.user.id, name, role, tab_access: body.tab_access ?? null }, { onConflict: "id" });
  if (pErr) {
    return json(500, { error: "Account created but the profile could not be saved: " + pErr.message });
  }
  return json(200, { id: data.user.id, email, name, role });
}

export async function PATCH(req: Request) {
  const gate = await requireOwner(req);
  if (!gate.ok) return json(gate.status, { error: gate.message });

  let body: { userId?: string; role?: string; password?: string; name?: string; tab_access?: Record<string, string> | null };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid request." });
  }

  const userId = String(body.userId ?? "");
  if (!userId) return json(400, { error: "Missing user." });

  if (body.tab_access !== undefined) {
    const { error } = await gate.admin
      .from("profiles")
      .update({ tab_access: body.tab_access })
      .eq("id", userId);
    if (error) return json(400, { error: error.message });
  }

  if (body.role !== undefined) {
    const role = String(body.role);
    if (!ROLES.includes(role as (typeof ROLES)[number])) {
      return json(400, { error: "Invalid role." });
    }
    if (userId === gate.userId) {
      return json(400, { error: "You cannot change your own role here — the admin account is always owner." });
    }
    const { error } = await gate.admin.from("profiles").update({ role }).eq("id", userId);
    if (error) return json(400, { error: error.message });
  }

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return json(400, { error: "Name cannot be empty." });
    const { error } = await gate.admin.from("profiles").update({ name }).eq("id", userId);
    if (error) return json(400, { error: error.message });
  }

  if (body.password !== undefined) {
    const password = String(body.password);
    if (password.length < 6) {
      return json(400, { error: "Password must be at least 6 characters." });
    }
    const { error } = await gate.admin.auth.admin.updateUserById(userId, { password });
    if (error) return json(400, { error: friendly(error.message) });
  }

  return json(200, { ok: true });
}

export async function DELETE(req: Request) {
  const gate = await requireOwner(req);
  if (!gate.ok) return json(gate.status, { error: gate.message });

  const userId = new URL(req.url).searchParams.get("userId") ?? "";
  if (!userId) return json(400, { error: "Missing user." });
  if (userId === gate.userId) {
    return json(400, { error: "You cannot delete your own account." });
  }

  const { error } = await gate.admin.auth.admin.deleteUser(userId);
  if (error) return json(400, { error: friendly(error.message) });
  return json(200, { ok: true });
}
