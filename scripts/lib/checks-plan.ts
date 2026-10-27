/**
 * Which checks does a change need? The planning half of `npm run checks` (scripts/checks.mts).
 *
 * Pure file reading: no database, no network, no child processes. The test chain comes from
 * package.json's `test` script, so it cannot drift; a changed path is mapped to the chain entries
 * that care about it in two ways:
 *
 *  1. Import closure: a chain script is relevant when the changed file is in the static import
 *     closure of the script, or the script names the file (a `docs/…` fixture it reads) as a string.
 *  2. RULES, the small table below, for what no import shows (a Server Function file is checked by
 *     guards.ts, which reads files rather than importing them; migrations are read by the db checks).
 *
 * A path neither way knows gets FALLBACK; a path that is known to need no script (prose docs) gets none.
 */
import fs from "node:fs";
import path from "node:path";

/** One `tsx <file> [args]` entry of the `test` chain. `key` is the whole entry, the identity used everywhere. */
export interface ChainEntry { key: string; file: string; args: string[] }

/** The cheap scripts that run for a path nothing else claims. */
export const FALLBACK = ["scripts/verify-rules.ts", "scripts/verify-arena.ts", "scripts/verify/guards.ts"];

const posix = (p: string) => p.replace(/\\/g, "/");

/** Split package.json's `test` script into its chain. Anything but `tsx <file> …` is refused, loudly. */
export function parseChain(testScript: string): ChainEntry[] {
  return testScript.split("&&").map((part) => part.trim()).filter(Boolean).map((part) => {
    const [cmd, file, ...args] = part.split(/\s+/);
    if (cmd !== "tsx" || !file) {
      throw new Error(`test chain entry "${part}" is not "tsx <file>": teach scripts/lib/checks-plan.ts to run it`);
    }
    return { key: part, file: posix(file), args };
  });
}

export function readChain(root: string): ChainEntry[] {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
  return parseChain(pkg.scripts.test);
}

/* ---------------------------------------------------------------- import closure */

