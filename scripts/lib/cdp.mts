/**
 * A very small Chrome DevTools Protocol driver for the arena review tooling
 * (`scripts/arena-shots.mts`, `scripts/arena-contrast.mts`, issue #343).
 *
 * It exists so neither script needs Playwright or Puppeteer as a dependency: it
 * starts whatever Chrome/Chromium is installed, speaks the protocol over the
 * WebSocket built into Node 22, and offers just what the two scripts need — open
 * a page at a viewport, wait for the board, evaluate in the page, tap, shoot.
 *
 * Not used by `npm test` (it needs a browser) and not part of the app.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- CDP messages are untyped JSON at the protocol boundary */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CANDIDATES = [
  process.env.CHROME_PATH,
  "/opt/pw-browsers/chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

export function findChrome(): string {
  for (const c of CANDIDATES) if (c && existsSync(c)) return c;
  throw new Error("No Chrome or Chromium found. Set CHROME_PATH to one.");
}

export type Viewport = { name: string; width: number; height: number; mobile: boolean };

/** The two viewports the redesign frames use (`docs/arena-redesign/README.md`). */
export const VIEWPORTS: Viewport[] = [
  { name: "phone", width: 390, height: 844, mobile: true },
  { name: "desk", width: 1440, height: 900, mobile: false },
];

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

export class Browser {
  private ws!: WebSocket;
  private proc!: ChildProcess;
  private dir = "";
  private seq = 0;
  private pending = new Map<number, Pending>();
  private listeners: Array<(method: string, params: any, sessionId?: string) => void> = [];

  static async launch(): Promise<Browser> {
    const b = new Browser();
    b.dir = mkdtempSync(join(tmpdir(), "arena-cdp-"));
    b.proc = spawn(findChrome(), ["--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${b.dir}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
    const url = await new Promise<string>((resolve, reject) => {
      let buf = "";
      const t = setTimeout(() => reject(new Error("Chrome did not announce a DevTools port in 20 s.")), 20000);
      b.proc.stderr!.on("data", (d: Buffer) => {
        buf += d.toString();
        const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
        if (m) {
          clearTimeout(t);
          resolve(m[1]);
        }
      });
      b.proc.on("exit", (code) => reject(new Error(`Chrome exited (${code}) before it was ready.`)));
    });
    b.ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      b.ws.addEventListener("open", () => resolve());
      b.ws.addEventListener("error", () => reject(new Error("Could not connect to Chrome's DevTools socket.")));
    });
    b.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id != null) {
        const p = b.pending.get(msg.id);
        if (!p) return;
        b.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else p.resolve(msg.result);
      } else if (msg.method) {
        for (const l of b.listeners) l(msg.method, msg.params, msg.sessionId);
      }
    });
    return b;
  }

  send<T = any>(method: string, params: object = {}, sessionId?: string): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  on(fn: (method: string, params: any, sessionId?: string) => void) {
    this.listeners.push(fn);
  }

  async page(vp: Viewport): Promise<Page> {
    const { targetId } = await this.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    const page = new Page(this, sessionId, targetId, vp);
    await page.init();
    return page;
  }

  async close() {
    try {
      this.ws.close();
    } catch {}
    this.proc.kill();
    try {
      rmSync(this.dir, { recursive: true, force: true });
    } catch {}
  }
}

export class Page {
  constructor(
    private b: Browser,
    private sid: string,
    private targetId: string,
    readonly vp: Viewport,
  ) {}

  private call<T = any>(method: string, params: object = {}) {
    return this.b.send<T>(method, params, this.sid);
  }

  async init() {
    await this.call("Page.enable");
    await this.call("Runtime.enable");
    await this.call("Network.enable");
    await this.call("Emulation.setDeviceMetricsOverride", { width: this.vp.width, height: this.vp.height, deviceScaleFactor: this.vp.mobile ? 2 : 1, mobile: this.vp.mobile });
    await this.call("Emulation.setTouchEmulationEnabled", { enabled: this.vp.mobile });
  }

