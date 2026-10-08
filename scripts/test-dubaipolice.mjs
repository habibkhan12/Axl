/** Standalone headless test of the Dubai Police TC fines flow. */
import { chromium } from "playwright";
import fs from "node:fs";

const TC = process.argv[2] || "4070054504";

fs.mkdirSync(".dues-browser-profile", { recursive: true });
const ctx = await chromium.launchPersistentContext(".dues-browser-profile", {
  headless: true,
  viewport: { width: 1366, height: 900 },
  locale: "en-US",
  args: ["--disable-blink-features=AutomationControlled"],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
try {
  await page.goto(`https://www.dubaipolice.gov.ae/app/services/fine-payment/details?tcNumber=${TC}`, { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(5000);
  const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  console.log("URL:", page.url());
  console.log("CONGRATS:", /congratulations|no outstanding fines/i.test(text));
  console.log("AMOUNTS:", JSON.stringify([...text.matchAll(/AED\s*([\d,]+(?:\.\d+)?)/gi)].map((m) => m[1])));
  console.log("SNIPPET:", text.slice(0, 600));
} catch (e) {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await ctx.close();
  process.exit(process.exitCode ?? 0);
}
