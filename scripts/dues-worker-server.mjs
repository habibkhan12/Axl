/**
 * Dues worker HTTP bridge — run this on an ALWAYS-ON desktop/server (Windows
 * with Chrome + ffmpeg installed) when the app itself is hosted on Netlify.
 *
 *   set DUES_WORKER_TOKEN=some-long-random-string
 *   node scripts/dues-worker-server.mjs        # listens on :8787
 *
 * Then in Netlify set the env var DUES_WORKER_URL to
 *   http://<that-machine>:8787/worker   (expose via Tailscale/VPN — do NOT
 *   put it on the public internet without the token)
 *
 * Protocol: POST { op, ...args } with header Authorization: Bearer <token>.
 * Responds { ok: true, data } or { ok: false, error }. Ops are the same ones
 * the in-process IPC worker speaks: ping, ajman-due, salik-balance,
 * dubai-fines, solve-recaptcha.
 */
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DUES_WORKER_PORT || 8787);
const TOKEN = process.env.DUES_WORKER_TOKEN || "";

if (!TOKEN) {
  console.error("Refusing to start without DUES_WORKER_TOKEN set (the bridge has no auth otherwise).");
  process.exit(1);
}

// Reuse the existing stdio worker as the engine.
const worker = spawn(process.execPath, [path.join(DIR, "dues-captcha-worker.mjs")], {
  stdio: ["pipe", "pipe", "pipe"],
});
worker.stderr.setEncoding("utf8");
worker.stderr.on("data", (d) => process.stderr.write("[engine] " + d));

const pending = new Map();
let buf = "";
let nextId = 1;
worker.stdout.setEncoding("utf8");
worker.stdout.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    const p = pending.get(msg.id);
    if (!p) continue;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.ok) p.resolve(msg.data);
    else p.reject(new Error(msg.error || "worker error"));
  }
});
worker.on("exit", () => {
  for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error("worker engine exited")); }
  pending.clear();
  console.error("[bridge] worker engine exited — restart the bridge.");
  process.exit(1);
});

function callEngine(op, args, timeoutMs = 240_000) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("engine timed out")); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    worker.stdin.write(JSON.stringify({ id, op, ...args }) + "\n");
  });
}

const server = http.createServer(async (req, res) => {
  if (req.url !== "/worker" || req.method !== "POST") {
    res.writeHead(404).end();
    return;
  }
  if ((req.headers.get?.("authorization") ?? req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim() !== TOKEN) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "bad token" }));
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  let msg;
  try { msg = JSON.parse(body); } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "invalid JSON" }));
    return;
  }
  const { op, ...args } = msg ?? {};
  try {
    const data = await callEngine(String(op || ""), args);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, data }));
  } catch (e) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
  }
});

server.listen(PORT, () => console.log(`[bridge] dues worker bridge on http://0.0.0.0:${PORT}/worker`));
