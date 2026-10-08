import { NextResponse } from "next/server";
import { getAdmin } from "@/lib/server-admin";
import { ADMIN_EMAIL } from "@/lib/admin";

export const dynamic = "force-dynamic";

/**
 * Self-healing admin: when the hardcoded admin email signs in, this forces
 * their profile role to "owner". The client calls this automatically after
 * sign-in, so the admin can never end up stuck as viewer/editor again.
 */
export async function POST(req: Request) {
  const admin = getAdmin();
  if (!admin) {
    return NextResponse.json({ error: "ADMIN_NOT_CONFIGURED" }, { status: 503 });
  }
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ error: "You are not signed in." }, { status: 401 });
  }
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    return NextResponse.json({ error: "Your session has expired — sign in again." }, { status: 401 });
  }
  const email = (data.user.email ?? "").trim().toLowerCase();
  if (email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Not the admin account." }, { status: 403 });
  }

  const name = data.user.user_metadata?.name || email.split("@")[0];
  const { error: upErr } = await admin
    .from("profiles")
    .upsert({ id: data.user.id, name, role: "owner" }, { onConflict: "id" });
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }
  return NextResponse.json({ role: "owner" });
}
