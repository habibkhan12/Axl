import { NextResponse } from "next/server";
import { requireDues } from "@/lib/server-admin";
import { checkDuesAccounts } from "@/lib/dues-checkers";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST — run the sequencer. Body { accountId? } checks one account, otherwise
 * every active account.
 * Auth: a signed-in user with Dues edit access, OR the cloud cron runner with
 * `Authorization: Bearer <CRON_SECRET>` (used by .github/workflows/dues-cron.yml
 * on GitHub-hosted schedules — the browser checkers degrade to reachability
 * probes on serverless, HTTP-only providers still return live statuses).
 */
export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const isCron = !!(cronSecret && (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim() === cronSecret);
  if (!isCron) {
    const gate = await requireDues(req, "edit");
    if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status });
  }

  const body = (await req.json().catch(() => ({}))) as { accountId?: string };
  const { results, error } = await checkDuesAccounts(body.accountId || undefined);
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ results });
}