const EXTS = [".ts", ".tsx", ".mts", ".js", ".mjs", ".json"];
const IMPORT_RE = /(?:\bimport|\bexport)\b[^'"`;]*?\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|new URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url/g;
/** A repo path named in a string: `"docs/arena-worker-budgets.md"`, `"../../docs/x/y.json"`. */
const DATA_REF_RE = /["'`](?:\.\.?\/)*((?:docs|drizzle|src|scripts)\/[\w./-]+\.[a-z]{2,5})["'`]/g;

function isFile(abs: string) {
  try { return fs.statSync(abs).isFile(); } catch { return false; }
}

function resolveSpec(root: string, from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(root, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(root, path.dirname(from), spec);
  else return null; // a package or node: builtin
  const stem = base.replace(/\.(m?js)$/, "");
  const candidates = [base, ...EXTS.map((e) => stem + e), ...EXTS.map((e) => path.join(base, "index" + e))];
  const hit = candidates.find(isFile);
  return hit ? posix(path.relative(root, hit)) : null;
}

export interface Graph {
  /** Every repo file reachable from the entry by static imports (the entry included), with its import distance. */
  closure(entry: string): Map<string, number>;
  /** Repo files the closure names as strings (fixtures, docs read at test time). */
  dataRefs(entry: string): Set<string>;
}

export function buildGraph(root: string): Graph {
  const direct = new Map<string, { imports: string[]; refs: string[] }>();
  const scan = (file: string) => {
    let hit = direct.get(file);
    if (hit) return hit;
    hit = { imports: [], refs: [] };
    direct.set(file, hit);
    let text = "";
    try { text = fs.readFileSync(path.join(root, file), "utf8"); } catch { return hit; }
    if (file.endsWith(".json")) return hit;
    for (const m of text.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
      const resolved = spec ? resolveSpec(root, file, spec) : null;
      if (resolved) hit.imports.push(resolved);
    }
    for (const m of text.matchAll(DATA_REF_RE)) hit.refs.push(m[1]);
    return hit;
  };
  const cache = new Map<string, { files: Map<string, number>; refs: Set<string> }>();
  const walk = (entry: string) => {
    let hit = cache.get(entry);
    if (hit) return hit;
    const files = new Map<string, number>([[entry, 0]]);
    const refs = new Set<string>();
    let level = [entry];
    for (let depth = 1; level.length; depth++) {
      const next: string[] = [];
      for (const f of level) {
        const d = scan(f);
        for (const r of d.refs) refs.add(r);
        for (const i of d.imports) if (!files.has(i)) { files.set(i, depth); next.push(i); }
      }
      level = next;
    }
    hit = { files, refs };
    cache.set(entry, hit);
    return hit;
  };
  return { closure: (e) => walk(e).files, dataRefs: (e) => walk(e).refs };
}

/* ---------------------------------------------------------------- the rule table */

interface Rule {
  why: string;
  match: RegExp;
  /** Chain entries (by file) this path also needs; `[]` = known, and needs no script. */
  run: (chain: ChainEntry[]) => string[];
}

const files = (...f: string[]) => () => f;
const dbChecks = (chain: ChainEntry[]) => chain.filter((e) => /(^|\/)verify-[\w-]*db\.mts$|\/[\w-]+-db\.mts$/.test(e.file)).map((e) => e.file);

/** What an import cannot show. Read it top to bottom; a path may match several rules and takes them all. */
export const RULES: Rule[] = [
  { why: "Server Functions, pages and routes are checked for their lock by reading the files", match: /(^|\/)actions\.ts$|^src\/app\/.*\/(page\.tsx|route\.ts)$|^src\/app\/(page\.tsx|route\.ts)$|^src\/proxy\.ts$|^src\/lib\/auth\//, run: files("scripts/verify/guards.ts") },
  { why: "sign-in code", match: /^src\/lib\/auth\//, run: files("scripts/verify/auth.ts", "scripts/verify/arena-admin.ts") },
  { why: "schema and migrations are replayed by the PGlite checks", match: /^(drizzle\/|src\/db\/)/, run: (chain) => ["scripts/verify-db.mts", ...dbChecks(chain)] },
  { why: "the arena engine's own proofs", match: /^src\/lib\/arena\//, run: files("scripts/verify-arena.ts") },
  { why: "the plan itself", match: /^(scripts\/checks\.mts|scripts\/lib\/checks-plan\.ts|package\.json)$/, run: files("scripts/verify/checks-plan.ts") },
  { why: "prose: nothing executes it (fixtures that tests read are found by name)", match: /^(docs\/|\.github\/|\.claude\/|[^/]+\.md$)/, run: () => [] },
];

/* ---------------------------------------------------------------- the plan */

export interface TestPlan {
  /** Chain entries to run, in chain order. */
  entries: ChainEntry[];
  /** Changed paths nothing claimed (they got FALLBACK). */
  unknown: string[];
  /** Import-closure matches dropped because a path reached more than MAX_PER_PATH scripts (farthest first). */
  trimmed: number;
}

/** A widely imported file (a glossary, a types module) reaches most of the chain; run its nearest importers only. */
export const MAX_PER_PATH = 12;

/** The chain entries a set of changed paths needs. `full` is just the whole chain. */
export function testsForPaths(paths: string[], chain: ChainEntry[], graph: Graph): TestPlan {
  const wanted = new Set<string>();
  const unknown: string[] = [];
  const reach = chain.map((e) => ({ e, files: graph.closure(e.file), refs: graph.dataRefs(e.file) }));
  let trimmed = 0;
  for (const raw of paths) {
    const p = posix(raw);
    let known = false;
    const hits: Array<{ key: string; depth: number }> = [];
    for (const r of reach) {
      if (r.files.has(p)) hits.push({ key: r.e.key, depth: r.files.get(p)! });
      else if (r.refs.has(p)) hits.push({ key: r.e.key, depth: 0 });
    }
    if (hits.length) known = true;
    hits.sort((x, y) => x.depth - y.depth); // stable: ties keep chain order
    for (const h of hits.slice(0, MAX_PER_PATH)) wanted.add(h.key);
    trimmed += Math.max(0, hits.length - MAX_PER_PATH);
    for (const rule of RULES) {
      if (!rule.match.test(p)) continue;
      known = true;
      for (const f of rule.run(chain)) for (const e of chain) if (e.file === f) wanted.add(e.key);
    }
    if (!known) unknown.push(p);
  }
  if (unknown.length) for (const f of FALLBACK) for (const e of chain) if (e.file === f) wanted.add(e.key);
  return { entries: chain.filter((e) => wanted.has(e.key)), unknown, trimmed };
}

/** A change the build can break (docs/agent-brief.md, "Checking a change"); anything else skips the build in `full`. */
const BUILD_SENSITIVE = [/^src\/app\//, /^src\/components\//, /^next\.config\./, /^src\/proxy\.ts$/, /^package(-lock)?\.json$/, /^\.env/, /^tsconfig\.json$/, /^postcss\.config\./, /^public\//];
export function isBuildSensitive(paths: string[]): boolean {
  return paths.some((p) => BUILD_SENSITIVE.some((re) => re.test(p)));
}

/* ---------------------------------------------------------------- steps */

export type StepKind = "tsc" | "eslint" | "test" | "build";
export interface Step { name: string; kind: StepKind; /** argv after the node executable */ argv: string[]; env?: Record<string, string>; timeoutMs: number }

const MIN = 60_000;
const LINTABLE = /\.(ts|tsx|mts|js|jsx|mjs)$/;

/** `quick` and `paths` both carry the changed files; quick only typechecks and lints them. */
export type Scope = "full" | { kind: "quick" | "paths"; paths: string[] };

export function planSteps(scope: Scope, root: string, chain: ChainEntry[], graph: Graph): { steps: Step[]; unknown: string[]; trimmed: number } {
  const bin = (...p: string[]) => path.join("node_modules", ...p);
  const tsc: Step = { name: "typecheck", kind: "tsc", argv: [bin("typescript", "bin", "tsc"), "--noEmit", "--pretty", "false"], timeoutMs: 8 * MIN };
  const lint = (list: string[]): Step => ({ name: list.length ? `lint (${list.length} files)` : "lint", kind: "eslint", argv: [bin("eslint", "bin", "eslint.js"), "--no-warn-ignored", ...list], timeoutMs: 8 * MIN });
  // verify-arena runs every arena suite in one process (about 20 min by Oct 2026); the rest stay at 15.
  const test = (e: ChainEntry): Step => ({ name: e.key.replace(/^scripts\//, ""), kind: "test", argv: [bin("tsx", "dist", "cli.mjs"), e.file, ...e.args], timeoutMs: (e.file.endsWith("verify-arena.ts") ? 30 : 15) * MIN });
  if (scope === "full") {
    return {
      unknown: [],
      trimmed: 0,
      steps: [tsc, lint([]), ...chain.map(test), {
        name: "build", kind: "build", argv: [bin("next", "dist", "bin", "next"), "build"], timeoutMs: 20 * MIN,
        // The build needs a DATABASE_URL that points nowhere, never the real one.
        env: { DATABASE_URL: "postgres://build:build@localhost:5432/build", NEXT_TELEMETRY_DISABLED: "1" },
      }],
    };
  }
  const lintFiles = scope.paths.filter((p) => LINTABLE.test(p) && fs.existsSync(path.join(root, p)));
  const steps: Step[] = [tsc];
  if (lintFiles.length) steps.push(lint(lintFiles));
  let unknown: string[] = [];
  let trimmed = 0;
  if (scope.kind === "paths") {
    const plan = testsForPaths(scope.paths, chain, graph);
    unknown = plan.unknown;
    trimmed = plan.trimmed;
    steps.push(...plan.entries.map(test));
  }
  return { steps, unknown, trimmed };
}
