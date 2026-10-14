/**
 * #783: the phone match layout, proved in real Chrome over `/arena/local` (no database).
 *
 *   npm run dev -- -p 3783                      # or `next start` on a build
 *   npx tsx scripts/arena-phone-board-783.mts [--base http://localhost:3783] [--out dir] [--tag after] [--viewports s21,s21plus,desk] [--skins anime,night]
 *
 * One local match per viewport and skin, the audited SD15/SD5 pack chosen in the page's own picker and
 * started from the page's own Start button. The human's moves go through the page's `LocalBoard.act`
 * (the session the board was handed), the computer's through the board's own advance. At each key step
 * the first time it comes up — mulligan, main (with a card on the field), combo, a choice, the end — the
 * board's playback is skipped and the screen is shot, and what a player would feel is measured:
 *
 *   - `pageScroll`: how far the document can scroll (0 is a one-screen board);
 *   - `chrome`: whether the app's header or tab bar is on the page;
 *   - `leaders`: the "Leader" labels the board draws (both sides).
 *
 * A notice the board raises (`[data-arena-notice]`, the no-target acknowledgement) is answered with its OK
 * button, and counted. Writes `<out>/783-<tag>.json` beside the screenshots. Exit 1 when a phone viewport
 * (`s21`, `s21plus`) scrolls during a turn, shows app chrome, or misses a Leader label; `--tag before`
 * only records.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { arg, Browser, requireServer, sleep, type Page, type Viewport } from "./lib/cdp.mts";
import { BOARD, choosePack } from "./lib/local-arena-page.mts";
import { auditPack } from "./verify/arena-local-worker-fixture.mts";
import type { Snapshot } from "../src/lib/arena/snapshot-core.ts";
import type { Action, LegalAction } from "../src/lib/arena/types.ts";

const base = (arg("base") ?? "http://localhost:3783").replace(/\/$/, "");
const out = arg("out") ?? join(process.cwd(), "docs", "arena-backlog", "evidence", "783");
const tag = arg("tag") ?? "after";
/** `--text 200`: the root font size, for the 200 % text check (rem-sized text grows; the layout must not overlap). */
const TEXT = arg("text") ?? "";
const ALL: Viewport[] = [
  { name: "s21", width: 360, height: 800, mobile: true },
  { name: "s21plus", width: 412, height: 915, mobile: true },
  { name: "desk", width: 1440, height: 900, mobile: false },
  // The S21's Chrome with its address and navigation bars shown: what the owner's screenshot measures (about 360 x 655).
  { name: "s21browser", width: 360, height: 650, mobile: true },
];
const PHONES = new Set(["s21", "s21plus", "s21browser"]);
const viewports = arg("viewports") ? ALL.filter((v) => arg("viewports")!.split(",").includes(v.name)) : ALL;
const skins = (arg("skins") ?? "anime,night").split(",");
const STEPS = ["mulligan", "main", "combo", "choice", "end"] as const;
type Step = (typeof STEPS)[number];
mkdirSync(out, { recursive: true });
await requireServer(base);

const pack = JSON.stringify(await auditPack());
const BOARD_NOW = `((window.__bc && !window.__bc.closed && window.__bc.snapshot) ? window.__bc : (window.__bc = ${BOARD}))`;

/** Which key step a snapshot is, from the human's chair (null: not one we shoot). */
function stepOf(s: Snapshot): Step | null {
  if (s.game.status === "over" || s.over) return "end";
  if (s.decision?.actor !== s.game.you || !s.legal.length) return null;
  const k = s.view.prompt.kind;
  if (k === "mulligan") return "mulligan";
  if (k === "combo") return "combo";
  if (k === "main") return s.view.you.battle.length + s.view.them.battle.length > 0 ? "main" : null;
  if (["chooseCards", "chooseMode", "blocker", "counter", "optionalCost", "payCost", "replaceMove", "zEnergyFromCombo", "offering"].includes(k)) return "choice";
  return null;
}

