/**
 * Driving `/arena/local` ("Play on this device", #656) in real Chrome over `scripts/lib/cdp.mts`:
 * the helpers `scripts/arena-local-board-shots.mts` (screenshots) and `scripts/arena-local-browser.mts`
 * (#657, recovery scenarios against a production build) share.
 *
 *  - `choosePack`, `clickText`, `textOf`, `until`: the page driven as a player drives it.
 *  - `WORKER_TAP`: run before the page's own scripts; keeps a handle on every module Worker the page
 *    starts and a log of what it sent them, so a proof can terminate the real Worker or post a
 *    duplicate/stale message to it. It changes nothing the page does.
 *  - `BOARD`: the page's own `LocalBoard` (the `ArenaSession` the board was handed), found through
 *    React's fiber on the DOM — the production build keeps it. A proof reads `snapshot`/`state` from
 *    it and answers the human's question with its `act`, as the board's buttons would.
 *  - `readJournalExpr`: the match as saved in the real IndexedDB (`dbs-arena-local`), read-only.
 *  - `WorkerTaps`: CDP sessions on the page's dedicated Workers, to inject storage faults inside them.
 *  - `denyNetwork`: every match/provider request (an API route, a server action, any other host)
 *    failed at the browser and counted; page documents and static assets pass.
 */
import type { Browser, Page } from "./cdp.mts";
import { sleep } from "./cdp.mts";

export const choosePack = (page: Page, text: string) =>
  page.eval(`(() => {
    const input = document.querySelector('input[type=file]');
    const dt = new DataTransfer();
    dt.items.add(new File([${JSON.stringify(text)}], "pack.json", { type: "application/json" }));
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);

export const clickText = (page: Page, text: string) =>
  page.eval<boolean>(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)}) && !x.disabled && x.getClientRects().length > 0); if (!b) return false; b.click(); return true; })()`);

export const textOf = (page: Page) => page.eval<string>(`document.body.innerText`);

