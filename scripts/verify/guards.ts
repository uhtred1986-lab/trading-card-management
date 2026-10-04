/**
 * Every Server Function, page and route checks who is asking, itself — the
 * proxy is the first lock, not the only one (docs/architecture/auth.md).
 * Ported in spirit from gullet-cove-dm's `verify-guards.mts` and
 * `verify-page-guards.mts`. Fails `npm test` when:
 *
 * - an exported function of a `"use server"` file does not open (within its
 *   first three statements) with `requireSl()` or `requireSignedIn()`;
 * - a `page.tsx` does not open with `await requireSlPage()` or
 *   `await requireSignedInPage()` — and every page under an SL-only path
 *   (`isSlOnlyPath`) must use the SL one;
 * - a route handler under `src/app/api` does not open with `routeViewer()`.
 *
 * Each exemption below names why. Pure file reading: no database, no request.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isSlOnlyPath } from "../../src/lib/auth/core";

const ROOT = path.resolve("src");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const rel = (p: string) => path.relative(process.cwd(), p).split(path.sep).join("/");
const files = walk(ROOT).filter((f) => /\.(ts|tsx)$/.test(f));
const problems: string[] = [];

/** The body of `export async function name(...)…{`, as the text after its opening brace. */
function bodies(src: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /^export (?:default )?async function (\w+)\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = src.indexOf("(", m.index);
    let depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")" && --depth === 0) break;
    }
    // The body opens at the first "{" followed by a newline after the parameter list.
    const open = src.indexOf("{\n", i);
    out.push({ name: m[1], body: src.slice(open + 2, open + 2 + 600) });
  }
  return out;
}

const firstLines = (body: string, n: number) =>
  body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//"))
    .slice(0, n)
    .join("\n");

// ── Server Functions ───────────────────────────────────────────────────────

/** Server Functions with no guard of their own, and why. */
const ACTION_EXEMPT: Record<string, string> = {
  "src/app/login/actions.ts#signOut": "signing out needs no permission; it only ever ends the caller's own session or device",
};

let actions = 0;
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  if (!/^"use server";/m.test(src)) continue;
  for (const { name, body } of bodies(src)) {
    actions++;
    const key = `${rel(f)}#${name}`;
    if (ACTION_EXEMPT[key]) continue;
    if (!/\brequire(Sl|SignedIn)\(\)/.test(firstLines(body, 3))) problems.push(`${key}: a Server Function must open with requireSl() or requireSignedIn()`);
  }
}

// ── Pages ──────────────────────────────────────────────────────────────────

/** Pages with no guard, and why: both are where a signed-out browser has to be able to go. */
const PAGE_EXEMPT: Record<string, string> = {
  "src/app/login/page.tsx": "the sign-in itself; reads no data",
  "src/app/join/page.tsx": "where a player redeems a join code; shows only the name a valid code joins, behind the rate limit",
};

let pages = 0;
for (const f of files.filter((p) => p.endsWith(`${path.sep}page.tsx`))) {
  pages++;
  const key = rel(f);
  if (PAGE_EXEMPT[key]) continue;
  const route = "/" + path.relative(path.join(ROOT, "app"), path.dirname(f)).split(path.sep).join("/");
  const urlPath = route === "/." ? "/" : route.replace(/\[([^\]]+)\]/g, "1");
  const [main] = bodies(fs.readFileSync(f, "utf8")).filter((b) => b.name);
  if (!main) {
    problems.push(`${key}: no async default export to guard`);
    continue;
  }
  const first = firstLines(main.body, 1);
  const sl = /^(const \w+ = )?await requireSlPage\(\);$/.test(first);
  const any = /^(const \w+ = )?await requireSignedInPage\(\);$/.test(first);
  if (!sl && !any) problems.push(`${key}: a page must open with await requireSlPage() or await requireSignedInPage()`);
  else if (isSlOnlyPath(urlPath) && !sl) problems.push(`${key}: ${urlPath} is SL-only (isSlOnlyPath) and must open with requireSlPage()`);
}

// ── Route handlers ─────────────────────────────────────────────────────────

/** Routes that answer without a session, and the lock they hold instead. */
const ROUTE_EXEMPT: Record<string, string> = {
  "src/app/api/sync/meta/route.ts": "Vercel cron; CRON_SECRET bearer, and the proxy matcher skips it",
  "src/app/api/sync/prices/route.ts": "Vercel cron; CRON_SECRET bearer, and the proxy matcher skips it",
  "src/app/api/ai/agent-sdk/route.ts": "called by other functions; AI_AGENT_SDK_SECRET header (#518)",
  "src/app/api/auth/login/route.ts": "the start of the Google sign-in; writes nothing",
  "src/app/api/auth/callback/google/route.ts": "Google's redirect back; state, PKCE and nonce checked",
  "src/app/api/join/route.ts": "a player redeeming a code; rate-limited, the code is the credential",
  "src/app/api/v1/health/route.ts": "the contract version a client checks on launch; no data",
  "src/app/password-login/route.ts": "the old Basic Auth popup on demand; checks the credentials itself",
};

let routes = 0;
for (const f of files.filter((p) => p.endsWith(`${path.sep}route.ts`))) {
  routes++;
  const key = rel(f);
  if (ROUTE_EXEMPT[key]) continue;
  for (const { name, body } of bodies(fs.readFileSync(f, "utf8"))) {
    if (!/^(GET|POST|PUT|PATCH|DELETE)$/.test(name)) continue;
    if (!/^const auth = await routeViewer\((\{ sl: true \})?\);\nif \(!auth\.ok\) return auth\.response;$/.test(firstLines(body, 2))) {
      problems.push(`${key}#${name}: a route handler must open with routeViewer()`);
    }
  }
}

for (const key of [...Object.keys(ACTION_EXEMPT).map((k) => k.split("#")[0]), ...Object.keys(PAGE_EXEMPT), ...Object.keys(ROUTE_EXEMPT)]) {
  assert.ok(fs.existsSync(key), `an exemption names a file that is gone: ${key}`);
}

// The checker proves itself on a few shapes before its verdict is trusted.
assert.equal(firstLines("  // why\n  await requireSl();\n  x();", 1), "await requireSl();");
assert.deepEqual(
  bodies("export async function a(x: { y: number }): Promise<{ ok: true }> {\n  await requireSignedIn();\n}\n").map((b) => [b.name, firstLines(b.body, 1)]),
  [["a", "await requireSignedIn();"]],
);
assert.ok(actions > 100 && pages > 30 && routes > 10, `the scan found too little: ${actions} actions, ${pages} pages, ${routes} routes`);

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`guards: ok — ${actions} Server Functions, ${pages} pages, ${routes} routes`);
