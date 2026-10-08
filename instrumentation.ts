/**
 * Next.js instrumentation hook — starts the dues scheduler exactly once per
 * server process, wherever the app is hosted. First sweep ~90s after boot,
 * then every 6 hours. The checker itself lives in lib/dues-checkers.ts.
 *
 * On serverless hosts (Netlify/Vercel) this scheduler is DISABLED: functions
 * are ephemeral, so setInterval dies with the instance. The sweep runs from
 * GitHub Actions cron instead (.github/workflows/dues-cron.yml), which calls
 * POST /api/dues/check with the CRON_SECRET on the deployed site.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (
    process.env.NETLIFY ||
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME
  ) {
    console.log("[dues-scheduler] serverless host detected — scheduled sweeps run from cloud cron (GitHub Actions), not in-process.");
    return;
  }
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
