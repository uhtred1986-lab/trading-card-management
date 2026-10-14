/**
 * Screenshots (and a smoke drive) of `/arena/local` in real Chrome, no database (#656):
 * the start screen, a refused pack, the board on a local match, the saved-match screen after a
 * reload, a second tab (ownership lost), a full device, and 200 % text — at 1440 and 390, both skins.
 *
 *   npm run dev                                   # in one terminal (any port)
 *   npx tsx scripts/arena-local-board-shots.mts --pack staged.json [--refused audit.json] [--base http://localhost:3000] [--out dir]
 *
 * `--pack` is a qualified pack file (the test-only staged pair of `scripts/verify/arena-local-worker-fixture.mts`);
 * `--refused` is the audited pack as built today (unplayable). The page is driven like a player drives it:
 * a file chosen in the picker, the Start button, the board's own AI advance. Nothing is sent to a server
 * (the run counts requests to /api and server actions and fails when there is one).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { arg, Browser, requireServer, sleep, VIEWPORTS } from "./lib/cdp.mts";

const base = (arg("base") ?? "http://localhost:3000").replace(/\/$/, "");
const out = arg("out") ?? join(process.cwd(), "docs", "arena-redesign", "current", "local");
const packFile = arg("pack");
const refusedFile = arg("refused");
const skins = (arg("skins") ?? "anime,night").split(",");
if (!packFile) throw new Error("--pack <qualified pack file> is required");
mkdirSync(out, { recursive: true });
await requireServer(base);

const pack = readFileSync(packFile, "utf8");
const refused = refusedFile ? readFileSync(refusedFile, "utf8") : null;
const browser = await Browser.launch();
const requests: string[] = [];
let shots = 0;
// Anything the page asks of the app's own server beyond its page assets: an API route, a server action, an RSC fetch.
browser.on((method, params) => {
  if (method !== "Network.requestWillBeSent") return;
  const { url, method: verb, headers } = params.request as { url: string; method: string; headers: Record<string, string> };
  if (url.startsWith(base) && (/\/api\//.test(url) || verb === "POST" || headers["Next-Action"] || headers["RSC"] || headers["rsc"])) requests.push(`${verb} ${url}`);
});

const choose = (page: Awaited<ReturnType<Browser["page"]>>, text: string) =>
  page.eval(`(() => {
    const input = document.querySelector('input[type=file]');
    const dt = new DataTransfer();
    dt.items.add(new File([${JSON.stringify(text)}], "pack.json", { type: "application/json" }));
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
const clickText = (page: Awaited<ReturnType<Browser["page"]>>, text: string) =>
  page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)}) && !x.disabled); if (!b) return false; b.click(); return true; })()`);
const textOf = (page: Awaited<ReturnType<Browser["page"]>>) => page.eval(`document.body.innerText`) as Promise<string>;
async function until(page: Awaited<ReturnType<Browser["page"]>>, predicate: string, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.eval(predicate)) return;
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${predicate}\n${(await textOf(page)).slice(0, 600)}`);
}

/**
 * A device out of space, as the match engine meets it: every IndexedDB write in the match Workers a page
 * started throws the browser's own `QuotaExceededError` (Chrome's quota override does not bite on localhost in
 * headless). The Workers are reached by auto-attaching to the page that owns them.
 */
