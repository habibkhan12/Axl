import "server-only";
import { salikBalance, dubaiPoliceFines, ajmanSewerageDue } from "./dues-browser";

/**
 * SERVER-ONLY. Dues checker + sequencer.
 *
 * v1 contract per portal: we probe the portal over plain HTTP. Where the
 * portal exposes a captcha-free data endpoint we read live amounts (status
 * "ok"); where it is gated behind reCAPTCHA / WAF the check returns status
 * "manual" (portal reachable, human verification needed) and the dashboard
 * keeps showing the payment link. This keeps the pipeline, history and
 * notifications real today, while Phase 2 (headless browser) upgrades
 * individual checkers to live amounts without any UI/data-model change.
 */

export type DuesCheckOutcome = {
  status: "ok" | "manual" | "error";
  amount_due?: number | null;
  message: string;
  extra?: Record<string, unknown>;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

async function probe(url: string): Promise<{ reachable: boolean; httpStatus: number; blocked: boolean }> {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });
    const body = res.url.includes("quick-pay") || url.includes("eand") ? await res.text().catch(() => "") : "";
    const blocked = /request rejected|access denied|captcha-required/i.test(body);
    return { reachable: res.ok, httpStatus: res.status, blocked };
  } catch {
    return { reachable: false, httpStatus: 0, blocked: false };
  }
}

/** Reachability probe + honest status. Phase 2 swaps bodies for live scraping. */
async function reachabilityCheck(name: string, url: string): Promise<DuesCheckOutcome> {
  const { reachable, httpStatus, blocked } = await probe(url);
  if (!reachable) {
    return { status: "error", message: `${name}: portal unreachable (HTTP ${httpStatus || "network error"}) from the server.` };
  }
  if (blocked) {
    return { status: "manual", message: `${name}: portal reachable but bot-shielded — open the payment link to check this account.` };
  }
  return {
    status: "manual",
    message: `${name}: portal reachable; live amount needs human verification (portal captcha) — use the payment link. Phase 2 automates this.`,
  };
}

type Checker = (fields: Record<string, string>) => Promise<DuesCheckOutcome>;

const CHECKERS: Record<string, Checker> = {
  evg: async () => ({
    status: "manual",
    message: "EVG needs a login — link-only. Pursue an EVG Organization (fleet) account for fleet-wide fines.",
  }),
  dubai_police: async (f) => {
    try {
      const r = await dubaiPoliceFines(f);
      return { status: "ok", amount_due: r.amount_due, message: r.message, extra: r.extra };
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      const probe = await reachabilityCheck("Dubai Police", "https://www.dubaipolice.gov.ae/app/services/fine-payment/search");
      return { ...probe, message: reason + " — " + probe.message };
    }
  },
  ajman_sewerage: async (f) => {
    // LIVE: captcha worker solves reCAPTCHA (auto-pass or audio→Google STT) and
    // drives the SPA's own form. Verified live Oct 2026.
    try {
      const r = await ajmanSewerageDue(f);
      return { status: "ok", amount_due: r.amount_due, message: r.message, extra: r.extra };
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      const probe = await reachabilityCheck("Ajman Sewerage", "https://www.ajmansewerage.ae/quickpay");
      return { ...probe, message: reason + " — " + probe.message };
    }
  },
  etihad_we: () =>
    reachabilityCheck(
      "Etihad WE",
      "https://online.etihadwe.ae/QuickBillPay/index.cfm?fuseaction=home.OUJBOEJEMTdFNURENTY3QzcyNDAyOEE1MDI5OTEzMTA1NUMzOEVCMzZBMjg2NkU3MkIxRjAyNEZGMjJDNjNDMQ==&z=1"
    ),
  salik: async (f) => {
    // Live first (headless browser — verified working), fall back to probe status.
    try {
      const r = await salikBalance(f);
      return { status: "ok", amount_due: r.amount_due, message: r.message, extra: r.extra };
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      const probe = await reachabilityCheck("Salik", "https://www.salik.ae/en/support/salik-services-catalog/recharge-a-salik-account");
      return { ...probe, message: reason + " — " + probe.message };
    }
  },
  du: () => reachabilityCheck("du", "https://myaccount.du.ae/webapp/en/quick-pay"),
  eand: () => reachabilityCheck("e&", "https://www.eand.ae/ecare/c/quick-pay"),
};

export function runDuesCheck(providerKey: string, fields: Record<string, string>): Promise<DuesCheckOutcome> {
  const checker = CHECKERS[providerKey];
  if (!checker) {
    return Promise.resolve({ status: "error", message: `Unknown provider "${providerKey}".` });
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
