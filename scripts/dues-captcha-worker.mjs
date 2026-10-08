/**
 * PRODUCTION captcha-solving worker. Spawned as a child process by the Next.js
 * server (lib/dues-browser.ts) — keeps patchright OUT of the bundler.
 *
 * Protocol (stdin/stdout, newline-delimited JSON):
 *   → { id, op: "ping" | "solve-recaptcha", url }
 *   ← { id, ok: true, data: {...} } | { id, ok: false, error: string }
 *
 * Proven live (Oct 2026):
 *  - patchright persistent Chrome (headed, off-screen) auto-passes Ajman's reCAPTCHA
 *    (checkbox tick, no challenge) and yields a 2276-char token.
 *  - Fallback: audio challenge → ffmpeg → Google web-speech v2 (free) ranked
 *    alternatives → submit. Proven: "vertical line test" → 2382-char token.
 */
import { chromium } from "patchright";
import ffmpegPath from "ffmpeg-static";
import { spawn as spawnProc } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PROFILE = path.resolve(DIR, "..", ".captcha-profile");
const TMP = path.resolve(DIR, "..", ".asr-tmp");
const GKEY = "AIzaSyBOti4mM-6x9WDnZIjIeyEU21OpBXqWBgw"; // public chromium web-speech key

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawnProc(ffmpegPath, args, { windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-300)))));
  });
}

// ---------- browser singleton ----------
let ctxPromise = null;
function getContext() {
  if (!ctxPromise) {
    ctxPromise = chromium
      .launchPersistentContext(PROFILE, {
        headless: false,
        channel: "chrome",
        viewport: null,
        serviceWorkers: "allow",
        args: ["--window-position=-32000,-32000"], // headed but off-screen
      })
      .catch((e) => {
        ctxPromise = null;
        throw e;
      });
  }
  return ctxPromise;
}

const frameBy = (page, frag) => page.frames().find((f) => f.url().includes(frag));

