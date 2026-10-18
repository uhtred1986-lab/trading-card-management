/** Milestone 23: real board fixture evidence. No database or game transport. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { arg, Browser } from "./lib/cdp.mts";

const base = arg("base") ?? "http://localhost:3000";
const out = resolve(arg("out") ?? "docs/arena-redesign/current/m23");
const fixtures = (arg("fixtures") ?? "play,charge,attack,defend,hand,refusal").split(",");
const check = process.argv.includes("--check");
mkdirSync(out, { recursive: true });
const browser = await Browser.launch();
const results: unknown[] = [];
const failures: string[] = [];
try {
  for (const height of [800, 650]) {
    const page = await browser.page({ name: `360x${height}`, width: 360, height, mobile: true });
    // These are layout fixtures, not saved matches. Keep the real poller but
    // answer its unchanged-revision request without touching a database.
    await page.interceptFetch("*/api/v1/games/*");
    page.onFetchPaused(({ requestId }) => { setTimeout(() => { void page.fulfillFetch(requestId, "", 204).catch(() => {}); }, 500); });
    await page.beforeLoad('try { localStorage.setItem("arena.pace", "step"); } catch {}');
    for (const fixture of fixtures) for (const skin of ["anime", "night"]) {
      await page.setCookie("arenaSkin", skin, base);
      await page.goto(`${base}/arena/preview?fixture=${fixture}&skin=${skin}&pace=step&admin=0`);
      await page.waitFor(".arena");
      await page.settle(700);
      const facts = await page.eval<{ defence: boolean; scroll: boolean; phase: boolean; cards: number; clippedReasons: number; obscuredRows: number; obscuredChips: number }>(`(() => {
        const phase = document.querySelector('.arena-phases-row');
        const box = phase?.getBoundingClientRect();
        const reasons = [...document.querySelectorAll('[data-target-reason]')];
        const dockTop = document.querySelector('.arena-bar')?.getBoundingClientRect().top ?? innerHeight;
        return { defence: !!document.querySelector("[data-defend-step]"), scroll: document.documentElement.scrollHeight > innerHeight + 2,
          phase: !!box && box.height > 0 && box.bottom <= innerHeight,
          cards: document.querySelectorAll('[data-arena-card]').length,
          clippedReasons: reasons.filter(e => e.scrollWidth > e.clientWidth + 1).length,
          obscuredChips: [...document.querySelectorAll('[data-hand-action]')].filter(e => {const r=e.getBoundingClientRect();return r.bottom>dockTop+1 || e.scrollHeight>e.clientHeight+1 || e.scrollWidth>e.clientWidth+1}).length,
          obscuredRows: [...document.querySelectorAll('.arena-row,.arena-pstrip,.arena-hand')].filter(e => e.getBoundingClientRect().bottom > dockTop + 1).length,
          height: document.documentElement.scrollHeight,
          boxes: [...document.querySelectorAll('.arena-topbar,.arena-row,.arena-pstrip,.arena-lane-battle,.arena-hand,.arena-bar')].map(e=>({class: e.className, y:e.getBoundingClientRect().y, height:e.getBoundingClientRect().height, bottom:e.getBoundingClientRect().bottom})) };
      })()`);
      const label = `360x${height}-${fixture}-${skin}`;
      results.push({ label, ...facts });
      if (check && facts.scroll && !facts.defence) failures.push(`${label}: page scrolls`);
      if (check && !facts.phase) failures.push(`${label}: phase row unavailable`);
      if (check && facts.clippedReasons) failures.push(`${label}: target reason clipped`);
      if (check && facts.obscuredRows && !facts.defence) failures.push(`${label}: board or hand covered by dock`);
      if (check && facts.obscuredChips) failures.push(`${label}: hand action chips clipped or covered by dock`);
      writeFileSync(join(out, `${label}.jpg`), await page.screenshot(false));
      console.log(`${label}: scroll=${facts.scroll}, phase=${facts.phase}, cards=${facts.cards}`);
    }
    await page.close();
  }
} finally { await browser.close(); }
writeFileSync(join(out, "layout.json"), JSON.stringify({ base, results, failures }, null, 2) + "\n");
if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; }
