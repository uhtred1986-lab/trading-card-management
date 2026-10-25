/**
 * Focused visual smoke for the character banner (#1105). Needs a dev server (`npm run dev`), no database.
 *
 *   npx tsx scripts/arena-banner-smoke.mts --base http://127.0.0.1:3000 --out .banner-smoke
 *
 * For each immersion fixture effect and width it opens `/arena/preview?fixture=immersion&fx=…&pace=slow`,
 * waits for the banner, records its `data-*` contract attributes at the windup and release phases, and
 * captures the release frame. The banner is transient (≤1100 ms), so the frame is taken from a static
 * clone made at release with its animations paused; the live banner is left to finish on its own.
 * Also checks reduced motion (static result, no phases) and page overflow. Prints one JSON line per shot.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { arg, Browser, sleep, type Viewport } from "./lib/cdp.mts";

const base = arg("base") ?? "http://127.0.0.1:3000";
const out = resolve(arg("out") ?? ".banner-smoke");
mkdirSync(out, { recursive: true });
const effects = (arg("fx") ?? "immersion-attack,immersion-hit,immersion-block,immersion-negated").split(",");
const viewports: Viewport[] = [
  { name: "1440", width: 1440, height: 900, mobile: false },
  { name: "1024", width: 1024, height: 768, mobile: true },
  { name: "390", width: 390, height: 844, mobile: true },
];

// Runs in the page: watch for the banner, note its phases, clone it at release and freeze the clone.
const WATCH = `(() => {
  const seen = { phases: [], attrs: null, frozen: false };
  window.__banner = seen;
  const freeze = (node) => {
    if (seen.frozen) return;
    seen.frozen = true;
    const clone = node.cloneNode(true);
    clone.setAttribute("data-smoke-clone", "");
    clone.querySelector("button")?.remove();
    document.body.appendChild(clone);
    requestAnimationFrame(() => { for (const a of clone.getAnimations({ subtree: true })) { a.currentTime = Math.min(260, Number(a.effect?.getTiming().duration) || 260); a.pause(); } });
  };
  const look = () => {
    const node = document.querySelector("[data-combat-banner]:not([data-smoke-clone])");
    if (!node) return;
    const phase = node.getAttribute("data-phase");
    if (seen.phases.at(-1) !== phase) seen.phases.push(phase);
    seen.attrs = { kind: node.getAttribute("data-combat-banner"), role: node.getAttribute("data-role"), neutral: node.getAttribute("data-neutral"), pose: node.querySelector("[data-pose]")?.getAttribute("data-pose") ?? null, contact: !!node.querySelector("[data-contact]"), label: node.querySelector("[role=status]")?.textContent ?? "" };
    // A banner without phases (before #1105) is frozen as soon as it appears.
    if (phase === "release" || phase === null) setTimeout(() => freeze(node), 40);
  };
  new MutationObserver(look).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-phase", "data-combat-banner"] });
})();`;

const browser = await Browser.launch();
const results: object[] = [];
try {
  for (const vp of viewports) {
    for (const reduced of [false, true]) {
      const page = await browser.page(vp);
      if (reduced) await page.cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
      await page.beforeLoad(`document.addEventListener("DOMContentLoaded", () => { ${WATCH} });`);
      for (const fx of reduced ? effects.slice(0, 1) : effects) {
        const url = `${base}/arena/preview?fixture=immersion&fx=${fx}&pace=slow&skin=anime`;
        await page.goto(url);
        await page.waitFor(".arena");
        let state: { phases: string[]; attrs: Record<string, unknown> | null; frozen: boolean } | null = null;
        for (let i = 0; i < 60; i++) {
          state = await page.eval(`window.__banner ?? null`);
          if (state?.frozen) break;
          await sleep(100);
        }
        await sleep(150);
        const overflow = await page.eval<boolean>(`document.documentElement.scrollWidth > window.innerWidth + 1`);
        const name = `${fx}-${vp.name}${reduced ? "-reduced" : ""}.png`;
        writeFileSync(join(out, name), await page.screenshot(false, "png"));
        const line = { fx, width: vp.name, reduced, ...state, overflow, shot: join(out, name) };
        results.push(line);
        console.log(JSON.stringify(line));
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
}
writeFileSync(join(out, "smoke.json"), JSON.stringify(results, null, 2));
