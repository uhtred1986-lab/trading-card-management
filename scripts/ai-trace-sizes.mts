/**
 * `npm run ai:trace-sizes` — which serverless functions carry the Claude Agent SDK's native `claude`
 * binary, and how big each is, uncompressed, against Vercel's 250 MB function limit (#518).
 *

 * Sizes are shown in decimal MB (the 250 MB limit is compared as 250,000,000 bytes, the stricter reading) and in MiB.
 *
 * Reads the `.next/server/**\/*.nft.json` trace files that `next build` writes (run
 * `AI_AGENT_SDK=1 DATABASE_URL=postgres://u:p@localhost:5432/db npm run build` first: next.config.ts adds the
 * binary only to a build made with AI_AGENT_SDK=1; no database is touched). Each
 * trace lists the files one route's function needs; their sizes, plus the route's own entry file,
 * are summed (a file shared by two listings counts once per function). Exits 1 unless the binary is carried by
 * exactly one function, `/api/ai/agent-sdk` (owner ruling, #518: every other function reaches the plan through
 * that route), or when that function is over the limit. Functions that trace the SDK's JavaScript but not the
 * binary are counted for information; they forward to the route.
 *
 *   --limit <MB>   the limit to compare with (default 250, decimal megabytes: the stricter reading)
 *   --top <n>      also show the n largest functions overall (default 5)
 *   --md           print the table as Markdown (for an issue or PR body)
 *
 * No dependencies; no network.
 */
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (n: string): string | undefined => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const limitMb = Number(flag("limit") ?? 250);
const limit = limitMb * 1_000_000;
const top = Number(flag("top") ?? 5);
const md = args.includes("--md");

const root = path.join(process.cwd(), ".next", "server");
if (!fs.existsSync(root)) {
  console.error("No .next/server — run `DATABASE_URL=postgres://u:p@localhost:5432/db npm run build` first.");
  process.exit(2);
}

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith(".nft.json")) yield p;
  }
}

const ONLY_CARRIER = "/api/ai/agent-sdk";
const BINARY = /node_modules\/@anthropic-ai\/claude-agent-sdk-[a-z0-9-]+\/claude(\.exe)?$/;
const SDK = /node_modules\/@anthropic-ai\/claude-agent-sdk\//;

interface Fn {
  route: string;
  bytes: number;
  files: number;
  binaries: string[];
  sdk: boolean;
}
const size = (f: string): number => {
  try {
    return fs.statSync(f).size;
  } catch {
    return 0; // a listed file the build did not keep
  }
};

const fns: Fn[] = [];
for (const nft of walk(root)) {
  const dir = path.dirname(nft);
  const list: string[] = JSON.parse(fs.readFileSync(nft, "utf8")).files ?? [];
  const entry = nft.replace(/\.nft\.json$/, "");
  const abs = new Set(list.map((f) => path.resolve(dir, f)));
  if (fs.existsSync(entry)) abs.add(entry);
  const posix = [...abs].map((f) => f.split(path.sep).join("/"));
  fns.push({
    route: "/" + path.relative(root, entry).split(path.sep).join("/").replace(/^app\//, "").replace(/\/(page|route)\.js$/, ""),
    bytes: [...abs].reduce((t, f) => t + size(f), 0),
    files: abs.size,
    binaries: posix.filter((f) => BINARY.test(f)).map((f) => f.replace(/.*node_modules\//, "")),
    sdk: posix.some((f) => SDK.test(f)),
  });
}

const mb = (b: number) => (b / 1_000_000).toFixed(1);
const mib = (b: number) => (b / 1_048_576).toFixed(1);
const pct = (b: number) => `${((b / limit) * 100).toFixed(0)}%`;
const carry = fns.filter((f) => f.binaries.length).sort((a, b) => b.bytes - a.bytes);
const sdkOnly = fns.filter((f) => carry.length && f.sdk && !f.binaries.length && !f.route.startsWith("/instrumentation"));
const strays = carry.filter((f) => f.route !== ONLY_CARRIER);
const routeMissing = carry.length > 0 && !carry.some((f) => f.route === ONLY_CARRIER);
const plain = fns.filter((f) => !f.binaries.length);
const over = carry.filter((f) => f.bytes > limit);

const row = (cells: string[]) => (md ? `| ${cells.join(" | ")} |` : cells.map((c, i) => (i === 0 ? c.padEnd(40) : c.padStart(10))).join(" "));
const head = (cells: string[]) => (md ? `${row(cells)}\n|${cells.map((_, i) => (i === 0 ? "---" : "---:")).join("|")}|` : row(cells));

console.log(`Functions in .next/server: ${fns.length}; carrying the claude binary: ${carry.length}; limit ${limitMb} MB uncompressed (decimal MB)\n`);
if (!carry.length) console.log("No function carries the binary — the build was made without AI_AGENT_SDK=1 (the default, inert build).");
if (carry.length) {
  console.log(head(["function", "files", "MB", "MiB", "of limit"]));
  for (const f of carry) console.log(row([f.route, String(f.files), mb(f.bytes), mib(f.bytes), pct(f.bytes)]));
  console.log(`\nbinary: ${[...new Set(carry.flatMap((f) => f.binaries))].join(", ")}`);
  const sizes = carry.map((f) => f.bytes);
  console.log(`carriers: smallest ${mb(Math.min(...sizes))} MB, largest ${mb(Math.max(...sizes))} MB; over the limit: ${over.length}`);
}
if (plain.length) {
  const withoutMax = Math.max(...plain.map((f) => f.bytes));
  const bins = [...new Set(carry.flatMap((f) => f.binaries))].map((b) => size(path.join(process.cwd(), "node_modules", b)));
  const binNote = bins.length ? `; the binary file itself is ${mb(Math.max(...bins))} MB (${mib(Math.max(...bins))} MiB)` : "";
  console.log(`\nlargest function without the binary: ${mb(withoutMax)} MB${binNote}`);
}
if (top > 0) {
  console.log(`\nlargest ${top} functions overall:`);
  for (const f of [...fns].sort((a, b) => b.bytes - a.bytes).slice(0, top)) console.log(`  ${mb(f.bytes).padStart(7)} MB  ${f.route}${f.binaries.length ? "  (binary)" : ""}`);
}
if (sdkOnly.length) console.log(`\n${sdkOnly.length} functions trace the SDK's JavaScript but carry no binary (they forward to ${ONLY_CARRIER}); largest ${mb(Math.max(...sdkOnly.map((f) => f.bytes)))} MB`);
if (strays.length) {
  console.log(`\nThese functions carry the binary but only ${ONLY_CARRIER} may — narrow outputFileTracingIncludes in next.config.ts:`);
  for (const f of strays) console.log(`  ${f.route}`);
}
if (routeMissing) console.log(`\n${ONLY_CARRIER} does not carry the binary.`);
process.exit(strays.length || routeMissing || over.length ? 1 : 0);
