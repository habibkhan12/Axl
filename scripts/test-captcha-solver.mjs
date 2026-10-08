/**
 * PoC v3 — patchright best practices:
 *  - launchPersistentContext with real Chrome channel, NO automation args
 *  - locator-only interactions on Google pages (no page.evaluate)
 *  - human-paced typing; network-layer audio capture
 *  - Whisper-tiny.en ASR in a second tab of the same browser (WASM, cached)
 */
import { chromium } from "patchright";
import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DEMO_URL = process.env.TARGET_URL || "https://www.google.com/recaptcha/api2/demo";
const PROFILE = path.resolve(".captcha-profile");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-400)))));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Whisper ASR in a tab of the same persistent context ----
async function makeInBrowserASR(context) {
  const page = await context.newPage();
  await page.goto("https://huggingface.co/404-does-not-exist", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await page.evaluate(async () => {
    try {
      const { pipeline, env } = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5");
      env.useBrowserCache = true;
      window.__asr = await pipeline("automatic-speech-recognition", "onnx-community/whisper-base.en", { dtype: "q8", device: "wasm" });
      window.__asrReady = true;
    } catch (e) {
      window.__asrErr = String(e).slice(0, 400);
    }
  });
  for (let i = 0; i < 90; i++) {
    const st = await page.evaluate(() => ({ ready: !!window.__asrReady, err: window.__asrErr || null }));
    if (st.ready) break;
    if (st.err) throw new Error("ASR init failed: " + st.err);
    await sleep(2000);
  }
  return async (wavBase64) =>
    page.evaluate(async (b64) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const actx = new AudioContext({ sampleRate: 16000 });
      const decoded = await actx.decodeAudioData(bytes.buffer);
      const out = await window.__asr(decoded.getChannelData(0));
      return out.text;
    }, wavBase64);
}

const frameBy = (page, frag) => page.frames().find((f) => f.url().includes(frag));

// ---- run ----
const context = await chromium.launchPersistentContext(PROFILE, {
  headless: process.env.HEADLESS === "1",
  channel: "chrome",
  viewport: null, // real window size
  serviceWorkers: "allow",
  args: process.env.HEADLESS === "1" ? [] : ["--window-position=-32000,-32000"], // headed but invisible
});
const page = context.pages()[0] || (await context.newPage());

// global network recorder
const seen = [];
page.on("response", (r) => { if (!r.url().startsWith("data:")) seen.push(r.status() + " " + r.url()); });

await page.goto(DEMO_URL, { waitUntil: "domcontentloaded" });
await sleep(2000);

const asr = await makeInBrowserASR(context);
console.log("ASR ready — solving…");

// 1. tick the checkbox (locator-only)
const anchor = frameBy(page, "anchor");
await anchor.locator(".recaptcha-checkbox-border").click();
await sleep(4000);

// did it auto-pass?
const anchorFrame = page.frames().find((f) => f.url().includes("anchor"));
const anchorChecked = await anchorFrame.locator(".recaptcha-checkbox-checked").count();
console.log("auto-pass:", anchorChecked > 0);

// wait for token to populate in the textarea
await sleep(1500);
let token = await page.locator("#g-recaptcha-response").inputValue().catch(() => "");
if (anchorChecked > 0 && token) {
  console.log("TOKEN (auto-pass) len:", token.length, token.slice(0, 30));
  await context.close();
  process.exit(0);
}

// 2. challenge frame — audio button
let bframe = frameBy(page, "bframe");
if (!bframe) { console.log("NO CHALLENGE SHOWN"); process.exit(2); }
const audioBtn = bframe.locator("#recaptcha-audio-button");
if ((await audioBtn.count()) === 0) { console.log("no audio button; text:", await bframe.locator("body").innerText().then((t) => t.slice(0, 150))); process.exit(3); }
console.log("audio btn disabled?", await audioBtn.isDisabled());
await audioBtn.click();
await sleep(3000);

// re-lookup frame
bframe = frameBy(page, "bframe");
const challengeText = await bframe.locator("body").innerText().catch(() => "(gone)");
console.log("challenge text:", JSON.stringify(challengeText.slice(0, 200)));

// 3. press PLAY — record network
const playSel = ".rc-audiochallenge-play-button button, button[title*='lay']";
await bframe.locator(playSel).first().click({ timeout: 15000 }).catch(() => {});
await sleep(5000);
bframe = frameBy(page, "bframe");
console.log("after play:", JSON.stringify((await bframe.locator("body").innerText().catch(() => "(gone)")).slice(0, 200)));