async function googleStt(flacPath) {
  const r = await fetch("https://www.google.com/speech-api/v2/recognize?client=chromium&lang=en-US&key=" + GKEY, {
    method: "POST",
    headers: { "content-type": "audio/x-flac; rate=16000" },
    body: fs.readFileSync(flacPath),
  });
  const text = await r.text();
  return [...text.matchAll(/"transcript":"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * Solve a reCAPTCHA v2 widget on the given page. Returns the g-response token.
 * Strategy: tick checkbox → auto-pass? done : audio challenge → Google STT
 * alternatives → submit each until token appears.
 */
export async function solveRecaptchaOnPage(page, log = () => {}) {
  const seen = [];
  page.on("response", (r) => { if (!r.url().startsWith("data:")) seen.push(r.status() + " " + r.url()); });

  const anchor = frameBy(page, "anchor");
  if (!anchor) throw new Error("no recaptcha anchor iframe found");
  await anchor.locator(".recaptcha-checkbox-border").click({ timeout: 20000 });
  await sleep(4000);

  const anchorFrame = frameBy(page, "anchor");
  if ((await anchorFrame.locator(".recaptcha-checkbox-checked").count()) > 0) {
    await sleep(1200);
    const token = await page.locator("#g-recaptcha-response").inputValue().catch(() => "");
    if (token && token.length > 20) return { token, mode: "auto-pass" };
  }

  // audio challenge path (image challenges are NOT solvable — force audio via reload if needed)
  let bframe;
  try {
    bframe = await clickAudioChallenge(page);
  } catch (e) {
    // challenge area may show an image grid first; the audio button lives behind the reload flow
    const bf = frameBy(page, "bframe");
    const reload = bf && bf.locator("#recaptcha-reload-button, button[id*='reload']").first();
    if (reload && (await reload.count()) > 0) {
      await reload.click().catch(() => {});
      await sleep(2500);
      bframe = await clickAudioChallenge(page);
    } else throw e;
  }

  for (let attempt = 0; attempt < 6; attempt++) {
    const mp3 = await fetchAudioBytes(page, seen);
    if (!mp3) throw new Error("no audio bytes captured");

    fs.mkdirSync(TMP, { recursive: true });
    const stamp = Date.now() + "-" + attempt;
    const mp3p = path.join(TMP, `c-${stamp}.mp3`);
    const flacp = path.join(TMP, `c-${stamp}.flac`);
    fs.writeFileSync(mp3p, mp3);
    await runFfmpeg(["-y", "-i", mp3p, "-vn", "-ar", "16000", "-ac", "1", "-f", "flac", flacp]);

    const alts = await googleStt(flacp);
    log("stt alternatives: " + JSON.stringify(alts));
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
    const candidates = [...new Set(alts.map(norm))].filter(Boolean);

    for (const cand of candidates) {
      bframe = frameBy(page, "bframe");
      const box = bframe.locator("#audio-response");
      await box.fill("");
      await box.pressSequentially(cand, { delay: 60 });
      await bframe.locator("#recaptcha-verify-button").click();
      await sleep(4000);
      const token = await page.locator("#g-recaptcha-response").inputValue().catch(() => "");
      if (token && token.length > 20) return { token, mode: "audio:" + cand };
    }

    if (candidates.length === 0) log("attempt " + attempt + ": no stt output, refreshing challenge");
    // failed → fresh audio challenge for the next attempt
    const nb = await newAudioChallenge(page);
    if (!nb) throw new Error("could not request a new audio challenge");
  }
  throw new Error("audio challenge failed after retries");
}

// ---------- ops ----------
async function fetchAudioBytes(page, seen) {
  const media = seen.filter((u) => /payload/i.test(u) && u.startsWith("200"));
  for (const u of media.reverse()) {
    try {
      const r = await page.request.get(u.replace(/^\d+ /, ""));
      if (r.status() !== 200) continue;
      const body = await r.body();
      const magic = body.subarray(0, 3).toString("latin1");
      if (magic === "ID3" || magic.startsWith("\u00ff\u00fb")) return body;
    } catch {}
  }
  return null;
}

async function clickAudioChallenge(page) {
  let bframe = frameBy(page, "bframe");
  if (!bframe) throw new Error("challenge did not appear after checkbox");
  const audioBtn = bframe.locator("#recaptcha-audio-button");
  if ((await audioBtn.count()) === 0) throw new Error("no audio challenge available (image-only)");
  if (await audioBtn.isDisabled().catch(() => true)) throw new Error("audio challenge disabled (risk engine)");
  await audioBtn.click();
  await sleep(3000);
  bframe = frameBy(page, "bframe");
  const playSel = ".rc-audiochallenge-play-button button, button[title*='lay']";
  await bframe.locator(playSel).first().click({ timeout: 15000 }).catch(() => {});
  await sleep(5000);
  return bframe;
}

async function newAudioChallenge(page) {
  // click the "new challenge" (reload/refresh) button inside bframe, then play
  const bframe = frameBy(page, "bframe");
  if (!bframe) return null;
  const reload = bframe.locator("#recaptcha-reload-button, button[title*='ew challenge'], button[id*='reload']").first();
  if ((await reload.count()) === 0) return null;
  await reload.click().catch(() => {});
  await sleep(3000);
  const b2 = frameBy(page, "bframe");
  const playSel = ".rc-audiochallenge-play-button button, button[title*='lay']";
  await b2.locator(playSel).first().click({ timeout: 15000 }).catch(() => {});
  await sleep(5000);
  return b2;
}

/**
 * Full Ajman Sewerage due lookup — PROVEN LIVE (Oct 2026).
 * Drives the SPA's own UI: solve captcha → fill account → Continue → parse
 * "Account\tDetails\tTotal" row. The SPA's axios handles token exchange.
 * Returns { results: [{ accountId, due, premise }] }.
 */
async function opAjmanDue({ accounts }) {
  const context = await getContext();
  const page = await context.newPage();
  try {
    await page.goto("https://www.ajmansewerage.ae/quickpay", { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(3000);
    const { token } = await solveRecaptchaOnPage(page, (m) => console.error("[worker] " + m));
    console.error("[worker] ajman token: " + String(token).slice(0, 24) + "…");

    const results = [];
    for (const acc of accounts) {
      try {
        // back to the account form if we advanced past it
        if (!(await page.locator('input[placeholder*="10 digit"], input[placeholder*="ccount"]').first().isVisible().catch(() => false))) {
          await page.goto("https://www.ajmansewerage.ae/quickpay", { waitUntil: "domcontentloaded", timeout: 60000 });
          await sleep(3000);
          // re-solve only if the widget is fresh AND unticked
          const anchor2 = frameBy(page, "anchor");
          const unticked = anchor2 && (await anchor2.locator(".recaptcha-checkbox-border:not(.recaptcha-checkbox-checked)").count()) > 0 && (await anchor2.locator(".recaptcha-checkbox-checked").count()) === 0;
          if (unticked) {
            const t2 = await solveRecaptchaOnPage(page, (m) => console.error("[worker] " + m));
            console.error("[worker] re-solved for " + acc);
          } else {
            console.error("[worker] captcha still valid for " + acc);
          }
        }
        const input = page.locator('input[placeholder*="10 digit"], input[placeholder*="ccount"]').first();
        await input.waitFor({ timeout: 20000 });
        await input.fill(acc);
        const btn = page
          .locator('button:has-text("Continue"), button:has-text("Submit"), #accountsForm button[type=submit], .quickpay-form-btn button')
          .first();
        await btn.click();
        await sleep(9000);
        const body = await page.locator("body").innerText().catch(() => "");
        // parse the billing row: "<acc>\t<details>\t...\t<amount>"
        const lines = body.split("\n").map((l) => l.trim());
        const idx = lines.findIndex((l) => l === acc);
        let due = null;
        let premise = null;
        if (idx !== -1) {
          premise = lines[idx + 1] || null;
          // amount appears in the same row block; find a number after the premise
          for (let j = idx + 1; j < Math.min(idx + 6, lines.length); j++) {
            const m = lines[j].match(/([0-9]+(?:\.[0-9]{1,2})?)$/);
            if (m) { due = parseFloat(m[1]); break; }
          }
        }
        if (due === null && /Please enter an amount greater than 1 AED/i.test(body)) {
          due = 0; // account valid, zero due (page shows 0.00)
        }
        results.push({ accountId: acc, due, premise });
      } catch (e) {
        results.push({ accountId: acc, due: null, raw: String(e && e.message ? e.message : e).slice(0, 200) });
      }
    }
    return { results };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Salik balance via the guest flow (proven live: 112.8 AED for plate 36975 A).
 * Runs in the shared patchright browser — real Chrome fingerprint beats the
 * Cloudflare challenges that hit plain Playwright.
 */
async function opSalikBalance(fields) {
  const emirate = fields.plate_emirate ?? "Dubai";
  const plate = (fields.plate_number ?? "").trim();
  const mobile = (fields.registered_mobile ?? "").replace(/\D/g, "");
  if (!plate || !mobile) throw new Error("Salik check needs a plate number and the registered mobile.");

  const context = await getContext();
  const page = await context.newPage();
  try {
    await page.goto("https://www.salik.ae/en/support/salik-services-catalog/recharge-a-salik-account", {
      waitUntil: "load", timeout: 60000,
    });
    await sleep(2500);
    if (/attention required|just a moment/i.test(await page.title())) {
      throw new Error("Salik is temporarily blocking automated access (Cloudflare). Will retry next scheduled check.");
    }
    await page.getByRole("button", { name: "Check my balance" }).click({ timeout: 15000 });
    await page.getByRole("textbox", { name: "Mobile Number" }).fill(mobile, { timeout: 15000 });
    const pickSelect = async (index, value) => {
      await page.evaluate(({ index, value }) => {
        const sel = document.querySelectorAll("select")[index];
        if (!sel) throw new Error("select not found");
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
        const opt = [...sel.options].find((o) => o.text.trim().toLowerCase() === value.toLowerCase() || o.value === value);
        setter.call(sel, opt ? opt.value : value);
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }, { index, value });
      await sleep(1500);
    };
    await pickSelect(0, emirate);
    await pickSelect(1, "Private");
    const code = (fields.plate_code ?? "A").trim().toUpperCase();
    await page.evaluate((code) => {
      const sel = document.querySelectorAll("select")[2];
      if (!sel) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
      const opt = [...sel.options].find((o) => o.text.trim().toUpperCase() === code);
      setter.call(sel, opt ? opt.value : sel.options[1] ? sel.options[1].value : "");
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }, code);
    await page.getByRole("textbox", { name: "Plate number" }).fill(plate);
    await page.getByRole("button", { name: "Check balance" }).click({ timeout: 15000 });
    await sleep(5000);
    const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
    const m = text.match(/Available balance\s+([\d,]+(?:\.\d+)?)\s*AED/i);
    if (m) return { amount_due: Number(m[1].replace(/,/g, "")), message: "Salik balance for plate " + plate + " " + emirate, extra: { kind: "balance" } };
    if (/not found|no record|invalid/i.test(text)) throw new Error("Salik: plate/mobile combination not recognised.");
    throw new Error("Salik: balance element not found — portal layout may have changed.");
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Dubai Police fines via the direct details URL (verified live: no captcha,
 * "Congratulations! You have no outstanding fines" detection works).
 */
async function opDubaiFines(fields) {
  const tc = (fields.tc_number ?? "").trim();
  if (!tc) throw new Error("Dubai Police check needs a traffic code (TC) number.");
  const context = await getContext();
  const page = await context.newPage();
  try {
    await page.goto("https://www.dubaipolice.gov.ae/app/services/fine-payment/details?tcNumber=" + encodeURIComponent(tc), {
      waitUntil: "load", timeout: 60000,
    });
    await sleep(5000);
    const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
    if (/congratulations|no outstanding fines/i.test(text)) {
      return { amount_due: 0, message: "Dubai Police: no outstanding fines for TC " + tc, extra: { kind: "fines" } };
    }
    const total = text.match(/total(?:\s*(?:fines|amount|payable|due))*[^A-Za-z0-9]{0,25}AED?\s*([\d,]+(?:\.\d+)?)/i) || text.match(/AED\s*([\d,]+(?:\.\d+)?)\s*(?:to be paid|total|payable)/i);
    if (total) return { amount_due: Number(total[1].replace(/,/g, "")), message: "Dubai Police fines for TC " + tc, extra: { kind: "fines" } };
    const amounts = [...text.matchAll(/AED\s*([\d,]+(?:\.\d+)?)/gi)].map((m) => Number(m[1].replace(/,/g, "")));
    if (amounts.length) return { amount_due: Math.max(...amounts), message: "Dubai Police fines for TC " + tc + " (largest listed amount)", extra: { kind: "fines", amounts: amounts.slice(0, 10) } };
    throw new Error("Dubai Police: could not read the fines result — check manually.");
  } finally {
    await page.close().catch(() => {});
  }
}

async function opSolveRecaptcha({ url }) {
  const context = await getContext();
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(2500);
    const { token, mode } = await solveRecaptchaOnPage(page, (m) => console.error("[worker] " + m));
    return { token, mode };
  } finally {
    await page.close().catch(() => {});
  }
}

const OPS = {
  ping: async () => ({ pong: true }),
  "solve-recaptcha": opSolveRecaptcha,
  "ajman-due": opAjmanDue,
  "salik-balance": opSalikBalance,
  "dubai-fines": opDubaiFines,
};

// ---------- IPC loop ----------
const pending = new Map();
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    const { id, op } = msg;
    const fn = OPS[op];
    if (!fn) {
      process.stdout.write(JSON.stringify({ id, ok: false, error: "unknown op " + op }) + "\n");
      continue;
    }
    fn(msg)
      .then((data) => process.stdout.write(JSON.stringify({ id, ok: true, data }) + "\n"))
      .catch((e) => process.stdout.write(JSON.stringify({ id, ok: false, error: String(e && e.message ? e.message : e).slice(0, 500) }) + "\n"));
  }
});
process.stdin.on("end", () => process.exit(0));
process.stderr.write("[dues-captcha-worker] ready\n");
