/**
 * #640: the portable replay core, without a database.
 *
 *   1. Fixed hash vectors (`arena-replay-vectors.ts`) give exactly the frozen format-1
 *      bundle/catalog/program/ruleset hashes under Node's Web Crypto, and the core's hash of the
 *      shipped ruleset equals `node:crypto` over the same canonical JSON.
 *   2. The static import graph of `src/lib/arena/replay-core.ts` reaches no database, Drizzle,
 *      Node builtin, provider SDK, auth, cache or `process.env`. Type-only imports are erased at
 *      build time and are not followed. The walker is first run on a deliberately bad virtual
 *      graph to prove it catches each forbidden kind.
 *
 * Run from the repo root: `npx tsx scripts/verify/arena-replay-core.ts` (part of `npm test`).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { runReplayVectors } from "./arena-replay-vectors.ts";
import { canonicalJson, replayHash } from "../../src/lib/arena/replay-core.ts";
import { DBS_FILES } from "../../src/lib/arena/rulesets/dbs/index.ts";

const ROOT = process.cwd();
const ENTRY = path.join(ROOT, "src/lib/arena/replay-core.ts");

/** `@/` paths that are server-only by nature. Every bare package and Node builtin is refused too. */
const FORBIDDEN_ALIAS = [/^@\/db(\/|$)/, /^@\/lib\/auth(\/|$)/, /^@\/lib\/ai(\/|$)/, /^@\/lib\/cache(\/|$)/, /^@\/lib\/cardtrader(\/|$)/, /^@\/app(\/|$)/];

export interface Violation { file: string; reason: string }

/** Value (non-type-only) static and dynamic import specifiers, plus `process.env` / `require` uses. */
export function scanSource(fileName: string, text: string): { specifiers: string[]; violations: string[] } {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const specifiers: string[] = [];
  const violations: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const typeOnly = !!clause && (clause.isTypeOnly || (!clause.name && !!clause.namedBindings && ts.isNamedImports(clause.namedBindings)
        && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((e) => e.isTypeOnly)));
      if (!typeOnly) specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const typeOnly = node.isTypeOnly || (!!node.exportClause && ts.isNamedExports(node.exportClause)
        && node.exportClause.elements.length > 0 && node.exportClause.elements.every((e) => e.isTypeOnly));
      if (!typeOnly) specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node)) {
      const [arg] = node.arguments;
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (arg && ts.isStringLiteralLike(arg)) specifiers.push(arg.text);
        else violations.push("a dynamic import() whose target cannot be checked");
      } else if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
        violations.push(`require(${arg && ts.isStringLiteralLike(arg) ? JSON.stringify(arg.text) : "…"})`);
      }
    } else if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "process" && node.name.text === "env") {
      violations.push("process.env lookup");
    } else if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "process") {
      violations.push("process[...] lookup");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { specifiers, violations };
}

/** Walk the graph from `entry`. `read` returns a file's text or null; `exists` probes resolutions. */
export function checkImportGraph(entry: string, root: string, read: (file: string) => string | null): { files: string[]; violations: Violation[] } {
  const seen = new Set<string>();
  const violations: Violation[] = [];
  const resolve = (from: string, spec: string): string | null => {
    const base = spec.startsWith("@/") ? path.join(root, "src", spec.slice(2)) : path.resolve(path.dirname(from), spec);
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
      if (/\.(ts|tsx|mts)$/.test(candidate) && read(candidate) !== null) return candidate;
    }
    return null;
  };
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = read(file);
    const rel = path.relative(root, file).split(path.sep).join("/");
    if (text === null) {
      violations.push({ file: rel, reason: "unreadable module" });
      continue;
    }
    const scanned = scanSource(file, text);
    for (const reason of scanned.violations) violations.push({ file: rel, reason });
    for (const spec of scanned.specifiers) {
      if (spec.startsWith("@/")) {
        if (FORBIDDEN_ALIAS.some((re) => re.test(spec))) {
          violations.push({ file: rel, reason: `server-only import ${spec}` });
          continue;
        }
      } else if (!spec.startsWith(".")) {
        // Node builtins (node:crypto, fs, path…), drizzle-orm, provider SDKs, next — and any
        // other package: the portable core has no runtime dependencies.
        violations.push({ file: rel, reason: `package or builtin import ${spec}` });
        continue;
      }
      const target = resolve(file, spec);
      if (!target) violations.push({ file: rel, reason: `unresolved import ${spec}` });
      else queue.push(target);
    }
  }
  return { files: [...seen].map((f) => path.relative(root, f).split(path.sep).join("/")), violations };
}