const media = seen.filter((u) => /audio|mp3|payload/i.test(u));
console.log("media-ish:", media.slice(-6).join(" | "));

// 4. fetch audio bytes via browser session
let mp3 = null;
for (const u of media.reverse()) {
  const url = u.replace(/^\d+ /, "");
  try {
    const r = await page.request.get(url);
    if (r.status() === 200) {
      const body = await r.body();
      const magic = body.subarray(0, 3).toString("latin1");
      if (magic === "ID3" || magic.startsWith("\u00ff\u00fb")) { mp3 = body; break; } // real audio only
    }
  } catch {}
}
if (!mp3) throw new Error("no audio bytes captured");
console.log("audio bytes:", mp3.length, "magic:", mp3.subarray(0, 3).toString("latin1"));
if (mp3.length < 1000 || !/ID3|\u00ff\u00fb/.test(mp3.subarray(0, 3).toString("latin1"))) console.log("WARN: payload may not be audio");
const tmp = path.resolve(".asr-tmp");
fs.mkdirSync(tmp, { recursive: true });
const stamp = Date.now();
const mp3p = path.join(tmp, `challenge-${stamp}.mp3`);
const wavp = path.join(tmp, `challenge-${stamp}.wav`);
fs.writeFileSync(mp3p, mp3);
await runFfmpeg(["-y", "-i", mp3p, "-af", "highpass=f=200,lowpass=f=3400,dynaudnorm", "-ar", "16000", "-ac", "1", "-sample_fmt", "s16", wavp]);
console.log("ffmpeg ok, wav size:", fs.statSync(wavp).size);

// 5. transcribe + submit with human pacing
const text = await asr(fs.readFileSync(wavp).toString("base64"));
console.log("ASR text (whisper):", JSON.stringify(text));
// also ask Google's free web-speech endpoint for a second opinion + alternatives
let gAlt = [];
try {
  const flacp = path.join(tmp, `challenge-${stamp}.flac`);
  await runFfmpeg(["-y", "-i", mp3p, "-vn", "-ar", "16000", "-ac", "1", "-f", "flac", flacp]);
  const gResp = await fetch("https://www.google.com/speech-api/v2/recognize?client=chromium&lang=en-US&key=AIzaSyBOti4mM-6x9WDnZIjIeyEU21OpBXqWBgw", {
    method: "POST",
    headers: { "content-type": "audio/x-flac; rate=16000" },
    body: fs.readFileSync(flacp),
  });
  const gText = await gResp.text();
  gAlt = [...gText.matchAll(/"transcript":"([^"]+)"/g)].map((m) => m[1]);
  console.log("google stt alternatives:", JSON.stringify(gAlt));
} catch (e) { console.log("google stt failed (continuing with whisper):", String(e).slice(0, 80)); }

// candidate list: whisper + google alternatives, normalized
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const candidates = [...new Set([norm(text), ...gAlt.map(norm)])].filter(Boolean);
if (candidates.length === 0) throw new Error("no transcription candidates");

let solved = false;
for (const cand of candidates) {
  bframe = frameBy(page, "bframe");
  const box = bframe.locator("#audio-response");
  await box.fill("");
  await box.pressSequentially(cand, { delay: 60 });
  await bframe.locator("#recaptcha-verify-button").click();
  await sleep(4000);
  bframe = frameBy(page, "bframe");
  const now = await bframe.locator("body").innerText().catch(() => "");
  console.log("tried:", JSON.stringify(cand), "→ challenge now:", JSON.stringify(now.slice(0, 80)));
  if (!/enter what you hear|play/i.test(now) || /verified|expired/i.test(now) === false && now.length < 40) {
    // check token — the only reliable success signal
  }
  const t = await page.locator("#g-recaptcha-response").inputValue().catch(() => "");
  if (t && t.length > 20) { solved = true; console.log("SOLVED with:", JSON.stringify(cand)); break; }
  // challenge failed — request a fresh audio challenge and try next candidate against NEW audio
  const newAudio = bframe.locator("#recaptcha-audio-button");
  if ((await newAudio.count()) > 0 && (await bframe.locator("body").innerText().catch("")).includes("Enter what you hear")) {
    console.log("(retrying with fresh audio for next candidate)");
  }
}
const finalToken = await page.locator("#g-recaptcha-response").inputValue().catch(() => "");
console.log("TOKEN len:", finalToken.length, finalToken ? finalToken.slice(0, 30) : "(empty)");
console.log("challenge now:", JSON.stringify((await frameBy(page, "bframe").locator("body").innerText().catch(() => "(gone)")).slice(0, 120)));
await context.close();
process.exit(finalToken ? 0 : 1);
