/**
 * Driving the practice match at `/arena/tutorial` (#843/#844/#845) in real Chrome over `scripts/lib/cdp.mts`.
 *
 * The state is only READ from React's fiber (the `ArenaSession` the board was handed: which prompt is
 * up, which actions are legal, what the journal holds). Every move is made with the page's own
 * controls, as a player makes it: a tap or click on a hand card, then Charge it / Play it, a tap on an
 * attacker and a target, Confirm attack, End turn, a response button. Nothing here calls `session.act`.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Browser, sleep, type Page, type Viewport } from "./cdp.mts";

const profiles = new WeakMap<Browser, string>();
/**
 * Chrome with a profile this script owns. `Browser.launch` deletes its own temporary profile with one `rmSync`
 * that fails silently on Windows while Chrome's child processes still hold files, leaving ~90 MB behind per
 * run; here the browser is asked to quit and the directory is removed with retries.
 */
export async function launchBrowser(): Promise<Browser> {
  const dir = mkdtempSync(join(tmpdir(), "arena-tut-"));
  const b = await Browser.launch({ userDataDir: dir });
  profiles.set(b, dir);
  return b;
}
export async function closeBrowser(b: Browser) {
  await b.close();
  const dir = profiles.get(b);
  if (!dir) return;
  for (let i = 0; i < 10; i++) {
    try { rmSync(dir, { recursive: true, force: true }); return; } catch { await sleep(700); }
  }
}

export const KEY ="arena:masters-first-match:classic-v2";

const FIND = `(() => {
  const roots = [document, document.documentElement, document.body];
  let start = null;
  for (const r of roots) { const k = r && Object.keys(r).find((x) => x.startsWith("__reactContainer$")); if (k) { start = r[k]; break; } }
  if (!start) return null;
  const st = [start]; let n = 0;
  while (st.length && n++ < 300000) {
    const f = st.pop(); const p = f.memoizedProps;
    if (p && p.session && typeof p.session.getSnapshot === "function") return p.session;
    if (f.sibling) st.push(f.sibling);
    if (f.child) st.push(f.child);
  }
  return null;
})()`;

export interface State {
  rev: number; waiting: string; prompt: string; turn: number; tp: string; battle: boolean; over: string | null;
  you: string; life: number; oppLife: number; energy: number;
  legal: Array<{ type: string; label: string; card: string | null; attacker: string | null; target: string | null }>;
}
export const state = (page: Page) => page.eval<State | null>(`(() => {
  const sess = ${FIND}; if (!sess) return null; const s = sess.getSnapshot();
  return { rev: s.game.revision, waiting: s.waiting, prompt: s.view.prompt.kind, turn: s.view.turn, tp: s.view.turnPlayer, battle: !!s.view.battle,
    over: s.view.over ? s.view.over.winner : null, you: s.view.you.player, life: s.view.you.life, oppLife: s.view.them.life, energy: s.view.you.energy.length,
    legal: s.legal.map((l) => ({ type: l.action.type, label: l.label, card: l.action.card ?? null, attacker: l.action.attacker ?? null, target: l.action.target ?? null })) };
})()`);

/** The versioned local save, as the page wrote it. */
export const saved = (page: Page) => page.eval<{ intro: number | null; hints: boolean; handoff: boolean; session: { journal: Array<{ requestId: string; basedOn: number; action: { type: string; player: string } }> }; progress: { completed: string[]; skipped: string[] } } | null>(`(() => { const r = localStorage.getItem(${JSON.stringify(KEY)}); return r ? JSON.parse(r) : null; })()`);

export const text = (page: Page) => page.eval<string>(`document.body.innerText`);
export const buttons = (page: Page) => page.eval<string[]>(`[...document.querySelectorAll('button,a,summary')].filter((e) => e.getClientRects().length).map((e) => e.textContent.trim().replace(/\\s+/g, " ").slice(0, 40)).filter(Boolean)`);