const workerSessions = new Map<string, string[]>();
browser.on((method, params, sessionId) => {
  if (method !== "Target.attachedToTarget" || params.targetInfo?.type !== "worker" || !sessionId) return;
  workerSessions.set(sessionId, [...(workerSessions.get(sessionId) ?? []), params.sessionId as string]);
});
async function watchWorkers(page: Awaited<ReturnType<Browser["page"]>>): Promise<void> {
  await page.cdp("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
}
async function storageFull(page: Awaited<ReturnType<Browser["page"]>>, on: boolean): Promise<void> {
  const sid = (page as unknown as { sid: string }).sid;
  const sessions = workerSessions.get(sid) ?? [];
  if (!sessions.length) throw new Error("no match Worker is attached to this page");
  for (const session of sessions) {
    await browser.send("Runtime.evaluate", {
      expression: on
        ? `(() => { const P = IDBObjectStore.prototype; if (!P.__put) { P.__put = P.put; P.__add = P.add; } P.put = P.add = function () { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); }; })()`
        : `(() => { const P = IDBObjectStore.prototype; if (P.__put) { P.put = P.__put; P.add = P.__add; } })()`,
    }, session).catch(() => {});
  }
}

try {
  for (const vp of arg("viewports") ? VIEWPORTS.filter((v) => arg("viewports")!.split(",").includes(v.name)) : VIEWPORTS) {
    for (const skin of skins) {
      const tag = (name: string) => join(out, `${vp.name}-local-${skin}-${name}.jpg`);
      const shoot = async (page: Awaited<ReturnType<Browser["page"]>>, name: string, settle = 600) => {
        await page.settle(settle);
        writeFileSync(tag(name), await page.screenshot(false));
        shots++;
        console.log(tag(name));
      };
      const open = async () => {
        const page = await browser.page(vp);
        await page.setCookie("arenaSkin", skin, base);
        await page.beforeLoad(`try { localStorage.setItem("arena.pace", "step"); } catch {}`);
        await page.goto(`${base}/arena/local?skin=${skin}`);
        await page.waitFor("input[type=file]");
        return page;
      };

      // 1. Start screen, then a refused pack.
      const page = await open();
      await shoot(page, "start");
      if (refused) {
        await choose(page, refused);
        await until(page, `document.body.textContent.includes("not playable yet")`);
        await shoot(page, "refused");
      }

      // 2. A qualified pack: the form, then the board.
      await choose(page, pack);
      await until(page, `document.body.textContent.includes("New match")`);
      await shoot(page, "pack");
      await page.eval(`document.documentElement.style.fontSize = "200%"`);
      await shoot(page, "pack-200", 500);
      await page.eval(`document.documentElement.style.fontSize = ""`);
      if (!(await clickText(page, "Start match"))) throw new Error("no Start button");
      await page.waitFor(".arena", 60000);
      await shoot(page, "board", 1500);

      // 3. 200 % text on the board.
      await page.eval(`document.documentElement.style.fontSize = "200%"`);
      await shoot(page, "board-200", 800);
      await page.eval(`document.documentElement.style.fontSize = ""`);

      // 4. Reload: the saved match is offered, the pack is chosen again, Continue.
      await page.goto(`${base}/arena/local?skin=${skin}`);
      await page.waitFor("input[type=file]");
      await until(page, `document.body.textContent.includes("Saved match")`);
      await shoot(page, "saved");
      await choose(page, pack);
      await until(page, `[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === "Continue" && !b.disabled)`);
      await clickText(page, "Continue");
      await page.waitFor(".arena", 60000);
      await shoot(page, "resumed", 1500);

      // 5. A second tab on the same match: it only watches.
      const second = await open();
      await watchWorkers(second);
      await choose(second, pack);
      await until(second, `document.body.textContent.includes("Saved match")`);
      await until(second, `[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === "Continue" && !b.disabled)`);
      await clickText(second, "Continue");
      await until(second, `document.body.textContent.includes("open in another tab")`, 60000);
      await shoot(second, "other-tab", 1000);
      // "Play here instead": the first tab loses the match the next time it looks (its heartbeat).
      await clickText(second, "Play here instead");
      await until(page, `document.body.textContent.includes("took this match over")`, 30000);
      await shoot(page, "ownership-lost", 800);

      // 6. A full device: the origin's quota is cut to nothing, then the human answers the first question.
      await until(second, `!document.body.textContent.includes("open in another tab")`, 30000);
      await storageFull(second, true);
      // The first question is either the flip's (Go first) or the mulligan's (Keep hand).
      if (!(await clickText(second, "Go first")) && !(await clickText(second, "Keep hand"))) throw new Error("no first question to answer");
      await until(second, `document.body.textContent.includes("Could not save on this device")`, 30000);
      await shoot(second, "storage-error", 600);
      await second.eval(`document.documentElement.style.fontSize = "200%"`);
      await shoot(second, "storage-error-200", 600);
      await second.eval(`document.documentElement.style.fontSize = ""`);
      await storageFull(second, false);
      await clickText(second, "Try again");
      await until(second, `!document.body.textContent.includes("Could not save on this device")`, 30000);
      await shoot(second, "recovered", 800);
      // The board's menu says where the match is saved.
      await second.tap('[aria-label="Open arena settings and counts"]');
      await shoot(second, "menu", 600);
      await second.close();
      await page.close();
    }
  }
} finally {
  await browser.close();
}
writeFileSync(join(out, "requests.json"), JSON.stringify(requests, null, 2));
console.log(`\n${shots} screenshots in ${out}; ${requests.length} server request(s) beyond page assets`);
if (requests.length) process.exitCode = 1;
