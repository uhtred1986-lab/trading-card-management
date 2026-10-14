/** Real phone gestures against the Milestone 23 board; fixture transport only. */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Browser, arg } from "./lib/cdp.mts";
const base = arg("base") ?? "http://localhost:3000";
const out = arg("out") ?? "docs/arena-redesign/current/m23-interactions";
mkdirSync(out, { recursive: true });
const fixture = (name: string) => JSON.parse(readFileSync(`contract/fixtures/${name}.json`, "utf8"));
const browser = await Browser.launch();
try {
  for (const height of (arg("heights") ?? "800,650").split(",").map(Number)) for (const skin of ["anime", "night"]) {
    const page = await browser.page({ name: `${height}-${skin}`, width: 360, height, mobile: true });
    await page.interceptFetch("*/api/v1/games/*");
    page.onFetchPaused(({ requestId }) => { setTimeout(() => { void page.fulfillFetch(requestId, "", 204).catch(() => {}); }, 500); });
    const open = async (name: string) => {
      await page.goto(`${base}/arena/preview?fixture=${name}&skin=${skin}&pace=step&admin=0`);
      await page.waitFor(".arena"); await page.settle(300);
    };
    const shot = async (name: string) => { writeFileSync(`${out}/${height}-${skin}-${name}.jpg`, await page.screenshot(false)); };
    await open("phone-ux-hand-10");
    const hand = fixture("phone-ux-hand-10").view.you.hand;
    // Touch the visible control without the generic helper's scrollIntoView:
    // scrolling this short sticky board can change the compositor hit region.
    const openPoint = await page.eval<{x:number;y:number}>(`(() => {const r=document.querySelector('[aria-label="Open the whole hand, 10 cards"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await page.cdp("Input.dispatchTouchEvent", {type:"touchStart",touchPoints:[openPoint]});
    await page.cdp("Input.dispatchTouchEvent", {type:"touchEnd",touchPoints:[]});
    await page.waitFor("[data-arena-review]");
    await page.settle(100);
    assert.equal(await page.eval("document.querySelector('[data-arena-review]').getAttribute('data-arena-review')"), hand[0].id);
    assert.equal(await page.eval("document.querySelectorAll('[aria-label=\"Filter hand cards\"] button').length"), 3);
    await shot("card-review");
    await page.tap('[aria-label="Show card image only"]');
    await page.waitFor('[aria-label="Full card artwork"]');
    assert.equal(await page.eval("Math.round(document.querySelector('[data-arena-review]').getBoundingClientRect().height)"), height);
    await page.settle(200);
    await shot("fullscreen-before");
    await page.tap('[aria-label="Next card"]');
    await page.waitFor(`[data-arena-review="${hand[1].id}"]`);
    assert.equal(await page.eval("document.querySelector('[data-arena-review]').getAttribute('data-arena-review')"), hand[1].id);
    await page.swipe('[aria-label="Full card artwork"]', -120, 0);
    await page.settle(250);
    assert.equal(await page.eval("document.querySelector('[data-arena-review]').getAttribute('data-arena-review')"), hand[2].id);
    await shot("fullscreen-swiped");
    await page.tap('[aria-label="Close card review"]');
    await open("phone-ux-attack-pick");
    const snap = fixture("phone-ux-attack-pick");
    await page.tap(`[data-arena-card="${snap.view.you.battle[0].id}"]`);
    await page.waitFor("[data-arena-review]");
    const selector = await page.eval<string>(`(() => {const button=[...document.querySelectorAll('[data-arena-review] button')].find(e=>e.textContent.includes('Attack with')); if(!button)throw Error('Attack action missing');button.setAttribute('data-test-attack','');return '[data-test-attack]';})()`);
    await page.tap(selector);
    await page.waitFor("[data-target-label]");
    await shot("attack-pick");
    await page.tap(`[data-arena-card="${snap.view.them.leader.id}"]`);
    await page.waitFor("[data-attack-summary]");
    assert.ok(await page.eval("document.querySelector('[data-attack-summary]').getBoundingClientRect().height >= 80"), "attack summary must have visible height");
    assert.equal(await page.eval("document.querySelectorAll('[data-attack-role]').length"), 2);
    const overlap = await page.eval(`(() => {const summary=document.querySelector('[data-attack-summary]').getBoundingClientRect();return [...document.querySelectorAll('.arena-row,.arena-pstrip')].some(e=>{const r=e.getBoundingClientRect();return r.top<summary.bottom && r.bottom>summary.top});})()`);
    assert.equal(overlap, false, "attack summary must stay between player rows");
    assert.equal(await page.eval("document.documentElement.scrollHeight > innerHeight + 2"), false);
    await shot("attack-confirm");
    await page.tap('[data-attack-confirm] [data-pass-action]');
    await page.settle(100);
    assert.equal(await page.eval("!!document.querySelector('[data-attack-confirm]')"), false);
    console.log(`${height}-${skin}: full-screen arrows/swipe and staged attack/cancel passed`);
    await page.close();
  }
} finally { await browser.close(); }
