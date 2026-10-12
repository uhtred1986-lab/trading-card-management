/**
 * Portable screenshot and interaction evidence for Arena #560.
 *
 *   DATABASE_URL='' npm run dev -- --port 3010   # or start a server at BASE
 *   DATABASE_URL='' npx tsx scripts/arena-fullscreen-review.mts --after --base=http://localhost:3010
 *
 * `--before` can be run against a separate, untouched 747 worktree by passing
 * `--repo=/path/to/that/worktree`; the fixture is written there and always
 * removed. Images and screenshots are read/written from this script's branch.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Browser, requireServer, sleep, type Viewport } from "./lib/cdp.mts";

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(scriptRoot, "docs", "arena-backlog", "evidence", "560");
const arg = (name: string, fallback: string) => process.argv.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback;
const mode = process.argv.includes("--before") ? "before" : "after";
const base = arg("--base", "http://localhost:3000");
const repo = resolve(arg("--repo", scriptRoot));
const fixtureName = "u03-evidence";
const fixturePath = join(repo, "contract", "fixtures", `${fixtureName}.json`);
const artPath = join(out, "card-art-bt11-053.jpg");
const art = readFileSync(artPath).toString("base64");
const viewports: Viewport[] = [
  { name: "phone", width: 390, height: 844, mobile: true },
  { name: "shortphone", width: 390, height: 650, mobile: true },
  { name: "narrowphone", width: 320, height: 568, mobile: true },
];

function check(ok: boolean, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

function withArtwork(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(withArtwork);
    return;
  }
  if (!value || typeof value !== "object") return;
  const card = value as Record<string, unknown>;
  if (card.cardId === "V1") {
    card.cardId = "BT11-053";
    card.name = "Senzu Bean";
    card.imageUrl = `data:image/jpeg;base64,${art}`;
  }
  Object.values(card).forEach(withArtwork);
}

function prepareFixture() {
  const fixture = JSON.parse(readFileSync(join(repo, "contract", "fixtures", "play.json"), "utf8")) as {
    view: { you: { hand: Array<Record<string, unknown>>; handCount: number } };
  };
  const original = fixture.view.you.hand;
  const count = mode === "before" ? original.length : 20;
  const cards = Array.from({ length: count }, (_, i) => ({
    ...original[i % original.length],
    id: i < original.length ? original[i].id : `p1#u03-${i}`,
  }));
  fixture.view.you.hand = cards;
  fixture.view.you.handCount = cards.length;
  withArtwork(fixture);
  writeFileSync(fixturePath, JSON.stringify(fixture));
}

async function press(page: object, key: string) {
  const bridge = page as { call: (method: string, params?: object) => Promise<unknown> };
  const code = key === "Escape" ? 27 : key === "ArrowRight" ? 39 : key === "ArrowLeft" ? 37 : 13;
  const common = { key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
  await bridge.call("Input.dispatchKeyEvent", { type: "keyDown", ...common });
  await bridge.call("Input.dispatchKeyEvent", { type: "keyUp", ...common });
}

async function hideDevBadge(page: Awaited<ReturnType<Browser["page"]>>) {
  await page.eval(`(() => { const s=document.createElement('style'); s.textContent='nextjs-portal{display:none!important}'; document.head.append(s); })()`);
}

async function loadPage(browser: Browser, viewport: Viewport, skin: string) {
  const page = await browser.page(viewport);
  await page.setCookie("arenaSkin", skin, base);
  const bridge = page as unknown as { call: (method: string, params?: object) => Promise<unknown> };
  if (viewport.name !== "phone" && viewport.name !== "desk") {
    await bridge.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  }
  await page.goto(`${base}/arena/preview?fixture=${fixtureName}&skin=${skin}&pace=step&admin=0`);
  await page.waitFor(".arena");
  await hideDevBadge(page);
  if (viewport.name === "shortphone" || viewport.name === "narrowphone") await page.eval(`document.documentElement.style.fontSize='200%'`);
  await page.settle(250);
  return page;
}

async function assertArtwork(page: Awaited<ReturnType<Browser["page"]>>, label: string) {
  const loaded = await page.eval<boolean>(`(() => { const img=document.querySelector('[data-arena-review] img'); return !!img && img.complete && img.naturalWidth > 0; })()`);
  check(loaded, `${label}: review artwork did not load`);
}

async function assertFullArt(page: Awaited<ReturnType<Browser["page"]>>, label: string) {
  const loaded = await page.eval<boolean>(`(() => { const img=document.querySelector('[aria-label="Full card artwork"] img'); return !!img && img.complete && img.naturalWidth > 0; })()`);
  check(loaded, `${label}: full card artwork did not load`);
}

async function save(page: Awaited<ReturnType<Browser["page"]>>, name: string) {
  const path = join(out, name);
  writeFileSync(path, await page.screenshot(false));
  console.log(path);
}

mkdirSync(out, { recursive: true });
await requireServer(base);
let closeBrowser: (() => Promise<void>) | undefined;
try {
  prepareFixture();
  const browser = await Browser.launch();
  closeBrowser = () => browser.close();
  for (const skin of ["anime", "night"]) {
    const desk = await loadPage(browser, { name: "desk", width: 1440, height: 900, mobile: false }, skin);
    if (mode === "after") {
      await desk.tap('[aria-label^="Inspect your hand"]');
      await desk.waitFor("[data-arena-inspector]");
    }
    await save(desk, `desk-play-${skin}-u03-${mode}.jpg`);
    await desk.close();

    for (const viewport of viewports) {
      console.log(`capturing ${skin}/${viewport.name}/${mode}`);
      const page = await loadPage(browser, viewport, skin);
      if (mode === "before") {
        const target = '[data-arena-card="p1#17"] button:not(:disabled)';
        // The baseline card's existing context-menu inspector is independent
        // of the new hand affordance. Dispatch it on the real card button so
        // captures work even when the horizontal board crops that card.
        await page.eval(`(() => { const el=document.querySelector(${JSON.stringify(target)}); if (!el) throw new Error('baseline inspect card missing'); el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2})); })()`);
        await page.waitFor("[data-arena-review]");
        console.log(`opened baseline inspector ${skin}/${viewport.name}`);
        await assertArtwork(page, `${skin}/${viewport.name} baseline`);
        if (viewport.name === "phone") await save(page, `phone-play-${skin}-u03-before.jpg`);
        else await save(page, `${viewport.name}-play-${skin}-u03-before-200text-reduced.jpg`);
      } else {
        const opener = '[aria-label^="Inspect your hand"]';
        const initialIds = await page.eval<string[]>(`[...document.querySelectorAll('.arena-hand [data-arena-card]')].map((el)=>el.getAttribute('data-arena-card')||'')`);
        check(initialIds.length === 20 && new Set(initialIds).size === 20, `${skin}/${viewport.name}: the fixture must have 20 distinct hand instances`);
        console.log(`opening 20-card hand ${skin}/${viewport.name}`);
        await page.tap(opener);
        await page.waitFor('[data-arena-review]');
        const pagerItems = await page.eval<{ ids: string[]; thumbs: number; selected: string }>(`(() => ({
          ids: [...document.querySelectorAll('.arena-hand [data-arena-card]')].map((el)=>el.getAttribute('data-arena-card')||''),
          thumbs: document.querySelectorAll('[data-arena-thumb]').length,
          selected: document.querySelector('[data-arena-review]')?.getAttribute('data-arena-review')||'',
        }))()`);
        check(pagerItems.thumbs === 20 && pagerItems.selected === initialIds[0], `${skin}/${viewport.name}: inspect did not open the first instance in the 20-card hand pager`);
        check(JSON.stringify(pagerItems.ids) === JSON.stringify(initialIds), `${skin}/${viewport.name}: inspecting changed the hand selection or committed an action`);
        await assertArtwork(page, `${skin}/${viewport.name} details`);
        if (viewport.name !== "phone") {
          const control = await page.eval<{ visible: boolean; width: number; height: number; reduced: boolean; zoom: boolean }>(`(() => {
            const button=document.querySelector('[aria-label="View full card"]');
            const r=button?.getBoundingClientRect();
            return { visible:!!r&&r.width>=44&&r.height>=44&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,
              width:r?.width||0,height:r?.height||0,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,
              zoom:parseFloat(getComputedStyle(document.documentElement).fontSize)>=30 };
          })()`);
          check(control.visible && control.reduced && control.zoom, `${skin}/${viewport.name}: Inspect/expand control is not reachable at 200% text and reduced motion`);
        }
        console.log(`expanding full art ${skin}/${viewport.name}`);
        await page.tap('[aria-label="View full card"]');
        await page.waitFor('[aria-label="Show card details"]');
        await assertFullArt(page, `${skin}/${viewport.name} full art`);
        if (viewport.name === "phone") await save(page, `phone-play-${skin}-u03-after.jpg`);
        else await save(page, `${viewport.name}-play-${skin}-u03-after-200text-reduced.jpg`);

        const controls = await page.eval<{ close: number[]; arrows: number[][] }>(`(() => {
          const rect=(el)=>{const r=el?.getBoundingClientRect();return r?[r.left,r.top,r.width,r.height,r.right,r.bottom]:[]};
          return {close:rect(document.querySelector('[aria-label="Close card review"]')),
            arrows:[rect(document.querySelector('[aria-label="Previous card"]')),rect(document.querySelector('[aria-label="Next card"]'))]};
        })()`);
        check(controls.close[2] >= 44 && controls.close[3] >= 44 && controls.close[0] >= 0 && controls.close[4] <= viewport.width && controls.close[1] >= 0 && controls.close[5] <= viewport.height,
          `${skin}/${viewport.name}: full-art close target is clipped or smaller than 44px`);
        for (const arrow of controls.arrows) check(arrow[2] >= 44 && arrow[3] >= 44 && arrow[0] >= 0 && arrow[4] <= viewport.width && arrow[1] >= 0 && arrow[5] <= viewport.height,
          `${skin}/${viewport.name}: full-art pager target is clipped or smaller than 44px`);

        if (viewport.name === "phone" && skin === "anime") {
          let previous = initialIds[0];
          for (let i = 1; i < initialIds.length; i++) {
            await page.swipe('[aria-label="Full card artwork"] img', -110, 0);
            await sleep(130);
            const selected = await page.eval<string>(`document.querySelector('[data-arena-review]')?.getAttribute('data-arena-review')||''`);
            check(selected === initialIds[i], `swipe ${i}: expected instance ${initialIds[i]}, found ${selected}; prior=${previous}`);
            previous = selected;
          }
          await press(page, "ArrowLeft");
          await sleep(100);
          check(await page.eval<boolean>(`document.querySelector('[data-arena-review]')?.getAttribute('data-arena-review')===${JSON.stringify(initialIds[18])}`), "ArrowLeft did not page the full-art view");
          await page.eval(`document.querySelector('[aria-label="Close card review"]')?.focus()`);
          await press(page, "Escape");
          await sleep(100);
          const restored = await page.eval<boolean>(`!document.querySelector('dialog[open]') && document.activeElement?.matches('[aria-label^="Inspect your hand"]')`);
          const handAfter = await page.eval<string[]>(`[...document.querySelectorAll('.arena-hand [data-arena-card]')].map((el)=>el.getAttribute('data-arena-card')||'')`);
          check(restored && JSON.stringify(handAfter) === JSON.stringify(initialIds), "closing review failed to restore focus or changed the hand instances");

          const boardCard = '[data-arena-card="p1#9"] button:not(:disabled)';
          // Open the pre-existing board-card inspector through the same card
          // context-menu handler; the hand inspect affordance above is tested
          // as a real touch. This avoids making a cropped board gesture part
          // of the fullscreen-view capture fixture.
          await page.eval(`(() => { const el=document.querySelector(${JSON.stringify(boardCard)}); if (!el) throw new Error('board inspect card missing'); el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2})); })()`);
          await page.waitFor('[data-arena-review="p1#9"]');
          await assertArtwork(page, `${skin}/board-card inspect`);
          await page.eval(`document.querySelector('[aria-label="Close card review"]')?.click()`);
          await sleep(100);
        }
      }
      await page.close();
    }
  }
} finally {
  await closeBrowser?.();
  rmSync(fixturePath, { force: true });
}
