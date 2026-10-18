# Arena agent tools: code navigation and browser inspection

Verified 13 Oct 2026 for issue #639 (Arena O1-01) on Windows 11, Node v24.21.0, TypeScript from
`node_modules` (`^5`), Next.js 16.3.0, Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe`,
Git Bash. Every command below was run; the outcome is what was observed. Nothing here needs a new
dependency, an MCP server or a database. Timings are wall-clock on one machine, one run each, and
say nothing about token or context cost: **no token saving is claimed.**

## 1. Environment facts (Windows worktree)

| Fact | Observed |
|---|---|
| A fresh worktree has no `node_modules` | Confirmed. `npm ci` fails on this machine with npm 11.19 (`EUSAGE`: "Missing: @tailwindcss/oxide-*, @esbuild/* from lock file", observed 13 Oct 2026). Copy the main checkout's instead: `robocopy "<main checkout>\node_modules" "<worktree>\node_modules" /E /MT:32 /NFL /NDL /NJH /NJS /NP` from PowerShell. **Robocopy exit code 1 means "files copied" and is success.** Never `npm install`. |
| No `.env.local` in a worktree | Not needed for anything below; `DATABASE_URL=''` is enough and `next dev` started with it. |
| Line endings | Set `git config core.autocrlf false` in the worktree and strip `\r` from `src`/`scripts` `.ts`/`.tsx`/`.mts` files. Observed 13 Oct 2026: with the machine's global `core.autocrlf=true`, a fresh checkout gets CRLF and `scripts/verify/guards.ts` ("a route handler must open with routeViewer()") and `capabilities.mts --check` (NotYet signature mismatch on `\r\n`) fail; both pass after the switch. A few committed docs carry CRLF themselves — after stripping, `git checkout --` any file `git status` then lists. |
| `ripgrep` | Not on the Git Bash `PATH` (`which rg` finds nothing). Use `git grep` in a shell, or the agent's own Grep tool. |
| `scripts/verify/ai-agent-sdk.ts` | Fails on Windows (observed 13 Oct 2026: expects `/tmp/claude-config`, gets `\tmp\claude-config`) and stops the `npm test` chain there; run the remaining chain entries individually with `npx tsx`. |
| Playwright | **Not a dependency**: `package.json` has no `playwright`/`puppeteer` and `node_modules/playwright*` does not exist. Do not write "use Playwright"; use `scripts/lib/cdp.mts` (section 3). |
| Chrome | Found by `findChrome()` in `scripts/lib/cdp.mts` (`CHROME_PATH`, then `/opt/pw-browsers/chromium`, Linux/macOS paths, then the two Windows Chrome/Edge paths). Chrome and Edge are both installed here; nothing was installed. |

## 2. TypeScript definition, references and diagnostics

Example symbol: `keywordOf`, defined in `src/lib/arena/text/cards.ts`.

### 2a. Text search (fast, imprecise)

```bash
git grep -nw keywordOf -- src scripts
```

Observed: 50 lines (includes comments and strings), instant. Use it to find a symbol you only know by
name; it cannot tell a definition from a use or a shadowed local.

### 2b. Project-wide diagnostics

```bash
npm run typecheck        # tsc --noEmit over tsconfig.json
```

Observed: exit 0, no output, 1 min 51 s. This is the only authority on whether the whole tree is
clean. It is slow, so use 2c for one file while editing.

### 2c. Definition, references and one file's diagnostics (TypeScript compiler API)

`typescript` is already a dependency; this uses its language service, the engine behind editor
go-to-definition and find-all-references. Save the script as an untracked scratch file in the repo root
(it needs `node_modules` resolution) and delete it afterwards. It is not committed.

```ts
// tsnav.scratch.mts — usage: npx tsx tsnav.scratch.mts <file> <symbol>
import ts from "typescript";
import { readFileSync } from "node:fs";
import { resolve, relative } from "node:path";

