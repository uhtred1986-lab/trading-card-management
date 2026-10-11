/**
 * Browser proof for connection recovery with real local card art. Requires
 * `DATABASE_URL='' npm run dev`; only CDP Fetch interception supplies test
 * snapshot responses. The dev-only fixture is written for the run and removed
 * in `finally`; no route or mock is shipped in the app.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Snapshot } from "../../src/lib/arena/snapshot";
import { Browser, requireServer, sleep, VIEWPORTS } from "../lib/cdp.mts";

const base = (process.env.ARENA_BASE ?? "http://localhost:3000").replace(/\/$/, "");
const captureBaseline = process.env.ARENA_CAPTURE_BASELINE === "1";
const repo = process.cwd();
const fixturePath = join(repo, "contract", "fixtures", "arena-live-proof.json");
const evidenceDir = join(repo, "docs", "arena-backlog", "evidence", "546");
const art = {
  "BT1-055": { url: "http://arena-art.local/BT1-055.webp", path: join(evidenceDir, "assets", "whis-coercion-bt1-055.webp"), mime: "image/webp" },
  "BT11-053": { url: "http://arena-art.local/BT11-053.jpg", path: join(evidenceDir, "assets", "senzu-bean-bt11-053.jpg"), mime: "image/jpeg" },
} as const;
for (const asset of Object.values(art)) {
  if (!existsSync(asset.path)) throw new Error(`Missing review-only card art at ${asset.path}; restore the committed evidence assets.`);
}

const fixture = JSON.parse(readFileSync(join(repo, "contract", "fixtures", "versus.json"), "utf8")) as Snapshot;
const hand = fixture.view.you.hand;
for (const [index, cardId] of ["BT11-053", "BT1-055"].entries()) {
  const target = hand?.[index];
  if (!target) throw new Error(`Expected hand card ${index} in versus proof fixture.`);
  const cardName = cardId === "BT11-053" ? "Senzu Bean" : "Whis's Coercion";
  Object.assign(target, { cardId, name: cardName, imageUrl: art[cardId as keyof typeof art].url });
}
writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, { flag: "wx" });

const terminal = JSON.parse(JSON.stringify(fixture)) as Snapshot;
terminal.game.revision = fixture.game.revision + 1;
const realTerminalShape = JSON.parse(readFileSync(join(repo, "contract", "fixtures", "over.json"), "utf8")) as Snapshot;
terminal.game.status = realTerminalShape.game.status;
terminal.waiting = null;
terminal.legal = [];
delete terminal.rejected;
terminal.taps = { byCard: {}, bare: [], attackTargets: {} };
terminal.view.phase = realTerminalShape.view.phase;
terminal.view.prompt = realTerminalShape.view.prompt;
terminal.over = { winner: fixture.game.you, reason: "The match is over." };
terminal.view.over = terminal.over;

mkdirSync(evidenceDir, { recursive: true });
let browser: Browser | null = null;
let count = 0;
try {
  await requireServer(base);
  browser = await Browser.launch();
  for (const viewport of VIEWPORTS) {
    const page = await browser.page(viewport);
    await page.interceptFetch(["*://*/api/v1/games/1*", "http://arena-art.local/*"]);
    let resolveTerminalRequest: ((value: { requestId: string; request: { url: string } }) => void) | null = null;
    page.onFetchPaused((request) => {
      const artKey = Object.keys(art).find((id) => request.request.url === art[id as keyof typeof art].url);
      if (artKey) {
        const image = art[artKey as keyof typeof art];
        void page.fulfillFetchBytes(request.requestId, readFileSync(image.path), image.mime);
      } else if (request.request.url.includes("/api/v1/games/1")) {
        if (resolveTerminalRequest) {
          const resolve = resolveTerminalRequest;
          resolveTerminalRequest = null;
          resolve(request);
        } else {
          void page.fulfillFetch(request.requestId, JSON.stringify({ error: "No live game API is used by this browser proof." }), 503);
        }
      } else {
        void page.continueFetch(request.requestId);
      }
    });

    for (const skin of ["anime", "night"]) {
      await page.setCookie("arenaSkin", skin, base);
      await page.goto(`${base}/arena/preview?fixture=arena-live-proof&skin=${skin}&pace=step`);
      await page.waitFor(".arena");
      await page.settle(700);
      const artworkLoaded = await page.eval<boolean>(`Array.from(document.querySelectorAll('img[src*="arena-art.local"]')).length >= 2 && Array.from(document.querySelectorAll('img[src*="arena-art.local"]')).every((img) => img.complete && img.naturalWidth > 0)`);
      if (!artworkLoaded) throw new Error(`${viewport.name}/${skin}: real card artwork did not load from the local review assets`);
      if (captureBaseline) {
        await page.setOffline(true);
        await sleep(250);
        writeFileSync(join(evidenceDir, `${viewport.name}-${skin}-offline-before.jpg`), await page.screenshot(false));
        await page.setOffline(false);
        count++;
        continue;
      }
      const topbarFits = await page.eval<boolean>(`(() => { const el = document.querySelector('.arena-topbar'); return !!el && el.scrollWidth <= el.clientWidth; })()`);
      if (!topbarFits) throw new Error(`${viewport.name}/${skin}: topbar controls overflowed`);

      await page.setOffline(true);
      const offlineEnd = Date.now() + 5000;
      while (Date.now() < offlineEnd && !(await page.eval<boolean>(`!!document.querySelector('[data-arena-connection="offline"]')`))) await sleep(50);
      if (!(await page.eval<boolean>(`!!document.querySelector('[data-arena-connection="offline"]')`))) throw new Error(`${viewport.name}/${skin}: offline state did not appear`);
      if (!(await page.eval<boolean>(`!!document.querySelector('button[aria-label="Retry arena connection"]')`))) throw new Error(`${viewport.name}/${skin}: Retry button missing offline`);
      const retryTarget = await page.eval<{ width: number; height: number }>(`(() => { const button = document.querySelector('button[aria-label="Retry arena connection"]'); if (!button) return { width: 0, height: 0 }; const r = button.getBoundingClientRect(); return { width: r.width, height: r.height }; })()`);
      if (retryTarget.width < 44 || retryTarget.height < 44) throw new Error(`${viewport.name}/${skin}: Retry target is smaller than 44×44 CSS px`);
      await page.tap('button[aria-label="Retry arena connection"]');
      if (!(await page.eval<boolean>(`!!document.querySelector('[data-arena-connection="offline"]')`))) throw new Error(`${viewport.name}/${skin}: Retry lost the Offline state without a network`);
      writeFileSync(join(evidenceDir, `${viewport.name}-${skin}-offline.jpg`), await page.screenshot(false));

      const terminalRequestPromise = new Promise<{ requestId: string; request: { url: string } }>((resolve) => { resolveTerminalRequest = resolve; });
      await page.setOffline(false);
      const reconnectEnd = Date.now() + 5000;
      while (Date.now() < reconnectEnd && !(await page.eval<boolean>(`!!document.querySelector('[data-arena-connection="reconnecting"]')`))) await sleep(50);
      if (!(await page.eval<boolean>(`!!document.querySelector('[data-arena-connection="reconnecting"]')`))) throw new Error(`${viewport.name}/${skin}: reconnect state did not appear after browser came online`);
      const terminalRequest = await Promise.race([
        terminalRequestPromise,
        sleep(5000).then(() => { throw new Error(`${viewport.name}/${skin}: terminal GET was not intercepted`); }),
      ]);
      writeFileSync(join(evidenceDir, `${viewport.name}-${skin}-reconnecting.jpg`), await page.screenshot(false));
      await page.fulfillFetch(terminalRequest.requestId, JSON.stringify(terminal));
      const terminalEnd = Date.now() + 5000;
      while (Date.now() < terminalEnd && !(await page.eval<boolean>(`!!document.querySelector('[role="dialog"][aria-label="victory"]')`))) await sleep(50);
      if (!(await page.eval<boolean>(`!!document.querySelector('[role="dialog"][aria-label="victory"]')`))) throw new Error(`${viewport.name}/${skin}: terminal higher-revision snapshot did not render`);
      if (await page.eval<boolean>(`!!document.querySelector('[data-arena-connection]')`)) throw new Error(`${viewport.name}/${skin}: connected terminal state kept the recovery warning`);
      if (!(await page.eval<boolean>(`!!document.querySelector('img[src*="arena-art.local"]')?.naturalWidth`))) throw new Error(`${viewport.name}/${skin}: terminal screen dropped the real card artwork`);
      await sleep(900); // Let the existing victory overlay finish its entrance before capturing evidence.
      writeFileSync(join(evidenceDir, `${viewport.name}-${skin}-recovered.jpg`), await page.screenshot(false));
      count += 3;
    }
    await page.close();
  }
} finally {
  await browser?.close();
  rmSync(fixturePath, { force: true });
}
console.log(`${captureBaseline ? "arena baseline screenshots" : "arena connection browser proof"}: ${count} screenshots written to ${evidenceDir}`);
