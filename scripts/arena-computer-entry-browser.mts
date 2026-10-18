#!/usr/bin/env node
/**
 * #896: "Play the computer" on the Arena Play tab, in real Chrome against a dev server with no database.
 *
 *   npm run dev -- -p 3466          # DATABASE_URL empty: open mode, everyone is an SL
 *   npx tsx scripts/arena-computer-entry-browser.mts --base http://localhost:3466 --out <dir> [--skins anime,night]
 *
 * `/arena` itself reads decks from the database, so this drives the dev-only fixture route
 * `/arena/setup-preview?view=play` (SL only, absent in production), which mounts the same
 * `ComputerPlayCard` and `PlayPicker` the page mounts. It checks, at 390x844 and 1440x900:
 *   - an unprepared device, a prepared one and one with a saved match each get their own wording and button;
 *   - no horizontal scroll, the button is at least 44 px tall and links to /arena/offline;
 *   - the picker offers the built-in computer beside Claude, and says Claude uses AI tokens;
 *   - the button leads to the "Play the computer" page, which says no AI tokens are used.
 * and writes a screenshot per viewport and theme. Exit 0 ok, 1 a check failed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { arg, Browser, requireServer, VIEWPORTS } from "./lib/cdp.mts";

const base = (arg("base") ?? "http://localhost:3466").replace(/\/$/, "");
const out = arg("out") ?? join(process.cwd(), "arena-computer-shots");
const skins = (arg("skins") ?? "anime,namek,korin,night,instinct").split(",");
const PREPARED = "dbs-arena-offline-prepared";
const POINTER = "dbs-arena-local-pointer";
const pointer = JSON.stringify({ matchId: "m1", gameId: 1, packHash: "h", packId: "p", decks: { p1: "a", p2: "b" }, human: "p2", names: { p1: "Goku starter", p2: "Vegeta starter" }, savedAt: 1 });
const states = {
  new: "",
  prepared: `localStorage.setItem(${JSON.stringify(PREPARED)}, "1");`,
  saved: `localStorage.setItem(${JSON.stringify(PREPARED)}, "1"); localStorage.setItem(${JSON.stringify(POINTER)}, ${JSON.stringify(pointer)});`,
} as const;

let failed = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failed++; };

mkdirSync(out, { recursive: true });
await requireServer(base);
const browser = await Browser.launch();
try {
  for (const vp of VIEWPORTS) {
    const page = await browser.page(vp);
    for (const [state, seed] of Object.entries(states)) {
      for (const skin of state === "new" ? skins : skins.slice(0, 1)) {
        await page.beforeLoad(`try { localStorage.clear(); ${seed} } catch {}`);
        await page.setCookie("arenaSkin", skin, base);
        await page.goto(`${base}/arena/setup-preview?view=play`);
        await page.waitFor("[data-computer-play]");
        await page.settle(500);
        const info = await page.eval<{ text: string; cta: string; href: string; h: number; overflow: boolean; chip: string }>(`(() => {
          const card = document.querySelector("[data-computer-play]");
          const cta = card.querySelector("[data-computer-play-cta]");
          return { text: card.textContent, cta: cta.textContent, href: cta.getAttribute("href"), h: cta.getBoundingClientRect().height,
            overflow: document.documentElement.scrollWidth > innerWidth + 1, chip: document.querySelector("[data-opponent-computer]")?.textContent ?? document.body.textContent };
        })()`);
        const tag = `${vp.name}/${state}/${skin}`;
        check(info.href === "/arena/offline", `${tag}: button leads to /arena/offline`);
        check(!vp.mobile || info.h >= 44, `${tag}: button is ${Math.round(info.h)} px tall`);
        check(!info.overflow, `${tag}: no horizontal scroll`);
        check(/no AI tokens/.test(info.text), `${tag}: says no AI tokens`);
        const want = state === "saved" ? /Continue your match/ : state === "prepared" ? /Start a match/ : /Set up and play/;
        check(want.test(info.cta), `${tag}: button says "${info.cta.trim()}"`);
        if (state === "saved") check(/Vegeta starter|Goku starter/.test(info.text) && /second/.test(info.text), `${tag}: names the saved match and seat`);
        if (vp.mobile) {
          // The opponent chips live in the setup sheet on a phone; the desktop shows them inline.
          const open = await page.eval<boolean>(`!!document.querySelector("[data-match-setup-open]")`);
          check(open || state !== "new", `${tag}: match setup reachable`);
        } else if (state === "new") {
          check(/Built-in computer/.test(info.chip) && /uses AI tokens/.test(await page.eval<string>(`document.body.textContent`)), `${tag}: picker offers the computer and marks Claude as paid`);
        }
        writeFileSync(join(out, `${vp.name}-${state}-${skin}.png`), await page.screenshot(false));
      }
    }
    // The button works: it lands on the existing offline page, worded as the computer, not Claude.
    await page.beforeLoad(`try { localStorage.clear(); } catch {}`);
    await page.goto(`${base}/arena/setup-preview?view=play`);
    await page.waitFor("[data-computer-play-cta]");
    await page.tap("[data-computer-play-cta]");
    await page.waitFor("h1");
    await page.eval(`new Promise((r) => { const t = Date.now(); const i = setInterval(() => { if (location.pathname === "/arena/offline" || Date.now() - t > 20000) { clearInterval(i); r(0); } }, 100); })`);
    await page.settle(1500);
    const dest = await page.eval<{ path: string; h1: string; text: string }>(`({ path: location.pathname, h1: document.querySelector("h1")?.textContent ?? "", text: document.body.textContent })`);
    check(dest.path === "/arena/offline" && dest.h1 === "Play the computer", `${vp.name}: button opens /arena/offline titled "${dest.h1}"`);
    check(/not Claude/.test(dest.text) && /no AI tokens/.test(dest.text), `${vp.name}: that page says it is not Claude and uses no AI tokens`);
    writeFileSync(join(out, `${vp.name}-offline-page.png`), await page.screenshot(false));
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(failed ? `\n${failed} check(s) failed` : `\nall checks passed; screenshots in ${out}`);
process.exit(failed ? 1 : 0);
