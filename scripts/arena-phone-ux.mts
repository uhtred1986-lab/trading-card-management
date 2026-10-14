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
    await page.beforeLoad('try { localStorage.setItem("arena.pace", "step"); } catch {}');
    for (const fixture of fixtures) for (const skin of ["anime", "night"]) {
      await page.setCookie("arenaSkin", skin, base);
      await page.goto(`${base}/arena/preview?fixture=${fixture}&skin=${skin}&pace=step&admin=0`);
      await page.waitFor(".arena");
      await page.settle(700);
      const facts = await page.eval<{ scroll: boolean; phase: boolean; cards: number; clippedReasons: number }>(`(() => {
        const phase = document.querySelector('.arena-phases-row');
        const box = phase?.getBoundingClientRect();
        const reasons = [...document.querySelectorAll('[data-target-reason]')];
        return { scroll: document.documentElement.scrollHeight > innerHeight + 2,
          phase: !!box && box.height > 0 && box.bottom <= innerHeight,
          cards: document.querySelectorAll('[data-arena-card]').length,
          clippedReasons: reasons.filter(e => e.scrollWidth > e.clientWidth + 1).length };
      })()`);
      const label = `360x${height}-${fixture}-${skin}`;
      results.push({ label, ...facts });
      if (check && facts.scroll) failures.push(`${label}: page scrolls`);
      if (check && !facts.phase) failures.push(`${label}: phase row unavailable`);
      if (check && facts.clippedReasons) failures.push(`${label}: target reason clipped`);
      writeFileSync(join(out, `${label}.jpg`), await page.screenshot());
      console.log(`${label}: scroll=${facts.scroll}, phase=${facts.phase}, cards=${facts.cards}`);
    }
    await page.close();
  }
} finally { await browser.close(); }
writeFileSync(join(out, "layout.json"), JSON.stringify({ base, results, failures }, null, 2) + "\n");
if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; }
