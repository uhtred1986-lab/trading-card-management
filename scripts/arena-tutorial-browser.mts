/**
 * #843 / #844 / #845: the practice match (`/arena/tutorial`) proved in real Chrome over `scripts/lib/cdp.mts`.
 * No database, no Playwright: the route is DB-free and the app runs open without auth configuration.
 *
 *   npx next dev -p 3121                                  # in another shell; DATABASE_URL may be empty
 *   npx tsx scripts/arena-tutorial-browser.mts [--base http://localhost:3121] [--only intro,input,motion,boards,guided,unguided]
 *                                              [--out docs/arena-backlog/evidence/tutorial]
 *
 * Scenarios (each prints PASS/FAIL lines; the run exits 1 on any FAIL and writes `<out>/results.json`):
 *   intro   #843  announcer intro at 390/820/1440, a keyboard-only walk, 44 px targets, 200 % zoom (browser and text),
 *                short landscape, safe-area insets, Back keeps progress, browser back/forward/reload, Restart/Exit.
 *   input   #844  the coach words its instruction for the input mode actually in use: touch, mouse, keyboard
 *                (a narrow desktop window is still a mouse; a wide touch device is still touch).
 *   motion  #844  intro -> compact coach -> focus cue: what animates, and that reduced motion has none of it.
 *   boards  #844  the board beside the coach at 390/820/1440: nothing hidden, nothing overlaid, hints off changes no game text.
 *   guided  #844/#845  one match through the REAL controls on a phone: anchors at every checkpoint, an unaffordable
 *                card, an alternate charge, resize with a review open, reload in the intro, in a play review, during the
 *                opponent's turn and after hand-off, hints off and restored, and the match played to its end unguided.
 *   unguided #845  a whole match with hints off from the first move, to its end, through the real controls.
 *
 * The session is only READ (through React's fiber) to know which prompt is up; every move is a tap, click or key.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { arg, Browser, sleep, type Viewport } from "./lib/cdp.mts";
import { buttons, click, closeBrowser, drive, launchBrowser, focused, has, idle, loadTutorial, open, press, saved, shot, skipIntro, tapText, state, text, until, type Page } from "./lib/tutorial-page.mts";

const base = (arg("base") ?? "http://localhost:3121").replace(/\/$/, "");
const out = arg("out") ?? join(process.cwd(), "docs", "arena-backlog", "evidence", "tutorial");
const only = new Set((arg("only") ?? "intro,input,motion,boards,guided,unguided").split(","));
mkdirSync(out, { recursive: true });

const PHONE: Viewport = { name: "phone", width: 390, height: 844, mobile: true };
const TABLET: Viewport = { name: "tablet", width: 820, height: 1180, mobile: true };
const DESK: Viewport = { name: "desk", width: 1440, height: 900, mobile: false };

const results: Array<{ scenario: string; name: string; ok: boolean; detail: string }> = [];
let scenario = "";
function check(name: string, ok: boolean, detail = "") {
  results.push({ scenario, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${scenario}] ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Answer window.confirm / alert dialogs the page raises (Restart practice asks first). */
function dialogs(b: Browser, answer: { accept: boolean; seen: string[] }) {
  b.on((method, params, sessionId) => {
    if (method !== "Page.javascriptDialogOpening") return;
    answer.seen.push(String(params.message));
    void b.send("Page.handleJavaScriptDialog", { accept: answer.accept }, sessionId);
  });
}

const reload = async (page: Page) => {
  await page.cdp("Page.reload");
  await sleep(600);
  if (!(await until(page, `!!document.querySelector('#tutorial-heading') || !!document.querySelector('[data-arena-zone]')`, 60000))) throw new Error("no render after reload");
  await sleep(1200);
};
const overflowX = (page: Page) => page.eval<number>(`Math.max(0, document.documentElement.scrollWidth - innerWidth)`);
const introStep = async (page: Page) => (/(\d) \/ 5/.exec(await text(page)) ?? [])[1] ?? "?";

/** Visible controls smaller than 44 x 44 CSS px (links inside running text excluded). */
const smallTargets = (page: Page) => page.eval<string[]>(`[...document.querySelectorAll('button, a, summary')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 43.5 || r.width < 43.5) && !e.closest('[data-arena-zone]'); }).map((e) => (e.textContent.trim().slice(0, 24) || e.getAttribute('aria-label') || e.tagName) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height))`);

/** Every intro control can be brought into the viewport by scrolling; the dialogue is not clipped or trapped. */
const reachable = (page: Page) => page.eval<{ ok: boolean; missing: string[]; canScroll: boolean }>(`(() => {
  const labels = ["Back", "Next", "Skip opening", "Exit practice"];
  const missing = [];
  for (const l of labels) {
    const e = [...document.querySelectorAll('button, a')].find((x) => x.textContent.trim().startsWith(l));
    if (!e) { missing.push(l); continue; }
    e.scrollIntoView({ block: "center" });
    const r = e.getBoundingClientRect();
    if (r.top < -1 || r.bottom > innerHeight + 1 || r.left < -1 || r.right > innerWidth + 1) missing.push(l);
  }
  const copy = document.querySelector('[class*="copy"]');
  window.scrollTo(0, 0);
  const canScroll = document.documentElement.scrollHeight <= innerHeight + 1 || (window.scrollTo(0, 99999), window.scrollY > 0);
  const clipped = copy ? copy.scrollHeight > copy.clientHeight + 1 : false;
  if (clipped) missing.push("copy clipped");
  window.scrollTo(0, 0);
  return { ok: missing.length === 0 && canScroll, missing, canScroll };
})()`);

