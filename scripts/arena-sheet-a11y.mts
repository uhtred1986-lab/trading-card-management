/**
 * Focus and narrow-screen evidence for the shared arena sheets (#559).
 * Requires the local dev-only contract preview; it never opens a game route,
 * calls a server action, or reads the database.
 *
 *   DATABASE_URL='' npm run dev
 *   DATABASE_URL='' npx tsx scripts/arena-sheet-a11y.mts
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Browser, requireServer, sleep, type Viewport } from "./lib/cdp.mts";

const base = "http://localhost:3000";
const out = join(process.cwd(), "docs", "arena-backlog", "evidence", "559");
const fixtureName = "u02-evidence";
const fixturePath = join(process.cwd(), "contract", "fixtures", `${fixtureName}.json`);
const captureOnly = process.argv.includes("--capture-only");
const viewports: Viewport[] = [
  { name: "shortphone", width: 390, height: 650, mobile: true },
  { name: "narrowphone", width: 320, height: 568, mobile: true },
];
const keyCode: Record<string, number> = { Tab: 9, Escape: 27, F10: 121 };

async function press(page: object, key: string, shift = false) {
  // Browser.call is the same DevTools bridge used by scripts/lib/cdp.mts.
  const bridge = page as { call: (method: string, params?: object) => Promise<unknown> };
  const common = { key, code: key, windowsVirtualKeyCode: keyCode[key], ...(shift ? { modifiers: 8 } : {}) };
  await bridge.call("Input.dispatchKeyEvent", { type: "rawKeyDown", ...common });
  await bridge.call("Input.dispatchKeyEvent", { type: "keyUp", ...common });
}

function check(ok: boolean, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

const sampleArt = readFileSync(join(out, "card-art-bt11-053.jpg")).toString("base64");
const artwork: Record<string, { id: string; name: string; image: string }> = {
  V1: { id: "BT11-053", name: "Senzu Bean", image: sampleArt },
};

function withArtwork(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(withArtwork);
    return;
  }
  if (!value || typeof value !== "object") return;
  const card = value as Record<string, unknown>;
  const real = typeof card.cardId === "string" ? artwork[card.cardId] : undefined;
  if (real) {
    card.cardId = real.id;
    card.name = real.name;
    card.imageUrl = `data:image/jpeg;base64,${real.image}`;
  }
  Object.values(card).forEach(withArtwork);
}

function prepareArtworkFixture() {
  const fixture = JSON.parse(readFileSync(join(process.cwd(), "contract", "fixtures", "play.json"), "utf8")) as unknown;
  withArtwork(fixture);
  writeFileSync(fixturePath, JSON.stringify(fixture));
}

async function openReview(page: Awaited<ReturnType<Browser["page"]>>, mobile: boolean, selector = "[data-arena-card] button:not(:disabled)", keyboard = false) {
  if (keyboard) {
    await press(page, "F10", true);
  } else if (mobile) {
    const point = await page.pointOf(selector);
    await page.pointer("down", point.x, point.y);
    await sleep(550);
    await page.pointer("up", point.x, point.y);
  } else {
    await page.rightClick(selector.replace(/\s+button:not\(:disabled\)$/, ""));
  }
  await page.waitFor("[data-arena-review]");
}

async function assertLoadedArt(page: Awaited<ReturnType<Browser["page"]>>, context: string, selector = '[data-arena-review] img') {
  const loaded = await page.eval<boolean>(`(() => {
    const image = document.querySelector(${JSON.stringify(selector)});
    return !!image && image.complete && image.naturalWidth > 0;
  })()`);
  check(loaded, `${context}: reviewed card artwork did not load`);
}

async function hideNextDevBadge(page: Awaited<ReturnType<Browser["page"]>>) {
  // Next's development indicator is outside the app tree and is not part of
  // the artwork or controls being documented here.
  await page.eval(`(() => {
    const style = document.createElement('style');
    style.textContent = 'nextjs-portal { display: none !important; }';
    document.head.append(style);
  })()`);
}

mkdirSync(out, { recursive: true });
await requireServer(base);
prepareArtworkFixture();
const browser = await Browser.launch();
try {
  if (captureOnly) {
    for (const skin of ["anime", "night"]) {
      const desk = await browser.page({ name: "desk", width: 1440, height: 900, mobile: false });
      await desk.setCookie("arenaSkin", skin, base);
      await desk.goto(`${base}/arena/preview?fixture=${fixtureName}&skin=${skin}&pace=step&admin=0`);
      await desk.waitFor(".arena");
      await hideNextDevBadge(desk);
      await desk.settle(300);
      const deskShot = join(out, `desk-play-${skin}-u02-${captureOnly ? "before" : "after"}.jpg`);
      writeFileSync(deskShot, await desk.screenshot(false));
      await desk.close();

      for (const viewport of [
        { name: "phone", width: 390, height: 844, mobile: true },
        { name: "shortphone", width: 390, height: 650, mobile: true },
        { name: "narrowphone", width: 320, height: 568, mobile: true },
      ] satisfies Viewport[]) {
        const page = await browser.page(viewport);
        await page.setCookie("arenaSkin", skin, base);
        const bridge = page as unknown as { call: (method: string, params?: object) => Promise<unknown> };
        await bridge.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
        await page.goto(`${base}/arena/preview?fixture=${fixtureName}&skin=${skin}&pace=step&admin=0`);
        await page.waitFor(".arena");
        await hideNextDevBadge(page);
        await page.settle(300);
        const captureCard = await page.eval<string>(`(() => {
          const cards = [...document.querySelectorAll('[data-arena-card] button:not(:disabled)')];
          const button = cards.find((candidate) => candidate.closest('[data-arena-card]')?.getAttribute('data-arena-card') === 'p1#17') ?? cards[0];
          button?.focus();
          return button?.closest('[data-arena-card]')?.getAttribute('data-arena-card') ?? '';
        })()`);
        check(!!captureCard, `${skin}/${viewport.name}: no visible card trigger for evidence capture`);
        await openReview(page, true, `[data-arena-card="${captureCard}"] button:not(:disabled)`, true);
        if (viewport.name !== "phone") await page.eval(`document.documentElement.style.fontSize = '200%'`);
        await page.settle(300);
        const filename = join(out, `${viewport.name}-play-${skin}-u02-before${viewport.name === "phone" ? "" : "-200text-reduced"}.jpg`);
        writeFileSync(filename, await page.screenshot(false));
        console.log(filename);
        await page.close();
      }
    }
  } else {
  for (const skin of ["anime", "night"]) {
    const phone = await browser.page({ name: "phone", width: 390, height: 844, mobile: true });
    await phone.setCookie("arenaSkin", skin, base);
    await phone.goto(`${base}/arena/preview?fixture=${fixtureName}&skin=${skin}&pace=step&admin=0`);
    await phone.waitFor(".arena");
    await hideNextDevBadge(phone);
    await phone.settle(300);
    const handCard = '[data-arena-card="p1#17"] button:not(:disabled)';
    const opener = await phone.eval<string | null>(`(() => {
      const card = document.querySelector(${JSON.stringify(handCard)});
      if (!card || card.disabled) return null;
      card.focus();
      return card.closest('[data-arena-card]')?.getAttribute('data-arena-card') ?? null;
    })()`);
    const cardSummary = await phone.eval<string>(`JSON.stringify([...document.querySelectorAll('[data-arena-card]')].map((el) => [el.getAttribute('data-arena-card'), !!el.querySelector('button'), el.querySelector('button')?.disabled]))`);
    check(opener === "p1#17", `${skin}: preview has no keyboard-reachable hand card; cards=${cardSummary}`);
    await openReview(phone, true, handCard, true);
    const initial = await phone.eval<{ tag: string; inDialog: boolean; modal: boolean; labeled: boolean }>(`(() => {
      const dialog = document.querySelector('dialog[open]');
      return {
        tag: document.activeElement?.tagName ?? '',
        inDialog: !!dialog?.contains(document.activeElement),
        modal: !!dialog?.matches(':modal'),
        labeled: !!dialog?.getAttribute('aria-label'),
      };
    })()`);
    check(initial.inDialog && initial.modal && initial.labeled, `${skin}: dialog did not take initial focus or enter the modal top layer`);
    const phoneShot = join(out, `phone-play-${skin}-u02-after.jpg`);
    await assertLoadedArt(phone, `${skin}/phone after`);
    writeFileSync(phoneShot, await phone.screenshot(false));
    console.log(phoneShot);

    check(await phone.eval<boolean>(`!!document.querySelector('[data-arena-thumb]')`), `${skin}: the fullscreen review pager is missing`);
    const pageBeforeArrow = await phone.eval<string>(`document.querySelector('[data-arena-review]')?.getAttribute('data-arena-review') ?? ''`);
    await press(phone, "ArrowRight");
    check(await phone.eval<boolean>(`document.querySelector('[data-arena-review]')?.getAttribute('data-arena-review') !== ${JSON.stringify(pageBeforeArrow)}`), `${skin}: ArrowRight did not page while the close button held focus`);

    await phone.eval(`document.querySelector('[data-arena-card] button:not(:disabled)')?.focus()`);
    const backgroundStayedInert = await phone.eval<boolean>(`document.querySelector('dialog[open]')?.contains(document.activeElement) ?? false`);
    check(backgroundStayedInert, `${skin}: background accepted focus while the sheet was open`);

    await phone.eval(`(() => {
      const parent = document.querySelector('dialog[open]');
      if (!parent) throw new Error('sheet dialog missing');
      const nested = document.createElement('dialog');
      nested.innerHTML = '<button autofocus type="button">Nested close</button>';
      nested.style.cssText = 'position:fixed;inset:20%;margin:0;background:#111;color:white;padding:2rem';
      parent.append(nested);
      nested.showModal();
    })()`);
    check(await phone.eval<boolean>(`document.querySelectorAll('dialog:modal').length === 2 && document.activeElement?.textContent === 'Nested close'`), `${skin}: nested modal did not take the top layer`);
    const nestedPage = await phone.eval<string>(`document.querySelector('[data-arena-review]')?.getAttribute('data-arena-review') ?? ''`);
    await press(phone, "ArrowRight");
    check(await phone.eval<boolean>(`document.querySelector('[data-arena-review]')?.getAttribute('data-arena-review') === ${JSON.stringify(nestedPage)}`), `${skin}: parent pager changed while a nested modal had focus`);
    await press(phone, "Escape");
    await phone.eval(`new Promise((resolve) => setTimeout(resolve, 50))`);
    check(await phone.eval<boolean>(`document.querySelector('dialog[open]')?.matches(':modal') === true && document.querySelectorAll('dialog:modal').length === 1 && document.querySelector('dialog[open]')?.contains(document.activeElement) === true`), `${skin}: Escape did not close only the topmost nested dialog`);
    await phone.eval(`document.querySelector('dialog[open] > dialog')?.remove()`);

    for (let i = 0; i < 18; i++) {
      await press(phone, "Tab");
      const tabResult = await phone.eval<{ inside: boolean; active: string; modal: boolean }>(`(() => {
        const dialog = document.querySelector('dialog[open]');
        return { inside: !!dialog?.contains(document.activeElement), active: document.activeElement?.outerHTML?.slice(0, 180) ?? '', modal: !!dialog?.matches(':modal') };
      })()`);
      check(tabResult.inside, `${skin}: Tab escaped the sheet at ${i + 1}; ${JSON.stringify(tabResult)}`);
    }
    await press(phone, "Tab", true);
    check(await phone.eval<boolean>(`document.querySelector('dialog[open]')?.contains(document.activeElement) ?? false`), `${skin}: Shift+Tab escaped the sheet`);

    await press(phone, "Escape");
    await phone.eval(`new Promise((resolve) => setTimeout(resolve, 50))`);
    const restored = await phone.eval<boolean>(`!document.querySelector('dialog[open]') && document.activeElement?.closest('[data-arena-card]')?.getAttribute('data-arena-card') === ${JSON.stringify(opener)}`);
    const afterEscape = await phone.eval<{ dialog: boolean; active: string }>(`({ dialog: !!document.querySelector('dialog[open]'), active: document.activeElement?.outerHTML?.slice(0, 180) ?? '' })`);
    check(restored, `${skin}: Escape did not close the sheet and restore focus to its opener; ${JSON.stringify(afterEscape)}`);

    // A downward gesture on the sheet handle invokes the parent close path;
    // verify focus still returns after CardSheet is removed from React state.
    await phone.eval(`document.querySelector('[data-arena-card="p1#17"] button:not(:disabled)')?.focus()`);
    await openReview(phone, true, '[data-arena-card="p1#17"] button:not(:disabled)', true);
    await phone.swipe('[data-arena-review] > div:first-child', 0, 220);
    await phone.eval(`new Promise((resolve) => setTimeout(resolve, 100))`);
    const swiped = await phone.eval<{ reviewClosed: boolean; focusRestored: boolean }>(`({
      reviewClosed: !document.querySelector('[data-arena-review]'),
      focusRestored: document.activeElement?.closest('[data-arena-card]')?.getAttribute('data-arena-card') === 'p1#17',
    })`);
    check(swiped.reviewClosed && swiped.focusRestored, `${skin}: swipe unmount did not close and restore focus; ${JSON.stringify(swiped)}`);

    await phone.eval(`document.querySelector('[data-arena-card="p1#17"] button:not(:disabled)')?.focus()`);
    await openReview(phone, true, '[data-arena-card="p1#17"] button:not(:disabled)', true);
    await phone.eval(`document.querySelector('dialog[open]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
    await phone.eval(`new Promise((resolve) => setTimeout(resolve, 100))`);
    const backdropClosed = await phone.eval<boolean>(`!document.querySelector('dialog[open]') && document.activeElement?.closest('[data-arena-card]')?.getAttribute('data-arena-card') === 'p1#17'`);
    check(backdropClosed, `${skin}: backdrop close did not unmount the sheet and restore focus`);

    // Picking a live action removes CardSheet through the parent state path.
    // The primitive cleanup must close the native dialog and return focus.
    await phone.eval(`document.querySelector('[data-arena-card="p1#9"] button:not(:disabled)')?.focus()`);
    await openReview(phone, true, '[data-arena-card="p1#9"] button:not(:disabled)', true);
    const actionCount = await phone.eval<number>(`document.querySelectorAll('[data-arena-review] button[class*="bg-ki-500"]').length`);
    check(actionCount > 0, `${skin}: fixture battle card has no live action to exercise parent unmount`);
    await phone.eval(`document.querySelector('[data-arena-review] button[class*="bg-ki-500"]')?.click()`);
    await phone.eval(`new Promise((resolve) => setTimeout(resolve, 100))`);
    const picked = await phone.eval<{ reviewClosed: boolean; focusRestored: boolean }>(`({
      reviewClosed: !document.querySelector('[data-arena-review]'),
      focusRestored: document.activeElement?.closest('[data-arena-card]')?.getAttribute('data-arena-card') === 'p1#9',
    })`);
    check(picked.reviewClosed && picked.focusRestored, `${skin}: onPick unmount did not close and restore focus; ${JSON.stringify(picked)}`);

    const desktop = await browser.page({ name: "desk", width: 1440, height: 900, mobile: false });
    await desktop.setCookie("arenaSkin", skin, base);
    await desktop.goto(`${base}/arena/preview?fixture=${fixtureName}&skin=${skin}&pace=step&admin=0`);
    await desktop.waitFor(".arena");
    await hideNextDevBadge(desktop);
    await desktop.settle(300);
    const controls = '[aria-label="Open arena settings and counts"]';
    await desktop.eval(`document.querySelector(${JSON.stringify(controls)})?.focus()`);
    await desktop.tap(controls);
    await desktop.waitFor('dialog[open][aria-label="Board controls"]');
    check(await desktop.eval<boolean>(`document.querySelector('dialog[open]')?.contains(document.activeElement) ?? false`), `${skin}: board controls sheet did not receive initial focus`);
    const deskShot = join(out, `desk-play-${skin}-u02-after.jpg`);
    writeFileSync(deskShot, await desktop.screenshot(false));
    console.log(deskShot);
    await assertLoadedArt(desktop, `${skin}/desktop after`, '.arena img');
    await press(desktop, "Escape");
    await desktop.eval(`new Promise((resolve) => setTimeout(resolve, 50))`);
    check(await desktop.eval<boolean>(`!document.querySelector('dialog[open]') && document.activeElement?.getAttribute('aria-label') === 'Open arena settings and counts'`), `${skin}: board controls Escape did not restore focus`);
    console.log(`${skin}: modal focus, inert background, nested modal, tab containment, Escape and focus restoration passed`);
    await phone.close();
    await desktop.close();
  }

  for (const viewport of viewports) {
    for (const skin of ["anime", "night"]) {
      const page = await browser.page(viewport);
      await page.setCookie("arenaSkin", skin, base);
      const bridge = page as unknown as { call: (method: string, params?: object) => Promise<unknown> };
      await bridge.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
      await page.goto(`${base}/arena/preview?fixture=${fixtureName}&skin=${skin}&pace=step&admin=0`);
      await page.waitFor(".arena");
      await hideNextDevBadge(page);
      await page.settle(300);
      const captureCard = await page.eval<string>(`(() => {
        const cards = [...document.querySelectorAll('[data-arena-card] button:not(:disabled)')];
        const button = cards.find((candidate) => candidate.closest('[data-arena-card]')?.getAttribute('data-arena-card') === 'p1#17') ?? cards[0];
        button?.focus();
        return button?.closest('[data-arena-card]')?.getAttribute('data-arena-card') ?? '';
      })()`);
      check(!!captureCard, `${skin}/${viewport.name}: no visible card trigger for evidence capture`);
      await openReview(page, true, `[data-arena-card="${captureCard}"] button:not(:disabled)`, true);
      await page.eval(`document.documentElement.style.fontSize = '200%'`);
      await page.settle(300);
      const result = await page.eval<{ reduced: boolean; textZoom: boolean; closeInside: boolean; width: number; height: number }>(`(() => {
        const dialog = document.querySelector('dialog[open]');
        const close = dialog?.querySelector('[aria-label="Close card review"]');
        const rect = close?.getBoundingClientRect();
        return {
          reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
          textZoom: parseFloat(getComputedStyle(document.documentElement).fontSize) >= 30,
          closeInside: !!rect && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
          width: rect?.width ?? 0,
          height: rect?.height ?? 0,
        };
      })()`);
      check(result.reduced && result.textZoom && result.closeInside && result.width >= 44 && result.height >= 44, `${viewport.name}/${skin}: close target is obscured or too small with 200% text`);
      const screenshot = join(out, `${viewport.name}-play-${skin}-u02-after-200text-reduced.jpg`);
      await assertLoadedArt(page, `${skin}/${viewport.name} after at 200% text`);
      writeFileSync(screenshot, await page.screenshot(false));
      console.log(`${viewport.name}/${skin}: 200% text, reduced motion and reachable 44px close control passed; ${screenshot}`);
      await page.close();
    }
  }
  }
} finally {
  await browser.close();
  rmSync(fixturePath, { force: true });
}
