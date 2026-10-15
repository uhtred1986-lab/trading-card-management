/** Dev-only board screenshots from the same EngineAPI state and preview service. */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Browser, requireServer, sleep, type Viewport } from "./lib/cdp.mts";
import { buildSnapshot } from "../src/lib/arena/snapshot.ts";
import { RULES } from "../src/lib/arena/vm/index.ts";
import { previewGameplan } from "../src/lib/arena/gameplan-preview.ts";
import { planMoves, sameValue } from "../src/lib/arena/gameplan-types.ts";
import { planActions, planCtx, planState } from "./verify/gameplan-fixture-570.ts";

const base = process.argv.find((arg) => arg.startsWith("--base="))?.slice(7) ?? "http://localhost:3024";
const fixtureDir = resolve(process.argv.find((arg) => arg.startsWith("--fixture-dir="))?.slice(14) ?? "contract/fixtures");
const before = process.argv.includes("--before");
const evidence = resolve(process.argv.find((arg) => arg.startsWith("--evidence="))?.slice(11) ?? "docs/arena-backlog/evidence/570");
const boardPath = join(fixtureDir, "u08-gameplan-board.json");
const proofPath = join(fixtureDir, "u08-gameplan-proof.json");
const assets = resolve("docs/arena-backlog/evidence/546/assets");
const images = {
  "PLAN-READY": { front: "http://arena-561-art.local/BT1-055", back: null },
  V1: { front: "http://arena-561-art.local/BT11-053", back: null },
};
const state = planState();
const actions = planActions(state);
const snapshot = buildSnapshot({
  id: 570, revision: 7, mode: "versus", status: "playing", p1Name: "You", p2Name: "Opponent",
  ctx: planCtx, state, legal: RULES.legalActions(planCtx, state), log: [], beats: null,
  spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer: "p1", images,
});
const first = previewGameplan({ ctx: planCtx, state, art: images, player: "p1", actions: actions.slice(0, 1) });
const second = previewGameplan({ ctx: planCtx, state, art: images, player: "p1", actions });
assert.equal(first.steps.length, 2);
assert.deepEqual(second.steps.map((step) => step.budget.ready), [2, 1, 0]);
mkdirSync(evidence, { recursive: true });
writeFileSync(boardPath, JSON.stringify(snapshot));
if (!before) writeFileSync(proofPath, JSON.stringify({ snapshot, actions, first, second }));
await requireServer(base);
const browser = await Browser.launch();
const viewports: Viewport[] = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
try {
  for (const skin of ["night", "anime"]) for (const viewport of viewports) {
    const page = await browser.page(viewport);
    try {
      await page.setCookie("arenaSkin", skin, base);
      await page.interceptFetch(["http://arena-561-art.local/*", "*api/v1/games/570*"]);
      page.onFetchPaused((request) => {
        if (request.request.url.includes("/api/v1/games/570")) {
          void page.fulfillFetch(request.requestId, JSON.stringify(snapshot)).catch(() => undefined);
          return;
        }
        const whis = request.request.url.includes("BT1-055");
        void page.fulfillFetchBytes(request.requestId, readFileSync(join(assets, whis ? "whis-coercion-bt1-055.webp" : "senzu-bean-bt11-053.jpg")), whis ? "image/webp" : "image/jpeg").catch(() => undefined);
      });
      await page.goto(`${base}/arena/preview?${before ? "fixture=u08-gameplan-board" : "gameplan=1"}&skin=${skin}&admin=0`);
      await page.waitFor("[data-decision-summary]");
      await page.settle(550);
      await page.eval("document.querySelector('nextjs-portal')?.remove()");
      assert(await page.eval<boolean>("[...document.querySelectorAll('img')].some(img => img.complete && img.naturalWidth > 0)"), "real artwork painted");
      writeFileSync(join(evidence, `${before ? "before" : "after-board"}-${viewport.name}-${skin}.jpg`), await page.screenshot(false));
      if (before) continue;
      assert.equal(await page.eval<number>("document.querySelectorAll('.arena-bar [data-gameplan]').length"), 0, "planner does not crowd the turn prompt");
      await page.tap('[aria-label="Open arena settings and counts"]');
      await page.waitFor("[data-plan-open]");
      await page.tap("[data-plan-open]");
      await page.waitFor("#gameplan-first");
      const firstIndex = planMoves(snapshot.legal, "p1").findIndex((move) => sameValue(move.action, actions[0]));
      assert(firstIndex >= 0);
      await page.eval(`(() => { const select=document.querySelector('#gameplan-first'); select.value='${firstIndex}'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
      await page.waitFor('[data-plan-step="1"]');
      const secondIndex = first.next.findIndex((move) => sameValue(move.action, actions[1]));
      assert(secondIndex >= 0);
      await page.eval(`(() => { const select=document.querySelector('#gameplan-second'); select.value='${secondIndex}'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
      await page.waitFor('[data-plan-step="2"]');
      await page.settle(250);
      assert.deepEqual(await page.eval<number[]>("[...document.querySelectorAll('[data-plan-step]')].map(el => Number(el.querySelector('p:nth-of-type(2)').textContent.match(/Ready energy (\\d+)/)[1]))"), [2, 1, 0]);
      assert(await page.eval<boolean>("document.documentElement.scrollWidth <= innerWidth + 1"), "no horizontal overflow");
      assert(await page.eval<boolean>("[...document.querySelectorAll('[data-gameplan] button, [data-gameplan] select')].every(el => el.getBoundingClientRect().height >= 44)"), "controls meet 44px touch target");
      writeFileSync(join(evidence, `after-plan-${viewport.name}-${skin}.jpg`), await page.screenshot(false));
      await page.eval("document.documentElement.style.fontSize='200%'");
      await sleep(200);
      assert(await page.eval<boolean>("document.documentElement.scrollWidth <= innerWidth + 1"), "200% text has no horizontal overflow");
      await page.eval("document.querySelector('[data-plan-clear]').focus()");
      assert(await page.eval<boolean>("document.activeElement === document.querySelector('[data-plan-clear]')"), "clear control is keyboard focusable");
      const keyboard = page as unknown as { call(method: string, params: object): Promise<unknown> };
      await keyboard.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
      await keyboard.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await sleep(250);
      assert.equal(await page.eval<number>("document.querySelectorAll('[data-plan-step]').length"), 0, "clearing the plan discards projections");
      assert.equal(await page.eval<string>("document.querySelector('#gameplan-first').value"), "-1", "keyboard clear resets the preview without playing a move");
      assert.deepEqual(await page.eval("window.__arenaSent ?? []"), [], "preview never sends a game move");
    } finally { await page.close(); }
  }
  if (!before) {
    const page = await browser.page(viewports[0]);
    try {
      await page.interceptFetch(["http://arena-561-art.local/*", "*api/v1/games/570*"]);
      page.onFetchPaused((request) => {
        if (request.request.url.includes("/api/v1/games/570")) {
          void page.fulfillFetch(request.requestId, JSON.stringify(snapshot)).catch(() => undefined);
          return;
        }
        const whis = request.request.url.includes("BT1-055");
        void page.fulfillFetchBytes(request.requestId, readFileSync(join(assets, whis ? "whis-coercion-bt1-055.webp" : "senzu-bean-bt11-053.jpg")), whis ? "image/webp" : "image/jpeg").catch(() => undefined);
      });
      await page.goto(`${base}/arena/preview?gameplan=1&reject=1&skin=night&admin=0`);
      await page.waitFor("[data-decision-summary]");
      await page.settle(550);
      await page.eval("document.querySelector('nextjs-portal')?.remove()");
      assert.equal(await page.eval<number>("document.querySelectorAll('.arena-bar [data-gameplan]').length"), 0, "planner does not crowd the turn prompt");
      await page.tap('[aria-label="Open arena settings and counts"]');
      await page.waitFor("[data-plan-open]");
      await page.tap("[data-plan-open]");
      await page.waitFor("#gameplan-first");
      const firstIndex = planMoves(snapshot.legal, "p1").findIndex((move) => sameValue(move.action, actions[0]));
      assert(firstIndex >= 0);
      await page.eval(`(() => { const select=document.querySelector('#gameplan-first'); select.value='${firstIndex}'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
      await page.waitFor("[data-plan-retry]");
      assert.match(await page.eval<string>("document.querySelector('[data-gameplan] [role=alert]').textContent"), /Could not check the plan/);
      assert.equal(await page.eval<number>("document.querySelectorAll('[data-plan-step]').length"), 0, "failed request leaves no stale projection");
      await page.tap("[data-plan-retry]");
      await page.waitFor('[data-plan-step="1"]');
      assert.equal(await page.eval<number>("document.querySelectorAll('[data-gameplan] [role=alert]').length"), 0, "retry clears the transport error");
      assert.deepEqual(await page.eval<number[]>("[...document.querySelectorAll('[data-plan-step]')].map(el => Number(el.querySelector('p:nth-of-type(2)').textContent.match(/Ready energy (\\d+)/)[1]))"), [2, 1]);
    } finally { await page.close(); }
  }
} finally {
  await browser.close();
  rmSync(boardPath, { force: true });
  if (!before) rmSync(proofPath, { force: true });
}
console.log(`#570 ${before ? "before" : "after"}: real-art EngineAPI board ${viewports.map((v) => v.name).join("/")} in both skins`);
