/** Offline browser proof. The transport is mocked; snapshots and actions come from EngineAPI. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Browser, requireServer, sleep, type Viewport } from './lib/cdp.mts';
import { phoneFixture, chargeFixture, snapshot563, apply563 } from './verify/phone-engine-fixture-563';
import { makeWhisFixture } from './verify/ability-engine-fixture-561';
import { engine562, fixtureContext, paymentFixture } from './verify/battle-engine-fixture-562';
import type { Action } from '../src/lib/arena/types';
import type { Snapshot } from '../src/lib/arena/snapshot';
import type { VmState } from '../src/lib/arena/vm/state';

const base = process.argv.find(a => a.startsWith('--base='))?.slice(7) ?? 'http://localhost:3024';
const before = process.argv.includes('--before');
const evidence = resolve('docs/arena-backlog/evidence/564');
const fixture = resolve('contract/fixtures/u07-engine-proof.json');
const assets = resolve('docs/arena-backlog/evidence/546/assets');
const viewports: Viewport[] = [
  { name: 'desk', width: 1440, height: 900, mobile: false },
  { name: 'phone', width: 390, height: 844, mobile: true },
  { name: 'short-phone', width: 390, height: 667, mobile: true },
  { name: 'small-phone', width: 320, height: 568, mobile: true },
  { name: 'landscape-phone', width: 844, height: 390, mobile: true },
];
type Page = Awaited<ReturnType<Browser['page']>>;
function mainFixture() {
  const made = chargeFixture();
  const charge = made.snapshot.legal.find(row => row.action.type === 'charge');
  assert(charge, 'EngineAPI offers Charge');
  const result = apply563(made.state, charge.action);
  assert(result.events.some(event => event.type === 'move' && event.to === 'energy'));
  const state = result.state as VmState;
  const artCard = state.sides.p1.zones.hand[0]!;
  state.cards[artCard].cardId = 'BT11-053';
  const snapshot = snapshot563(state, 11, 'p1', 563);
  assert.equal(snapshot.view.prompt.kind, 'main');
  assert(snapshot.legal.some(row => row.action.type === 'play' && row.cost?.energy === 1));
  return { state, snapshot, card: null as string | null };
}
function targetFixture() {
  const made = chargeFixture();
  let state = made.state;
  for (let n = 0; n < 20; n++) {
    const legal = engine562.legalActions(fixtureContext(), state);
    if (state.prompt.kind === 'main' && state.prompt.player === 'p1' && legal.some(row => row.action.type === 'attack')) {
      const artCard = state.sides.p1.zones.hand[0]!;
      state.cards[artCard].cardId = 'BT11-053';
      const snapshot = snapshot563(state, 12, 'p1', 563);
      assert(snapshot.legal.some(row => row.action.type === 'attack'));
      return { state, snapshot, card: null as string | null };
    }
    const next = legal.find(row => row.action.type === (state.prompt.kind === 'main' ? 'endMain' : state.prompt.kind === 'charge' ? 'charge' : 'pass'));
    assert(next, `EngineAPI progresses ${state.prompt.kind}`);
    state = apply563(state, next.action).state as VmState;
  }
  throw Error('No actual attack target window');
}
function square(page: Page, selector: string, radius = 21) {
  return page.eval<boolean>(`(() => { const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;const r=el.getBoundingClientRect();if(r.width<43.5||r.height<43.5)return false;const x=r.left+r.width/2,y=r.top+r.height/2;if(x-${radius}<0||x+${radius}>innerWidth||y-${radius}<0||y+${radius}>innerHeight)return false;return [-${radius},0,${radius}].every(dx=>[-${radius},0,${radius}].every(dy=>{const h=document.elementFromPoint(x+dx,y+dy);return h===el||el.contains(h)}));})()`);
}
async function ready(page: Page) {
  await page.waitFor('[data-decision-summary]');
  await page.settle(750);
  await page.eval("document.querySelector('nextjs-portal')?.remove()");
  await page.eval('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert(await page.eval<boolean>("[...document.querySelectorAll('img')].some(i => i.complete && i.naturalWidth > 0)"), 'actual artwork has painted');
}
mkdirSync(evidence, { recursive: true });
await requireServer(base);
const browser = await Browser.launch();
try {
  for (const skin of ['anime', 'night']) for (const vp of viewports.filter(v => !before || ['desk', 'phone'].includes(v.name))) {
    const original = phoneFixture();
    const snapshot = original.snapshot;
    writeFileSync(fixture, JSON.stringify(snapshot));
    const page = await browser.page(vp);
    try {
      await page.setCookie('arenaSkin', skin, base);
      await page.interceptFetch(['http://arena-561-art.local/*', '*api/v1/games/*']);
      page.onFetchPaused(request => {
        if (request.request.url.startsWith('http://arena-561-art.local/')) {
          const whis = request.request.url.includes('BT1-055');
          void page.fulfillFetchBytes(request.requestId, readFileSync(join(assets, whis ? 'whis-coercion-bt1-055.webp' : 'senzu-bean-bt11-053.jpg')), whis ? 'image/webp' : 'image/jpeg').catch(() => undefined);
        } else void page.fulfillFetch(request.requestId, JSON.stringify(snapshot)).catch(() => undefined);
      });
      await page.goto(`${base}/arena/preview?fixture=u07-engine-proof&skin=${skin}&admin=0&staging=band`);
      await ready(page);
      assert(await page.eval<boolean>('!!document.querySelector("[data-battle-stakes]")'), 'actual battle stakes shown');
      writeFileSync(join(evidence, `${before ? 'before' : 'after'}-${vp.name}-${skin}.jpg`), await page.screenshot(false));
      if (!before && vp.mobile) {
        assert(await page.eval<boolean>('document.documentElement.scrollWidth<=innerWidth+1'), `${vp.name} has no horizontal overflow`);
        assert(await square(page, '[data-pass-action]'), `${vp.name} Pass has an unobscured 44px hit square`);
        assert(await page.eval<boolean>("getComputedStyle(document.querySelector('.arena-context')).display==='contents'"), 'phone keeps transparent dock wrapper');
      }
      if (!before && !vp.mobile) {
        assert.equal(await page.eval<number>("document.querySelectorAll('.arena-bar').length"), 1, 'one decision component');
        assert.equal(await page.eval<number>("document.querySelectorAll('.arena-matchcol').length"), 0, 'no repeated permanent match column');
        assert(await square(page, '[data-pass-action]'), 'Pass has an unobscured 44px hit square');
        const initial = snapshot;
        await page.tap('[data-arena-row="p1#0"]');
        assert(await page.eval<boolean>(`!!document.querySelector('[data-arena-inspector="p1#0"]')`), 'in-play row pins leader');
        assert(await page.eval<boolean>("document.querySelector('[data-battle-stakes]')?.textContent.includes('Attack')"), 'decision survives pin');
        const senzu = snapshot.view.you.hand?.find(card => card.cardId === 'BT11-053');
        assert(senzu, 'Senzu artwork and ability exist in the engine-projected hand');
        await page.tap('.arena-hand button[aria-label^="Inspect your hand"]');
        assert(await page.eval<boolean>(`!!document.querySelector('[data-arena-inspector="${senzu.id}"]')`), 'visible Inspect hand control pins real-art Senzu');
        assert(await page.eval<boolean>(`!!document.querySelector('.arena-sidecol-sheet [data-abilities-now="${senzu.id}"]')`), 'pinned inspector retains timed ability section');
        writeFileSync(join(evidence, `after-pinned-${skin}.jpg`), await page.screenshot(false));
        const ability = `.arena-sidecol-sheet [data-abilities-now="${senzu.id}"] button`;
        for (let n = 0; n < 5 && !(await square(page, ability)); n++) {
          await (page as unknown as { call(method: string, params: object): Promise<unknown> }).call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 1250, y: 480, deltaY: 230, deltaX: 0 });
          await sleep(150);
        }
        assert(await square(page, ability), 'actual wheel exposes pinned Activate button as a true 44px target');
        assert(await square(page, '[data-pass-action]'), 'current decision stays visible while pinned ability is browsed');
        writeFileSync(join(evidence, `after-pinned-ability-${skin}.jpg`), await page.screenshot(false));
        await page.eval("document.documentElement.style.fontSize='200%'");
        await (page as unknown as { call(method: string, params: object): Promise<unknown> }).call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        await sleep(250);
        writeFileSync(join(evidence, `after-200text-reduced-${skin}.jpg`), await page.screenshot(false));
        assert(await square(page, '[data-pass-action]'), '200% Pass has an unobscured 44px hit square');
        assert(await page.eval<boolean>('document.documentElement.scrollWidth<=innerWidth+1'), '200% has no horizontal overflow');
        assert(await page.eval<boolean>("document.querySelector('.arena-sidecol-sheet').scrollHeight>document.querySelector('.arena-sidecol-sheet').clientHeight"), 'pinned card remains independently browsable');
        assert(await page.eval<boolean>(`!!document.querySelector('.arena-sidecol-sheet [data-abilities-now="${senzu.id}"] button')`), 'pinned ability remains available at 200%');
        await page.eval('window.__arenaSent=[]');
        const bridge = page as unknown as { call(method: string, params: object): Promise<unknown> };
        await page.eval("document.activeElement?.blur()");
        let focused = false;
        for (let n = 0; n < 220; n++) {
          if (await page.eval<boolean>("document.activeElement?.hasAttribute('data-pass-action')??false")) { focused = true; break; }
          await bridge.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
          await bridge.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        }
        assert(focused, 'Tab reaches the live Pass control');
        assert(await square(page, '[data-pass-action]'), 'focused Pass remains visibly unobscured');
        await bridge.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
        await bridge.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
        await sleep(300);
        const sent = await page.eval<Action[]>('window.__arenaSent??[]');
        assert.deepEqual(sent, [initial.legal.find(row => row.action.type === 'pass')!.action], 'browser sends exact offered Pass');
        const result = apply563(original.state, sent[0]!);
        assert(result.events.some(event => event.type === 'powerCompare'), 'independent EngineAPI apply resolves battle');
      }
      console.log(`${before ? 'before' : 'after'} ${vp.name} ${skin}`);
    } finally { await page.close(); }
  }
  if (!before) for (const skin of ['anime', 'night']) for (const kind of ['main', 'counter', 'target'] as const) {
    const made = kind === 'main' ? mainFixture() : kind === 'counter' ? makeWhisFixture('http://arena-561-art.local/BT1-055.webp') : targetFixture();
    let snapshot: Snapshot = made.snapshot;
    const state = made.state;
    writeFileSync(fixture, JSON.stringify(snapshot));
    const page = await browser.page(viewports[0]);
    try {
      await page.setCookie('arenaSkin', skin, base);
      await page.interceptFetch(['http://arena-561-art.local/*', '*api/v1/games/*']);
      page.onFetchPaused(request => {
        if (request.request.url.startsWith('http://arena-561-art.local/')) {
          const whis = request.request.url.includes('BT1-055');
          void page.fulfillFetchBytes(request.requestId, readFileSync(join(assets, whis ? 'whis-coercion-bt1-055.webp' : 'senzu-bean-bt11-053.jpg')), whis ? 'image/webp' : 'image/jpeg').catch(() => undefined);
        } else void page.fulfillFetch(request.requestId, JSON.stringify(snapshot)).catch(() => undefined);
      });
      await page.goto(`${base}/arena/preview?fixture=u07-engine-proof&skin=${skin}&admin=0&staging=band`);
      await ready(page);
      if (kind === 'main') {
        const artCard = snapshot.view.you.hand?.find(card => card.cardId === 'BT11-053');
        assert(artCard, 'real-art Senzu is in hand during Main');
        await page.eval('window.__arenaSent=[]');
        await page.tap(`[data-arena-card="${artCard.id}"] button`);
        assert.deepEqual(await page.eval<Action[]>('window.__arenaSent??[]'), [], 'wrong-window Senzu tap sends no invented action');
        const play = snapshot.legal.find(row => row.action.type === 'play' && row.cost?.energy === 1);
        assert(play && play.action.type === 'play', 'EngineAPI offers one-energy Battle Card play');
        await page.tap(`[data-arena-card="${play.action.card}"] button`);
        if (await page.eval<boolean>("!!document.querySelector('[data-arena-review]')")) {
          assert(await page.eval<boolean>("(()=>{const b=[...document.querySelectorAll('[data-arena-review] button')].find(x=>x.textContent.includes('Play'));if(!b)return false;b.setAttribute('data-proof-play','');return true})()"));
          await page.tap('[data-proof-play]');
        }
        const sent = await page.eval<Action[]>('window.__arenaSent??[]');
        assert.deepEqual(sent, [play.action], 'browser sends exact offered one-energy play');
        const result = apply563(state, sent[0]!);
        const nextState = result.state as VmState;
        assert(result.events.some(event => event.type === 'move' && event.to === 'battle'), 'independent EngineAPI places Battle Card');
        assert(result.events.some(event => event.type === 'mode'), 'independent EngineAPI records energy payment');
        assert.equal(nextState.sides.p1.zones.energy.filter(id => nextState.cards[id].mode === 'active').length, snapshot.view.you.activeEnergy - 1, 'exact one-energy cost rests one ready energy');
      }
      if (kind === 'target') {
        const attack = snapshot.legal.find(row => row.action.type === 'attack')!;
        if (attack.action.type !== 'attack') throw Error('attack expected');
        await page.tap(`[data-arena-card="${attack.action.attacker}"] button`);
        assert(await page.eval<boolean>("!!document.querySelector('[data-arena-review]')"), 'leader with Awaken refusal opens actual choice sheet');
        assert(await page.eval<boolean>("(()=>{const b=[...document.querySelectorAll('[data-arena-review] button')].find(x=>x.textContent.includes('Attack with'));if(!b)return false;b.setAttribute('data-proof-attack','');return true})()"));
        await page.tap('[data-proof-attack]');
        assert(await page.eval<boolean>("document.querySelector('.arena-bar')?.textContent.includes('Choose what to attack')"), 'target question stays in contextual panel');
        assert(await square(page, `[data-arena-card="${attack.action.target}"] button`), 'target card has a true 44px hit square');
        writeFileSync(join(evidence, `after-target-${skin}.jpg`), await page.screenshot(false));
        await page.eval('window.__arenaSent=[]');
        await page.tap(`[data-arena-card="${attack.action.attacker}"] button`);
        assert.deepEqual(await page.eval<Action[]>('window.__arenaSent??[]'), [], 'invalid target cancels without sending an attack');
        await page.tap(`[data-arena-card="${attack.action.attacker}"] button`);
        assert(await page.eval<boolean>("(()=>{const b=[...document.querySelectorAll('[data-arena-review] button')].find(x=>x.textContent.includes('Attack with'));if(!b)return false;b.setAttribute('data-proof-attack','');return true})()"));
        await page.tap('[data-proof-attack]');
        await page.tap(`[data-arena-card="${attack.action.target}"] button`);
        const sent = await page.eval<Action[]>('window.__arenaSent??[]');
        assert.deepEqual(sent, [attack.action], 'target selection sends exact offered attack');
        const result = apply563(state, sent[0]!);
        assert(result.events.some(event => event.type === 'attack'), 'independent EngineAPI apply opens actual attack');
      } else {
        writeFileSync(join(evidence, `after-${kind}-${skin}.jpg`), await page.screenshot(false));
      }
      if (kind === 'counter') {
        assert(made.card, 'Counter fixture has the Whis instance');
        const counter = snapshot.legal.find(row => row.action.type === 'counter' && row.action.card === made.card)!;
        assert(counter, 'actual Whis Counter offered');
        assert(await square(page, `[data-arena-card="${made.card}"] button`), 'Counter hand card has a true 44px hit square');
        await page.eval('window.__arenaSent=[]');
        await page.tap(`[data-arena-card="${made.card}"] button`);
        const sent = await page.eval<Action[]>('window.__arenaSent??[]');
        assert.deepEqual(sent, [counter.action], 'browser sends exact current Counter');
        const result = apply563(state, sent[0]!);
        assert(result.events.some(event => event.type === 'attackNegated'), 'independent EngineAPI apply negates attack');
        const nextState = result.state as VmState;
        assert.equal(nextState.sides.p1.zones.energy.filter(id => nextState.cards[id].mode === 'active').length, 0, 'Whis cost rests the one ready Blue energy');
        snapshot = snapshot563(nextState, snapshot.game.revision + 1, 'p1', 561);
        await sleep(1650);
        assert(await page.eval<boolean>("document.querySelector('.arena-bar')?.textContent.includes('Choose')"), 'same-view revision presents resulting choice');
        const fresh = snapshot;
        snapshot = made.snapshot;
        await sleep(1650);
        assert(await page.eval<boolean>("document.querySelector('.arena-bar')?.textContent.includes('Choose')"), 'stale poll does not roll back decision');
        snapshot = fresh;
        writeFileSync(fixture, JSON.stringify(fresh));
        await page.goto(`${base}/arena/preview?fixture=u07-engine-proof&skin=${skin}&admin=0&staging=band`);
        await ready(page);
        assert(await page.eval<boolean>("document.querySelector('.arena-bar')?.textContent.includes('Choose')"), 'reload reconstructs current decision');
        writeFileSync(join(evidence, `after-counter-reload-${skin}.jpg`), await page.screenshot(false));
      }
      console.log(`after ${kind} ${skin}`);
    } finally { await page.close(); }
  }
  if (!before) for (const skin of ['anime', 'night']) {
    const made = paymentFixture();
    const snapshot = snapshot563(made.state, 30, 'p1', 563);
    const choice = snapshot.legal.find(row => row.action.type === 'payCost' && row.action.option === 2);
    assert(choice, 'EngineAPI offers marker payment');
    assert.deepEqual(snapshot.view.prompt.payments?.find(p => p.option === 2)?.energyRest, [], 'offered marker payment rests no energy');
    writeFileSync(fixture, JSON.stringify(snapshot));
    const page = await browser.page({ name: 'short-desktop', width: 1280, height: 700, mobile: false });
    try {
      await page.setCookie('arenaSkin', skin, base);
      await page.interceptFetch(['http://arena-561-art.local/*', '*api/v1/games/*']);
      page.onFetchPaused(request => {
        if (request.request.url.startsWith('http://arena-561-art.local/')) {
          const whis = request.request.url.includes('BT1-055');
          void page.fulfillFetchBytes(request.requestId, readFileSync(join(assets, whis ? 'whis-coercion-bt1-055.webp' : 'senzu-bean-bt11-053.jpg')), whis ? 'image/webp' : 'image/jpeg').catch(() => undefined);
        } else void page.fulfillFetch(request.requestId, JSON.stringify(snapshot)).catch(() => undefined);
      });
      await page.goto(`${base}/arena/preview?fixture=u07-engine-proof&skin=${skin}&admin=0&staging=band`);
      await ready(page);
      assert(await page.eval<boolean>("document.querySelector('.arena-bar')?.textContent.includes('Remaining ready/total')"), 'payment previews stay in decision panel');
      writeFileSync(join(evidence, `after-paycost-short-${skin}.jpg`), await page.screenshot(false));
      await page.eval("document.documentElement.style.fontSize='200%'");
      await (page as unknown as { call(method: string, params: object): Promise<unknown> }).call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await sleep(200);
      await page.eval('window.__arenaSent=[];document.activeElement?.blur()');
      const bridge = page as unknown as { call(method: string, params: object): Promise<unknown> };
      let focused = false;
      for (let n = 0; n < 220; n++) {
        if (await page.eval<boolean>("document.activeElement?.getAttribute('data-payment-option')==='2'")) { focused = true; break; }
        await bridge.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        await bridge.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      }
      assert(focused, 'Tab reaches final payment option');
      assert(await square(page, '[data-payment-option="2"]'), 'last payment is visibly unobscured at 200% on short desktop');
      writeFileSync(join(evidence, `after-paycost-200text-short-${skin}.jpg`), await page.screenshot(false));
      await bridge.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
      await bridge.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await sleep(300);
      const sent = await page.eval<Action[]>('window.__arenaSent??[]');
      assert.deepEqual(sent, [choice.action], 'keyboard sends exact offered marker payment');
      const result = apply563(made.state, sent[0]!);
      assert(result.events.some(event => event.type === 'energyMarker'), 'independent EngineAPI spends one marker');
      assert(result.events.some(event => event.type === 'move' && event.to === 'combo'), 'independent EngineAPI resumes combo after payment');
      const nextState = result.state as VmState;
      assert.deepEqual(nextState.sides.p1.zones.energy.map(id => nextState.cards[id].mode), made.state.sides.p1.zones.energy.map(id => made.state.cards[id].mode), 'marker option preserves ready energy');
      console.log(`after payCost short 200% ${skin}`);
    } finally { await page.close(); }
  }
} finally { await browser.close(); rmSync(fixture, { force: true }); }
