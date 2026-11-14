import "server-only";
import { salikBalance, dubaiPoliceFines, ajmanSewerageDue } from "./dues-browser";
import { duesProviderOf } from "./dues-providers";

/**
 * SERVER-ONLY. Dues checker + sequencer.
 *
 * Only portals whose automated lookup is proven live are checked here — all
 * three drive a real Chrome through the captcha worker
 * (scripts/dues-captcha-worker.mjs):
 *
 *   salik            — guest plate + mobile balance
 *   dubai_police     — fines by traffic code (TC) number
 *   ajman_sewerage   — balance by 10-digit account number
 *
 * Every other portal (EVG, Etihad WE, du, e&) is link-only: the check records a
 * "manual" status and the dashboard keeps showing the payment link.
 */

export type DuesCheckOutcome = {
  status: "ok" | "manual" | "error";
  amount_due?: number | null;
  message: string;
  extra?: Record<string, unknown>;
};

type Checker = (fields: Record<string, string>) => Promise<DuesCheckOutcome>;

/**
 * When a browser-based checker reports the serverless marker (no patchright/
 * Chrome on this host), report a clean "manual" status instead of leaking the
 * internal marker text.
 */
function isNoBrowserMarker(reason: string): boolean {
  return reason.includes("__SERVERLESS_NO_BROWSER__");
}

function manualCheck(name: string, reason: string): DuesCheckOutcome {
  if (isNoBrowserMarker(reason)) {
    return {
      status: "manual",
      message: `${name}: live checks run on the desktop/server host — open the payment link to check this account here.`,
    };
  }
  return { status: "error", message: `${name}: ${reason}` };
}

const CHECKERS: Record<string, Checker> = {
  dubai_police: async (f) => {
    const name = "Dubai Police";
    try {
      const r = await dubaiPoliceFines(f);
      return { status: "ok", amount_due: r.amount_due, message: r.message, extra: r.extra };
    } catch (e) {
      return manualCheck(name, e instanceof Error ? e.message : String(e));
    }
  },
  ajman_sewerage: async (f) => {
    const name = "Ajman Sewerage";
    try {
      const r = await ajmanSewerageDue(f);
      return { status: "ok", amount_due: r.amount_due, message: r.message, extra: r.extra };
    } catch (e) {
      return manualCheck(name, e instanceof Error ? e.message : String(e));
    }
  },
  salik: async (f) => {
    const name = "Salik";
    try {
      const r = await salikBalance(f);
      return { status: "ok", amount_due: r.amount_due, message: r.message, extra: r.extra };
    } catch (e) {
      return manualCheck(name, e instanceof Error ? e.message : String(e));
    }
  },
};

export function runDuesCheck(providerKey: string, fields: Record<string, string>): Promise<DuesCheckOutcome> {
  const provider = duesProviderOf(providerKey);
  if (!provider) {
    return Promise.resolve({ status: "error", message: `Unknown provider "${providerKey}".` });
  }
  const checker = provider.checkable ? CHECKERS[providerKey] : undefined;
  if (!checker) {
    return Promise.resolve({
      status: "manual",
      message: `${provider.name}: manual check — open the payment link to see the amount.`,
    });
  }
  return checker(fields).catch((e: unknown) => ({
    status: "error" as const,
    message: `Checker crashed: ${e instanceof Error ? e.message : String(e)}`,
  }));
}

// ─────────────────────────── Sequencer ─────────────────────────────────────

export type DuesRunResult = { accountId: string; providerKey: string; label: string; outcome: DuesCheckOutcome };

/** Check one account (or all active accounts) and persist a dues_checks row each. */
export async function checkDuesAccounts(accountId?: string): Promise<{ results: DuesRunResult[]; error?: string }> {
  const { getAdmin } = await import("./server-admin");
  const admin = getAdmin();
  if (!admin) return { results: [], error: "SUPABASE_NOT_CONFIGURED" };

  let query = admin.from("dues_accounts").select("id, provider_key, label, fields, active").eq("active", true);
  if (accountId) query = query.eq("id", accountId);
  const { data: accounts, error } = await query;
  if (error) return { results: [], error: error.message };

  const results: DuesRunResult[] = [];
  for (const acct of accounts ?? []) {
    const fields = (acct.fields ?? {}) as Record<string, string>;
    const outcome = await runDuesCheck(acct.provider_key, fields);
    const { error: insErr } = await admin.from("dues_checks").insert({
      account_id: acct.id,
      status: outcome.status,
      amount_due: outcome.amount_due ?? null,
      message: outcome.message,
      extra: outcome.extra ?? null,
    });
    if (insErr) {
      results.push({ accountId: acct.id, providerKey: acct.provider_key, label: acct.label, outcome: { status: "error", message: "Could not save check: " + insErr.message } });
    } else {
      results.push({ accountId: acct.id, providerKey: acct.provider_key, label: acct.label, outcome });
    }
  }

  // Housekeeping: keep 90 days of history.
  await admin
    .from("dues_checks")
    .delete()
    .lt("checked_at", new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString());

  return { results };
}
