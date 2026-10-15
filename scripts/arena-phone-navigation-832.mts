/** Engine-backed mulligan and real touch gestures; only the secondary database is used. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { Browser, arg } from "./lib/cdp.mts";
import { createPinnedMatch, applyMove, legalMoves, projectSnapshot } from "../src/lib/arena/browser.ts";
import { combatFixtureBundle, COMBAT_FIXTURE_REVISION } from "./verify/arena-policy-combat-fixture.ts";

const base = arg("base") ?? "http://127.0.0.1:3110";
const out = arg("out") ?? "/tmp/phone-navigation-832";
mkdirSync(out, { recursive: true });
const fixture = "contract/fixtures/phone-832-mulligan.json";
const bundle = await combatFixtureBundle();
let { match } = await createPinnedMatch({ bundle, seed: 1, interpreterRevision: COMBAT_FIXTURE_REVISION });
const first = legalMoves(match).find(row => row.action.type === "chooseFirst" && row.action.first === "p1");
assert.ok(first);
match = applyMove(match, first.action).match;
assert.equal(match.state.prompt.kind, "mulligan");
const snapshot = projectSnapshot(match, "p1", { id: 832 });
writeFileSync(fixture, JSON.stringify(snapshot));
const browser = await Browser.launch();
const checks: object[] = [];
try {
  for (const width of [360, 390]) for (const skin of ["anime", "night"]) {
    const page = await browser.page({ name: `${width}-${skin}`, width, height: 800, mobile: true });
    try {
      await page.interceptFetch("*/api/v1/games/*");
      page.onFetchPaused(({ requestId }) => void page.fulfillFetch(requestId, "", 204).catch(() => {}));
      await page.goto(`${base}/arena/preview?fixture=phone-832-mulligan&skin=${skin}&admin=0`);
      await page.waitFor(".arena-hand [data-arena-card]");
      await page.settle(400);
      const card = snapshot.view.you.hand!.find(card => card.text)!;
      assert.ok(card);
      await page.tap(`[data-arena-card="${card.id}"]`);
      await page.waitFor("[data-arena-review]");
      await page.settle(200);
      assert.equal(await page.eval("document.querySelector('[data-printed-card-text]').open"), true, "written card text is expanded");
      await page.swipe(".arena-review-body", 0, -150);
      await page.settle(250);
      assert.ok(await page.eval<number>("document.querySelector('.arena-review-body').scrollTop") > 0, "real touch scroll reaches details");
      assert.equal(await page.eval("document.querySelector('[data-arena-review]').dataset.arenaReview"), card.id, "scroll keeps the same card open");
      await page.tap("[data-arena-review] > button");
      await page.settle(200);
      assert.equal(await page.eval(`(() => {const r=document.querySelector('[data-printed-card-text]').getBoundingClientRect();const b=document.querySelector('.arena-review-body').getBoundingClientRect();return r.top<b.bottom && r.bottom>b.top})()`), true, "Read card text jumps to visible written text");
      await page.swipe(".arena-review-body", 0, 150);
      await page.settle(250);
      assert.equal(await page.eval("!!document.querySelector('[data-arena-review]')"), true, "scrolling back does not dismiss the review");
      await page.tap("[data-arena-review] > button");
      writeFileSync(`${out}/mulligan-text-${width}-${skin}.jpg`, await page.screenshot(false));
      await page.tap('[aria-label="Next card"]');
      assert.equal(await page.eval("document.querySelector('.arena-review-body').scrollTop"), 0, "paging starts the next card at the top");
      await page.tap('[aria-label="Close card review"]');
      assert.deepEqual(await page.eval("window.__arenaSent ?? []"), [], "reading and paging never submit a mulligan");
      await page.goto(`${base}/arena`);
      await page.waitFor('[data-phone-app-menu]');
      await page.waitFor('nav[aria-label="Primary"]');
      await page.settle(300);
      assert.equal(await page.eval("document.querySelectorAll('nav[aria-label=Primary] a').length"), 5, "Arena keeps all five phone tabs");
      writeFileSync(`${out}/arena-${width}-${skin}.jpg`, await page.screenshot(false));
      await page.tap('[data-phone-app-menu] summary');
      await page.waitFor('[data-phone-app-menu][open]');
      assert.equal(await page.eval("[...document.querySelectorAll('[data-phone-app-menu] a')].some(a=>a.textContent==='Leaders')"), true);
      writeFileSync(`${out}/menu-${width}-${skin}.jpg`, await page.screenshot(false));
      await page.tap('[data-phone-app-menu] a[href="/leaders"]');
      await page.waitFor('nav[aria-label="Primary"] a[href="/decks"]');
      await page.settle(300);
      assert.equal(await page.eval("!!document.querySelector('[data-phone-app-menu][open]')"), false, "navigation closes the menu");
      await page.tap('nav[aria-label="Primary"] a[href="/decks"]');
      await page.settle(500);
      assert.equal(await page.eval("location.pathname"), "/decks");
      assert.equal(await page.eval("document.documentElement.scrollWidth <= innerWidth + 1"), true, "phone page fits horizontally");
      checks.push({ width, skin, mulliganScroll: true, writtenText: true, noAccidentalMove: true, appNavigation: true });
    } finally { await page.close(); }
  }
  writeFileSync(`${out}/checks.json`, JSON.stringify(checks, null, 2));
  console.log(checks);
} finally {
  rmSync(fixture, { force: true });
  await browser.close();
}