/** Click (a DOM click, as a keyboard or assistive tech would) the first visible, enabled button whose text matches. */
export const click = (page: Page, re: RegExp) =>
  page.eval<boolean>(`(() => { const re = new RegExp(${JSON.stringify(re.source)}, ${JSON.stringify(re.flags)}); const b = [...document.querySelectorAll('button')].filter((e) => e.getClientRects().length && !e.disabled).find((e) => re.test(e.textContent.trim())); if (!b) return false; b.click(); return true; })()`);
export const has = (page: Page, re: RegExp) =>
  page.eval<boolean>(`(() => { const re = new RegExp(${JSON.stringify(re.source)}, ${JSON.stringify(re.flags)}); return [...document.querySelectorAll('button')].some((e) => e.getClientRects().length && !e.disabled && re.test(e.textContent.trim())); })()`);

export async function until(page: Page, predicate: string, ms = 15000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.eval<boolean>(predicate).catch(() => false)) return true;
    await sleep(120);
  }
  return false;
}

/** A real touch tap (touchStart/touchEnd at the middle) on the first visible button or link whose text matches; false when none. */
export async function tapText(page: Page, re: RegExp): Promise<boolean> {
  const box = await page.eval<{ x: number; y: number } | null>(`(() => { const re = new RegExp(${JSON.stringify(re.source)}, ${JSON.stringify(re.flags)}); const e = [...document.querySelectorAll('button, a')].filter((x) => x.getClientRects().length && !x.disabled).find((x) => re.test(x.textContent.trim())); if (!e) return null; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!box) return false;
  await page.pointer("down", box.x, box.y);
  await page.pointer("up", box.x, box.y);
  return true;
}

/** A real key press through the browser's input pipeline (focus, default actions and key handlers all run). */
const KEYS: Record<string, { code: string; vk: number; text?: string }> = {
  Tab: { code: "Tab", vk: 9 }, Enter: { code: "Enter", vk: 13, text: "\r" }, Escape: { code: "Escape", vk: 27 }, " ": { code: "Space", vk: 32, text: " " },
  ArrowRight: { code: "ArrowRight", vk: 39 }, ArrowLeft: { code: "ArrowLeft", vk: 37 },
};
export async function press(page: Page, key: string, shift = false) {
  const k = KEYS[key];
  const base = { key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers: shift ? 8 : 0 };
  await page.cdp("Input.dispatchKeyEvent", { type: k.text ? "keyDown" : "rawKeyDown", ...base, ...(k.text ? { text: k.text } : {}) });
  await page.cdp("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  await sleep(60);
}

export interface Focus { tag: string; label: string; outline: string; visible: boolean }
export const focused = (page: Page) => page.eval<Focus>(`(() => { const e = document.activeElement; if (!e || e === document.body) return { tag: "body", label: "", outline: "", visible: false };
  const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
  return { tag: e.tagName.toLowerCase(), label: (e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 40), outline: cs.outlineStyle + " " + cs.outlineWidth, visible: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth }; })()`);

/** JPEG shot written under `dir`; `quality` keeps the evidence small. */
export async function shot(page: Page, dir: string, name: string, quality = 45) {
  const r = await page.cdp<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality });
  writeFileSync(`${dir}/${name}.jpg`, Buffer.from(r.data, "base64"));
}

export interface OpenOptions { reduced?: boolean; scale?: number; touch?: boolean }
/** A tab at a viewport. `touch` decides whether touch emulation (a coarse pointer) is on, independently of the width. */
export async function open(b: Browser, vp: Viewport, o: OpenOptions = {}): Promise<Page> {
  const page = await b.page(vp);
  if (o.touch !== undefined && o.touch !== vp.mobile) await page.cdp("Emulation.setTouchEmulationEnabled", { enabled: o.touch });
  if (o.scale) await page.cdp("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: o.scale, mobile: vp.mobile });
  if (o.reduced !== undefined) await page.cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: o.reduced ? "reduce" : "no-preference" }] });
  return page;
}

/** Wait for the intro heading (the page is client-rendered and compiles on first request in dev). */
export async function loadTutorial(page: Page, base: string, o: { keepSave?: boolean } = {}) {
  // A browser shares localStorage between its tabs: start every scenario from a practice match nobody has touched.
  // Once per tab (sessionStorage marks it), before the page's own scripts, so a reload later keeps what the page saved.
  if (!o.keepSave) await page.beforeLoad(`try { if (!sessionStorage.getItem("__tut_fresh")) { localStorage.removeItem(${JSON.stringify(KEY)}); sessionStorage.setItem("__tut_fresh", "1"); } } catch {}`);
  await page.goto(`${base}/arena/tutorial`, 120000);
  if (!(await until(page, `!!document.querySelector('#tutorial-heading') || !!document.querySelector('[data-arena-zone]')`, 60000))) throw new Error("the tutorial did not render");
  await sleep(400);
}

export async function skipIntro(page: Page) {
  if (!(await click(page, /^Skip opening/))) throw new Error("no Skip opening button");
  if (!(await until(page, `!!document.querySelector('[data-arena-zone]')`, 15000))) throw new Error("the board did not mount after the intro");
  await sleep(1500);
}

/** The board plays its own beats (a notice, a flight, a fight); taps made during them are ignored. Wait for the skip control to go. */
export async function idle(page: Page, ms = 12000) {
  const t0 = Date.now();
  let quiet = 0;
  while (Date.now() - t0 < ms) {
    const playing = await page.eval<boolean>(`[...document.querySelectorAll('button')].some((e) => e.getClientRects().length && /^(⏩|Skip|Next ▸)$/.test(e.textContent.trim()))`);
    quiet = playing ? 0 : quiet + 1;
    if (quiet >= 3) return;
    await sleep(150);
  }
}

const handBtn = (card: string) => `[data-hand-browse-card=${JSON.stringify(card)}] button`;
const sameRev = async (page: Page, rev: number, ms = 12000) => (await until(page, `(() => { const s = ${FIND}.getSnapshot(); return s.game.revision > ${rev}; })()`, ms));

export interface DriveOptions {
  /** Called the first time each `tag` comes up, before the move is made (for screenshots and measurements). */
  onFirst?: (tag: string, s: State, page: Page) => Promise<void>;
  until?: (s: State) => boolean;
  maxSteps?: number;
  /** Number of own turns that charge a card before the player declines to charge (keeps the game moving). */
  chargeTurns?: number;
  /** Called right after the board accepted End turn (`n` counts them), while the computer's turn is being played. */
  onEndTurn?: (page: Page, n: number) => Promise<void>;
  log?: (m: string) => void;
}
export interface DriveResult { steps: number; stalled: string | null; tags: Set<string>; last: State | null }

/**
 * Plays with the real controls until `until(state)` holds or the match is over. Returns how it ended.
 * Policy: charge a card for the first few turns, play whatever is playable, attack the opposing Leader (or
 * a rested Battle Card) with the Leader first, answer a defence prompt by declining, end the turn.
 */
export async function drive(page: Page, o: DriveOptions = {}): Promise<DriveResult> {
  const tags = new Set<string>();
  const log = o.log ?? (() => {});
  let steps = 0;
  let charges = 0;
  let endTurns = 0;
  let stall = 0;
  let lastKey = "";
  const first = async (tag: string, s: State) => { if (tags.has(tag)) return; tags.add(tag); await o.onFirst?.(tag, s, page); };
  for (; steps < (o.maxSteps ?? 400); steps++) {
    const s = await state(page);
    if (!s) return { steps, stalled: "no session", tags, last: null };
    if (o.until?.(s)) return { steps, stalled: null, tags, last: s };
    if (s.over) { await first("over", s); return { steps, stalled: null, tags, last: s }; }
    if (s.waiting !== "you") {
      await first(`opp:${s.battle ? "battle" : "turn"}`, s);
      await sleep(250);
      continue;
    }
    const key = `${s.rev}:${s.prompt}`;
    stall = key === lastKey ? stall + 1 : 0;
    lastKey = key;
    if (stall > 25) return { steps, stalled: `no progress at rev ${s.rev} prompt ${s.prompt}; buttons: ${(await buttons(page)).join(" | ")}`, tags, last: s };
    if (stall > 0 && stall % 6 === 0) await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    await idle(page);
    const move = async (ok: Promise<boolean> | boolean, what: string) => { log(`${what} rev ${s.rev}`); if (!(await ok)) await sleep(400); else await sameRev(page, s.rev, 8000); };
    switch (s.prompt) {
      case "charge": {
        await first("charge", s);
        const charge = s.legal.find((l) => l.type === "charge" && l.card);
        if (charge && charges < (o.chargeTurns ?? 3)) {
          if (!(await has(page, /^Charge it/))) { await page.tap(handBtn(charge.card!)); await sleep(500); }
          await move(click(page, /^Charge it/), "charge");
          if ((await state(page))!.rev > s.rev) charges++;
        } else await move(click(page, /^Pass/), "skip charge");
        break;
      }
      case "main": {
        const play = s.legal.find((l) => l.type === "play" && l.card);
        const attack = s.legal.find((l) => l.type === "attack" && l.attacker && l.target);
        if (play && stall < 4) {
          await first("main:play", s);
          if (!(await has(page, /^Play it/))) { await page.tap(handBtn(play.card!)); await sleep(500); }
          await first("play:review", s);
          await move(click(page, /^Play it/), "play");
          // An explicit payment prompt is answered with the first offered option and Confirm.
          if ((await state(page))!.prompt === "payCost") { await first("play:payment", await state(page) as State); await click(page, /^(Pay|Confirm|Use)/); }
        } else if (attack && stall < 8) {
          await first("main:attack", s);
          await attackWith(page, s, attack.attacker!, attack.target!, first);
        } else {
          log(`end turn rev ${s.rev}`);
          if (await click(page, /^End turn/)) { endTurns++; await o.onEndTurn?.(page, endTurns); await sameRev(page, s.rev, 8000); } else await sleep(400);
        }
        break;
      }
      case "payCost": {
        await first("play:payment", s);
        if (!(await click(page, /^(Pay|Confirm|Use|Spend)/))) await click(page, /^(Pass|Cancel)/);
        await sleep(500);
        break;
      }
      default: {
        // A response window (counter, blocker, combo, Z-Energy, a card's own choice): decline it with the board's own control.
        await first(`prompt:${s.prompt}`, s);
        const declined = await click(page, /^(Pass|Don’t|Don't|No |Skip|Decline|Done|Continue|OK|Next)/);
        if (!declined) await click(page, /^(Confirm|Choose|Use|Play)/);
        await sleep(500);
      }
    }
  }
  return { steps, stalled: "step limit", tags, last: await state(page) };
}

/** Tap an attacker, then its target, then Confirm attack — the touch flow; a mouse click drives the same buttons. */
async function attackWith(page: Page, s: State, attacker: string, target: string, first: (t: string, s: State) => Promise<void>) {
  const cardSel = (id: string) => `[data-card-id=${JSON.stringify(id)}], [data-id=${JSON.stringify(id)}], [data-arena-card=${JSON.stringify(id)}]`;
  const tapCard = async (id: string) => { const sel = cardSel(id); if (await page.eval<boolean>(`!!document.querySelector(${JSON.stringify(sel)})`)) await page.tap(sel); };
  for (let i = 0; i < 3 && !(await has(page, /^Cancel the attack/)); i++) { await idle(page); await tapCard(attacker); await sleep(500); }
  await first("attack:picked", s);
  await first("attack:target", s);
  await tapCard(target);
  if (await has(page, /^Confirm attack/)) { await first("attack:confirm", s); await click(page, /^Confirm attack/); }
  await sameRev(page, s.rev, 6000);
}

export { sleep };
export type { Page, Viewport };