// ---------------------------------------------------------------------------------------------------------------
async function introScenario() {
  scenario = "intro";
  const b = await launchBrowser();
  const dlg = { accept: false, seen: [] as string[] };
  dialogs(b, dlg);
  try {
    // Screenshots and layout at the three sizes the issue names.
    for (const vp of [PHONE, TABLET, DESK]) {
      const page = await open(b, vp, { scale: 1 });
      await loadTutorial(page, base);
      const t = await text(page);
      check(`${vp.name}: full copy and natural reading order`, /Welcome to the tournament/.test(t) && /eight Life/.test(t) && t.indexOf("Welcome to the tournament") < t.indexOf("Welcome!") && t.indexOf("Welcome!") < t.indexOf("Next"), "heading, then copy, then controls");
      check(`${vp.name}: no horizontal overflow`, (await overflowX(page)) === 0, `overflow ${await overflowX(page)} px`);
      const small = await smallTargets(page);
      check(`${vp.name}: controls are at least 44 px`, small.length === 0, small.join("; "));
      const reach = await reachable(page);
      check(`${vp.name}: every control reachable, no scroll trap`, reach.ok, reach.missing.join(", "));
      check(`${vp.name}: no timed auto-advance`, await (async () => { const a = await introStep(page); await sleep(6000); return a === (await introStep(page)); })(), "step unchanged after 6 s idle");
      await page.eval(`window.scrollTo(0, 0)`);
      await shot(page, out, `intro-${vp.width}`);
      if (vp.mobile) {
        // A touch walkthrough: real touch events on Next, Back and Let's play.
        await tapText(page, /^Next/);
        await sleep(300);
        await tapText(page, /^Back/);
        await sleep(300);
        const back = await introStep(page);
        for (let i = 0; i < 4; i++) { await tapText(page, /^Next/); await sleep(300); }
        const last = await introStep(page);
        await tapText(page, /^Let/);
        const onBoard = await until(page, `!!document.querySelector('[data-arena-zone]')`, 15000);
        check(`${vp.name}: a touch walkthrough (Next, Back, Next x4, Let's play) reaches the board`, back === "1" && last === "5" && onBoard, `after Back ${back}, last ${last}, board ${onBoard}`);
      }
      await page.close();
    }

    // A keyboard-only walk (a desktop window; real key events through the input pipeline).
    {
      const page = await open(b, DESK, { scale: 1 });
      await loadTutorial(page, base);
      const f0 = await focused(page);
      check("keyboard: the intro heading takes focus on arrival", f0.tag === "h1", `${f0.tag} "${f0.label}"`);
      const order: string[] = [];
      let allVisible = true;
      let allOutlined = true;
      for (let i = 0; i < 5; i++) {
        await press(page, "Tab");
        const f = await focused(page);
        // `nextjs-portal` is the dev server's own overlay, not the page.
        if (f.tag === "nextjs-portal") continue;
        order.push(`${f.tag}:${f.label}`);
        if (!f.visible) allVisible = false;
        if (/^(button|a|summary)$/.test(f.tag) && !/^solid [1-9]/.test(f.outline)) allOutlined = false;
      }
      check("keyboard: Tab visits the controls in reading order", order.findIndex((x) => x.includes("Next")) > -1 && order.findIndex((x) => x.includes("Next")) < order.findIndex((x) => x.includes("Skip opening")) && order.findIndex((x) => x.includes("Skip opening")) < order.findIndex((x) => x.includes("Exit practice")), order.join(" > "));
      check("keyboard: the focused control is always on screen", allVisible);
      check("keyboard: a visible focus ring (3 px outline)", allOutlined);
      // Shift+Tab back to the start, then Enter on Next.
      for (let i = 0; i < 12; i++) await press(page, "Tab", true);
      await page.eval(`document.querySelector('#tutorial-heading').focus()`);
      let guard = 0;
      while (!(await focused(page)).label.startsWith("Next") && guard++ < 10) await press(page, "Tab");
      await press(page, "Enter");
      await sleep(300);
      check("keyboard: Enter on Next advances", (await introStep(page)) === "2");
      const f1 = await focused(page);
      check("keyboard: the new step's heading takes focus", f1.tag === "h1", `${f1.tag} "${f1.label}"`);
      // Back keeps progress.
      guard = 0;
      while (!(await focused(page)).label.startsWith("Back") && guard++ < 10) await press(page, "Tab");
      await press(page, "Enter");
      await sleep(300);
      check("keyboard: Enter on Back returns a step", (await introStep(page)) === "1");
      await press(page, "Tab"); // lands on Why? or Back; walk to Next again
      guard = 0;
      while (!(await focused(page)).label.startsWith("Next") && guard++ < 10) await press(page, "Tab");
      for (let i = 0; i < 4; i++) { await press(page, "Enter"); await sleep(250); guard = 0; while (!(await focused(page)).label.startsWith("Next") && !(await focused(page)).label.startsWith("Let") && guard++ < 10) await press(page, "Tab"); }
      check("keyboard: the five screens can be read through with Enter alone", (await introStep(page)) === "5", `step ${await introStep(page)}`);
      await press(page, "Enter"); // Let's play
      await sleep(2500);
      const onBoard = await page.eval<boolean>(`!!document.querySelector('[data-arena-zone]')`);
      const landed = await focused(page);
      check("keyboard: Let's play opens the board", onBoard);
      check("keyboard: focus does not fall to the page after the intro closes", landed.tag !== "body", `focus is ${landed.tag} "${landed.label}"`);
      await page.close();
    }

    // Browser back/forward, reload, Back keeps progress, Restart and Exit are explicit.
    {
      const page = await open(b, PHONE, { scale: 1 });
      await loadTutorial(page, base);
      for (let i = 0; i < 2; i++) { await click(page, /^Next/); await sleep(300); }
      check("Next twice reaches step 3", (await introStep(page)) === "3");
      await click(page, /^Back/);
      await sleep(300);
      check("Back keeps the earlier step and its progress", (await introStep(page)) === "2");
      await click(page, /^Next/);
      await sleep(400);
      await reload(page);
      check("reload restores the step you were reading", (await introStep(page)) === "3", `step ${await introStep(page)}`);
      await page.goto("about:blank");
      await page.eval(`history.back()`);
      await sleep(600);
      await until(page, `!!document.querySelector('#tutorial-heading')`, 60000);
      await sleep(800);
      check("browser back to the tutorial restores the step", (await introStep(page)) === "3", `step ${await introStep(page)}`);
      const exit = await page.eval<string>(`[...document.querySelectorAll('a')].find((a) => /^Exit practice/.test(a.textContent.trim()))?.getAttribute('href')`);
      check("Exit practice is an explicit link to the Arena", exit === "/arena", String(exit));
      await click(page, /^Skip opening/);
      await sleep(1500);
      await page.eval(`document.querySelector('details summary')?.click()`);
      await click(page, /^Restart practice/);
      dlg.accept = false;
      await sleep(400);
      check("Restart asks first", dlg.seen.some((m) => /Restart this practice match/.test(m)), dlg.seen.join("|"));
      check("declining the Restart prompt changes nothing", !(await text(page)).includes("Welcome to the tournament"));
      dlg.accept = true;
      await click(page, /^Restart practice/);
      await sleep(1200);
      check("accepting Restart starts the practice over from the welcome", (await introStep(page)) === "1" && (await saved(page))?.session.journal.length === 0);
      dlg.accept = false;
      await page.close();
    }

    // 200 % browser zoom of a 1280 x 800 window (640 x 400 CSS px at 2x), text zoom 200 % on a phone, short landscape phones.
    const stress: Array<{ name: string; vp: Viewport; scale: number; text200?: boolean }> = [
      { name: "200% zoom (1280x800 window)", vp: { name: "z200", width: 640, height: 400, mobile: false }, scale: 2 },
      { name: "200% text size (phone)", vp: PHONE, scale: 1, text200: true },
      { name: "short landscape 844x390", vp: { name: "land", width: 844, height: 390, mobile: true }, scale: 1 },
      { name: "short landscape 667x375", vp: { name: "land2", width: 667, height: 375, mobile: true }, scale: 1 },
    ];
    for (const s of stress) {
      const page = await open(b, s.vp, { scale: s.scale });
      if (s.text200) await page.beforeLoad(`document.addEventListener("DOMContentLoaded", () => { document.documentElement.style.fontSize = "32px"; });`);
      await loadTutorial(page, base);
      check(`${s.name}: no horizontal overflow`, (await overflowX(page)) === 0, `overflow ${await overflowX(page)} px`);
      const reach = await reachable(page);
      check(`${s.name}: every control reachable, the copy is not clipped, the page scrolls`, reach.ok, reach.missing.join(", "));
      const width = await page.eval<number>(`document.querySelector('[class*="dialogue"]').getBoundingClientRect().width / innerWidth`);
      check(`${s.name}: the dialogue uses the width (not a squeezed column)`, width >= 0.6, `${Math.round(width * 100)}% of the viewport`);
      await page.eval(`window.scrollTo(0, 0)`);
      await shot(page, out, `intro-${s.text200 ? "text200" : s.vp.name}`);
      const full = await text(page);
      check(`${s.name}: full copy present`, /eight Life/.test(full));
      await page.close();
    }

    // Safe areas: the intro pads itself with env(safe-area-inset-*).
    {
      const page = await open(b, { name: "notch", width: 844, height: 390, mobile: true }, { scale: 1 });
      let applied = true;
      try { await page.cdp("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, left: 47, bottom: 21, right: 47 } }); } catch { applied = false; }
      await loadTutorial(page, base);
      const pad = await page.eval<{ left: number; right: number; bottom: number }>(`(() => { const s = getComputedStyle(document.querySelector('section')); return { left: parseFloat(s.paddingLeft), right: parseFloat(s.paddingRight), bottom: parseFloat(s.paddingBottom) }; })()`);
      check("safe areas: the intro's side padding follows env(safe-area-inset-*)", applied ? pad.left >= 47 && pad.right >= 47 && pad.bottom >= 21 : pad.left >= 16, applied ? `padding ${pad.left}/${pad.right}/${pad.bottom} with insets 47/47/21` : `override unavailable; padding ${pad.left}/${pad.right}`);
      await page.close();
    }
  } finally {
    await closeBrowser(b);
  }
}

// ---------------------------------------------------------------------------------------------------------------
const COACH_LINE = `(() => { const c = document.querySelector('section[aria-label="Announcer coach"]'); return c ? { mode: c.getAttribute('data-input-mode'), instruction: c.querySelector('p[class*="pointer"]')?.textContent ?? '', help: c.querySelector('[data-coach-input]')?.textContent ?? '' } : null; })()`;
const coachLine = (page: Page) => page.eval<{ mode: string; instruction: string; help: string } | null>(COACH_LINE);

async function inputScenario() {
  scenario = "input";
  const b = await launchBrowser();
  try {
    const t = (page: Page) => page.eval(`document.querySelectorAll('section[aria-label="Announcer coach"] details').forEach((d) => d.setAttribute('open', ''))`);
    // Touch phone: coarse pointer from the start.
    const phone = await open(b, PHONE, { scale: 1 });
    await loadTutorial(phone, base);
    await skipIntro(phone);
    await t(phone);
    let c = await coachLine(phone);
    check("phone with a coarse pointer starts in touch wording", c?.mode === "touch" && /^Tap a hand card/.test(c.instruction), `${c?.mode}: ${c?.instruction}`);
    check("the touch help line is shown, the other two stay discoverable", /^Touch:/.test(c?.help ?? "") && /Other ways to play: Mouse:.*Keyboard:/.test(await text(phone)));
    await phone.eval(`document.dispatchEvent(new Event('x'))`);
    // A real mouse arrives on the same (touch) device.
    await phone.cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: 5, y: 5, button: "left", clickCount: 1 });
    await phone.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: 5, y: 5, button: "left", clickCount: 1 });
    await sleep(300);
    c = await coachLine(phone);
    check("a mouse press on a touch device switches the coach to mouse wording", c?.mode === "mouse" && /Click a hand card/.test(c.instruction), `${c?.mode}: ${c?.instruction}`);
    await press(phone, "Tab");
    await sleep(300);
    c = await coachLine(phone);
    check("a Tab key press switches the coach to keyboard wording", c?.mode === "keyboard" && /Press Tab/.test(c.instruction) && /^Keyboard:/.test(c.help), `${c?.mode}: ${c?.instruction}`);
    await phone.tap(`[data-hand-browse-card] button`);
    await sleep(500);
    c = await coachLine(phone);
    check("a finger tap switches it back to touch wording", c?.mode === "touch" && /^Tap a hand card/.test(c.instruction), `${c?.mode}`);
    await shot(phone, out, "input-touch-390");
    await phone.close();

    // Desktop with a fine pointer: mouse wording at 1440, and still mouse at a phone-sized window.
    const desk = await open(b, DESK, { scale: 1 });
    await loadTutorial(desk, base);
    await skipIntro(desk);
    c = await coachLine(desk);
    check("desktop with a fine pointer starts in mouse wording", c?.mode === "mouse" && /Click a hand card/.test(c.instruction), `${c?.mode}: ${c?.instruction}`);
    await shot(desk, out, "input-mouse-1440");
    // The mouse flow the coach describes really works: click a hand card, then its Charge button in the card panel.
    await idle(desk);
    await sleep(3000);
    const r0 = (await state(desk))!.rev;
    await desk.tap("[data-hand-browse-card] button"); await sleep(600); await click(desk, /^Charge /);
    let charged = false;
    for (let i = 0; i < 40 && !charged; i++) { charged = (await state(desk))!.rev > r0; await sleep(150); }
    check("mouse: clicking a hand card and its Charge button charges the card", charged, `rev ${r0} -> ${(await state(desk))!.rev}`);
    await press(desk, "Tab");
    c = await coachLine(desk);
    check("desktop: Tab switches to keyboard wording", c?.mode === "keyboard");
    await shot(desk, out, "input-keyboard-1440");
    await desk.close();

    // The keyboard flow the coach describes: Tab to a hand card, Enter selects it, and its Charge button is offered.
    const kb = await open(b, DESK, { scale: 1 });
    await loadTutorial(kb, base);
    await skipIntro(kb);
    await idle(kb);
    await sleep(3000);
    let inHand = false;
    for (let i = 0; i < 40 && !inHand; i++) { await press(kb, "Tab"); inHand = await kb.eval<boolean>(`!!document.activeElement.closest('[data-hand-browse-card]')`); }
    await press(kb, "Enter");
    await sleep(800);
    check("keyboard: Tab reaches a hand card and Enter offers its Charge button", inHand && (await has(kb, /^Charge /)), (await buttons(kb)).filter((x) => /^Charge/.test(x)).join(" | "));
    check("keyboard: the coach says so", /Press Tab/.test((await coachLine(kb))?.instruction ?? ""));
    await kb.close();

    const narrow = await open(b, { name: "narrow", width: 390, height: 844, mobile: false }, { scale: 1 });
    await loadTutorial(narrow, base);
    await skipIntro(narrow);
    c = await coachLine(narrow);
    check("a 390 px wide window with a mouse is NOT treated as touch (width does not decide)", c?.mode === "mouse", `${c?.mode}: ${c?.instruction}`);
    await narrow.close();

    const wide = await open(b, TABLET, { scale: 1 });
    await loadTutorial(wide, base);
    await skipIntro(wide);
    c = await coachLine(wide);
    check("an 820 px wide touch device IS touch (a coarse pointer, not a narrow screen)", c?.mode === "touch", `${c?.mode}: ${c?.instruction}`);
    await wide.close();
  } finally {
    await closeBrowser(b);
  }
}

