/**
 * `npm run checks` plans from package.json's `test` chain (scripts/lib/checks-plan.ts). This proves the
 * plan cannot silently drop a script: `full` reaches the whole chain, representative paths map to the
 * scripts that guard them, and a path nothing claims gets the cheap fallback. Pure file reading.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FALLBACK, MAX_PER_PATH, buildGraph, parseChain, planSteps, readChain, testsForPaths } from "../lib/checks-plan.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const chain = readChain(root);
const graph = buildGraph(root);
const filesFor = (...paths: string[]) => testsForPaths(paths, chain, graph).entries.map((e) => e.file);

// parseChain: arguments stay attached, anything but `tsx <file>` is refused.
assert.deepEqual(parseChain("tsx a.ts && tsx b.mts --x &&tsx c.ts").map((e) => [e.file, e.args.join(" ")]), [["a.ts", ""], ["b.mts", "--x"], ["c.ts", ""]]);
assert.throws(() => parseChain("tsx a.ts && node b.js"), /not "tsx <file>"/);

// full: every chain entry is a test step, in order, with its arguments, then the build.
const full = planSteps("full", root, chain, graph).steps;
const tests = full.filter((s) => s.kind === "test");
assert.equal(tests.length, chain.length, "full runs every entry of the test chain");
chain.forEach((e, i) => assert.deepEqual(tests[i].argv.slice(-1 - e.args.length), [e.file, ...e.args], `full runs ${e.key} unchanged`));
assert.ok(full.some((s) => s.kind === "tsc") && full.some((s) => s.kind === "eslint"), "full typechecks and lints");
assert.equal(full.at(-1)?.kind, "build", "the build comes last");
assert.match(full.at(-1)!.env?.DATABASE_URL ?? "", /localhost/, "the build gets a DATABASE_URL that points nowhere");
assert.ok(chain.some((e) => e.file === "scripts/verify/checks-plan.ts"), "this check is in the test chain");

// Representative paths.
assert.ok(filesFor("src/lib/arena/compile.ts").includes("scripts/verify-arena.ts"), "engine code runs verify-arena");
assert.ok(filesFor("src/app/decks/actions.ts").includes("scripts/verify/guards.ts"), "a Server Function file runs the guard check");
assert.ok(filesFor("src/app/page.tsx").includes("scripts/verify/guards.ts"), "a page runs the guard check");
assert.ok(filesFor("src/db/schema.ts").includes("scripts/verify-db.mts"), "the schema runs verify-db");
assert.ok(filesFor("drizzle/0001_x.sql").includes("scripts/verify-db.mts"), "a migration runs verify-db");
assert.ok(filesFor("src/lib/auth/core.ts").includes("scripts/verify/auth.ts"), "sign-in code runs the auth check");
assert.deepEqual(filesFor("scripts/verify/tryit.ts").filter((f) => f === "scripts/verify/tryit.ts"), ["scripts/verify/tryit.ts"], "a changed verify script is run itself");
assert.ok(filesFor("scripts/lib/checks-plan.ts", "package.json").includes("scripts/verify/checks-plan.ts"), "the plan's own files run this check");
assert.ok(filesFor("docs/arena-worker-budgets.md").includes("scripts/verify/arena-worker-budgets.ts"), "a doc a test reads runs that test");
assert.deepEqual(filesFor(["docs", "unread-note.md"].join("/"), ["NOTES", "md"].join(".")), [], "prose that nothing reads needs no script");

// A file almost everything imports does not run the whole chain.
const wide = testsForPaths(["src/lib/arena/glossary.ts"], chain, graph);
assert.ok(wide.trimmed > 0 && wide.entries.length <= MAX_PER_PATH + 3, "a widely imported file runs its nearest importers only");

// Unknown paths: the cheap fallback, and they are reported.
const unknown = testsForPaths(["public/never-heard-of-it.svg"], chain, graph);
assert.deepEqual(unknown.unknown, ["public/never-heard-of-it.svg"]);
assert.deepEqual(unknown.entries.map((e) => e.file), FALLBACK.filter((f) => chain.some((e) => e.file === f)), "the fallback scripts run");
assert.ok(FALLBACK.every((f) => chain.some((e) => e.file === f)), "every fallback script is in the test chain");

// quick lints and typechecks only.
const quick = planSteps({ kind: "quick", paths: ["scripts/checks.mts", "docs/x.md"] }, root, chain, graph).steps;
assert.deepEqual(quick.map((s) => s.kind), ["tsc", "eslint"]);
assert.ok(quick[1].argv.includes("scripts/checks.mts") && !quick[1].argv.includes("docs/x.md"), "quick lints the changed source files only");

console.log("checks-plan: ok");
