/**
 * `npm run checks -- [quick | full | <paths...>]`: check a change at the right size.
 *
 *   (no args)  paths changed vs origin/main plus uncommitted/untracked: typecheck, eslint on them,
 *              and only the test-chain scripts that can care about them (scripts/lib/checks-plan.ts)
 *   quick      typecheck + eslint on the changed files, no tests
 *   full       typecheck, eslint, every script of package.json's `test`, then the build
 *   <paths>    like no args, for exactly these paths
 *
 * Prints only failures (first ~40 relevant lines each), then a pass/fail count with timings. Exits
 * non-zero on any failure. Children run in their own process groups, killed when they finish, on
 * Node (the one running this) with DATABASE_URL removed: `npm test` never touches a database, and
 * in a cloud session that variable belongs to another app.
 */
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraph, planSteps, readChain, type Scope, type Step } from "./lib/checks-plan.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PARALLEL = 4;
const MAX_LINES = 40;

function git(...args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

/** Files changed since this branch left origin/main, plus uncommitted and untracked ones. */
function changedPaths(): string[] {
  const base = git("merge-base", "origin/main", "HEAD").trim() || "HEAD";
  const lines = [...git("diff", "--name-only", base).split("\n"), ...git("ls-files", "-o", "--exclude-standard").split("\n")];
  return [...new Set(lines.map((l) => l.trim()).filter(Boolean))];
}

type Result = { step: Step; ok: boolean; ms: number; out: string; timedOut: boolean };

function run(step: Step): Promise<Result> {
  const started = Date.now();
  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = { ...process.env, ...step.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}` };
    if (!step.env?.DATABASE_URL) delete env.DATABASE_URL;
    const child = spawn(process.execPath, step.argv, { cwd: root, env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let timedOut = false;
    let done = false;
    const kill = () => {
      try {
        if (process.platform === "win32") child.kill();
        else if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch { /* already gone */ }
    };
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => { timedOut = true; kill(); }, step.timeoutMs);
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      kill(); // nothing the step started may outlive it
      resolve({ step, ok: code === 0 && !timedOut, ms: Date.now() - started, out, timedOut });
    };
    child.on("error", (e) => { out += String(e); finish(null); });
    child.on("close", finish);
  });
}

/** The lines of a failed step worth reading. */
export function excerpt(r: Pick<Result, "step" | "out" | "timedOut">): string[] {
  const lines = r.out.replace(/\x1b\[[0-9;]*m/g, "").split("\n").map((l) => l.replace(/\s+$/, ""));
  const nonEmpty = lines.filter((l) => l.trim());
  if (r.timedOut) return [`timed out after ${Math.round(r.step.timeoutMs / 60000)} min`, ...nonEmpty.slice(-5)];
  let picked: string[];
  if (r.step.kind === "tsc") picked = nonEmpty.filter((l) => /error TS\d+/.test(l));
  else if (r.step.kind === "eslint") picked = nonEmpty;
  else {
    const at = lines.findIndex((l) => /^\s*(\w*Error\b|AssertionError|FAIL|not ok)|✗|\bfailed\b/i.test(l));
    picked = at >= 0 ? lines.slice(Math.max(0, at - 2)).filter((l) => l.trim()) : nonEmpty.slice(-MAX_LINES);
  }
  if (picked.length === 0) picked = nonEmpty.slice(-MAX_LINES);
  const cut = picked.length - MAX_LINES;
  return cut > 0 ? [...picked.slice(0, MAX_LINES), `... (+${cut} more lines)`] : picked;
}

async function pool(steps: Step[], width: number, onDone: (r: Result) => void): Promise<Result[]> {
  const results: Result[] = [];
  const queue = [...steps];
  const worker = async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      const r = await run(s);
      results.push(r);
      onDone(r);
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, steps.length) }, worker));
  return results;
}

const sec = (ms: number) => (ms / 1000).toFixed(1) + "s";

async function main() {
  const args = process.argv.slice(2);
  const chain = readChain(root);
  let scope: Scope;
  let label: string;
  if (args[0] === "full") { scope = "full"; label = "full"; }
  else if (args[0] === "quick") { scope = { kind: "quick", paths: changedPaths() }; label = "quick"; }
  else {
    const paths = (args.length ? args : changedPaths()).map((p) => path.relative(root, path.resolve(root, p)).replace(/\\/g, "/"));
    scope = { kind: "paths", paths };
    label = `${paths.length} path${paths.length === 1 ? "" : "s"}`;
  }

  const started = Date.now();
  const { steps, unknown, trimmed } = planSteps(scope, root, chain, buildGraph(root));
  const build = steps.filter((s) => s.kind === "build");
  const rest = steps.filter((s) => s.kind !== "build");
  if (unknown.length) console.log(`no rule for ${unknown.length} path(s) (ran the fallback scripts): ${unknown.slice(0, 5).join(", ")}${unknown.length > 5 ? ", ..." : ""}`);
  if (trimmed) console.log(`${trimmed} further importing script(s) not run (a widely imported file): use "full" before pushing`);
  console.log(`checks ${label}: ${rest.length}${build.length ? "+build" : ""} steps, ${PARALLEL} at a time`);

  const all: Result[] = [];
  const report = (r: Result) => { if (!r.ok) console.log(`FAIL ${r.step.name} (${sec(r.ms)})`); };
  all.push(...(await pool(rest, PARALLEL, report)));
  // The build wants the machine to itself, and is pointless when the tests above failed.
  if (build.length && all.every((r) => r.ok)) all.push(...(await pool(build, 1, report)));
  else if (build.length) console.log("build skipped: fix the failures above first");

  const bad = all.filter((r) => !r.ok);
  for (const r of bad) {
    console.log(`\n--- ${r.step.name}`);
    for (const l of excerpt(r)) console.log(l);
  }
  const slow = [...all].sort((a, b) => b.ms - a.ms).slice(0, 3).map((r) => `${r.step.name.replace(/^verify\//, "")} ${sec(r.ms)}`);
  console.log(`\n${bad.length ? "FAILED" : "ok"}: ${all.length - bad.length} passed, ${bad.length} failed in ${sec(Date.now() - started)} (slowest: ${slow.join(", ")})`);
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
