/**
 * The portable-module import-graph walker (#640, shared since #641).
 *
 * Walks the static *value* import graph of a TypeScript entry with the
 * compiler's AST: type-only imports and exports are erased at build time and
 * are not followed. Every bare package and Node builtin is a violation (the
 * portable modules have no runtime dependencies), so are the server-only `@/`
 * aliases, `process.env`, `require` and an unanalysable dynamic `import()`.
 * `forbidFile` adds rules on resolved repo files — #641 uses it to keep the
 * legacy engine out of the browser-safe entry's graph.
 *
 * Used by `scripts/verify/arena-replay-core.ts` and
 * `scripts/verify/arena-browser-boundary.mts`.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/** `@/` paths that are server-only by nature. Every bare package and Node builtin is refused too. */
export const FORBIDDEN_ALIAS = [/^@\/db(\/|$)/, /^@\/lib\/auth(\/|$)/, /^@\/lib\/ai(\/|$)/, /^@\/lib\/cache(\/|$)/, /^@\/lib\/cardtrader(\/|$)/, /^@\/app(\/|$)/];

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

export interface GraphOptions {
  /**
   * A rule on a resolved repo file (path relative to `root`, `/`-separated):
   * a reason string refuses it — reported against the importer, and the file
   * is not walked — and `null` admits it.
   */
  forbidFile?: (rel: string) => string | null;
}

/** Walk the graph from `entry`. `read` returns a file's text or null. */
export function checkImportGraph(entry: string, root: string, read: (file: string) => string | null, options: GraphOptions = {}): { files: string[]; violations: Violation[] } {
  const seen = new Set<string>();
  const violations: Violation[] = [];
  const relOf = (file: string) => path.relative(root, file).split(path.sep).join("/");
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
    const rel = relOf(file);
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
      if (!target) {
        violations.push({ file: rel, reason: `unresolved import ${spec}` });
        continue;
      }
      const refused = options.forbidFile?.(relOf(target));
      if (refused) violations.push({ file: rel, reason: `${refused} ${relOf(target)}` });
      else queue.push(target);
    }
  }
  return { files: [...seen].map(relOf), violations };
}

/**
 * #641's `forbidFile` rule for the browser-safe arena entry: no file of the legacy engine, nor
 * `engines.ts`, whose switch imports it.
 */
export function legacyEngineRule(rel: string): string | null {
  if (/^src\/lib\/arena\/engine\//.test(rel)) return "legacy engine import";
  if (rel === "src/lib/arena/engines.ts") return "engine switch import (loads the legacy engine)";
  return null;
}

/** `read` for the real repo. */
export const diskRead = (file: string): string | null => {
  try {
    return fs.statSync(file).isFile() ? fs.readFileSync(file, "utf8") : null;
  } catch {
    return null;
  }
};