  /** Run `source` in every document before its own scripts — used to pin localStorage. */
  async beforeLoad(source: string) {
    await this.call("Page.addScriptToEvaluateOnNewDocument", { source });
  }

  async setCookie(name: string, value: string, url: string) {
    await this.call("Network.setCookie", { name, value, url });
  }

  async goto(url: string, timeoutMs = 60000) {
    const loaded = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`Timed out loading ${url}`)), timeoutMs);
      this.b.on((method, _p, sessionId) => {
        if (sessionId === this.sid && method === "Page.loadEventFired") {
          clearTimeout(t);
          resolve();
        }
      });
    });
    await this.call("Page.navigate", { url });
    await loaded;
  }

  async eval<T = any>(expression: string): Promise<T> {
    const r = await this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  }

  async waitFor(selector: string, timeoutMs = 30000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (await this.eval<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`)) return;
      await sleep(150);
    }
    throw new Error(`Timed out waiting for ${selector}`);
  }

  /** Fonts loaded, then a pause for entrance animation to settle. */
  async settle(ms: number) {
    await this.eval(`document.fonts ? document.fonts.ready.then(() => true) : true`);
    await sleep(ms);
    // Entrance animations leave text half-transparent for a moment; jump every
    // finite one to its end so a shot and an audit both see the settled board.
    await this.eval(`document.getAnimations().forEach((a) => { try { a.finish(); } catch {} })`);
    await sleep(100);
  }

  /** Tap the first element matching `selector` — touch on the phone viewport, mouse on desktop. */
  async tap(selector: string) {
    const box = await this.eval<{ x: number; y: number } | null>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!box) throw new Error(`--tap: nothing matches ${selector}`);
    if (this.vp.mobile) {
      await this.call("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x, y: box.y }] });
      await this.call("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      await this.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
      await this.call("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
      await this.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
    }
  }

  private async centre(selector: string, flag: string) {
    const box = await this.eval<{ x: number; y: number } | null>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      // Only scroll a target that is off screen: scrolling a sticky panel moves it under the pointer.
      let r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) {
        el.scrollIntoView({ block: "center", inline: "center" });
        r = el.getBoundingClientRect();
      }
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!box) throw new Error(`${flag}: nothing matches ${selector}`);
    return box;
  }

  /** Move the mouse over the first match, without pressing (desktop only: a phone has no hover). */
  async hover(selector: string) {
    const { x, y } = await this.centre(selector, "--hover");
    // A page reused across shots still has the last pointer position: park it
    // first, or a move to the same spot fires no enter on the new document.
    await this.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
    await this.call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  }

  /** Right-click the first match (desktop only) — the gesture that pins the docked inspector. */
  async rightClick(selector: string) {
    const { x, y } = await this.centre(selector, "--rclick");
    await this.call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await this.call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "right", clickCount: 1 });
    await this.call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "right", clickCount: 1 });
  }

  async screenshot(fullPage: boolean): Promise<Buffer> {
    const r = await this.call("Page.captureScreenshot", { format: "jpeg", quality: 85, captureBeyondViewport: fullPage });
    return Buffer.from(r.data, "base64");
  }

  async close() {
    await this.b.send("Target.closeTarget", { targetId: this.targetId }).catch(() => {});
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fail early, and plainly, when the dev server the scripts need is not up. */
export async function requireServer(base: string) {
  try {
    const res = await fetch(`${base}/arena/preview?fixture=play`, { redirect: "manual" });
    if (res.status === 404) throw new Error("404 — is this a production build? The preview route is dev-only; run `npm run dev`.");
    // A production build streams its 404 page under a 200 (the arena's loading.tsx commits the status first).
    if ((await res.text()).includes("NEXT_HTTP_ERROR_FALLBACK;404")) throw new Error("the page answered not-found — is this a production build? The preview route is dev-only; run `npm run dev`.");
    if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    throw new Error(`No arena preview at ${base}/arena/preview (${(e as Error).message}). Start \`npm run dev\` first, or pass --base <url>.`);
  }
}

export function arg(name: string, argv = process.argv): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}
