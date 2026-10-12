/**
 * Capture the admin replay-export UI in the real ArenaStage on the dev-only
 * fixture route. The route's checked-in snapshot is copied to a temporary
 * visual fixture with one local card image attached; all files are removed in
 * finally. Only the replay URL is intercepted, so no database/API is used.
 *
 * Run with DATABASE_URL='' npm run dev, then DATABASE_URL='' npx tsx
 * scripts/verify/replay-browser-evidence.mts. Set ARENA_CAPTURE_BASELINE=1
 * against base 74701713 for the before screenshots.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Snapshot } from "../../src/lib/arena/snapshot";
import { Browser, requireServer, sleep, VIEWPORTS } from "../lib/cdp.mts";

const base = (process.env.ARENA_BASE ?? "http://localhost:3000").replace(/\/$/, "");
const baseline = process.env.ARENA_CAPTURE_BASELINE === "1";
const repo = process.cwd();
const fixtureDir = join(repo, "contract", "fixtures");
const fixtureName = "replay-browser-proof";
const fixturePath = join(fixtureDir, `${fixtureName}.json`);
const sourceFixture = join(fixtureDir, "versus.json");
const artPath = join(repo, "docs", "arena-backlog", "evidence", "547", "BT1-053.webp");
const evidenceDir = join(repo, "docs", "arena-backlog", "evidence", "547");
const downloadDir = join(tmpdir(), `arena-replay-download-${process.pid}`);
const artUrl = "http://arena-replay-art.local/BT1-053.webp";
const gameId = 1;
const fixtureBody = {
  format: 1,
  gameId,
  exact: false,
  reason: "A historical export without a pinned bundle is not an exact replay.",
  seed: 20261012,
  engine: "rules",
  actions: [],
};

if (!existsSync(artPath)) throw new Error(`Missing portable card-art evidence asset: ${artPath}`);
if (existsSync(fixturePath)) throw new Error(`Refusing to overwrite an existing fixture: ${fixturePath}`);
mkdirSync(evidenceDir, { recursive: true });
mkdirSync(downloadDir, { recursive: true });

const snapshot = JSON.parse(readFileSync(sourceFixture, "utf8")) as Snapshot;
if (!snapshot.view.you.leader) throw new Error("The versus contract fixture has no visible leader for the art proof.");
Object.assign(snapshot.view.you.leader, { cardId: "BT1-053", name: "Senzu Bean", imageUrl: artUrl });
writeFileSync(fixturePath, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: "wx" });

type PausedRequest = { requestId: string; request: { url: string } };
type CdpPage = { sid: string };
const captured: string[] = [];
let browser: Browser | null = null;

async function fulfill(browser: Browser, page: CdpPage, requestId: string, body: string, status: number, mimeType: string) {
  await browser.send("Fetch.fulfillRequest", {
    requestId,
    responseCode: status,
    responseHeaders: [{ name: "content-type", value: mimeType }],
    body: Buffer.from(body).toString("base64"),
  }, page.sid);
}

async function fulfillBytes(browser: Browser, page: CdpPage, requestId: string, bytes: Buffer, mimeType: string) {
  await browser.send("Fetch.fulfillRequest", {
    requestId,
    responseCode: 200,
    responseHeaders: [{ name: "content-type", value: mimeType }, { name: "cache-control", value: "no-store" }],
    body: bytes.toString("base64"),
  }, page.sid);
}

async function waitFile(path: string) {
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    if (existsSync(path)) return;
    await sleep(50);
  }
  throw new Error(`Download did not complete at ${path}`);
}

try {
  await requireServer(base);
  browser = await Browser.launch();
  for (const viewport of VIEWPORTS) {
    for (const skin of ["anime", "night"] as const) {
      const page = await browser.page(viewport);
      const sessionId = (page as unknown as CdpPage).sid;
      let pageClosing = false;
      const iterationDownloadDir = join(downloadDir, `${viewport.name}-${skin}`);
      mkdirSync(iterationDownloadDir, { recursive: true });
      await browser.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: iterationDownloadDir, eventsEnabled: true });
      await browser.send("Fetch.enable", { patterns: [
        { urlPattern: "http://arena-replay-art.local/*", requestStage: "Request" },
        { urlPattern: `*/api/v1/games/${gameId}*`, requestStage: "Request" },
      ] }, sessionId);

      const requestHandler = (method: string, params: PausedRequest, eventSession?: string) => {
        if (pageClosing || eventSession !== sessionId || method !== "Fetch.requestPaused") return;
        if (params.request.url === artUrl) {
          void fulfillBytes(browser!, { sid: sessionId }, params.requestId, readFileSync(artPath), "image/webp").catch((error) => console.error("art interception failed:", error));
        } else if (params.request.url.includes(`/api/v1/games/${gameId}/replay`)) {
          void fulfill(browser!, { sid: sessionId }, params.requestId, JSON.stringify(fixtureBody, null, 2), 200, "application/json; charset=utf-8").catch((error) => console.error("download interception failed:", error));
        } else if (params.request.url.includes(`/api/v1/games/${gameId}?`)) {
          void fulfill(browser!, { sid: sessionId }, params.requestId, JSON.stringify(snapshot), 200, "application/json; charset=utf-8").catch((error) => console.error("snapshot interception failed:", error));
        } else {
          void browser!.send("Fetch.continueRequest", { requestId: params.requestId }, sessionId).catch((error) => console.error("request continuation failed:", error));
        }
      };
      browser.on(requestHandler);

      await page.goto(`${base}/arena/preview?fixture=${fixtureName}&skin=${skin}&pace=step`);
      await page.waitFor("[data-arena-admin='shield']");
      await page.settle(500);
      const artLoaded = await page.eval<boolean>(`(() => { const img = [...document.querySelectorAll('img')].find((el) => el.src === ${JSON.stringify(artUrl)}); return !!img && img.complete && img.naturalWidth > 0; })()`);
      if (!artLoaded) throw new Error(`${viewport.name}/${skin}: local Senzu Bean artwork failed to load`);
      const boardName = `${viewport.name}-${skin}-${baseline ? "before" : "after"}-board.jpg`;
      writeFileSync(join(evidenceDir, boardName), await page.screenshot(false));
      captured.push(boardName);
      await page.tap("[data-arena-admin='shield']");
      await page.waitFor("[data-arena-admin='drawer']");
      await page.settle(500);
      const filename = await page.eval<string>(`document.querySelector('[data-arena-admin="replay-export"]')?.getAttribute('download') ?? ''`);
      if (baseline) {
        if (filename) throw new Error(`Base 747 unexpectedly has a replay download link (${filename})`);
        const name = `${viewport.name}-${skin}-before.jpg`;
        writeFileSync(join(evidenceDir, name), await page.screenshot(false));
        captured.push(name);
      } else {
        if (filename !== `arena-game-${gameId}-replay.json`) throw new Error(`Unexpected download filename: ${filename}`);
        const buttonBox = await page.eval<{ left: number; right: number; top: number; bottom: number; width: number; height: number; scrollWidth: number; clientWidth: number }>(`(() => { const el = document.querySelector('[data-arena-admin="replay-export"]'); if (!el) return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, scrollWidth: 0, clientWidth: 0 }; const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }; })()`);
        if (buttonBox.width < 44 || buttonBox.height < 44 || buttonBox.left < 0 || buttonBox.right > viewport.width || buttonBox.scrollWidth > buttonBox.clientWidth) {
          throw new Error(`${viewport.name}/${skin}: replay link target is undersized, clipped, or horizontally overflowing (${JSON.stringify(buttonBox)})`);
        }
        const name = `${viewport.name}-${skin}-after.jpg`;
        writeFileSync(join(evidenceDir, name), await page.screenshot(false));
        captured.push(name);

        let resolveDownload!: (value: { guid: string; suggestedFilename: string }) => void;
        let resolveComplete!: () => void;
        const downloadStarted = new Promise<{ guid: string; suggestedFilename: string }>((resolve) => { resolveDownload = resolve; });
        const downloadCompleted = new Promise<void>((resolve) => { resolveComplete = resolve; });
        browser.on((method, params, eventSession) => {
          if (eventSession) return;
          if (method === "Browser.downloadWillBegin") resolveDownload(params as { guid: string; suggestedFilename: string });
          if (method === "Browser.downloadProgress" && params.state === "completed") resolveComplete();
        });
        await page.tap("[data-arena-admin='replay-export']");
        const started = await Promise.race([
          downloadStarted,
          sleep(10000).then(() => { throw new Error(`${viewport.name}/${skin}: browser did not emit downloadWillBegin after the real link click`); }),
        ]);
        if (started.suggestedFilename !== filename) throw new Error(`Browser suggested ${started.suggestedFilename}, link declared ${filename}`);
        await Promise.race([
          downloadCompleted,
          sleep(10000).then(() => { throw new Error(`${viewport.name}/${skin}: browser download did not complete`); }),
        ]);
        const downloadedPath = join(iterationDownloadDir, filename);
        await waitFile(downloadedPath);
        const downloaded = JSON.parse(readFileSync(downloadedPath, "utf8")) as typeof fixtureBody;
        if (downloaded.format !== 1 || downloaded.gameId !== gameId || downloaded.exact !== false || !Array.isArray(downloaded.actions)) {
          throw new Error(`${viewport.name}/${skin}: downloaded export body did not match the controlled response`);
        }
        captured.push(`${viewport.name}-${skin}-download.json`);
        writeFileSync(join(evidenceDir, `${viewport.name}-${skin}-download.json`), `${JSON.stringify(downloaded, null, 2)}\n`);
      }
      pageClosing = true;
      await page.close();
    }
  }
} finally {
  await browser?.close();
  rmSync(fixturePath, { force: true });
  rmSync(downloadDir, { recursive: true, force: true });
}

const extras = readdirSync(evidenceDir).filter((name) => captured.includes(name));
console.log(`${baseline ? "base-747 before" : "current after"} Arena preview evidence: ${extras.length} artifacts at ${evidenceDir}`);
