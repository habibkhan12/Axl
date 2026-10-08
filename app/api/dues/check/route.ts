import { NextResponse } from "next/server";
import { requireDues } from "@/lib/server-admin";
import { checkDuesAccounts } from "@/lib/dues-checkers";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST — run the sequencer. Body { accountId? } checks one account, otherwise
 * every active account. Requires Dues edit access (the scheduled worker calls
 * the internal runner directly, no session needed).
 */
export async function POST(req: Request) {
  const gate = await requireDues(req, "edit");
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status });

  const body = (await req.json().catch(() => ({}))) as { accountId?: string };
  const { results, error } = await checkDuesAccounts(body.accountId || undefined);
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ results });
}