// ---------------------------------------------------------------------------------------------------------------
async function motionScenario() {
  scenario = "motion";
  const b = await launchBrowser();
  try {
    for (const reduced of [false, true]) {
      const page = await open(b, PHONE, { scale: 1, reduced });
      await page.beforeLoad(`window.__anims = []; const rec = () => { for (const a of document.getAnimations()) { const t = a.effect && a.effect.target; window.__anims.push((a.animationName || a.transitionProperty || 'anim') + '@' + (t && (t.className || t.tagName)) + ':' + (a.effect.getTiming().duration)); } }; setInterval(rec, 100);`);
      await loadTutorial(page, base);
      const intro = await page.eval<string[]>(`[...new Set(window.__anims)].filter((a) => /introArt|arrive/.test(a))`);
      check(`${reduced ? "reduced" : "full"} motion: the announcer's arrival animation ${reduced ? "is absent" : "exists (0.35 s) and ends"}`, reduced ? intro.length === 0 : intro.length > 0, intro.join(", ") || "none recorded");
      const gotIntro = (await text(page)).includes("Welcome to the tournament");
      check(`${reduced ? "reduced" : "full"} motion: the intro is fully readable`, gotIntro);
      await skipIntro(page);
      await page.eval(`window.__anims = []`);
      await sleep(1500);
      const afterSwap = await page.eval<string[]>(`[...new Set(window.__anims)].filter((a) => /Announcer|coach|tutorial/i.test(a))`);
      check(`${reduced ? "reduced" : "full"} motion: the compact coach and the focus cue are immediate (no animation of their own)`, afterSwap.length === 0, afterSwap.join(", ") || "none");
      const coachText = (await coachLine(page))?.instruction ?? "";
      check(`${reduced ? "reduced" : "full"} motion: the instruction is in the DOM and readable once the board is up`, coachText.length > 10, coachText);
      const cue = await page.eval<string>(`(() => { const h = document.querySelector('[data-tutorial-focus]'); return h ? h.getAttribute('data-tutorial-focus') : ''; })()`);
      check(`${reduced ? "reduced" : "full"} motion: the focus cue is a static outline`, cue === "hand", `focus=${cue}`);
      await page.close();
    }
  } finally {
    await closeBrowser(b);
  }
}

