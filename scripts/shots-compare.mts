/**
 * Before/after screenshots in one command (the proof docs/agent-brief.md "Screens" asks for).
 *
 *   npm run shots:compare -- /collection /decks            # routes of the app
 *   npm run shots:compare -- play over                     # arena fixtures (/arena/preview?fixture=…)
 *   npm run shots:compare -- play --base origin/main --widths 1440,390 --out .shots-compare
 *   flags: --skin anime|night (fixtures), --settle ms (default 1500), --tolerance n (per channel, default 0),
 *          --rounds n (default 2: a changed picture is shot again before it is called changed)
 *
 * "after" is this checkout, as it is on disk (uncommitted changes included). "before" is a temporary
 * `git worktree add --detach <base>` with its own `next dev`, and its own node_modules: a hard-link copy of
 * this checkout's (instant, no extra disk; Turbopack refuses a symlinked node_modules, so a symlink is no
 * option). Each side gets a fresh server on a free port, one after the other, never hot reload. Shots are
 * lossless PNGs of the full page, taken with scripts/lib/cdp.mts and compared with sharp.
 *
 * Needs no database: DATABASE_URL is removed from the servers' environment. A page that reads the
 * database errors on the server; it is reported "needs DB" and not compared. Every server and Chromium it
 * starts is stopped by PID, also on error or Ctrl-C. Not part of `npm test`.
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { arg, Browser, sleep, type Viewport } from "./lib/cdp.mts";

const argv = process.argv.slice(2);
const FLAGS_WITH_VALUE = new Set(["--rounds", "--base", "--widths", "--out", "--skin", "--settle", "--tolerance"]);
const targets: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (FLAGS_WITH_VALUE.has(argv[i]!)) i++;
  else if (!argv[i]!.startsWith("--")) targets.push(argv[i]!);
}
if (!targets.length) {
  console.error("usage: npm run shots:compare -- <route or arena fixture>… [--base origin/main] [--widths 1440,390] [--out dir]");
  process.exit(2);
}
const baseRef = arg("base", argv) ?? "origin/main";
const widths = (arg("widths", argv) ?? "1440,390").split(",").map((w) => w.trim());
const outDir = resolve(arg("out", argv) ?? ".shots-compare");
const skin = arg("skin", argv) ?? "anime";
const settleMs = Number(arg("settle", argv) ?? 1500);
const tolerance = Number(arg("tolerance", argv) ?? 0);
const root = process.cwd();

type Job = { label: string; path: string; waitFor: string };
const jobs: Job[] = targets.map((t) =>
  t.startsWith("/")
    ? { label: t, path: t, waitFor: "body" }
    : { label: `fixture ${t}`, path: `/arena/preview?fixture=${encodeURIComponent(t)}&skin=${skin}&pace=step`, waitFor: ".arena" },
);
const viewports: Viewport[] = widths.map((w) => {
  const [ww, hh] = w.split("x").map(Number) as [number, number | undefined];
  return { name: w, width: ww, height: hh ?? (ww >= 768 ? 900 : 844), mobile: ww < 768 };
});
const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "root";

// ---- process bookkeeping: everything started here is stopped by PID ----
const servers = new Set<ChildProcess>();
let browser: Browser | undefined;
let worktree: string | undefined;

function killServer(p: ChildProcess) {
  if (p.pid && p.exitCode === null) {
    try {
      process.kill(-p.pid, "SIGKILL"); // its own process group: next dev spawns next-server
    } catch {
      try {
        p.kill("SIGKILL");
      } catch {}
    }
  }
  servers.delete(p);
}
async function cleanup() {
  for (const p of [...servers]) killServer(p);
  await browser?.close().catch(() => {});
  browser = undefined;
  if (worktree) {
    try {
      execFileSync("git", ["worktree", "remove", "--force", worktree], { cwd: root, stdio: "ignore" });
    } catch {
      rmSync(worktree, { recursive: true, force: true });
      try {
        execFileSync("git", ["worktree", "prune"], { cwd: root, stdio: "ignore" });
      } catch {}
    }
    worktree = undefined;
  }
}
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    void cleanup().finally(() => process.exit(130));
  });

const freePort = () =>
  new Promise<number>((res, rej) => {
    const s = createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => res(port));
    });
  });

type Side = { name: "before" | "after"; dir: string };
type Shot = { png?: Buffer; needsDb?: string; error?: string };

async function startServer(dir: string) {
  rmSync(join(dir, ".next"), { recursive: true, force: true }); // no cache from older code
  const port = await freePort();
  const env = { ...process.env, DATABASE_URL: "", NEXT_TELEMETRY_DISABLED: "1" } as NodeJS.ProcessEnv;
  delete env.DATABASE_URL;
  const log = { text: "" };
  const p = spawn(join(dir, "node_modules/.bin/next"), ["dev", "-p", String(port), "-H", "127.0.0.1"], { cwd: dir, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  servers.add(p);
  p.stdout!.on("data", (d) => (log.text += d));
  p.stderr!.on("data", (d) => (log.text += d));
  const base = `http://127.0.0.1:${port}`;
  const end = Date.now() + 120_000;
  for (;;) {
    if (p.exitCode !== null) throw new Error(`next dev exited early in ${dir}:\n${log.text.slice(-1500)}`);
    try {
      await fetch(`${base}/login`, { redirect: "manual" });
      break;
    } catch {
      if (Date.now() > end) throw new Error(`next dev in ${dir} did not answer in 120 s:\n${log.text.slice(-1500)}`);
      await sleep(500);
    }
  }
  return { p, base, log };
}

async function shootSide(side: Side, want: Set<string>): Promise<Map<string, Shot>> {
  const out = new Map<string, Shot>();
  const { p, base, log } = await startServer(side.dir);
  try {
    browser = await Browser.launch();
    for (const vp of viewports) {
      if (!jobs.some((j) => want.has(`${j.path}@${vp.name}`))) continue;
      const page = await browser.page(vp);
      // No motion, no caret: a screenshot should not depend on when it was taken.
      await page.beforeLoad(`document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}"; document.head.appendChild(s); });`);
      for (const job of jobs) {
        const key = `${job.path}@${vp.name}`;
        if (!want.has(key)) continue;
        const url = base + job.path;
        try {
          await page.goto(url); // first visit compiles the route (and may reload once)
          await page.settle(300);
          const mark = log.text.length;
          // Load the page afresh until two loads in a row give the same picture: a layout that depends
          // on a load race is not a result. (Seen: the arena hand fanned out in one load, packed in the next.)
          const load = async () => {
            await page.goto(url);
            await page.waitFor(job.waitFor);
            await page.settle(settleMs);
            return page.screenshot(true, "png");
          };
          let png = await load();
          let stable = false;
          for (let i = 0; i < 4 && !stable; i++) {
            const next = await load();
            stable = next.equals(png);
            png = next;
          }
          if (!stable) console.warn(`warning: ${key} on ${side.name} gave a different picture on every load; the last one is used, treat its diff as noise`);
          const serverErr = log.text.slice(mark).match(/⨯[^\n]*/)?.[0];
          const dom = await page.eval<string>(`document.getElementById("__next_error__") ? "error" : ""`);
          if (serverErr || dom) out.set(key, { needsDb: serverErr ?? `page shows a Next error (${dom})` });
          else out.set(key, { png });
        } catch (e) {
          out.set(key, { error: (e as Error).message });
        }
      }
      await page.close();
    }
  } finally {
    await browser?.close().catch(() => {});
    browser = undefined;
    killServer(p);
  }
  return out;
}