const [file, symbol] = process.argv.slice(2);
const abs = resolve(file).replace(/\\/g, "/");
const cfgPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, "tsconfig.json")!;
const cfg = ts.getParsedCommandLineOfConfigFile(cfgPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(String(d.messageText)); } })!;
const host: ts.LanguageServiceHost = {
  getCompilationSettings: () => cfg.options,
  getScriptFileNames: () => cfg.fileNames,
  getScriptVersion: () => "0",
  getScriptSnapshot: (f) => (ts.sys.fileExists(f) ? ts.ScriptSnapshot.fromString(ts.sys.readFile(f)!) : undefined),
  getCurrentDirectory: () => process.cwd(),
  getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories,
};
const ls = ts.createLanguageService(host, ts.createDocumentRegistry());
const text = readFileSync(abs, "utf8");
const pos = text.indexOf(symbol); // first textual occurrence; pass a more specific string to pick another
if (pos < 0) throw new Error(`${symbol} not found in ${file}`);
const rel = (f: string) => relative(process.cwd(), f).replace(/\\/g, "/");
const lc = (f: string, p: number) => {
  const sf = ls.getProgram()!.getSourceFile(f)!;
  const x = sf.getLineAndCharacterOfPosition(p);
  return `${rel(f)}:${x.line + 1}:${x.character + 1}`;
};
console.log("== definition ==");
for (const d of ls.getDefinitionAtPosition(abs, pos) ?? []) console.log(lc(d.fileName, d.textSpan.start), d.kind, d.name);
console.log("== references ==");
let n = 0;
for (const g of ls.findReferences(abs, pos) ?? [])
  for (const r of g.references) {
    n++;
    console.log(lc(r.fileName, r.textSpan.start), r.isDefinition ? "(def)" : "");
  }
console.log(`${n} references`);
console.log("== diagnostics for", rel(abs), "==");
const diags = [...ls.getSyntacticDiagnostics(abs), ...ls.getSemanticDiagnostics(abs)];
for (const d of diags) console.log(lc(abs, d.start ?? 0), ts.flattenDiagnosticMessageText(d.messageText, "\n"));
console.log(`${diags.length} diagnostics`);
```

```bash
npx tsx tsnav.scratch.mts src/lib/arena/text/cards.ts keywordOf
```

Observed (24 s, exit 0): definition `src/lib/arena/text/cards.ts:167:17 function keywordOf`; **35
references** in `text/cards.ts`, `text/filters.ts`, `compile/effects.ts`, `compile/index.ts`,
`engine/state.ts`, `engine/engine.ts`, `glossary.ts`, `scripts/verify/harness.ts`,
`scripts/verify/text.ts`, `src/lib/catalog/abilityKeywords.ts`; `0 diagnostics`. The first
occurrence of the name in the file (line 95) is a use, and the definition still resolved to line 167,
so it resolves real symbols, not text. The 35 versus 50 `git grep` lines is the difference between
semantic references and text hits (comments, strings, same-named locals).

Limits: the script reports one symbol per run, takes the first textual occurrence, builds the whole
project each time (the 24 s is mostly program creation), and does not do rename or call hierarchy.
It cannot see `.next/types` until a `next dev`/`build` has generated them.

### 2d. Why does this import resolve there? (`--traceResolution`)

```bash
npx tsc --noEmit --skipLibCheck --strict --lib esnext --moduleResolution bundler --module esnext --target es2017 --allowImportingTsExtensions --traceResolution src/lib/arena/text/filters.ts > trace.txt
```

Observed: exit 0, 21 s, about 6,450 trace lines on stdout, no errors. First lines show
`'./cards'` resolved from `text/filters.ts` to `src/lib/arena/text/cards.ts`; `grep "was successfully
resolved"` answers "which file did this specifier become". Without `--lib esnext` the same command
exits 2 with unrelated `findLast`/`hasOwn` errors in `vm/*.ts`, because the project's `lib` is
`esnext` and single-file mode ignores `tsconfig.json`. Prefer 2c when the question is only
"where is this symbol"; use this when module resolution itself (`@/` paths, `.ts` extensions) is the
suspect.