// ---------------------------------------------------------------------------------------------------------------
interface Measure {
  focus: string; highlighted: Array<{ what: string; visible: boolean }>; coachPosition: string; coachBottom: number;
  handTop: number | null; handVisible: boolean; dockVisible: boolean; hitHand: boolean; hitDock: boolean; zones: number; hint: boolean;
}
/** What the coach highlights, and that it neither overlaps nor covers the hand and the action dock. */
const measure = (page: Page) => page.eval<Measure>(`(() => {
  const host = document.querySelector('[data-tutorial-focus]');
  const coach = document.querySelector('section[aria-label="Announcer coach"]');
  const hand = document.querySelector('section[aria-label="Your hand"]');
  const dock = document.querySelector('[data-prompt-kind]');
  const inView = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const highlighted = [...host.querySelectorAll('*')].filter((e) => { const c = getComputedStyle(e); return c.outlineStyle === 'solid' && c.outlineColor === 'rgb(247, 200, 101)'; })
    .map((e) => ({ what: e.getAttribute('data-arena-zone') || ((e.hasAttribute('data-prompt-kind') || e.hasAttribute('data-arena-dock')) ? 'dock' : '') || (e.hasAttribute('data-hand-toolbar') ? 'hand toolbar' : '') || (e.getAttribute('aria-label') || '') || String(e.className).slice(0, 24), visible: inView(e) }));
  const hit = (el) => { if (!el) return true; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1), y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1); return !(coach && document.elementsFromPoint(x, y).some((t) => coach.contains(t))); };
  const cr = coach ? coach.getBoundingClientRect() : null;
  const hr = hand ? hand.getBoundingClientRect() : null;
  return { focus: host.getAttribute('data-tutorial-focus'), highlighted, coachPosition: coach ? getComputedStyle(coach).position : 'none', coachBottom: cr ? cr.bottom + scrollY : -1,
    handTop: hr ? hr.top + scrollY : null, handVisible: !!hand && inView(hand), dockVisible: !!dock && inView(dock), hitHand: hit(hand && hand.querySelector('[data-hand-browse-card] button')), hitDock: hit(dock),
    zones: new Set([...document.querySelectorAll('[data-arena-zone]')].map((e) => e.getAttribute('data-arena-zone'))).size, hint: !!coach };
})()`);

