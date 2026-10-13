/**
 * #640: the fixed replay-hash vectors in a real browser.
 *
 * Serves the repo's TypeScript to headless Chrome/Chromium as native ES modules
 * (`scripts/lib/module-server.mts`) — each file transpiled on request with `typescript` (type-only
 * imports vanish), `@/` rewritten to `/src/`, extensionless specifiers redirected to the real
 * file — so there is no bundler and no Node shim:
 * a module that needs `node:crypto`, `fs` or `process` fails to load. The page imports
 * `arena-replay-vectors.ts` (which imports only the portable `replay-core.ts`) from 127.0.0.1
 * (Web Crypto needs a secure context) and every vector must pass there too.
 *
 * Not part of `npm test` (it needs a browser). Run from the repo root:
 *   npx tsx scripts/verify/arena-replay-core-browser.mts      (CHROME_PATH=… to pick a binary)
 */
import assert from "node:assert/strict";
import { Browser, findChrome } from "../lib/cdp.mts";
import { serveRepoModules } from "../lib/module-server.mts";

const PAGE = `<!doctype html><meta charset="utf-8"><title>replay vectors</title>
<script type="module">
  import { runReplayVectors } from "/scripts/verify/arena-replay-vectors.ts";
  globalThis.__replayVectors = runReplayVectors;
  globalThis.__ready = true;
</script>
<script>addEventListener("error", (e) => { globalThis.__loadError = String(e.message || e); }, true);</script>`;

const { origin, served, refused, close } = await serveRepoModules(process.cwd(), PAGE);
const browser = await Browser.launch();
try {
  const page = await browser.page({ name: "desk", width: 800, height: 600, mobile: false });
  await page.goto(`${origin}/`);
  const end = Date.now() + 30000;
  while (!(await page.eval<boolean>("!!globalThis.__ready || !!globalThis.__loadError")) && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
  const loadError = await page.eval<string | null>("globalThis.__loadError ?? null");
  assert.equal(loadError, null, "the portable modules load as native ES modules");
  assert.ok(await page.eval<boolean>("!!globalThis.__ready"), `the vector module loaded (refused: ${refused.join(", ")})`);
  const env = await page.eval<{ ua: string; secure: boolean; subtle: boolean; process: boolean }>(
    `({ ua: navigator.userAgent, secure: isSecureContext, subtle: !!(globalThis.crypto && crypto.subtle), process: typeof process !== "undefined" })`,
  );
  assert.ok(env.secure && env.subtle, "the page has a secure context with Web Crypto");
  assert.equal(env.process, false, "no Node `process` shim exists in the page");
  const results = await page.eval<Array<{ name: string; ok: boolean; actual: unknown; expected: unknown }>>(`globalThis.__replayVectors()`);
  const failed = results.filter((r) => !r.ok);
  for (const r of failed) console.error(`  vector failed in browser: ${r.name}: expected ${JSON.stringify(r.expected)}, got ${JSON.stringify(r.actual)}`);
  assert.equal(failed.length, 0, `${failed.length} replay hash vector(s) failed in the browser`);
  assert.equal(refused.length, 0, `the page requested nothing outside the module graph (${refused.join(", ")})`);
  console.log(`arena-replay-core-browser: ${results.length}/${results.length} vectors pass in ${env.ua}`);
  console.log(`  binary ${findChrome()}; ${served.length} modules served natively: ${served.join(", ")}`);
  for (const r of results) console.log(`  ok  ${r.name}${typeof r.actual === "string" && /^[0-9a-f]{64}$/.test(r.actual) ? `  ${r.actual}` : ""}`);
} finally {
  await browser.close();
  close();
}