### Not tried

`tsserver` (present at `node_modules/.bin/tsserver`) speaks a JSON protocol on stdio; the language
service in 2c is the same engine without the protocol. No TypeScript LSP/MCP server was configured or
installed.

## 3. Browser network, offline, worker and storage inspection

The repository's own driver is `scripts/lib/cdp.mts`: it launches the installed Chrome headless and
speaks the DevTools protocol over Node's built-in WebSocket. It already exposes `Browser.launch`,
`page.goto`, `page.eval`, `page.setOffline(true|false)` (`Network.emulateNetworkConditions`),
`interceptFetch`/`fulfillFetch` (request mocking) and `Browser.send(method, params)` for any raw
protocol call. `scripts/verify/arena-live-browser.mts` already uses `setOffline`. For anything the
helpers lack, call `b.send("Domain.method", {...})`.

Dev server (no database needed for the preview route):

```bash
DATABASE_URL='' npx next dev -p 3107
```

Observed: `Ready in 1710ms`; `curl -s -o /dev/null -w "%{http_code}" "http://localhost:3107/arena/preview?fixture=play"` printed
`200` (the first request compiles the route). Stop it afterwards (on Windows, find the PID on the
port with `Get-NetTCPConnection -LocalPort 3107 -State Listen` and `Stop-Process`; the observed
background shell did not stop it for me).

Inspection script (untracked scratch file in the repo root, not committed):

```ts
// inspect.scratch.mts — usage: npx tsx inspect.scratch.mts <url>
import { Browser, VIEWPORTS, sleep } from "./scripts/lib/cdp.mts";

const url = process.argv[2];
const b = await Browser.launch();
const reqs: string[] = [];
b.on((m, p) => {
  if (m === "Network.responseReceived") reqs.push(`${p.response.status} ${p.type} ${p.response.url.slice(0, 90)}`);
  if (m === "Network.loadingFailed") reqs.push(`FAILED ${p.type ?? ""} ${p.errorText}`);
});
const page = await b.page(VIEWPORTS[1]);
await page.goto(url);
await sleep(1500);
console.log("== network (online load) ==");
console.log(reqs.length, "events; first 8:");
for (const r of reqs.slice(0, 8)) console.log(" ", r);
console.log("== storage ==");
console.log(
  JSON.stringify(
    await page.eval(`(async () => ({
      localStorageKeys: Object.keys(localStorage),
      sessionStorageKeys: Object.keys(sessionStorage),
      cacheNames: await caches.keys(),
      indexedDB: indexedDB.databases ? await indexedDB.databases() : "n/a",
      swRegistrations: (await navigator.serviceWorker.getRegistrations()).length,
      swSupported: "serviceWorker" in navigator,
      workerSupported: typeof Worker,
      cookies: document.cookie.length,
    }))()`),
    null,
    1,
  ),
);
console.log("== targets (pages/workers/service workers) ==");
const { targetInfos } = await b.send<{ targetInfos: Array<{ type: string; url: string }> }>("Target.getTargets");
for (const t of targetInfos) console.log(" ", t.type, t.url.slice(0, 90));
console.log("== inline worker round trip ==");
console.log(
  await page.eval(`new Promise((res) => {
    const w = new Worker(URL.createObjectURL(new Blob(["postMessage(typeof self.importScripts)"])));
    w.onmessage = (e) => res("worker replied: " + e.data);
    w.onerror = (e) => res("worker error: " + e.message);
  })`),
);
const { targetInfos: t2 } = await b.send<{ targetInfos: Array<{ type: string; url: string }> }>("Target.getTargets");
console.log("  target types now:", t2.map((t) => t.type).join(","));
console.log("== offline ==");
await page.setOffline(true);
console.log(await page.eval(`fetch(location.href, { cache: "no-store" }).then((r) => "fetch ok " + r.status, (e) => "fetch rejected: " + e.message)`));
console.log("navigator.onLine:", await page.eval("navigator.onLine"));
await page.setOffline(false);
console.log(await page.eval(`fetch(location.href, { cache: "no-store" }).then((r) => "back online, fetch ok " + r.status, (e) => "fetch rejected: " + e.message)`));
await page.close();
await b.close();
```