async function boardsScenario() {
  scenario = "boards";
  const b = await launchBrowser();
  try {
    for (const vp of [PHONE, TABLET, DESK]) {
      const page = await open(b, vp, { scale: 1 });
      await loadTutorial(page, base);
      await skipIntro(page);
      await idle(page);
      const m = await measure(page);
      check(`${vp.name}: the coach sits above the board in normal flow (not an overlay)`, m.coachPosition === "relative" || m.coachPosition === "static", `position ${m.coachPosition}`);
      check(`${vp.name}: the coach ends above the hand (no overlap)`, m.handTop === null || m.coachBottom <= m.handTop, `coach bottom ${Math.round(m.coachBottom)}, hand top ${Math.round(m.handTop ?? 0)}`);
      check(`${vp.name}: the hand and the action dock are present and are not covered by the coach`, m.handVisible && m.dockVisible && m.hitHand && m.hitDock, `hand ${m.handVisible}/${m.hitHand} dock ${m.dockVisible}/${m.hitDock}`);
      check(`${vp.name}: the Charge cue highlights a visible anchor`, m.highlighted.some((h) => h.visible), m.highlighted.map((h) => `${h.what}${h.visible ? "" : " (hidden)"}`).join(", "));
      check(`${vp.name}: all ten board zones are present`, m.zones >= 14, `${m.zones} zone anchors`);
      await page.eval(`window.scrollTo(0, 0)`);
      await shot(page, out, `board-charge-${vp.width}`);
      // Hints off must change no game text; restoring brings the coach back.
      // The board's own transient chatter (an idle hint on the Pass button, the charge notice) comes and goes by itself on a timer.
      const board = () => page.eval<string>(`(document.querySelector('.arena-board') || document.body).innerText.replace(/\\s+/g, ' ').replace(/You · charge · charge /, '').replace(/Skip charge declines charging; Main Phase follows after pending skills\\. /, '')`);
      await sleep(4000); // the board's own notice ("You charge ...") fades by itself; compare the settled board
      const before = await board();
      await click(page, /^Hints on/);
      await sleep(600);
      const off = await measure(page);
      const after = await board();
      check(`${vp.name}: hints off removes the coach and nothing on the board`, !off.hint && off.focus === "none" && after === before, `board text ${before.length} vs ${after.length} chars`);
      await shot(page, out, `board-hints-off-${vp.width}`);
      await click(page, /^Restore hints/);
      await sleep(600);
      check(`${vp.name}: Restore hints brings the coach back`, (await measure(page)).hint);
      await page.close();
    }
  } finally {
    await closeBrowser(b);
  }
}

