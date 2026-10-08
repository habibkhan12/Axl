/** Standalone headless test of the Salik balance flow (mirrors lib/dues-browser.ts). */
import { chromium } from "playwright";
import fs from "node:fs";

const fields = { plate_emirate: "Ajman", plate_code: "A", plate_number: "36975", registered_mobile: "506863454" };

fs.mkdirSync(".dues-browser-profile", { recursive: true });
const ctx = await chromium.launchPersistentContext(".dues-browser-profile", {
  headless: true,
  viewport: { width: 1366, height: 900 },
  locale: "en-US",
  args: ["--disable-blink-features=AutomationControlled"],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
try {
  await page.goto("https://www.salik.ae/en/support/salik-services-catalog/recharge-a-salik-account", { waitUntil: "load", timeout: 45000 });

  // Challenge / block handling (same policy as production).
  let cleared = false;
  for (let i = 0; i < 8; i++) {
    const title = await page.title();
    if (/attention required|sorry, you have been blocked/i.test(title)) {
      console.log("BLOCKED: portal is temporarily rate-limiting this IP — try again later.");
      process.exit(2);
    }
    if (!/just a moment/i.test(title)) { cleared = true; break; }
    await page.waitForTimeout(2500);
  }
  if (!cleared) { console.log("CHALLENGE DID NOT CLEAR"); process.exit(2); }

  await page.getByRole("button", { name: "Check my balance" }).click({ timeout: 15000 });
  await page.getByRole("textbox", { name: "Mobile Number" }).fill(fields.registered_mobile);

  const setSel = (index, match) =>
    page.evaluate(({ index, match }) => {
      const sel = document.querySelectorAll("select")[index];
      if (!sel) throw new Error("select " + index + " not found");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
      const opt = [...sel.options].find((o) => o.text.trim().toLowerCase() === match.toLowerCase());
      setter.call(sel, opt ? opt.value : match);
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }, { index, match });

  await setSel(0, fields.plate_emirate);
  await page.waitForTimeout(1500);
  await setSel(1, "Private");
  await page.waitForTimeout(2000);
  await page.evaluate((code) => {
    const sel = document.querySelectorAll("select")[2];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    const opt = [...sel.options].find((o) => o.text.trim().toUpperCase() === code);
    setter.call(sel, opt ? opt.value : sel.options[1]?.value ?? "");
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }, fields.plate_code);
  await page.waitForTimeout(500);
  await page.getByRole("textbox", { name: "Plate number" }).fill(fields.plate_number);
  await page.getByRole("button", { name: "Check balance" }).click();
  await page.waitForTimeout(4000);

  const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  const m = text.match(/Available balance\s+([\d,]+(?:\.\d+)?)\s*AED/i);
  if (m) console.log("SALIK LIVE OK — balance:", m[1], "AED");
  else {
    console.log("SALIK: pattern not found. Snippet:", text.slice(0, 300));
    process.exitCode = 1;
  }
} catch (e) {
  console.error("SALIK TEST FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await ctx.close();
  process.exit(process.exitCode ?? 0);
}