/** The human's move: keep the hand, play what can be played, attack, then end; take a choice's first card. */
function pick(s: Snapshot, seen: Set<Step>): Action {
  const legal = s.legal as LegalAction[];
  const of = (...types: string[]) => legal.find((l) => types.includes(l.action.type))?.action;
  const k = s.view.prompt.kind;
  if (k === "mulligan") return of("mulligan", "pass") ?? legal[0].action;
  if (k === "combo") {
    // Add one combo card the first time, so the shot after it shows a combo in place; then pass.
    const add = !seen.has("combo") ? legal.find((l) => l.action.type === "combo" && (l.action as { card?: string | null }).card) : undefined;
    return add?.action ?? of("pass") ?? legal[0].action;
  }
  if (k === "main") return of("play", "attack") ?? of("endMain", "pass") ?? legal[0].action;
  if (k === "chooseCards") return legal.find((l) => l.action.type === "choose" && (l.action as { cards: string[] }).cards.length > 0)?.action ?? legal[0].action;
  return of("pay", "payCost", "choose", "block", "pass") ?? legal[0].action;
}

const report: Record<string, unknown>[] = [];
let failed = 0;
const browser = await Browser.launch();

async function measure(page: Page) {
  return page.eval<{ pageScroll: number; chrome: boolean; leaders: number; notice: string | null }>(`(() => ({
    pageScroll: Math.max(0, document.scrollingElement.scrollHeight - innerHeight),
    chrome: !!document.querySelector("header nav, nav[aria-label], body > div header") && !!document.querySelector("header") && getComputedStyle(document.querySelector("header")).display !== "none",
    leaders: document.querySelectorAll("[data-leader-label]").length,
    notice: document.querySelector("[data-arena-notice]")?.textContent ?? null,
  }))()`);
}