function addBeforeWorktree(): string {
  const dir = mkdtempSync(join(tmpdir(), "shots-before-"));
  rmSync(dir, { recursive: true });
  execFileSync("git", ["worktree", "add", "--detach", dir, baseRef], { cwd: root, stdio: "ignore" });
  worktree = dir;
  const nm = join(root, "node_modules");
  if (!existsSync(nm)) throw new Error("no node_modules here: run `npm ci` first.");
  // `cp -al` = hard links: the same files, a real directory. Falls back to a plain copy.
  try {
    execFileSync("cp", ["-al", realpathSync(nm), join(dir, "node_modules")], { stdio: "ignore" });
  } catch {
    cpSync(realpathSync(nm), join(dir, "node_modules"), { recursive: true });
  }
  for (const f of ["package-lock.json"]) {
    if (existsSync(join(dir, f)) && readFileSync(join(dir, f), "utf8") !== readFileSync(join(root, f), "utf8")) console.warn(`warning: ${f} differs from ${baseRef}; "before" runs on this checkout's node_modules.`);
  }
  return dir;
}

async function compare(a: Buffer, b: Buffer, tol: number) {
  const A = await sharp(a).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const B = await sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = Math.max(A.info.width, B.info.width);
  const h = Math.max(A.info.height, B.info.height);
  const diff = Buffer.alloc(w * h * 4);
  let changed = 0;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  const px = (img: typeof A, x: number, y: number) => (x < img.info.width && y < img.info.height ? (y * img.info.width + x) * 4 : -1);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const ia = px(A, x, y), ib = px(B, x, y), o = (y * w + x) * 4;
      let differs: boolean;
      if (ia < 0 || ib < 0) differs = true; // one side is shorter or narrower: the extra area counts as changed
      else differs = Math.abs(A.data[ia]! - B.data[ib]!) > tol || Math.abs(A.data[ia + 1]! - B.data[ib + 1]!) > tol || Math.abs(A.data[ia + 2]! - B.data[ib + 2]!) > tol || Math.abs(A.data[ia + 3]! - B.data[ib + 3]!) > tol;
      if (differs) {
        changed++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        diff[o] = 255; diff[o + 1] = 0; diff[o + 2] = 60; diff[o + 3] = 255;
      } else if (ib >= 0) {
        // unchanged pixels, washed out so the changes stand out
        for (let c = 0; c < 3; c++) diff[o + c] = Math.round(B.data[ib + c]! * 0.25 + 191);
        diff[o + 3] = 255;
      }
    }
  const png = await sharp(diff, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  return { changed, bbox: changed ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null, sizeBefore: `${A.info.width}x${A.info.height}`, sizeAfter: `${B.info.width}x${B.info.height}`, png };
}