```bash
npx tsx inspect.scratch.mts "http://localhost:3107/arena/preview?fixture=play"
```

Observed (exit 0):

- Network: 36 events; the document `200 Document /arena/preview?fixture=play`, then `200 Font` /
  `200 Stylesheet` entries under `/_next/static/`.
- Storage on first load of the preview: `localStorage` and `sessionStorage` empty, `caches.keys()`
  empty, `indexedDB.databases()` = only `__next_debug_channel` (a Next.js dev artefact),
  `document.cookie` empty.
- Service worker: supported, **0 registrations** on the preview page (`public/sw.js` is not
  registered there), so offline behaviour through the worker's offline page was *not* exercised.
- Workers: an inline `Blob` Web Worker started and replied (`worker replied: function`), and
  `Target.getTargets` then listed a `worker` target. This proves worker visibility and a message
  round trip; the app itself has no `new Worker` yet (`git grep "new Worker" -- src scripts public`
  finds nothing), which is what #643 will measure.
- Offline: after `page.setOffline(true)`, `fetch(location.href)` rejected with `Failed to fetch` and
  `navigator.onLine` was `false`; after `setOffline(false)` the fetch returned 200.
- `Target.getTargets` also lists browser-internal targets (an extension service worker, omnibox
  popups); ignore those.

Other repo drivers on the same CDP layer: `npm run arena:shots` and `npm run arena:record` (need
`npm run dev` on port 3000 and a browser; see `docs/arena-tooling.md`). Not re-run for this issue.

### CLI fallbacks when no browser is available

- Network and response headers: `curl -s -D - -o /dev/null "http://localhost:3107/<path>"` for status
  and headers; add `--max-time 120` on the first hit, which compiles.
- Service worker script: `curl -s http://localhost:3107/sw.js | head` (public file; confirmed present
  as `public/sw.js`).
- Offline logic without a browser: run the pure code under `npx tsx` (for example
  `scripts/verify-arena.ts`); offline behaviour that needs a real browser (service worker lifecycle,
  IndexedDB, worker memory) has no CLI substitute and must be reported as unverified.

### The browser scripts that are not in `npm test`, checked 18 Oct 2026

All run over `scripts/lib/cdp.mts` (headless Chrome on this Windows machine); none needs a database.
Two kinds of server: `DATABASE_URL='' npx next dev -p <port>` for the fixture preview and `/arena/local`
(pass `--base http://localhost:<port>`, or `ARENA_BASE=` for `scripts/verify/*`), and a production
build (`GITHUB_SHA=<40 hex> npm run build`) that the script starts itself. Several write evidence
screenshots into tracked `docs/` folders: `git checkout -- docs contract` afterwards. A killed run
leaves its `arena-cdp-*` Chrome profile in `%TEMP%`; delete them now and then (67 of them filled the disk).
Phones open on the takeover battle staging since #982; scripts that measure the compact board switch to it
from the settings sheet first ("Use compact phone board"), as `arena-phone-board-783.mts` does.

