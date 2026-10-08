import "server-only";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

/**
 * SERVER-ONLY. Client for the captcha-solving browser worker
 * (scripts/dues-captcha-worker.mjs — patchright + persistent real-Chrome
 * profile, running headed-but-off-screen so portals trust it).
 *
 * Live-proven capabilities (Oct 2026):
 *  - reCAPTCHA v2: auto-pass OR audio challenge → ffmpeg → Google web-speech
 *    (free chromium key) → ranked candidates → token. Verified against the
 *    live Ajman portal repeatedly (2.3–2.5 kB tokens).
 *  - ajman-due: SPA UI-drive → due + premise parsed. Verified live:
 *    5380069820 → Ajman Industrial 2, Flat No 10 → 0.00 AED.
 *  - dubai-fines: direct details URL, verified live (0 fines → 0 AED).
 *  - salik-balance: guest flow, verified live earlier (112.8 AED, 36975 A).
 *
 * The worker is a long-lived child process (newline-JSON IPC on stdio). The
 * browser it owns keeps its clearance cookies between checks. If the worker
 * dies it is respawned on demand.
 */

export type Scraped = { amount_due: number | null; message: string; extra?: Record<string, unknown> };

/**
 * The captcha worker needs patchright + a real headed Chrome + ffmpeg — a
 * desktop-server capability. On serverless hosts (Netlify/Vercel Lambdas)
 * there is no display and no bundled Chrome, so every browser check reports
 * "manual" instead of crashing. HTTP-only checkers (Etihad WE, du, e&) are
 * unaffected. Point DUES_WORKER_URL at a always-on machine (e.g. the office
 * PC or a small VPS) running `node scripts/dues-captcha-worker-server.mjs`
 * to get live browser-based checks back on serverless.
 */
const REMOTE_WORKER_URL = process.env.DUES_WORKER_URL ?? "";

async function callRemoteWorker<T>(op: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(REMOTE_WORKER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ op, ...args }),
    signal: AbortSignal.timeout(240_000),
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; data?: T; error?: string } | null;
  if (!res.ok || !json?.ok) throw new Error(json?.error || "remote captcha worker failed (HTTP " + res.status + ")");
  return json.data as T;
}

function isServerless(): boolean {
  return !!(
    process.env.NETLIFY ||
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME
  );
}

/**
 * Browser ops route to the remote worker when DUES_WORKER_URL is set, else to
 * the local patchright worker (desktop servers only). On serverless with no
 * remote worker we throw — callers in dues-checkers.ts catch this and fall
 * back to the reachability probe (status "manual"), so the pipeline never
 * crashes just because it's hosted on a function platform.
 */
async function browserCheck<T>(
  op: string,
  args: Record<string, unknown>
): Promise<T> {
  if (REMOTE_WORKER_URL) return callRemoteWorker<T>(op, args);
  if (isServerless()) throw new Error("__SERVERLESS_NO_BROWSER__");
  return withRetry(() => callWorker<T>(op, args));
}

type Pending = { resolve: (v: never) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };
type WorkerMsg = { id: number; ok: boolean; data?: unknown; error?: string };

// Pending map uses `never` only to satisfy variance; resolution values are cast at call sites.
const pending = new Map<number, Pending>();

let worker: ChildProcessWithoutNullStreams | null = null;
let nextId = 1;
let workerBuf = "";
let workerDead = false;

function killWorker() {
  if (worker) {
    try { worker.kill(); } catch {}
    worker = null;
  }
  workerDead = true;
}

function spawnWorker(): ChildProcessWithoutNullStreams {
  const script = path.join(process.cwd(), "scripts", "dues-captcha-worker.mjs");
  if (!fs.existsSync(script)) throw new Error("captcha worker script missing: " + script);
  const w = spawn(process.execPath, [script], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }) as ChildProcessWithoutNullStreams;
  workerDead = false;
  w.stdout.setEncoding("utf8");
  w.stderr.setEncoding("utf8");
  w.stderr.on("data", (d: string) => {
    // worker logs go to server log for debugging
    if (process.env.DUES_DEBUG) process.stderr.write("[dues-worker] " + d);
  });
  w.stdout.on("data", (chunk: string) => {
    workerBuf += chunk;
    let i: number;
    while ((i = workerBuf.indexOf("\n")) !== -1) {
      const line = workerBuf.slice(0, i).trim();
      workerBuf = workerBuf.slice(i + 1);
      if (!line) continue;
      let msg: WorkerMsg;
      try { msg = JSON.parse(line) as WorkerMsg; } catch { continue; }
      const p = pending.get(msg.id);
      if (!p) continue;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) (p.resolve as (v: unknown) => void)(msg.data);
      else p.reject(new Error(msg.error || "worker error"));
    }
  });
  w.on("exit", () => {
    worker = null;
    // fail all pending
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error("Captcha worker exited unexpectedly."));
    }
    pending.clear();
  });
  return w;
}

function callWorker<T = unknown>(op: string, args: Record<string, unknown>, timeoutMs = 240_000): Promise<T> {
  if (workerDead || !worker) worker = spawnWorker();
  const w = worker;
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      // A timed-out op usually means the browser is stuck; recycle the worker.
      killWorker();
      reject(new Error("Portal check timed out (worker recycled)."));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    w.stdin.write(JSON.stringify({ id, op, ...args }) + "\n");
  });
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 2, waitMs = 20_000): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = String(e instanceof Error ? e.message : e);
      // hard blockers: don't retry
      if (/temporarily blocking automated access|needs|not recognised|timed out/i.test(msg)) throw e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

// ─────────────────────────── public API ───────────────────────────

export async function ajmanSewerageDue(fields: Record<string, string>): Promise<Scraped> {
  const acc = (fields.account_number ?? "").trim();
  if (!acc) throw new Error("Ajman Sewerage check needs an account number.");
  const out = await browserCheck<{ results?: Array<{ due?: number | null; premise?: string | null; raw?: string | null }> }>("ajman-due", { accounts: [acc] });
  const r = out?.results?.[0];
  if (!r) throw new Error("Ajman Sewerage: no result returned.");
  if (r.due === null || r.due === undefined) {
    throw new Error("Ajman Sewerage: could not read the due" + (r.raw ? " (" + String(r.raw).slice(0, 120) + ")" : ""));
  }
  return {
    amount_due: Number(r.due),
    message: "Ajman Sewerage due for account " + acc + (r.premise ? " — " + r.premise : ""),
    extra: { kind: "utility", premise: r.premise ?? undefined },
  };
}

export async function salikBalance(fields: Record<string, string>): Promise<Scraped> {
  const out = await browserCheck<{ amount_due: number; message: string; extra?: Record<string, unknown> }>("salik-balance", fields);
  return { amount_due: Number(out.amount_due), message: String(out.message), extra: out.extra };
}

export async function dubaiPoliceFines(fields: Record<string, string>): Promise<Scraped> {
  const out = await browserCheck<{ amount_due: number; message: string; extra?: Record<string, unknown> }>("dubai-fines", fields);
  return { amount_due: Number(out.amount_due), message: String(out.message), extra: out.extra };
}

/** Fire-and-forget health probe used by the scheduler warm-up. */
export async function workerPing(): Promise<boolean> {
  try {
    if (REMOTE_WORKER_URL) return await callRemoteWorker("ping", {});
    if (isServerless()) return false;
    await callWorker("ping", {}, 30_000);
    return true;
  } catch {
    return false;
  }
}

export function stopDuesWorker() {
  killWorker();
}