// ---- run ----
let exit = 0;
try {
  mkdirSync(outDir, { recursive: true });
  if (lstatSync(join(root, "node_modules"), { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error("node_modules here is a symlink and Turbopack refuses those. Replace it with a hard-link copy: `rm node_modules && cp -al $(realpath <other checkout>/node_modules) node_modules` (or `npm ci`).");
  }
  console.log(`before = ${baseRef} (temporary worktree), after = ${root}`);
  const beforeDir = addBeforeWorktree();
  // A changed picture is shot again (both sides, fresh servers): the arena hand, for one, fans out
  // differently from one run to the next on the same code. Changed in every round = changed; once
  // identical = reported identical, with a note.
  const rounds = Number(arg("rounds", argv) ?? 2);
  const final = new Map<string, string>();
  let pending = new Set(jobs.flatMap((j) => viewports.map((v) => `${j.path}@${v.name}`)));
  for (let round = 1; round <= rounds && pending.size; round++) {
    if (round > 1) console.log(`round ${round}: shooting ${pending.size} changed picture(s) again to rule out a flaky render`);
    const before = await shootSide({ name: "before", dir: beforeDir }, pending);
    const after = await shootSide({ name: "after", dir: root }, pending);
    const next = new Set<string>();
    for (const key of pending) {
      const b = before.get(key)!, a = after.get(key)!;
      const name = slug(key.replace("@", "-"));
      if (b.needsDb || a.needsDb) final.set(key, `needs DB (${(b.needsDb ?? a.needsDb)!.slice(0, 90)}): not compared, compare it by hand on a real database`);
      else if (b.error || a.error) {
        final.set(key, `failed: ${b.error ?? a.error}`);
        exit = 1;
      } else {
        writeFileSync(join(outDir, `${name}.before.png`), b.png!);
        writeFileSync(join(outDir, `${name}.after.png`), a.png!);
        const r = await compare(b.png!, a.png!, tolerance);
        if (!r.changed) {
          rmSync(join(outDir, `${name}.diff.png`), { force: true });
          final.set(key, round > 1 ? "identical (flaky: round 1 differed, the repeat did not)" : "identical");
        } else {
          writeFileSync(join(outDir, `${name}.diff.png`), r.png);
          final.set(key, `${r.changed} px changed, box x=${r.bbox!.x} y=${r.bbox!.y} ${r.bbox!.w}x${r.bbox!.h}${r.sizeBefore !== r.sizeAfter ? `; page size ${r.sizeBefore} -> ${r.sizeAfter}` : ""}${round > 1 ? ` (differed in all ${round} rounds)` : ""}`);
          next.add(key);
        }
      }
    }
    pending = next;
  }
  const rows = jobs.flatMap((j) => viewports.map((v) => `${j.label} @ ${v.name}: ${final.get(`${j.path}@${v.name}`)}`));
  const report = `# shots:compare ${new Date().toISOString()}\nbefore ${baseRef}, after working tree, files in ${outDir}\n\n${rows.map((r) => `- ${r}`).join("\n")}\n`;
  writeFileSync(join(outDir, "report.md"), report);
  console.log(`\n${report}`);
} catch (e) {
  console.error((e as Error).message);
  exit = 1;
} finally {
  await cleanup();
}
process.exit(exit);
