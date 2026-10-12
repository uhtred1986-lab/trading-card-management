/**
 * #561 browser evidence from real rules-engine-produced card views and actions.
 * The local preview's ArenaStage polling path is fed two increasing revisions;
 * no database or live game is involved.
 *
 *   DATABASE_URL='' npm run dev -- --port 3019
 *   DATABASE_URL='' npx tsx scripts/arena-abilities-now-561.mts --base=http://localhost:3019
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeSenzuFixture, makeWhisFixture, exactCurrentAction, applyWithEvents, restoreFixtureDefs } from "./verify/ability-engine-fixture-561";
import { Browser, requireServer, sleep, type Viewport } from "./lib/cdp.mts";
import type { Snapshot } from "../src/lib/arena/snapshot";
import type { Action } from "../src/lib/arena/types";
import type { VmState } from "../src/lib/arena/vm/state";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidence = join(root, "docs", "arena-backlog", "evidence", "561");
const fixtureDir = join(root, "contract", "fixtures");
const base = process.argv.find((arg) => arg.startsWith("--base="))?.slice(7) ?? "http://localhost:3019";
const senzuFixture = "u04-senzu-engine-proof";
const whisFixture = "u04-whis-engine-proof";
const fixturePaths = [join(fixtureDir, `${senzuFixture}.json`), join(fixtureDir, `${whisFixture}.json`)];
const senzuArt = join(root, "docs", "arena-backlog", "evidence", "546", "assets", "senzu-bean-bt11-053.jpg");
const whisArt = join(root, "docs", "arena-backlog", "evidence", "546", "assets", "whis-coercion-bt1-055.webp");
const senzuArtUrl = "http://arena-561-art.local/BT11-053.jpg";
const whisArtUrl = "http://arena-561-art.local/BT1-055.webp";
const views: Viewport[] = [
  { name: "phone", width: 390, height: 844, mobile: true },
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "shortphone", width: 390, height: 650, mobile: true },
  { name: "narrowphone", width: 320, height: 568, mobile: true },
];

function check(ok: boolean, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

function snapshotFile(snapshot: Snapshot, path: string) {
  if (existsSync(path)) throw new Error(`Refusing to overwrite an existing fixture: ${path}`);
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: "wx" });
}

type PausedFetch = { requestId: string; request: { url: string } };
type BrowserPage = Awaited<ReturnType<Browser["page"]>>;

async function press(page: BrowserPage, key: string, shift = false) {
  const bridge = page as unknown as { call: (method: string, params?: object) => Promise<unknown> };
  const code: Record<string, number> = { Tab: 9, Escape: 27, F10: 121 };
  const common = { key, code: key, windowsVirtualKeyCode: code[key], ...(shift ? { modifiers: 8 } : {}) };
  await bridge.call("Input.dispatchKeyEvent", { type: "rawKeyDown", ...common });
  await bridge.call("Input.dispatchKeyEvent", { type: "keyUp", ...common });
}

async function openCard(page: BrowserPage, viewport: Viewport, card: string) {
  const button = `[data-arena-card="${card}"] button:not(:disabled)`;
  if (viewport.mobile) {
    await page.eval(`document.querySelector(${JSON.stringify(button)})?.focus()`);
    await press(page, "F10", true);
  } else {
    await page.rightClick(`[data-arena-card="${card}"]`);
  }
  const opened = viewport.name === "desk" ? `[data-abilities-now="${card}"]` : `[data-arena-review="${card}"]`;
  try {
    await page.waitFor(opened);
  } catch (error) {
    const debug = await page.eval<string>(`JSON.stringify({ card:${JSON.stringify(card)}, found:!!document.querySelector(${JSON.stringify(`[data-arena-card="${card}"]`)}), review:[...document.querySelectorAll('[data-arena-review]')].map(el=>el.getAttribute('data-arena-review')), cards:[...document.querySelectorAll('[data-arena-card]')].map(el=>({id:el.getAttribute('data-arena-card'),box:(()=>{const r=el.getBoundingClientRect();return [r.left,r.top,r.width,r.height]})(),button:el.querySelector('button')?.outerHTML.slice(0,200)}))})`);
    throw new Error(`${String(error)}; open-card diagnostic: ${debug}`);
  }
}

async function assertNoOverflow(page: BrowserPage, context: string) {
  const dimensions = await page.eval<{ viewport: number; document: number; client: number; scroll: number }>(`(() => {
    const scroller = document.querySelector('[data-arena-review] .overflow-y-auto');
    return { viewport: innerWidth, document: document.documentElement.scrollWidth, client: scroller?.clientWidth ?? 0, scroll: scroller?.scrollWidth ?? 0 };
  })()`);
  check(dimensions.document <= dimensions.viewport + 1, `${context}: page overflows horizontally ${JSON.stringify(dimensions)}`);
  check(dimensions.scroll <= dimensions.client + 1, `${context}: card review overflows horizontally ${JSON.stringify(dimensions)}`);
}

async function runSenzu(browser: Browser, skin: string, viewport: Viewport, initial: Snapshot, fresh: Snapshot, card: string, freshState: VmState) {
  const sheet = viewport.name === "desk" ? `[data-abilities-now="${card}"]` : `[data-arena-review="${card}"]`;
  const cardPanel = viewport.name === "desk" ? `[data-arena-inspector="${card}"]` : `[data-arena-review="${card}"]`;
  const page = await browser.page(viewport);
  await page.setCookie("arenaSkin", skin, base);
  if (viewport.mobile) {
    const bridge = page as unknown as { call: (method: string, params?: object) => Promise<unknown> };
    await bridge.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  }
  await page.interceptFetch(["http://arena-561-art.local/*", "*api/v1/games/561*"]);
  let firstPollResolve: ((value: PausedFetch) => void) | undefined;
  const firstPoll = new Promise<PausedFetch>((resolvePoll) => { firstPollResolve = resolvePoll; });
  let sendFresh = false;
  const heldPolls: PausedFetch[] = [];
  page.onFetchPaused((request) => {
    if (request.request.url.startsWith("http://arena-561-art.local/")) {
      const asset = request.request.url === senzuArtUrl ? senzuArt : request.request.url === whisArtUrl ? whisArt : null;
      if (!asset) return void page.fulfillFetch(request.requestId, "missing local artwork", 404).catch(() => undefined);
      const mime = asset.endsWith(".webp") ? "image/webp" : "image/jpeg";
      return void page.fulfillFetchBytes(request.requestId, readFileSync(asset), mime).catch(() => undefined);
    }
    if (request.request.url.includes("/api/v1/games/561")) {
      if (sendFresh) void page.fulfillFetch(request.requestId, JSON.stringify(fresh)).catch(() => undefined);
      else {
        heldPolls.push(request);
        if (firstPollResolve) {
          firstPollResolve(request);
          firstPollResolve = undefined;
        }
      }
      return;
    }
    void page.continueFetch(request.requestId).catch(() => undefined);
  });

  await page.goto(`${base}/arena/preview?fixture=${senzuFixture}&skin=${skin}&pace=step&admin=0`);
  await page.waitFor(".arena");
  await firstPoll;
  await openCard(page, viewport, card);
  const wrongWindow = await page.eval<boolean>(`(() => {
    const details = [...document.querySelectorAll('[data-abilities-now] details')].find((el) => el.textContent?.includes('Other abilities'));
    return !!details && !details.open && (details.querySelector('summary')?.textContent ?? '').includes('Other abilities (');
  })()`);
  if (!wrongWindow) {
    const debug = await page.eval<string>(`JSON.stringify({sections:[...document.querySelectorAll('[data-abilities-now]')].map(s=>s.innerText),details:[...document.querySelectorAll('[data-arena-review] details')].map(d=>({open:d.open,text:d.innerText,html:d.outerHTML.slice(0,600)})),abilities:[...document.querySelectorAll('[data-abilities-now] [data-ability-index]')].map(x=>x.innerText)})`);
    throw new Error(`${skin}/${viewport.name}: actual Battle ability is initially under collapsed Other abilities in Counter: Attack; ${debug}`);
  }
  await page.eval(`document.querySelector('[data-abilities-now] details summary')?.click()`);
  const rowIsActuallyThere = await page.eval<boolean>(`[...document.querySelectorAll('[data-abilities-now] details [data-ability-index]')].some((el) => el.textContent?.includes('Activate: Battle'))`);
  check(rowIsActuallyThere, `${skin}/${viewport.name}: actual Senzu timing row must be present under Other abilities`);
  await page.eval(`document.querySelector('[data-abilities-now] details summary')?.click()`);
  if (viewport.name === "phone" || viewport.name === "desk") {
    await page.eval(`document.querySelector('nextjs-portal')?.remove()`);
    writeFileSync(join(evidence, `${viewport.name}-${skin}-senzu-counter-attack.jpg`), await page.screenshot(false));
  }

  sendFresh = true;
  for (const held of heldPolls) void page.fulfillFetch(held.requestId, JSON.stringify(fresh)).catch(() => undefined);
  await page.waitFor(`${sheet} [data-ability-index="0"] button`);
  const sameOpenReview = await page.eval<boolean>(`!!document.querySelector(${JSON.stringify(sheet)}) && !!document.querySelector(${JSON.stringify(`${sheet} [data-ability-index="0"] button`)})`);
  check(sameOpenReview, `${skin}/${viewport.name}: fresh EngineAPI revision did not update the open review sheet`);

  if (viewport.name === "shortphone" || viewport.name === "narrowphone") await page.eval(`document.documentElement.style.fontSize='200%'`);
  await assertNoOverflow(page, `${skin}/${viewport.name}${viewport.name === "shortphone" || viewport.name === "narrowphone" ? "/200%" : ""}`);
  if (viewport.mobile) {
    for (let i = 0; i < 20; i++) {
      const position = await page.eval<{ buttonTop: number; buttonBottom: number; scrollTop: number; scrollBottom: number }>(`(() => {
        const r=document.querySelector('${sheet} [data-ability-index="0"] button')?.getBoundingClientRect();
        const viewport=document.querySelector('${sheet} .overflow-y-auto')?.getBoundingClientRect();
        return { buttonTop:r?.top ?? -1, buttonBottom:r?.bottom ?? -1, scrollTop:viewport?.top ?? -1, scrollBottom:viewport?.bottom ?? -1 };
      })()`);
      if (position.buttonTop >= Math.max(0, position.scrollTop) && position.buttonBottom <= Math.min(viewport.height, position.scrollBottom)) break;
      await page.swipe(`${sheet} .overflow-y-auto`, 0, position.buttonTop < position.scrollTop ? 60 : -100);
    }
    const reachability = await page.eval<{ button: [number, number]; scrollport: [number, number]; close: [number, number] }>(`(() => {
      const button=document.querySelector('${sheet} [data-ability-index="0"] button')?.getBoundingClientRect();
      const scrollport=document.querySelector('${sheet} .overflow-y-auto')?.getBoundingClientRect();
      const close=document.querySelector('${sheet} button[aria-label="Close card review"]')?.getBoundingClientRect();
      return { button: [button?.top ?? -1, button?.bottom ?? -1], scrollport: [scrollport?.top ?? -1, scrollport?.bottom ?? -1], close: [close?.top ?? -1, close?.bottom ?? -1] };
    })()`);
    check(reachability.button[0] >= Math.max(0, reachability.scrollport[0]) && reachability.button[1] <= Math.min(viewport.height, reachability.scrollport[1]), `${skin}/${viewport.name}: a real upward touch scroll should bring the full Activate offer inside the scrollport (${JSON.stringify(reachability)})`);
    check(reachability.close[0] >= 0 && reachability.close[1] <= viewport.height, `${skin}/${viewport.name}: scrolling must leave the fixed review controls visible (${JSON.stringify(reachability)})`);
    await assertNoOverflow(page, `${skin}/${viewport.name}${viewport.name === "shortphone" || viewport.name === "narrowphone" ? "/200% after touch scroll" : " after touch scroll"}`);
  }
  const cta = await page.eval<{ text: string; top: number; bottom: number; available: boolean; labels: string[] }>(`(() => {
    const button = document.querySelector('${sheet} [data-ability-index="0"] button');
    const rect = button?.getBoundingClientRect();
    const ability = document.querySelector('${sheet} [data-ability-index="0"]')?.textContent ?? '';
    const labels = [...document.querySelectorAll('${cardPanel} [data-stat-tiles] dt')].map((el) => el.textContent?.trim().toLowerCase() ?? '');
    return { text: button?.textContent ?? '', top: rect?.top ?? -1, bottom: rect?.bottom ?? -1, available: ability.includes('Activate: Battle'), labels };
  })()`);
  check(cta.available && cta.text.trim().startsWith("Activate") && cta.text.toLowerCase().includes("blue") && !cta.text.includes("Choose up to"), `${skin}/${viewport.name}: compact EngineAPI offer must show cost without repeating the effect text (${JSON.stringify(cta)})`);
  check(JSON.stringify(cta.labels) === JSON.stringify(["cost"]), `${skin}/${viewport.name}: an Extra card should not reserve empty power/combo tiles (${JSON.stringify(cta)})`);
  const visibleWrongCardChip = await page.eval<boolean>(`[...document.querySelectorAll('${cardPanel} p.flex.flex-wrap span')].some((el) => el.textContent?.trim() === 'wrong card')`);
  check(!visibleWrongCardChip, `${skin}/${viewport.name}: structural Combo refusal should not surface as a card-state chip`);
  const otherActionsCollapsed = await page.eval<boolean>(`(() => { const d=document.querySelector('${cardPanel} details[data-other-actions]'); return !!d && !d.open && d.querySelector('summary')?.textContent?.includes('Other actions ('); })()`);
  check(otherActionsCollapsed, `${skin}/${viewport.name}: structural Combo refusal should remain under collapsed Other actions`);
  if (viewport.name === "phone") {
    await page.eval(`document.querySelector('${cardPanel} details[data-other-actions] summary')?.click()`);
    const detailRetained = await page.eval<boolean>(`(() => { const d=document.querySelector('${cardPanel} details[data-other-actions]'); return !!d?.open && d.textContent?.includes('Combo Senzu Bean') && d.textContent?.includes('wrong card'); })()`);
    check(detailRetained, "expanding Other actions should retain the Combo refusal and its reason");
    await page.eval(`(() => { const d=document.querySelector('${cardPanel} details[data-other-actions]'); if(d) d.open=false; })()`);
  }
  if (viewport.name === "phone" || viewport.name === "desk") {
    await page.eval(`document.querySelector('nextjs-portal')?.remove()`);
    writeFileSync(join(evidence, `${viewport.name}-${skin}-senzu-combo.jpg`), await page.screenshot(false));
  }
  if (viewport.name === "shortphone" || viewport.name === "narrowphone") {
    check(cta.top >= 0 && cta.bottom <= viewport.height, `${skin}/${viewport.name}/200%: current Activate offer should remain reachable after vertical scrolling (${JSON.stringify(cta)})`);
    writeFileSync(join(evidence, `${viewport.name}-${skin}-senzu-combo-200text.jpg`), await page.screenshot(false));
  }

  if (viewport.name === "phone") {
    await page.tap('[data-arena-review] button[aria-label="Expand card to full screen"]');
    await page.waitFor('[aria-label="Full card artwork"] img');
    const fullArtControl = await page.eval<string>(`document.querySelector('[data-arena-review] button[aria-pressed="true"]')?.textContent ?? ''`);
    check(fullArtControl === "Abilities now (1)", `full-art review should expose the timely ability count, got ${fullArtControl}`);
    await page.tap('[data-arena-review] button[aria-label^="Show current abilities"]');
    check(await page.eval<boolean>(`!!document.querySelector('[data-arena-review] [data-abilities-now]')`), "Abilities now toggle should return to the same card's live details");
    await page.tap('[data-arena-review] button[aria-label="Expand card to full screen"]');
    await page.waitFor('[aria-label="Full card artwork"] img');
    const beforeNext = await page.eval<string>(`document.querySelector('[data-arena-review]')?.getAttribute('data-arena-review') ?? ''`);
    await press(page, "ArrowRight");
    const afterNext = await page.eval<string>(`document.querySelector('[data-arena-review]')?.getAttribute('data-arena-review') ?? ''`);
    check(afterNext !== beforeNext, "fullscreen review pager should change cards without closing the sheet");
    const noAbilityControl = await page.eval<string>(`document.querySelector('[data-arena-review] button[aria-pressed="true"]')?.textContent ?? ''`);
    check(noAbilityControl === "Details", `a card without timely abilities should keep the generic Details control, got ${noAbilityControl}`);
    await press(page, "ArrowLeft");
    const returned = await page.eval<boolean>(`document.querySelector('[data-arena-review="${card}"] button[aria-pressed="true"]')?.textContent === 'Abilities now (1)'`);
    check(returned, "fullscreen previous-card navigation should refresh the ability count and keep full art open");
    await page.tap('[data-arena-review] button[aria-label^="Show current abilities"]');
    await page.waitFor('[data-arena-review] [data-abilities-now] [data-ability-index="0"] button');
  }
  if (viewport.name === "phone") {
    const actionButton = `${sheet} [data-ability-index="0"] button`;
    await page.eval(`window.__arenaSent = []`);
    const focusTrail: string[] = [];
    let focused = false;
    for (let i = 0; i < 24; i++) {
      focused = await page.eval<boolean>(`document.activeElement === document.querySelector(${JSON.stringify(actionButton)})`);
      if (focused) break;
      focusTrail.push(await page.eval<string>(`document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim().slice(0,40) ?? ''`));
      await press(page, "Tab");
    }
    check(focused, `the current Activate button must be reachable by keyboard focus; trail=${JSON.stringify(focusTrail)}`);
    await page.tap(actionButton);
    const end = Date.now() + 3000;
    while (Date.now() < end && !(await page.eval<boolean>(`(window.__arenaSent ?? []).length > 0`))) await sleep(100);
    await page.settle(100);
    const sent = await page.eval<Action[]>(`window.__arenaSent ?? []`);
    const exact = exactCurrentAction(fresh, "activate", card);
    const uiState = await page.eval<string>(`JSON.stringify({ sent:window.__arenaSent, review:!!document.querySelector('[data-arena-review]'), preview:window.__arenaPreviewDriver, active:document.activeElement?.outerHTML?.slice(0,300) })`);
    check(!!exact && JSON.stringify(sent.at(-1)) === JSON.stringify(exact), `UI callback must send the exact current EngineAPI Senzu action; got ${JSON.stringify(sent.at(-1))}, expected ${JSON.stringify(exact)}; ${uiState}`);
    const paidEnergy = freshState.sides.p1.zones.energy[0]!;
    const beforeMode = freshState.cards[paidEnergy]?.mode;
    const applied = applyWithEvents(structuredClone(freshState), sent.at(-1)!);
    check(freshState.sides.p1.zones.energy.length === 1 && beforeMode === "active" && applied.state.cards[paidEnergy]?.mode === "rest", "applying the captured action must rest exactly the one active Blue energy that pays BT11-053's total cost of one");
    check(applied.state.prompt.kind === "chooseCards", `Senzu effect must continue into its real card choice, got ${applied.state.prompt.kind}`);
    check(applied.events.some((event) => event.type === "skill"), "actual apply must emit the skill event");
    console.log(`Senzu actual action applied; energy paid and prompt is ${applied.state.prompt.kind}`);
  }
  await page.close();
}

async function runWhis(browser: Browser, skin: string, viewport: Viewport, snapshot: Snapshot, card: string, state: VmState) {
  const sheet = viewport.name === "desk" ? `[data-abilities-now="${card}"]` : `[data-arena-review="${card}"]`;
  const page = await browser.page(viewport);
  await page.setCookie("arenaSkin", skin, base);
  if (viewport.mobile) {
    const bridge = page as unknown as { call: (method: string, params?: object) => Promise<unknown> };
    await bridge.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  }
  await page.interceptFetch(["http://arena-561-art.local/*", "*api/v1/games/561*"]);
  let pollResolve: (() => void) | undefined;
  const firstPoll = new Promise<void>((resolvePoll) => { pollResolve = resolvePoll; });
  page.onFetchPaused((request) => {
    if (request.request.url === whisArtUrl) return void page.fulfillFetchBytes(request.requestId, readFileSync(whisArt), "image/webp").catch(() => undefined);
    if (request.request.url.includes("/api/v1/games/561")) {
      pollResolve?.();
      pollResolve = undefined;
      return void page.fulfillFetch(request.requestId, JSON.stringify(snapshot)).catch(() => undefined);
    }
    void page.continueFetch(request.requestId).catch(() => undefined);
  });
  await page.goto(`${base}/arena/preview?fixture=${whisFixture}&skin=${skin}&pace=step&admin=0`);
  await page.waitFor(".arena");
  await firstPoll;
  await openCard(page, viewport, card);
  await page.waitFor(`${sheet} [data-ability-index="0"] button`);
  const text = await page.eval<string>(`document.querySelector('[data-abilities-now] [data-ability-index="0"]')?.textContent ?? ''`);
  check(text.includes("Counter") && text.includes("1 energy (1 blue)"), `${skin}/${viewport.name}: actual Whis Counter action and exact one-Blue cost are missing (${text})`);
  if (viewport.name === "phone" || viewport.name === "desk") {
    await page.eval(`document.querySelector('nextjs-portal')?.remove()`);
    writeFileSync(join(evidence, `${viewport.name}-${skin}-whis-counter.jpg`), await page.screenshot(false));
  }
  if (viewport.name === "phone") {
    const actionButton = `${sheet} [data-ability-index="0"] button`;
    await page.eval(`window.__arenaSent = []`);
    await page.eval(`document.querySelector(${JSON.stringify(actionButton)})?.click()`);
    const end = Date.now() + 3000;
    while (Date.now() < end && !(await page.eval<boolean>(`(window.__arenaSent ?? []).length > 0`))) await sleep(100);
    const sent = await page.eval<Action[]>(`window.__arenaSent ?? []`);
    const exact = exactCurrentAction(snapshot, "counter", card);
    check(!!exact && JSON.stringify(sent.at(-1)) === JSON.stringify(exact), `UI callback must send the exact current EngineAPI Whis Counter action; got ${JSON.stringify(sent.at(-1))}, expected ${JSON.stringify(exact)}`);
    const applied = applyWithEvents(structuredClone(state), sent.at(-1)!);
    check(state.sides.p1.zones.energy.length === 1 && state.cards[state.sides.p1.zones.energy[0]!]?.mode === "active" && applied.state.cards[state.sides.p1.zones.energy[0]!]?.mode === "rest", "applying the captured Whis Counter action must rest exactly its one active Blue energy");
    check(applied.state.sides.p1.zones.drop.includes(card), "the real Extra Counter action moves Whis from hand to Drop");
    check(applied.events.some((event) => event.type === "skill"), "the real Whis Counter emits its skill event");
    check(applied.events.some((event) => event.type === "attackNegated"), "the real Whis Counter emits attackNegated");
    console.log("Whis actual Counter action applied; Blue energy paid and Whis moved to Drop");
  }
  await page.close();
}

mkdirSync(evidence, { recursive: true });
for (const path of fixturePaths) if (existsSync(path)) throw new Error(`Refusing to overwrite existing temporary fixture ${path}`);
await requireServer(base);
const senzu = makeSenzuFixture(senzuArtUrl);
const whis = makeWhisFixture(whisArtUrl);
snapshotFile(senzu.initial, fixturePaths[0]!);
snapshotFile(whis.snapshot, fixturePaths[1]!);
let browser: Browser | null = null;
try {
  browser = await Browser.launch();
  for (const skin of ["anime", "night"]) {
    for (const viewport of views) await runSenzu(browser, skin, viewport, senzu.initial, senzu.fresh, senzu.card, senzu.state);
    for (const viewport of views.slice(0, 2)) await runWhis(browser, skin, viewport, whis.snapshot, whis.card, whis.state);
  }
  console.log(`#561 EngineAPI-built phone/desktop evidence written to ${evidence}`);
} finally {
  try {
    await browser?.close();
  } finally {
    for (const path of fixturePaths) rmSync(path, { force: true });
    restoreFixtureDefs();
  }
}