try {
  for (const vp of viewports) {
    for (const skin of skins) {
      const page = await browser.page(vp);
      // Phones at DPR 1 too: the evidence stays small, and the layout is the CSS pixels'.
      await page.cdp("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile });
      await page.setCookie("arenaSkin", skin, base);
      await page.beforeLoad(`try { localStorage.setItem("arena.pace", "normal"); localStorage.removeItem("dbs-arena-local-pointer"); } catch {}
        // The dev server's own badge is not the board's (absent from a production build).
        addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = "nextjs-portal { display: none !important; }" + (${JSON.stringify(TEXT)} ? " html { font-size: ${TEXT}% !important; }" : ""); document.head.append(s); });`);
      await page.goto(`${base}/arena/local?skin=${skin}`);
      await page.waitFor("input[type=file]");
      await choosePack(page, pack);
      await page.eval(`new Promise((r) => { const t = setInterval(() => { if (document.body.textContent.includes("New match")) { clearInterval(t); r(true); } }, 100); })`);
      await page.eval(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Start match").click()`);
      await page.waitFor(".arena", 60000);
      const seen = new Set<Step>();
      const notices: string[] = [];
      const t0 = Date.now();
      let moves = 0;
      let waitingSince = null as { key: string; at: number } | null;
      while (Date.now() - t0 < 240000 && moves < 400) {
        // A notice waits for its OK before anything else moves.
        const notice = await page.eval<string | null>(`document.querySelector("[data-arena-notice]")?.textContent ?? null`);
        if (notice) {
          if (!notices.length) {
            // The first one is shot, as the player meets it.
            await page.settle(500);
            const shot = await page.cdp<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 70 });
            writeFileSync(join(out, `${vp.name}-${skin}-notice-${tag}.jpg`), Buffer.from(shot.data, "base64"));
            console.log(`${vp.name} ${skin} notice: ${notice}`);
          }
          notices.push(notice);
          await page.eval(`document.querySelector("[data-arena-notice] button").click()`);
          await sleep(200);
          continue;
        }
        const raw = await page.eval<string | null>(`(() => { const b = ${BOARD_NOW}; return b && b.snapshot && b.state.kind === "owner" ? JSON.stringify(b.snapshot) : null; })()`);
        if (!raw) { await sleep(150); continue; }
        const s = JSON.parse(raw) as Snapshot;
        const step = stepOf(s);
        const human = s.game.status !== "over" && s.decision?.actor === s.game.you && s.legal.length > 0;
        if (step && !seen.has(step)) {
          // The story first: skip what is still playing, then let the board settle.
          for (let i = 0; i < 40; i++) {
            const playing = await page.eval<boolean>(`[...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Skip")`);
            if (!playing) break;
            await page.eval(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Skip")?.click()`);
            await sleep(250);
          }
          if (await page.eval<boolean>(`!!document.querySelector("[data-arena-notice]")`)) continue;
          await page.settle(900);
          const file = join(out, `${vp.name}-${skin}-${step}-${tag}.jpg`);
          const shot = await page.cdp<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 70 });
          writeFileSync(file, Buffer.from(shot.data, "base64"));
          const m = await measure(page);
          seen.add(step);
          report.push({ viewport: vp.name, skin, step, file: basename(file), ...m });
          console.log(`${vp.name} ${skin} ${step}: scroll ${m.pageScroll}px, chrome ${m.chrome}, leader labels ${m.leaders}`);
          if (tag !== "before" && !TEXT && PHONES.has(vp.name)) {
            if (m.pageScroll > 0 && step !== "end") { failed++; console.log(`  FAIL: the page scrolls ${m.pageScroll}px at ${step}`); }
            if (m.chrome) { failed++; console.log("  FAIL: app chrome on the board"); }
            if (step !== "end" && step !== "mulligan" && m.leaders < 2) { failed++; console.log(`  FAIL: ${m.leaders} Leader label(s)`); }
          }
        }
        if (step === "end") { if (process.env.DEBUG783) console.log(`  end: ${s.game.status} ${JSON.stringify(s.over)}`); break; }
        if (human) {
          const action = pick(s, seen);
          if (process.env.DEBUG783) console.log(`  ${s.view.prompt.kind} -> ${JSON.stringify(action)}`);
          const err = await page.eval<string | null>(`${BOARD_NOW}.act(${JSON.stringify(action)}, ${s.game.revision}, crypto.randomUUID()).then((r) => r.error)`);
          moves++;
          if (err) await sleep(300);
        } else {
          // The computer's turn: the page's own advance (a direct `act` above bypasses the board's `send`,
          // which is what normally asks for it). Give the board's own request a moment first, so the two
          // never race ("the computer is still thinking").
          const key = `${s.game.revision}`;
          if (waitingSince?.key !== key) { waitingSince = { key, at: Date.now() }; await sleep(200); continue; }
          if (Date.now() - waitingSince.at < 2500) { await sleep(200); continue; }
          waitingSince = null;
          const err = await page.eval<string | null>(`${BOARD_NOW}.advance().then((r) => r.error)`);
          if (err) await sleep(300);
        }
      }
      const missing = STEPS.filter((st) => !seen.has(st));
      report.push({ viewport: vp.name, skin, moves, missing, notices });
      console.log(`${vp.name} ${skin}: ${moves} human moves; notices acknowledged ${notices.length}; not reached: ${missing.join(", ") || "none"}`);
      await page.close();
      // Written as it goes, so a long run that is stopped keeps what it measured.
      writeFileSync(join(out, `783-${tag}${TEXT ? `-text${TEXT}` : ""}.json`), JSON.stringify(report, null, 2));
    }
  }
} finally {
  await browser.close();
}
writeFileSync(join(out, `783-${tag}${TEXT ? `-text${TEXT}` : ""}.json`), JSON.stringify(report, null, 2));
if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exitCode = 1;
} else console.log("\nok");
