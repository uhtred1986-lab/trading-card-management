/**
 * #783: the no-target notice, proved in real Chrome on the fixture preview (dev server only — the
 * preview answers 404 in production).
 *
 *   npm run dev -- -p 3783
 *   npx tsx scripts/arena-no-target-783.mts [--base http://localhost:3783] [--out dir]
 *
 * Two scripted cases, at 360 x 800 in both skins:
 *
 *  - `?fixture=play&fx=no-target`: your leader's KO skill resolves with nothing to KO (the engine's
 *    `noEffect`), delivered on a snapshot that waits on the computer.
 *  - `?fixture=attack&fx=no-target-battle`: the same skill inside a battle, followed by the clash.
 *
 * For each: names the resolved effect without stealing focus or a modal scrim;
 * automatically dismisses after four seconds and releases the computer's held
 * advance once, without sending a game action. Screenshots before and after timeout.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { arg, Browser, requireServer, sleep } from "./lib/cdp.mts";

const base = (arg("base") ?? "http://localhost:3783").replace(/\/$/, "");
const out = arg("out") ?? join(process.cwd(), "docs", "arena-backlog", "evidence", "783");
mkdirSync(out, { recursive: true });
await requireServer(base);

let failed = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed++;
};

const browser = await Browser.launch();
try {
  for (const [fixture, fx] of [["play", "no-target"], ["attack", "no-target-battle"]] as const) {
    for (const skin of ["anime", "night"]) {
      const tag = `${fx}-${skin}`;
      const page = await browser.page({ name: "s21", width: 360, height: 800, mobile: true });
      await page.cdp("Emulation.setDeviceMetricsOverride", { width: 360, height: 800, deviceScaleFactor: 1, mobile: true });
      await page.beforeLoad(`window.__arenaPreviewDriver = { actions: [], advances: 0 };
        try { localStorage.setItem("arena.pace", "normal"); } catch {}
        addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = "nextjs-portal { display: none !important; }"; document.head.append(s); });`);
      await page.goto(`${base}/arena/preview?fixture=${fixture}&fx=${fx}&skin=${skin}&admin=0`);
      await page.waitFor(".arena", 60000);
      await page.waitFor("[data-arena-notice]", 20000);
      await page.settle(600);
      const text = await page.eval<string>(`document.querySelector("[data-arena-notice]").textContent`);
      check(/no valid target/i.test(text) && text.includes("Auto") && /KO it/.test(text), `${tag}: the notice names the card's skill and its effect — "${text.slice(0, 120)}…"`);
      check(await page.eval<boolean>(`document.activeElement !== document.querySelector("[data-arena-notice] button")`), `${tag}: a passive notice does not steal keyboard focus`);
      check(!(await page.eval<boolean>(`!!document.querySelector("[data-arena-notice-scrim]")`)), `${tag}: no modal scrim obscures the board`);
      writeFileSync(join(out, `s21-${skin}-${fx}-notice.jpg`), Buffer.from((await page.cdp<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 70 })).data, "base64"));
      await sleep(4500);
      const after = await page.eval<{ notice: boolean; advances: number; actions: number }>(`({ notice: !!document.querySelector("[data-arena-notice]"), advances: window.__arenaPreviewDriver.advances, actions: window.__arenaPreviewDriver.actions.length })`);
      check(!after.notice, `${tag}: passive notice dismisses automatically`);
      check(after.advances === 1 && after.actions === 0, `${tag}: timeout releases the held advance exactly once (${after.advances}), without a game action (${after.actions})`);
      writeFileSync(join(out, `s21-${skin}-${fx}-after-timeout.jpg`), Buffer.from((await page.cdp<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 70 })).data, "base64"));
      // A reload tells nothing again: the beats it has already seen are history.
      await page.goto(`${base}/arena/preview?fixture=${fixture}&skin=${skin}&admin=0`);
      await page.waitFor(".arena", 60000);
      await page.settle(1500);
      check(!(await page.eval<boolean>(`!!document.querySelector("[data-arena-notice]")`)), `${tag}: a board opened on a snapshot raises no notice for beats it did not watch`);
      await page.close();
    }
  }
} finally {
  await browser.close();
}
console.log(failed ? `\n${failed} check(s) failed` : "\nok");
if (failed) process.exitCode = 1;
