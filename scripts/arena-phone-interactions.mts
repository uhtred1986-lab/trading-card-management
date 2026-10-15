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
      await page.setCookie("arenaSkin", skin, base);
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
    await page.tap('[aria-label="Show card details and actions"]');
    assert.equal(await page.eval("document.querySelectorAll('[aria-label=\"Filter hand cards\"] button').length"), 3);
    await shot("card-review");
    await page.tap('[aria-label="Show enlarged card"]');
    await page.waitFor('[data-reader-face]');
    assert.equal(await page.eval("Math.round(document.querySelector('[data-arena-review]').getBoundingClientRect().height)"), height);
    await page.settle(200);
    await shot("fullscreen-before");
    await page.tap('[aria-label="Next card"]');
    await page.waitFor(`[data-arena-review="${hand[1].id}"]`);
    assert.equal(await page.eval("document.querySelector('[data-arena-review]').getAttribute('data-arena-review')"), hand[1].id);
    await page.swipe('[data-reader-face]', -120, 0);
    await page.settle(250);
    assert.equal(await page.eval("document.querySelector('[data-arena-review]').getAttribute('data-arena-review')"), hand[2].id);
    await shot("fullscreen-swiped");
    await page.tap('[aria-label="Close card review"]');
    await open("phone-ux-attack-pick");
    const snap = fixture("phone-ux-attack-pick");
    await page.tap(`[data-arena-card="${snap.view.you.battle[0].id}"]`);
    assert.equal(await page.eval("!!document.querySelector('[data-arena-review]')"), false, "ready card enters targeting directly");
    await page.waitFor("[data-target-label]");
    await shot("attack-pick");
    await page.eval(`document.querySelector('[data-arena-card="${snap.view.them.leader.id}"] button').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}))`);
    await page.waitFor('[data-arena-review]');
    assert.equal(await page.eval(`(() => {const top=document.querySelector('[data-arena-review]').getBoundingClientRect().top;return [...document.querySelectorAll('[data-target-label]')].filter(e=>/tap/i.test(e.textContent)).some(e=>e.getBoundingClientRect().bottom>top)})()`), false, 'targeting review leaves eligible cards visible');
    await shot('targeting-review');
    await page.tap('[aria-label="Close card review"]');
    await page.tap(`[data-arena-card="${snap.view.them.leader.id}"]`);
    await page.settle(150);
    assert.equal(await page.eval("!!document.querySelector('[data-attack-confirm]')"), false);
    const attacks = await page.eval<Array<{type:string;attacker:string;target:string}>>('window.__arenaSent ?? []');
    assert.equal(attacks.length, 1);
    assert.equal(attacks[0].type, 'attack');
    assert.equal(attacks[0].attacker, snap.view.you.battle[0].id);
    assert.equal(attacks[0].target, snap.view.them.leader.id);
    await shot("attack-declared");
    for (const kind of ['counter', 'blocker']) {
      await open(`phone-ux-${kind}`);
      await page.tap('[data-defend-action]');
      await page.settle(150);
      const sent = await page.eval<Array<{type:string;card?:string}>>('window.__arenaSent ?? []');
      assert.equal(sent.length, 1);
      assert.equal(sent[0].type, kind === 'blocker' ? 'block' : 'counter');
      assert.ok(sent[0].card, 'active response sends the chosen card, not a pass');
      await shot(`${kind}-chosen`);
    }
    console.log(`${height}-${skin}: full-screen arrows/swipe and direct attack and response choices passed`);
    await page.close();
  }
} finally { await browser.close(); }