| Script | Server | Notes |
|---|---|---|
| `arena-no-target-783`, `arena-phone-board-783`, `arena-phone-ux --check`, `arena-phone-feedback`, `arena-phone-interactions`, `arena-phone-comparison`, `arena-hand-scrub`, `arena-outcome-shots --state after`, `arena-ability-contract-558`, `deck-setup-browser`, `arena:shots`, `arena:perf:browser`, `verify/arena-advance-browser-evidence`, `verify/replay-browser-evidence` | dev | pass. A phone page does not scroll with a defence prompt up either (the compact board and a banded fight step their field down to fit, `useCompactSqueeze`), and `arena-phone-board-783` and `arena-phone-ux` assert it again. |
| `arena:contrast` | dev | runs; reports real contrast findings of the current skins (exit 1 only with `--strict`) |
| `arena:policy-browser`, `arena:pack-store-browser`, `arena:local-storage-browser`, `arena:local-ownership-browser`, `verify/arena-browser-engine-browser`, `verify/arena-replay-core-browser`, `arena:scenario -- --browser` | none (module server) | pass |
| `arena:local-browser`, `arena:offline-release` | production build | pass |
| `arena:local-worker-browser` | none | the `roundTripMs.p95 <= 50` budget fails at 58-75 ms on this machine (apply p50 22 ms), the rest passes. Not hardware alone: the same script on #784 (`daf3c188`), run back to back, gives p50 16-19 ms and p95 25-36 ms. The slowdown is in the engine and rule changes between `cdda6855` (#913) and `c94d4516` (#957/#936); not bisected further, budget kept. |
| `arena:offline-shell-browser` | production build | passes check E (the journey rows wrap at 200 % text). Check A2 ("the retry fetched only the images still missing") still fails, deterministically: 34 art requests against 31 allowed (43 required, 12 reported kept). It fails the same with `themes/` un-exempted, so it is not from these fixes; not looked into. |
| `arena:offline-decks-browser` | production build | passes (`/themes/*` is exempt from Basic Auth in `src/proxy.ts`, like `icons/`) |
| `arena:record` | dev | needs `ffmpeg` with VP8, not installed here |
| `arena:phone` | production build, Android phone | the defence prompt is reachable again: pass buttons are found by `data-action-label` (the legal action's label; the words on them are the player's, "Take the hit", "No block"), counters and blockers by `data-defend-card`, a staged combo card by its chip, and charge/play/pick confirmations by their `data-*-confirm` bars. `--emulated --pace normal --cases 1 --no-recovery` takes 6 min (`--pace step`, the default, took over 30 min and did not finish) and reaches the end of the match, but still reports 1-3 moves "unreachable by touch" per match: an Activate button in a card sheet that was found and tapped without effect, a leader Awaken (a tap on the leader starts an attack pick), and once a mulligan taken while the opening story plays. Not a pass; unverified on a phone |

## 4. Tooling availability, observed

| Capability | Status |
|---|---|
| `tsc`, `tsx`, `tsserver`, `typescript` compiler API | Available in `node_modules`. |
| `git grep` | Available. |
| `rg` on Git Bash `PATH` | Unavailable (the agent's Grep tool is the substitute). |
| Playwright / Puppeteer | Not installed and not a dependency; do not install. |
| Chrome/Edge via `scripts/lib/cdp.mts` | Available; used above. |
| Focused scenario run, Node and browser worker | `npm run arena:scenario [-- --browser]` (`docs/arena-tooling.md` §5b). |
| Service worker offline page, IndexedDB contents of the real app | Not observed (nothing registered / stored on `/arena/preview`). |
| Heap/memory profiling, tracing | Worker heap (`Runtime.getHeapUsage`, `HeapProfiler.collectGarbage` on an auto-attached worker session), `measureUserAgentSpecificMemory` and long tasks: `npm run arena:worker-bench` (`docs/arena-worker-budgets.md`, #643). Tracing: not tried. |
| Custom MCP server / LSP MCP | Not used, not required. The session also lists built-in browser and Chrome extension MCP tools; those were not exercised for this issue. |
| Task time / tool calls / context saved | Not measured; no claim is made. |

## 5. Corrections made to other guidance

- `docs/agent-brief.md` told agents to shoot screens "with Playwright"; Playwright is not a
  dependency (checked above). It now points at `npm run arena:shots` / `scripts/lib/cdp.mts`.
- `docs/agent-brief.md` said a fresh worktree needs `npm ci`; on Windows that fails here, so it now
  links to section 1.