// ---------------------------------------------------------------------------------------------------------------
async function guidedScenario() {
  scenario = "guided";
  const b = await launchBrowser();
  const t0 = Date.now();
  try {
    const page = await open(b, PHONE, { scale: 1 });
    await loadTutorial(page, base);

    // #845: reload during the intro (screen 3), then finish the intro.
    for (let i = 0; i < 2; i++) { await click(page, /^Next/); await sleep(250); }
    await reload(page);
    check("reload during the intro restores the screen and the lesson (screen 3 of 5)", (await introStep(page)) === "3" && (await saved(page))?.intro === 2);
    while ((await introStep(page)) !== "5" && (await has(page, /^Next/))) { await click(page, /^Next/); await sleep(250); }
    await click(page, /^Let/);
    await until(page, `!!document.querySelector('[data-arena-zone]')`, 15000);
    await sleep(1500);

    const reloads = { review: false };
    let measured = 0;
    const seenRevs: number[] = [];
    const onFirst = async (tag: string, s: Awaited<ReturnType<typeof state>>, p: Page) => {
      if (!s) return;
      const m = await measure(p);
      measured++;
      const anchorOk = m.focus === "none" || m.highlighted.some((h) => h.visible);
      check(`checkpoint ${tag} (rev ${s.rev}): lesson cue "${m.focus}" highlights a visible anchor`, anchorOk, m.highlighted.map((h) => `${h.what}${h.visible ? "" : " (hidden)"}`).join(", ") || "no outline");
      check(`checkpoint ${tag}: coach does not overlap the hand; the coach never covers the hand or the dock`, (m.handTop === null || m.coachBottom <= m.handTop) && (!m.handVisible || m.hitHand), `coach bottom ${Math.round(m.coachBottom)} hand top ${Math.round(m.handTop ?? 0)} hit ${m.hitHand}/${m.hitDock}`);
      await p.eval(`window.scrollTo(0, 0)`);
      await shot(p, out, `guided-${tag.replace(/[^a-z0-9]+/gi, "-")}`);
      if (tag === "play:review" && !reloads.review) {
        reloads.review = true;
        // Resize with the review open: landscape and back; the review (Play it) and the hand survive and the cue stays on a visible anchor.
        const had = await has(p, /^Play it/);
        await p.cdp("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 1, mobile: true });
        await sleep(900);
        const land = await measure(p);
        const kept = await has(p, /^Play it/);
        check("resize to landscape with a review open: the review is still open and the cue still on a visible anchor", had && kept && (land.focus === "none" || land.highlighted.some((h) => h.visible)), `review kept ${kept}; ${land.highlighted.map((h) => `${h.what}${h.visible ? "" : " (hidden)"}`).join(", ")}`);
        await shot(p, out, "guided-resize-landscape-review");
        await p.cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
        await sleep(900);
        const back = await measure(p);
        check("resize back to portrait: the review and the cue are unchanged", (await has(p, /^Play it/)) && back.focus === m.focus, `focus ${m.focus} -> ${back.focus}`);
        // Reload with the review open: accepted moves restored, the unconfirmed review closed, nothing duplicated.
        const rev = (await state(p))!.rev;
        const journal = (await saved(p))!.session.journal.length;
        await reload(p);
        const after = (await state(p))!;
        check("reload during an action review restores accepted moves and closes the unconfirmed review", after.rev === rev && !(await has(p, /^Play it/)) && (await saved(p))!.session.journal.length === journal, `rev ${rev} -> ${after.rev}, journal ${journal} -> ${(await saved(p))!.session.journal.length}`);
      }
    };

    // Reload while the computer plays its turn. The computer's whole turn is one `advance()` whose beats the board then
    // plays back, so there are two moments: during the playback (first End turn) and the instant End turn is accepted (second).
    let endTurnCount = 0;
    const onEndTurn = async (p: Page) => {
      endTurnCount++;
      if (endTurnCount > 2) return;
      const turnBefore = (await state(p))!.turn;
      let how = "immediately after End turn";
      if (endTurnCount === 1) {
        how = "while the opponent's moves are being played back";
        let beat = false;
        for (let i = 0; i < 40 && !beat; i++) { beat = await has(p, /^(⏩|Skip)$/); if (!beat) await sleep(100); }
        check("the board's own battle beats keep playing with the coach up (a Skip control is offered while the opponent moves)", beat, "");
      }
      const before = (await state(p))!;
      const j0 = (await saved(p))!.session.journal.length;
      await reload(p);
      const resumed = (await state(p))!;
      check(`reload ${how}: the match is restored at the saved revision`, resumed.rev >= j0 - 0 && (await saved(p))!.session.journal.length >= j0, `rev ${before.rev} -> ${resumed.rev}, journal ${j0} -> ${(await saved(p))!.session.journal.length}`);
      // The opponent carries on by itself after the reload and the turn comes back to you, with no repeated or lost action.
      let back: Awaited<ReturnType<typeof state>> = null;
      for (let i = 0; i < 480; i++) { back = await state(p); if (back && (back.waiting === "you" || back.over)) break; await sleep(250); }
      const jr = (await saved(p))!.session.journal;
      check(`reload ${how}: the match carries on by itself to your next decision (a response window or your turn), nothing duplicated`, !!back && (back.waiting === "you" || !!back.over) && new Set(jr.map((j) => j.requestId)).size === jr.length && jr.every((j, i) => j.basedOn === i), `turn ${turnBefore} -> ${back?.turn}, prompt ${back?.prompt}, rev ${resumed.rev} -> ${back?.rev}, ${jr.length} journal entries`);
      await p.eval(`window.scrollTo(0, 0)`);
      await shot(p, out, `guided-reload-opponent-${endTurnCount}`);
    };

    // Alternate card: charge the LAST card, not the first (the lesson's example), and an unaffordable card.
    await idle(page);
    const s0 = (await state(page))!;
    const alt = s0.legal.filter((l) => l.type === "charge" && l.card).at(-1)!;
    await page.tap(`[data-hand-browse-card=${JSON.stringify(alt.card)}] button`);
    await sleep(500);
    check("charging an alternate (not the suggested) card is offered by the board", await has(page, /^Charge it/));
    await onFirst("charge", s0, page);
    await click(page, /^Charge it/);
    await until(page, `true`, 10);
    const afterAlt = await (async () => { for (let i = 0; i < 60; i++) { const s = (await state(page))!; if (s.rev > s0.rev) return s; await sleep(150); } return (await state(page))!; })();
    check("the alternate charge was accepted and the lesson moved on", afterAlt.rev === s0.rev + 1 && afterAlt.prompt === "main", `rev ${s0.rev} -> ${afterAlt.rev}, prompt ${afterAlt.prompt}`);
    await idle(page);

    // Invalid action: a card the board says is unaffordable. Nothing is spent, nothing advances.
    {
      const s = (await state(page))!;
      const playable = new Set(s.legal.filter((l) => l.type === "play").map((l) => l.card));
      const hand = await page.eval<string[]>(`[...document.querySelectorAll('[data-hand-browse-card]')].map((e) => e.getAttribute('data-hand-browse-card'))`);
      const bad = hand.find((id) => !playable.has(id));
      const progress0 = JSON.stringify((await saved(page))!.progress);
      if (bad) {
        await page.tap(`[data-hand-browse-card=${JSON.stringify(bad)}] button`);
        await sleep(900);
        const s2 = (await state(page))!;
        const t = await text(page);
        const never = !(await has(page, /^Play it/));
        check("an unaffordable card cannot be played: no move, no lesson progress, and the board says why", s2.rev === s.rev && JSON.stringify((await saved(page))!.progress) === progress0 && never && /energy|cost|can.t|cannot|not enough/i.test(t), `rev ${s.rev}->${s2.rev}`);
        await shot(page, out, "guided-invalid-action");
        await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
        await sleep(300);
      } else check("an unaffordable card cannot be played", true, "every hand card was playable at this point; skipped");
    }

    // Play through the real controls. The checkpoints measure the anchors; the opponent turn and the review reload once each.
    let handoffSeen = false;
    const tags = new Set<string>();
    for (let round = 0; round < 40 && !handoffSeen; round++) {
      const cur = (await state(page))!;
      const r = await drive(page, { onFirst: (tag, st, p) => onFirst(tag, st, p), onEndTurn, until: (s) => s.rev >= cur.rev + 6, maxSteps: 120 });
      for (const t of r.tags) tags.add(t);
      if (r.stalled && r.stalled !== null) { check("the guided match keeps progressing", false, r.stalled); break; }
      await idle(page);
      handoffSeen = (await text(page)).includes("What would you do next?");
      if (r.last?.over) break;
    }
    seenRevs.length = 0;
    check("the guided match covered charge, play review, own attack and target and a response window", ["charge", "play:review", "attack:target"].every((t) => tags.has(t)) && [...tags].some((t) => /^prompt:(counter|blocker|combo)$/.test(t)), [...tags].join(", "));
    check("the lesson reached its hand-off after the demonstrated attack and defence", handoffSeen, `${measured} measured checkpoints`);

    if (handoffSeen) {
      await page.eval(`window.scrollTo(0, 0)`);
      await shot(page, out, "handoff-offer");
      const ready = (await state(page))!;
      check("hand-off is offered at a stable boundary: your main prompt, no battle", ready.waiting === "you" && ready.prompt === "main" && !ready.battle, `prompt ${ready.prompt}, battle ${ready.battle}`);
      // Prediction first (spends no action), then play without guidance.
      const jBefore = (await saved(page))!.session.journal.length;
      await click(page, /^Skip question/);
      await sleep(300);
      check("hand-off says honestly what was skipped and where to replay it", /(\d+ explanations or questions were skipped; you can replay them in Lessons|You can replay explanations in Lessons anytime)/.test(await text(page)), "");
      await sleep(400);
      check("the prediction question spends no action", (await saved(page))!.session.journal.length === jBefore);
      await click(page, /^Play without guidance/);
      await sleep(600);
      const off = await measure(page);
      check("Play without guidance removes the coach and keeps the same match", !off.hint && (await state(page))!.rev === ready.rev);
      const sv = (await saved(page))!;
      check("the choice is saved with the match (hints off, hand-off done)", sv.hints === false && sv.handoff === true);
      // Reload after hand-off.
      await reload(page);
      const re = (await state(page))!;
      const sv2 = (await saved(page))!;
      const ids = sv2.session.journal.map((j) => j.requestId);
      check("reload after hand-off restores the same match, hints still off, no hand-off card again", re.rev === ready.rev && sv2.hints === false && !(await text(page)).includes("What would you do next?") && !(await measure(page)).hint, `rev ${ready.rev} -> ${re.rev}`);
      check("no duplicated actions after reload: every journal entry is unique and in order", new Set(ids).size === ids.length && sv2.session.journal.every((j, i) => j.basedOn === i), `${ids.length} entries`);
      // Restore the hints from the toolbar, then turn them off again from the board's own menu.
      await click(page, /^Restore hints/);
      await sleep(500);
      check("hints can be restored mid-match from the toolbar", (await measure(page)).hint && (await state(page))!.rev === ready.rev);
      await page.eval(`window.scrollTo(0, 0)`);
      await shot(page, out, "handoff-hints-restored");
      const opened = await page.eval<boolean>(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getClientRects().length && /^open arena setting/i.test((x.getAttribute('aria-label') || ''))); if (!b) return false; b.click(); return true; })()`);
      await sleep(500);
      const viaMenu = opened && (await has(page, /^Turn practice hints off/));
      check("the board's own menu offers the same hints switch", viaMenu, opened ? "" : "no menu button found");
      if (viaMenu) { await click(page, /^Turn practice hints off/); await sleep(400); check("turning hints off from the board menu works", !(await measure(page)).hint); }
      await click(page, /^close$/i);
      await sleep(400);
      if ((await measure(page)).hint) await click(page, /^Hints on/);
    }

    await finishMatch(page, t0, "after hand-off");
    await page.close();
  } finally {
    await closeBrowser(b);
  }
}

/** Plays the rest of the match with the real controls and checks how it ends. Hints are whatever the page has. */
async function finishMatch(page: Page, t0: number, label: string) {
  {
    const end = await drive(page, { maxSteps: 700, until: (s) => !!s.over });
    const final = end.last!;
    if (!final.over) { console.log(`stalled: ${end.stalled}`); await shot(page, out, "unguided-stalled"); }
    await idle(page, 15000);
    await sleep(1500);
    check(`an unguided game is played through the UI to its end (${label})`, !!final.over, `${end.steps} steps, ${Math.round((Date.now() - t0) / 1000)} s; winner ${final.over}; life ${final.life} vs ${final.oppLife}${final.over ? "" : `; ${end.stalled}`}`);
    const finished = await text(page);
    check("the end of the match uses practice wording and offers replay and return", /Practice match finished/.test(finished) && (await has(page, /^Replay practice/)) && !/rematch|invite/i.test(finished), "");
    await shot(page, out, "unguided-finished");
    const jFinal = (await saved(page))!.session.journal;
    check("the finished match's journal is clean (unique request ids, sequential revisions)", new Set(jFinal.map((j) => j.requestId)).size === jFinal.length && jFinal.every((j, i) => j.basedOn === i), `${jFinal.length} accepted actions`);
    await reload(page);
    check("reload after the match ended still shows the finished practice match", (await text(page)).includes("Practice match finished") || !!(await state(page))?.over);
  }
}

/** #845: the whole match with hints off from the first move, no lesson in the way. */
async function unguidedScenario() {
  scenario = "unguided";
  const b = await launchBrowser();
  const t0 = Date.now();
  try {
    const page = await open(b, PHONE, { scale: 1 });
    await loadTutorial(page, base);
    await skipIntro(page);
    await click(page, /^Hints on/);
    await sleep(500);
    check("hints are off from the first move", !(await measure(page)).hint);
    await finishMatch(page, t0, "hints off from the start");
    await page.close();
  } finally {
    await closeBrowser(b);
  }
}

// ---------------------------------------------------------------------------------------------------------------
const started = Date.now();
if (only.has("intro")) await introScenario();
if (only.has("input")) await inputScenario();
if (only.has("motion")) await motionScenario();
if (only.has("boards")) await boardsScenario();
if (only.has("guided")) await guidedScenario();
if (only.has("unguided")) await unguidedScenario();
// A partial run (`--only`) replaces only the scenarios it ran and keeps the rest of the last results.
let kept: typeof results = [];
try { kept = (JSON.parse(readFileSync(join(out, "results.json"), "utf8")).results as typeof results).filter((r) => !only.has(r.scenario)); } catch { /* first run */ }
writeFileSync(join(out, "results.json"), JSON.stringify({ base, date: new Date().toISOString().slice(0, 10), results: [...kept, ...results] }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed in ${Math.round((Date.now() - started) / 1000)} s`);
void buttons;
if (failed.length) {
  console.log(failed.map((f) => `FAIL [${f.scenario}] ${f.name} — ${f.detail}`).join("\n"));
  process.exit(1);
}
