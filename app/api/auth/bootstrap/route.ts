import { NextResponse } from "next/server";
import { getAdmin } from "@/lib/server-admin";
import { ADMIN_EMAIL } from "@/lib/admin";

export const dynamic = "force-dynamic";

/**
 * One-time setup: creates THE admin account with the hardcoded email.
 * Only allowed while the database has zero users. After that, this route
 * is permanently closed — only an existing admin can create accounts.
 */
export async function POST(req: Request) {
  const admin = getAdmin();
  if (!admin) {
    return NextResponse.json({ error: "ADMIN_NOT_CONFIGURED" }, { status: 503 });
  }

  const { count } = await admin.from("profiles").select("id", { count: "exact", head: true });
  if ((count ?? 0) > 0) {
    return NextResponse.json({ error: "An admin already exists — sign in instead." }, { status: 403 });
  }

  let body: { password?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const password = String(body.password ?? "");
  const name = String(body.name ?? "").trim() || ADMIN_EMAIL.split("@")[0];
  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password,
    email_confirm: true,
    user_metadata: { name },
  });
  if (error || !data.user) {
    return NextResponse.json(
      { error: /already/i.test(error?.message ?? "") ? "The admin account already exists — sign in instead." : error?.message ?? "Could not create the admin account." },
      { status: 400 }
    );
  }

  await admin.from("profiles").upsert({ id: data.user.id, name, role: "owner" }, { onConflict: "id" });
  return NextResponse.json({ ok: true, email: ADMIN_EMAIL });
}
