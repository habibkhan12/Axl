/**
 * Next.js instrumentation hook — starts the dues scheduler exactly once per
 * server process, wherever the app is hosted. First sweep ~90s after boot,
 * then every 6 hours. The checker itself lives in lib/dues-checkers.ts.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const g = globalThis as { __axlDuesScheduler?: boolean };
  if (g.__axlDuesScheduler) return;
  g.__axlDuesScheduler = true;

  const SIX_HOURS = 6 * 60 * 60 * 1000;
  const tick = async () => {
    try {
      const { checkDuesAccounts } = await import("./lib/dues-checkers");
      const { results, error } = await checkDuesAccounts();
      if (error) console.error("[dues-scheduler]", error);
      else console.log("[dues-scheduler] checked", results.length, "monitored account(s)");
    } catch (e) {
      console.error("[dues-scheduler]", e);
    }
  };

  setTimeout(tick, 90_000);
  setInterval(tick, SIX_HOURS);
}
