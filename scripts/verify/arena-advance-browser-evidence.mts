/**
 * Screenshot proof for Arena's post-acknowledgement advance error and Retry UI.
 * Run against `DATABASE_URL='' npm run dev`. The existing dev-only preview is
 * given a temporary play fixture and a scripted fake action; no API/DB is used.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Snapshot } from "../../src/lib/arena/snapshot";
import { Browser, requireServer, sleep, VIEWPORTS } from "../lib/cdp.mts";

const base = (process.env.ARENA_BASE ?? "http://localhost:3000").replace(/\/$/, "");
const baseline = process.env.ARENA_CAPTURE_BASELINE === "1";
const root = process.cwd();
const serverRoot = process.env.ARENA_PREVIEW_ROOT ?? root;
const fixtureName = "arena-advance-proof";
const fixturePath = join(serverRoot, "contract", "fixtures", `${fixtureName}.json`);
const artPath = join(root, "docs/arena-backlog/evidence/566/BT1-053.webp");
const evidenceDir = join(root, "docs/arena-backlog/evidence/566");
const artUrl = "http://arena-566-art.local/BT1-053.webp";
if (!existsSync(artPath)) throw new Error(`Missing portable artwork fixture: ${artPath}`);
if (existsSync(fixturePath)) throw new Error(`Refusing to overwrite existing preview fixture: ${fixturePath}`);

const snapshot = JSON.parse(readFileSync(join(root, "contract/fixtures/play.json"), "utf8")) as Snapshot;
snapshot.game.mode = "sparring";
if (!snapshot.view.you.leader) throw new Error("Play fixture has no visible leader for the artwork proof.");
Object.assign(snapshot.view.you.leader, { cardId: "BT1-053", name: "Senzu Bean", imageUrl: artUrl });
mkdirSync(evidenceDir, { recursive: true });
writeFileSync(fixturePath, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: "wx" });

type Paused = { requestId: string; request: { url: string } };
type SessionPage = { sid: string };
let browser: Browser | null = null;
let captures = 0;

async function waitFor(page: Awaited<ReturnType<Browser["page"]>>, expression: string, label: string) {
  const until = Date.now() + 6000;
  while (Date.now() < until) {
    if (await page.eval<boolean>(expression)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

try {
  await requireServer(base);
  browser = await Browser.launch();
  for (const viewport of VIEWPORTS) {
    for (const skin of ["anime", "night"] as const) {
      const page = await browser.page(viewport);
      const sessionId = (page as unknown as SessionPage).sid;
      await page.beforeLoad(`window.__arenaPreviewDriver = { actions: [], advances: 0, failFirstAdvance: true, failedFirstAdvance: false };`);
      await browser.send("Fetch.enable", { patterns: [
        { urlPattern: "http://arena-566-art.local/*", requestStage: "Request" },
        { urlPattern: "*/api/v1/games/1*", requestStage: "Request" },
      ] }, sessionId);
      let closing = false;
      const requests = (method: string, params: Paused, eventSession?: string) => {
        if (closing || eventSession !== sessionId || method !== "Fetch.requestPaused") return;
        if (params.request.url === artUrl) {
          void browser!.send("Fetch.fulfillRequest", {
            requestId: params.requestId,
            responseCode: 200,
            responseHeaders: [{ name: "content-type", value: "image/webp" }, { name: "cache-control", value: "no-store" }],
            body: readFileSync(artPath).toString("base64"),
          }, sessionId);
        } else if (params.request.url.includes("/api/v1/games/1")) {
          void browser!.send("Fetch.fulfillRequest", {
            requestId: params.requestId,
            responseCode: 404,
            responseHeaders: [{ name: "content-type", value: "application/json; charset=utf-8" }],
            body: Buffer.from(JSON.stringify({ error: "Browser proof uses the local preview fixture only." })).toString("base64"),
          }, sessionId);
        } else {
          void browser!.send("Fetch.continueRequest", { requestId: params.requestId }, sessionId);
        }
      };
      browser.on(requests);
      await page.setCookie("arenaSkin", skin, base);
      await page.goto(`${base}/arena/preview?fixture=${fixtureName}&skin=${skin}&pace=step`);
      await page.waitFor(".arena");
      await page.settle(700);
      const imageReady = await page.eval<boolean>(`(() => { const i = [...document.querySelectorAll('img')].find((el) => el.src === ${JSON.stringify(artUrl)}); return !!i && i.complete && i.naturalWidth > 0; })()`);
      if (!imageReady) throw new Error(`${viewport.name}/${skin}: local Senzu Bean artwork did not load`);

      if (baseline) {
        const name = `${viewport.name}-${skin}-before.jpg`;
        writeFileSync(join(evidenceDir, name), await page.screenshot(false));
        captures++;
        closing = true;
        await page.close();
        continue;
      }

      const fits = await page.eval<boolean>(`(() => { const a = document.documentElement; const bar = document.querySelector('.arena-topbar'); return a.scrollWidth <= a.clientWidth && (!bar || bar.scrollWidth <= bar.clientWidth); })()`);
      if (!fits) throw new Error(`${viewport.name}/${skin}: stage controls overflow horizontally`);
      const action = await page.eval<{ clicked: boolean; buttons: string[] }>(`(() => { const bs = [...document.querySelectorAll('button')]; const b = bs.find((el) => el.textContent?.includes('End turn')); if (b) b.click(); return { clicked: !!b, buttons: bs.map((el) => el.textContent?.trim() ?? '').filter(Boolean) }; })()`);
      if (!action.clicked) throw new Error(`${viewport.name}/${skin}: fixture did not expose the human End turn action (${action.buttons.join(" | ")})`);
      await waitFor(page, `!!document.querySelector('[data-arena-advance-retry]')`, "advance failure Retry control");
      await waitFor(page, `!document.querySelector('[data-arena-advance-retry]').disabled`, "enabled Retry control after request completion");
      const failedState = await page.eval<{ actions: unknown[]; advances: number; message: string; retry: { width: number; height: number; left: number; right: number } }>(`(() => {
        const d = window.__arenaPreviewDriver; const b = document.querySelector('[data-arena-advance-retry]'); const r = b.getBoundingClientRect();
        return { actions: d.actions, advances: d.advances, message: document.querySelector('.arena-bar p')?.textContent ?? '', retry: { width: r.width, height: r.height, left: r.left, right: r.right } };
      })()`);
      if (failedState.actions.length !== 1 || failedState.advances !== 1) throw new Error(`${viewport.name}/${skin}: first failure did not follow one action and one advance (${JSON.stringify(failedState)})`);
      if (!failedState.message.includes("mocked opponent advance failed")) throw new Error(`${viewport.name}/${skin}: advance failure is not visible in the PromptPanel`);
      if (failedState.retry.width < 44 || failedState.retry.height < 44 || failedState.retry.left < 0 || failedState.retry.right > viewport.width) throw new Error(`${viewport.name}/${skin}: Retry target is clipped or smaller than 44×44 (${JSON.stringify(failedState.retry)})`);
      writeFileSync(join(evidenceDir, `${viewport.name}-${skin}-error.jpg`), await page.screenshot(false));

      const keyboardFocusable = await page.eval<boolean>(`(() => { const b = document.querySelector('[data-arena-advance-retry]'); b.focus(); return b.tagName === 'BUTTON' && document.activeElement === b && !b.disabled; })()`);
      if (!keyboardFocusable) throw new Error(`${viewport.name}/${skin}: Retry is not an enabled keyboard-focusable native button`);
      await page.tap("[data-arena-advance-retry]");
      await waitFor(page, `window.__arenaPreviewDriver.advances === 2`, `${viewport.name}/${skin} second advance request after Retry`);
      await page.settle(300);
      const afterRetry = await page.eval<{ actions: unknown[]; advances: number; retry: boolean }>(`(() => ({ actions: window.__arenaPreviewDriver.actions, advances: window.__arenaPreviewDriver.advances, retry: !!document.querySelector('[data-arena-advance-retry]') }))()`);
      if (afterRetry.actions.length !== 1 || afterRetry.advances !== 2 || afterRetry.retry) throw new Error(`${viewport.name}/${skin}: Retry repeated the human action or left the error visible (${JSON.stringify(afterRetry)})`);
      writeFileSync(join(evidenceDir, `${viewport.name}-${skin}-retried.jpg`), await page.screenshot(false));
      captures += 2;
      closing = true;
      await page.close();
    }
  }
} finally {
  await browser?.close();
  rmSync(fixturePath, { force: true });
}
console.log(`${baseline ? "base-747 before" : "ArenaStage advance Retry proof"}: ${captures} screenshots in ${evidenceDir}`);