const diskRead = (file: string): string | null => {
  try {
    return fs.statSync(file).isFile() ? fs.readFileSync(file, "utf8") : null;
  } catch {
    return null;
  }
};

async function main() {
  // 1. Vectors.
  const results = await runReplayVectors();
  const failed = results.filter((r) => !r.ok);
  for (const r of failed) console.error(`  vector failed: ${r.name}: expected ${JSON.stringify(r.expected)}, got ${JSON.stringify(r.actual)}`);
  assert.equal(failed.length, 0, `${failed.length} replay hash vector(s) failed`);
  assert.ok(results.length >= 25, "the vector suite ran");
  const nodeHash = createHash("sha256").update(canonicalJson(DBS_FILES)).digest("hex");
  assert.equal(await replayHash(DBS_FILES), nodeHash, "Web Crypto and node:crypto agree on the shipped DBS ruleset");

  // 2. The walker catches each forbidden kind on a virtual graph.
  const fakeRoot = path.join(ROOT, "__virtual__");
  const virtual: Record<string, string> = {
    [path.join(fakeRoot, "src/core.ts")]: [
      `import type { Db } from "@/db";`,
      `import { type Only } from "./types-only";`,
      `export type { X } from "./types-only";`,
      `import { helper } from "./helper";`,
      `export { helper };`,
    ].join("\n"),
    [path.join(fakeRoot, "src/types-only.ts")]: `import { createHash } from "node:crypto";\nexport type Only = 1;`,
    [path.join(fakeRoot, "src/helper.ts")]: [
      `import { createHash } from "node:crypto";`,
      `import fs from "fs";`,
      `import { eq } from "drizzle-orm";`,
      `import Anthropic from "@anthropic-ai/sdk";`,
      `import { db } from "@/db";`,
      `export * from "@/lib/auth";`,
      `export const rev = process.env.VERCEL_GIT_COMMIT_SHA;`,
      `export const lazy = () => import("./missing");`,
    ].join("\n"),
  };
  const bad = checkImportGraph(path.join(fakeRoot, "src/core.ts"), fakeRoot, (f) => virtual[f] ?? null);
  const reasons = bad.violations.map((v) => `${v.file}: ${v.reason}`);
  for (const expected of [
    "src/helper.ts: package or builtin import node:crypto",
    "src/helper.ts: package or builtin import fs",
    "src/helper.ts: package or builtin import drizzle-orm",
    "src/helper.ts: package or builtin import @anthropic-ai/sdk",
    "src/helper.ts: server-only import @/db",
    "src/helper.ts: server-only import @/lib/auth",
    "src/helper.ts: process.env lookup",
    "src/helper.ts: unresolved import ./missing",
  ]) assert.ok(reasons.includes(expected), `the import-graph check catches "${expected}" (got ${JSON.stringify(reasons)})`);
  assert.ok(!bad.files.includes("src/types-only.ts"), "type-only imports are not followed");
  assert.equal(reasons.filter((r) => r.startsWith("src/core.ts")).length, 0, "type-only imports of server modules are allowed");

  // 3. The real portable graph is clean.
  const real = checkImportGraph(ENTRY, ROOT, diskRead);
  for (const v of real.violations) console.error(`  forbidden: ${v.file}: ${v.reason}`);
  assert.equal(real.violations.length, 0, `replay-core.ts reaches ${real.violations.length} forbidden import(s)`);
  assert.ok(real.files.includes("src/lib/arena/rulesets/load.ts"), "the walker followed the core's value imports");
  for (const serverOnly of ["src/lib/arena/replay-bundle.ts", "src/db/index.ts", "src/db/schema.ts"]) {
    assert.ok(!real.files.includes(serverOnly), `${serverOnly} is outside the portable graph`);
  }
  // offline-replay.ts must take its bundle logic from the core, not the server module.
  const offline = scanSource("offline-replay.ts", fs.readFileSync(path.join(ROOT, "src/lib/arena/offline-replay.ts"), "utf8"));
  assert.ok(!offline.specifiers.some((s) => /replay-bundle/.test(s)), "offline-replay.ts does not import the server replay module");
  assert.equal(offline.violations.length, 0, "offline-replay.ts reads no environment");

  console.log(`arena-replay-core: ${results.length} vectors, ${real.files.length} portable modules, import graph clean`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