export async function until(page: Page, predicate: string, ms = 30000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.eval(predicate)) return;
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${predicate}\n${(await textOf(page)).slice(0, 600)}`);
}

/** Before the page's scripts: a tap on `Worker` (handles, sent messages, the last answers). */
export const WORKER_TAP = `(() => {
  if (window.__local) return;
  const W = window.Worker;
  const log = { workers: [], sent: [], recv: [] };
  window.__local = log;
  window.Worker = class extends W {
    constructor(url, options) {
      super(url, options);
      log.workers.push(this);
      this.addEventListener("message", (e) => { log.recv.push(e.data); if (log.recv.length > 60) log.recv.shift(); });
    }
    postMessage(message, transfer) {
      const m = message && (message.type === "start" || message.type === "resume") ? { type: message.type, requestId: message.requestId, sessionId: message.sessionId } : message;
      log.sent.push(m);
      if (log.sent.length > 400) log.sent.shift();
      return transfer ? super.postMessage(message, transfer) : super.postMessage(message);
    }
  };
})();`;

/** An expression for the page's `LocalBoard`, or null (walks React's fiber tree from the root). */
export const BOARD = `(() => {
  const isBoard = (v) => v && typeof v === "object" && typeof v.act === "function" && v.supervisor && v.packFacts;
  const roots = [document, document.documentElement, document.body];
  let start = null;
  for (const r of roots) { const k = r && Object.keys(r).find((x) => x.startsWith("__reactContainer$")); if (k) { start = r[k]; break; } }
  if (!start) return null;
  const stack = [start];
  let n = 0;
  while (stack.length && n++ < 200000) {
    const f = stack.pop();
    const p = f.memoizedProps;
    if (p && (isBoard(p.board) || isBoard(p.session))) return isBoard(p.board) ? p.board : p.session;
    if (f.sibling) stack.push(f.sibling);
    if (f.child) stack.push(f.child);
  }
  return null;
})()`;

/** The match `matchId` as saved on this device: its header and its committed decisions, read-only. */
export const readJournalExpr = (matchId: string) => `new Promise((resolve, reject) => {
  const open = indexedDB.open("dbs-arena-local");
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    try {
      const tx = db.transaction(["matches", "decisions"], "readonly");
      const head = tx.objectStore("matches").get(${JSON.stringify(matchId)});
      const all = tx.objectStore("decisions").getAll(IDBKeyRange.bound([${JSON.stringify(matchId)}, -Infinity], [${JSON.stringify(matchId)}, Infinity]));
      tx.oncomplete = () => { db.close(); const h = head.result; resolve(h ? { header: { seed: h.seed, policySeed: h.policySeed, decks: h.decks, human: h.human, revision: h.revision, trace: h.trace, status: h.status, decisions: h.decisions }, entries: all.result.sort((a, b) => a.index - b.index).map((d) => d.entry) } : null); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    } catch (e) { db.close(); reject(e); }
  };
})`;

/** Faults a Worker's IndexedDB can be given, evaluated inside the Worker. */
export const IDB_FAULT = {
  /** Every put/add throws the browser's own QuotaExceededError (Chrome's quota override does not bite on localhost headless). */
  quota: `(() => { const P = IDBObjectStore.prototype; if (!P.__put) { P.__put = P.put; P.__add = P.add; } P.put = P.add = function () { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); }; })()`,
  /** Every read-write transaction is aborted by the browser before it can commit. */
  abort: `(() => { const P = IDBDatabase.prototype; if (!P.__tx) P.__tx = P.transaction; P.transaction = function (...a) { const tx = P.__tx.apply(this, a); if (tx.mode === "readwrite") queueMicrotask(() => { try { tx.abort(); } catch {} }); return tx; }; })()`,
  clear: `(() => { const S = IDBObjectStore.prototype; if (S.__put) { S.put = S.__put; S.add = S.__add; } const D = IDBDatabase.prototype; if (D.__tx) D.transaction = D.__tx; })()`,
};

export interface Denied { url: string; method: string; why: string }

/**
 * The card-art CDNs (`next.config.ts` images, `public/sw.js` ART_HOSTS). Not a match or provider
 * request: since #659 the service worker no longer claims an open page, so a first visit's images
 * go straight to the CDN. They are still failed (the device is offline) but counted apart.
 */
const ART_HOSTS = new Set(["storage.googleapis.com", "www.dbs-cardgame.com", "tcgplayer-cdn.tcgplayer.com", "www.cardtrader.com", "cardtrader.com"]);

/** True when `request` is a match or provider request: an API route, a server action, a non-GET, or another host. */
export function matchOrProvider(base: string, request: { url: string; method: string; headers: Record<string, string> }): string | null {
  const origin = new URL(base).origin;
  if (/^(data|blob|chrome-extension):/.test(request.url)) return null;
  let u: URL;
  try { u = new URL(request.url); } catch { return "unparseable url"; }
  if (u.origin !== origin) return "another host (a provider)";
  if (u.pathname.startsWith("/api/")) return "an API route";
  const h = Object.fromEntries(Object.entries(request.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  if (h["next-action"]) return "a server action";
  if (request.method !== "GET" && request.method !== "HEAD") return `a ${request.method}`;
  return null;
}

/**
 * Dedicated Workers a page starts, attached over CDP (paused on start until their requests are
 * intercepted too), so a fault can be evaluated in them and their network denied like the page's.
 */
export class WorkerTaps {
  private readonly byPage = new Map<string, Set<string>>();
  readonly denied: Denied[] = [];
  readonly allowed: string[] = [];
  /** Card-art CDN requests, failed like the rest but not a match/provider request (see ART_HOSTS). */
  readonly art: string[] = [];

  constructor(private readonly browser: Browser, private readonly base: string) {
    browser.on((method, params, sessionId) => {
      if (method === "Target.attachedToTarget" && sessionId) {
        // Every target attached paused (waitForDebuggerOnStart) is released; only Workers are kept and guarded.
        const child = params.sessionId as string;
        const worker = params.targetInfo?.type === "worker";
        if (worker) {
          const set = this.byPage.get(sessionId) ?? new Set<string>();
          set.add(child);
          this.byPage.set(sessionId, set);
        }
        void (async () => {
          if (worker) await browser.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] }, child).catch(() => {});
          await browser.send("Runtime.runIfWaitingForDebugger", {}, child).catch(() => {});
        })();
      } else if (method === "Target.detachedFromTarget" && sessionId) {
        this.byPage.get(sessionId)?.delete(params.sessionId as string);
      } else if (method === "Fetch.requestPaused" && sessionId) {
        const r = params.request as { url: string; method: string; headers: Record<string, string> };
        const why = matchOrProvider(this.base, r);
        let host = "";
        try { host = new URL(r.url).hostname; } catch { /* unparseable: matchOrProvider names it */ }
        if (ART_HOSTS.has(host) && r.method === "GET") {
          this.art.push(r.url);
          void browser.send("Fetch.failRequest", { requestId: params.requestId, errorReason: "InternetDisconnected" }, sessionId).catch(() => {});
        } else if (why) {
          this.denied.push({ url: r.url, method: r.method, why });
          void browser.send("Fetch.failRequest", { requestId: params.requestId, errorReason: "BlockedByClient" }, sessionId).catch(() => {});
        } else {
          this.allowed.push(`${r.method} ${r.url}`);
          void browser.send("Fetch.continueRequest", { requestId: params.requestId }, sessionId).catch(() => {});
        }
      }
    });
  }

  /** Deny the page's match/provider requests and attach to the Workers it starts. Call before `goto`. */
  async guard(page: Page): Promise<void> {
    await page.cdp("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    await page.cdp("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  }

  sessions(page: Page): string[] {
    return [...(this.byPage.get((page as unknown as { sid: string }).sid) ?? [])];
  }

  /** Evaluate `expression` in every live Worker of `page`; the number reached. */
  async inWorkers(page: Page, expression: string): Promise<number> {
    let n = 0;
    for (const s of this.sessions(page)) {
      const ok = await this.browser.send("Runtime.evaluate", { expression }, s).then(() => true, () => false);
      if (ok) n++;
    }
    return n;
  }
}

/** #828: choose through the real bounded pickers and phone wizard, without changing match state.
 * The phone release runner supplies real coordinate taps; desktop probes use DOM activation.
 */
export async function chooseLocalSetup(page: Page, mine: string, theirs: string, seat: "p1" | "p2", tap?: (selector: string) => Promise<void>) {
  await until(page, `!!document.querySelector('section[aria-label="New match"]')`, 60000);
  const activate = async (selector: string) => {
    if(tap) await tap(selector);
    else await page.eval(`document.querySelector(${JSON.stringify(selector)}).click();0`);
    await sleep(100);
  };
  const mobile = await page.eval<boolean>(`innerWidth < 640`);
  if (mobile && !await page.eval<boolean>(`!!document.querySelector('dialog[open]')`)) {
    await activate('[data-match-setup-open]');
    await until(page, `!!document.querySelector('dialog[open]')`);
  }
  const scope = mobile ? "dialog[open]" : "[data-desktop-setup]";
  async function choose(label: string, key: string) {
    const field = `${scope} [data-deck-discovery="${label}"]`;
    if(!await page.eval<boolean>(`document.querySelector(${JSON.stringify(field+" > details")}).open`))await activate(field+" > details > summary");
    for(let i=0;i<30;i++){
      const found=await page.eval<boolean>(`!!document.querySelector(${JSON.stringify(field+` [data-deck-choice="${key}"]`)})`);
      if(found)break;
      const more=await page.eval<boolean>(`!!document.querySelector(${JSON.stringify(field+" [data-more-decks]")})`);
      if(!more)throw new Error(`Deck ${key} not offered by ${label}`);
      await activate(field+" [data-more-decks]");
    }
    await activate(field+` [data-deck-choice="${key}"]`);
  }
  await choose("Your deck",mine);
  if(mobile)await activate(scope+" [data-setup-next]");
  await choose("Computer's deck",theirs);
  await activate(scope+` [data-setup-seat="${seat}"]`);
  const chosen=await page.eval<{a:string;b:string;seat:string}>(`(() => {
    const root=document.querySelector(${JSON.stringify(scope)});
    const [a,b]=root.querySelectorAll('[data-deck-discovery] > [data-deck-facts]');
    return {a:a.dataset.deckFacts,b:b.dataset.deckFacts,seat:root.querySelector('[data-setup-seat][aria-pressed=true]')?.dataset.setupSeat};
  })()`);
  if(chosen.a!==mine || chosen.b!==theirs || chosen.seat!==seat)throw new Error(`Setup did not take choices: ${JSON.stringify(chosen)}`);
  if(mobile)await activate(scope+" [data-setup-next]");
  return chosen;
}
