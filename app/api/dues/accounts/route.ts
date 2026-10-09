import { NextResponse } from "next/server";
import { requireDues } from "@/lib/server-admin";
import { duesProviderOf } from "@/lib/dues-providers";

export const dynamic = "force-dynamic";

/** GET — accounts (all) + check history (last 30 days) for the Dues page. */
export async function GET(req: Request) {
  const gate = await requireDues(req, "view");
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status });
  const admin = gate.admin;

  const [{ data: accounts, error: aErr }, { data: checks, error: cErr }] = await Promise.all([
    admin.from("dues_accounts").select("*").order("created_at", { ascending: true }),
    admin
      .from("dues_checks")
      .select("id, account_id, checked_at, status, amount_due, message")
      .gte("checked_at", new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())
      .order("checked_at", { ascending: false })
      .limit(1000),
  ]);
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });

  return NextResponse.json({
    accounts: accounts ?? [],
    checks: checks ?? [],
    // Viewers/custom accounts get the read-only shape; UI hides mutation buttons via canEdit("/dues").
    canEdit: gate.role === "owner" || gate.role === "editor" || gate.tabAccess?.dues === "edit",
  });
}

/** POST — create a monitored account. */
export async function POST(req: Request) {
  const gate = await requireDues(req, "edit");
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status });

  const body = (await req.json().catch(() => null)) as
    | { provider_key?: string; label?: string; fields?: Record<string, string>; active?: boolean }
    | null;
  const provider = body?.provider_key ? duesProviderOf(body.provider_key) : undefined;
  if (!provider) return NextResponse.json({ error: "Unknown provider." }, { status: 400 });
  const label = (body?.label ?? "").trim();
  if (!label) return NextResponse.json({ error: "Give this account a name (e.g. \"Hilux — Dubai plate\")." }, { status: 400 });

  const fields = body?.fields ?? {};
  for (const spec of provider.fields) {
    if (spec.required && !String(fields[spec.key] ?? "").trim()) {
      return NextResponse.json({ error: `${spec.label} is required.` }, { status: 400 });
    }
  }
  if (provider.key === "dubai_police" && !String(fields.tc_number ?? "").trim() && !String(fields.plate_number ?? "").trim()) {
    return NextResponse.json({ error: "Provide a traffic code (TC) number or a plate number." }, { status: 400 });
  }

  const { data, error } = await gate.admin
    .from("dues_accounts")
    .insert({ provider_key: provider.key, label, fields, active: body?.active !== false })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data?.id });
}

/** PATCH — update label/fields/active. */
export async function PATCH(req: Request) {
  const gate = await requireDues(req, "edit");
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status });

  const body = (await req.json().catch(() => null)) as
    | { id?: string; label?: string; fields?: Record<string, string>; active?: boolean }
    | null;
  if (!body?.id) return NextResponse.json({ error: "Missing account id." }, { status: 400 });

  const { data: existing } = await gate.admin.from("dues_accounts").select("provider_key").eq("id", body.id).maybeSingle();
  const provider = existing?.provider_key ? duesProviderOf(existing.provider_key) : undefined;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.label === "string" && body.label.trim()) patch.label = body.label.trim();
  if (body.fields && provider) {
    for (const spec of provider.fields) {
      if (spec.required && !String(body.fields[spec.key] ?? "").trim()) {
        return NextResponse.json({ error: `${spec.label} is required.` }, { status: 400 });
      }
    }
    patch.fields = body.fields;
  }
  if (typeof body.active === "boolean") patch.active = body.active;

  const { error } = await gate.admin.from("dues_accounts").update(patch).eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** DELETE — remove a monitored account (its check history cascades). */
export async function DELETE(req: Request) {
  const gate = await requireDues(req, "edit");
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing account id." }, { status: 400 });
  const { error } = await gate.admin.from("dues_accounts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
