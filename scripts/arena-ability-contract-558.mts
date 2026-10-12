/**
 * Visual regression evidence for the #558 snapshot-only change.
 *
 *   DATABASE_URL='' npm run dev -- --port 3018
 *   DATABASE_URL='' npx tsx scripts/arena-ability-contract-558.mts --base=http://localhost:3018
 *
 * Use `--before --repo=/path/to/untouched-baseline --base=...` for the same
 * contract fixture on an unchanged worktree. The script writes a temporary
 * preview fixture and removes it even on failure; it does not add an app route.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Browser, requireServer, type Viewport } from "./lib/cdp.mts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "docs", "arena-backlog", "evidence", "558");
const arg = (name: string, fallback: string) => process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback;
const before = process.argv.includes("--before");
const repo = resolve(arg("--repo", root));
const base = arg("--base", "http://localhost:3018");
const fixtureName = "u01-evidence";
const fixturePath = join(repo, "contract", "fixtures", `${fixtureName}.json`);
const artPath = join(out, "assets", "card-art-bt11-053.jpg");
const art = readFileSync(artPath).toString("base64");
const viewports: Viewport[] = [
  { name: "phone", width: 390, height: 844, mobile: true },
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "shortphone", width: 390, height: 650, mobile: true },
  { name: "narrowphone", width: 320, height: 568, mobile: true },
];

function check(ok: boolean, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

function withArtwork(value: unknown): void {
  if (Array.isArray(value)) return void value.forEach(withArtwork);
  if (!value || typeof value !== "object") return;
  const card = value as Record<string, unknown>;
  if (card.cardId === "V1") {
    card.cardId = "BT11-053";
    card.name = "Senzu Bean";
    card.imageUrl = `data:image/jpeg;base64,${art}`;
  }
  Object.values(card).forEach(withArtwork);
}

function prepareFixture(): void {
  const fixture = JSON.parse(readFileSync(join(repo, "contract", "fixtures", "play.json"), "utf8"));
  withArtwork(fixture);
  writeFileSync(fixturePath, JSON.stringify(fixture));
}

async function load(browser: Browser, viewport: Viewport, skin: string) {
  const page = await browser.page(viewport);
  await page.setCookie("arenaSkin", skin, base);
  if (viewport.name === "shortphone" || viewport.name === "narrowphone") {
    const bridge = page as unknown as { call: (method: string, params?: object) => Promise<unknown> };
    await bridge.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  }
  await page.goto(`${base}/arena/preview?fixture=${fixtureName}&skin=${skin}&pace=step&admin=0`);
  await page.waitFor(".arena");
  if (viewport.name === "shortphone" || viewport.name === "narrowphone") {
    await page.eval(`document.documentElement.style.fontSize='200%'`);
  }
  await page.settle(250);
  const loaded = await page.eval<boolean>(`[...document.querySelectorAll('.arena img')].some((img) => img.complete && img.naturalWidth > 0)`);
  check(loaded, `${skin}/${viewport.name}: no local card artwork loaded`);
  return page;
}

mkdirSync(out, { recursive: true });
await requireServer(base);
let closeBrowser: (() => Promise<void>) | undefined;
try {
  prepareFixture();
  const browser = await Browser.launch();
  closeBrowser = () => browser.close();
  for (const skin of ["anime", "night"]) {
    for (const viewport of viewports) {
      const page = await load(browser, viewport, skin);
      const filename = `${viewport.name}-${skin}-${before ? "before" : "after"}-558.jpg`;
      writeFileSync(join(out, filename), await page.screenshot(false));
      console.log(join(out, filename));
      await page.close();
    }
  }
} finally {
  await closeBrowser?.();
  rmSync(fixturePath, { force: true });
}
