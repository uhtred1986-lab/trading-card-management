/**
 * Opt-in, local-only Arena preview frame-interval sample.
 * Start with `DATABASE_URL='' npm run dev`, then run
 * `DATABASE_URL='' npx tsx scripts/arena-perf-browser.mts`.
 * The reported rAF intervals and Long Task observations are browser scheduling
 * metrics, not a claim about React render CPU time or physical-phone latency.
 */
import { Browser, requireServer, VIEWPORTS } from "./lib/cdp.mts";

const base = (process.env.ARENA_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const fixtures = ["play", "over"];
const count = 120;

function quantile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] * 100) / 100;
}

await requireServer(base);
const browser = await Browser.launch();
const metrics = [];
try {
  for (const viewport of VIEWPORTS) {
    for (const fixture of fixtures) {
      const page = await browser.page(viewport);
      await page.beforeLoad(`window.__arenaPerfLongTasks = []; try { new PerformanceObserver((list) => window.__arenaPerfLongTasks.push(...list.getEntries().map((e) => e.duration))).observe({ type: "longtask", buffered: true }); } catch {}`);
      await page.goto(`${base}/arena/preview?fixture=${fixture}&skin=night&pace=step&admin=0`);
      await page.waitFor(".arena");
      await page.settle(300);
      const values = await page.eval<number[]>(`new Promise((resolve) => {
        const values = []; let previous;
        const tick = (now) => { if (previous !== undefined) values.push(now - previous); previous = now; if (values.length >= ${count}) resolve(values); else requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      })`);
      const longTasksMs = await page.eval<number[]>("window.__arenaPerfLongTasks ?? []");
      metrics.push({
        viewport: viewport.name,
        fixture,
        phase: "animationFrameInterval",
        samples: values.length,
        p50Ms: quantile(values, 0.5),
        p95Ms: quantile(values, 0.95),
        framesOver50Ms: values.filter((value) => value > 50).length,
        longTaskCount: longTasksMs.length,
        longestLongTaskMs: longTasksMs.length ? Math.round(Math.max(...longTasksMs) * 100) / 100 : 0,
      });
      await page.close();
    }
  }
} catch {
  console.error(JSON.stringify({ benchmark: "arena-perf-browser", failed: true, errorType: "BrowserMeasurementFailed" }));
  process.exitCode = 1;
} finally {
  await browser.close();
}
if (!process.exitCode) console.log(JSON.stringify({ browser: "headless Chromium", localOnly: true, metrics }, null, 2));
