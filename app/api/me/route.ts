import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server-admin";

export const dynamic = "force-dynamic";

/**
 * Self-service account management for the signed-in user (Settings → My details / Password).
 *   GET   /api/me   → own name, email, avatar, created/last-sign-in
 *   PATCH /api/me   → change own display name
 *   POST  /api/me   → { action: "avatar" | "password" | "signOutOthers", … }
 * The caller's access token is required; users can only ever touch their own row.
 */

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

const MAX_AVATAR_BYTES = 200_000; // ~200 KB decoded

/** GET → own profile for the settings page. */
export async function GET(req: Request) {
  const gate = await requireUser(req);
  if (!gate.ok) return json(gate.status, { error: gate.message });

  // avatar_url is a newer column — tolerate its absence gracefully.
  let name: string | null = null;
  let avatarUrl: string | null = null;
  {
    const { data, error } = await gate.admin
      .from("profiles")
      .select("name, avatar_url")
      .eq("id", gate.userId)
      .maybeSingle();
    if (!error && data) {
      name = (data as { name?: string | null }).name ?? null;
      avatarUrl = (data as { avatar_url?: string | null }).avatar_url ?? null;
    }
  }
  const { data: au } = await gate.admin.auth.admin.getUserById(gate.userId);
  const user = au?.user;

  return json(200, {
    id: gate.userId,
    email: gate.email,
    name: name ?? user?.user_metadata?.name ?? gate.email.split("@")[0] ?? "User",
    avatar_url: avatarUrl,
    created_at: user?.created_at ?? null,
    last_sign_in: user?.last_sign_in_at ?? null,
  });
}

/** PATCH → change own display name (profiles row + auth metadata). */
export async function PATCH(req: Request) {
  const gate = await requireUser(req);
  if (!gate.ok) return json(gate.status, { error: gate.message });

  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid request." });
  }
  const name = String(body.name ?? "").trim();
  if (!name) return json(400, { error: "Name cannot be empty." });
  if (name.length > 60) return json(400, { error: "Name is too long (60 characters max)." });

  const { error } = await gate.admin.from("profiles").update({ name }).eq("id", gate.userId);
  if (error) return json(400, { error: error.message });

  await gate.admin.auth.admin.updateUserById(gate.userId, { user_metadata: { name } }).catch(() => {});
  return json(200, { ok: true, name });
}

/** POST → avatar / password / sign-out-everywhere-else. */
export async function POST(req: Request) {
  const gate = await requireUser(req);
  if (!gate.ok) return json(gate.status, { error: gate.message });

  let body: { action?: string; dataUrl?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid request." });
  }

  if (body.action === "avatar") {
    const dataUrl = String(body.dataUrl ?? "");
    if (dataUrl === "") {
      // Removing the photo.
      const { error } = await gate.admin.from("profiles").update({ avatar_url: null }).eq("id", gate.userId);
      if (error) {
        if (/column|avatar_url/i.test(error.message))
          return json(400, { error: "Photo storage is not set up yet — run this SQL once: alter table profiles add column avatar_url text;" });
        return json(400, { error: error.message });
      }
      return json(200, { ok: true });
    }
    if (!dataUrl.startsWith("data:image/")) return json(400, { error: "Pick an image file (PNG or JPG)." });
    const comma = dataUrl.indexOf(",");
    const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : "";
    const bytes = Math.floor((b64.length * 3) / 4);
    if (bytes > MAX_AVATAR_BYTES) return json(400, { error: "Image is too large — keep it under 200 KB." });

    const { error } = await gate.admin.from("profiles").update({ avatar_url: dataUrl }).eq("id", gate.userId);
    if (error) {
      if (/column|avatar_url/i.test(error.message))
        return json(400, { error: "Photo storage is not set up yet — run this SQL once: alter table profiles add column avatar_url text;" });
      return json(400, { error: error.message });
    }
    return json(200, { ok: true });
  }

  if (body.action === "password") {
    const password = String(body.password ?? "");
    if (password.length < 6) return json(400, { error: "Password must be at least 6 characters." });
    const { error } = await gate.admin.auth.admin.updateUserById(gate.userId, { password });
    if (error) {
      if (/at least|short|6/i.test(error.message)) return json(400, { error: "Password must be at least 6 characters." });
      return json(400, { error: error.message });
    }
    return json(200, { ok: true });
  }

  if (body.action === "signOutOthers") {
    try {
      await gate.admin.auth.admin.signOut(gate.userId, "others");
    } catch {
      /* older supabase-js builds: treat as best-effort */
    }
    return json(200, { ok: true });
  }

  return json(400, { error: "Unknown action." });
}
