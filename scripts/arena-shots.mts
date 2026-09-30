/**
 * Screenshots of the real arena board, drawn from `contract/fixtures/*.json`
 * through the dev-only `/arena/preview` route — no database (issue #343).
 *
 *   npm run dev                       # in one terminal
 *   npm run arena:shots               # play, attack, ko  x  anime, night  x  phone, desk
 *   npm run arena:shots -- --fixtures play,over --skins anime
 *   npm run arena:shots -- --all      # every Snapshot fixture
 *   npm run arena:shots -- --fixtures play --tap "[data-arena-card]" --tag review
 *   npm run arena:shots -- --fixtures play --hover "[data-arena-card]" --tag hover   # desktop: pointer over a card
 *   npm run arena:shots -- --fixtures play --rclick "[data-arena-card]" --tag pin     # desktop: right-click
 *   npm run arena:shots -- --fixtures play --query turn=banner --tag turn --settle 500   # extra preview params: the turn banner up
 *   npm run arena:shots -- --fixtures hand --drag "[data-arena-card]" --to '[data-arena-zone="p1:battle"]' --tag drag   # a drag in progress, held for the shot
 *   npm run arena:shots -- --fixtures ko --query fx=ko --settle 50 --on ".arena-fx-ko" --freeze 400 --tag fx   # an effect frozen mid-animation (preview-only ?fx=)
 *   npm run arena:shots -- --full     # whole scrolled page, not just the viewport
 *
 * Output: docs/arena-redesign/current/{phone,desk}-<fixture>-<skin>[-<tag>].jpg
 * (git-ignored), named like the reference frames in docs/arena-redesign/ so the
 * two sit side by side. Drives the installed Chrome over the DevTools protocol
 * (scripts/lib/cdp.mts) — no Playwright. Not in `npm test`: it needs a running
 * dev server and a browser.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { arg, Browser, requireServer, VIEWPORTS } from "./lib/cdp.mts";

const OUT = join(process.cwd(), "docs", "arena-redesign", "current");
const FIXTURES = join(process.cwd(), "contract", "fixtures");
const base = (arg("base") ?? "http://localhost:3000").replace(/\/$/, "");
const skins = (arg("skins") ?? "anime,night").split(",");
const tap = arg("tap");
const hover = arg("hover");
const rclick = arg("rclick");
// A drag held in progress: press on --drag, move to --to, and stay down (rd-03).
// `--release` lets go there instead, for the state after a drop.
const drag = arg("drag");
const dragTo = arg("to");
const dragRelease = process.argv.includes("--release");
const tag = arg("tag");
const settle = Number(arg("settle") ?? 1500);
const full = process.argv.includes("--full");
const staging = arg("staging");
const pace = arg("pace") ?? "step";
const query = arg("query");
// An effect caught mid-animation (rd-07): wait until --on <selector> is on the
// page, pause every running animation and set each to --freeze <ms>.
// Pair it with a preview-only ?fx= hook and a small --settle.
const freeze = arg("freeze");
const freezeOn = arg("on");

function allSnapshotFixtures(): string[] {
  return readdirSync(FIXTURES)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .filter((n) => {
      const j = JSON.parse(readFileSync(join(FIXTURES, `${n}.json`), "utf8"));
      return j && typeof j === "object" && "view" in j && "game" in j;
    });
}

const fixtures = process.argv.includes("--all") ? allSnapshotFixtures() : (arg("fixtures") ?? "play,attack,ko").split(",");
const viewports = arg("viewports") ? VIEWPORTS.filter((v) => arg("viewports")!.split(",").includes(v.name)) : VIEWPORTS;

mkdirSync(OUT, { recursive: true });
await requireServer(base);
const browser = await Browser.launch();
let written = 0;
try {
  for (const vp of viewports) {
    const page = await browser.page(vp);
    // The preview route pins pace with ?pace=, but a board that read its pace
    // from localStorage before that effect ran would still start slow.
    if ((tap || drag) && vp.mobile) await page.clipOverflow();
    await page.beforeLoad(`try { localStorage.setItem("arena.pace", ${JSON.stringify(pace)}); } catch {}`);
    for (const fixture of fixtures) {
      for (const skin of skins) {
        const url = `${base}/arena/preview?fixture=${fixture}&skin=${skin}&pace=${pace}${staging ? `&staging=${staging}` : ""}${query ? `&${query}` : ""}`;
        // The root layout skins <html> (and so the page behind the board) from
        // the cookie; `?skin=` only pins the board itself. Set both.
        await page.setCookie("arenaSkin", skin, base);
        await page.goto(url);
        await page.waitFor(".arena");
        await page.settle(settle);
        if (tap) {
          await page.tap(tap);
          await page.settle(600);
        }
        if (drag) {
          if (!dragTo) throw new Error("--drag needs --to <selector>");
          await page.dragTo(drag, dragTo, { release: dragRelease });
          await page.settle(300);
        }
        // Desktop only: a phone has no pointer to hover or right-click with.
        if (hover && !vp.mobile) {
          await page.hover(hover);
          await page.settle(400);
        }
        if (rclick && !vp.mobile) {
          await page.rightClick(rclick);
          await page.settle(400);
        }
        if (freeze) {
          if (freezeOn) await page.waitFor(freezeOn);
          await page.eval(`(() => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = ${Number(freeze)}; } })()`);
          // Not `settle`: that finishes every animation, which is the opposite of a freeze.
          await page.eval(`new Promise((r) => setTimeout(r, 200))`);
        }
        const file = join(OUT, `${vp.name}-${fixture}-${skin}${tag ? `-${tag}` : ""}.jpg`);
        writeFileSync(file, await page.screenshot(full));
        // A drag still held would leave a finger down on the next document.
        if (drag && !dragRelease) await page.pointer("up", 0, 0);
        written++;
        console.log(file);
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`\n${written} screenshot${written === 1 ? "" : "s"} in ${OUT}`);
