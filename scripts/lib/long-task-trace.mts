/**
 * #782: what a main-thread long task is made of, from a CDP trace and a CPU profile of the same page.
 *
 * `startTrace(browser, page)` starts `Tracing` (the DevTools timeline categories) and the sampling
 * `Profiler` on the page's session; the returned `stop()` ends both and gives back the raw trace
 * events and the profile. `longTasks(events, profile, { minMs, label })` then finds every top-level task of
 * 50 ms or more on the page's renderer main thread and says what filled it: the timeline events by self
 * time (script, style, layout, paint, GC, ...), and from the profile samples that fall inside the task the
 * functions by self time and the app's source files by inclusive time. It measures; it changes nothing
 * the page does. Tracing slows the page a little, so a traced run's figures are for attribution, not for
 * the budgets.
 *
 * Function names in a production build are minified. `chunkLabeler(".next/static/chunks")` maps a frame
 * back to its source file and line when the build carries source maps (`PROFILE_SOURCEMAPS=1 npm run
 * build`, `next.config.ts`) and the optional `source-map-js` package resolves (it is not a dependency of
 * this app; without it, or without maps, the minified names are kept).
 */
import fs from "node:fs";
import path from "node:path";
import type { Browser, Page } from "./cdp.mts";

export interface TraceEvent { name: string; cat: string; ph: string; ts: number; dur?: number; pid: number; tid: number; args?: { name?: string; data?: { type?: string; url?: string; functionName?: string } } }
export interface CallFrame { functionName: string; url: string; lineNumber: number; columnNumber: number }
export interface CpuProfile { nodes: { id: number; callFrame: CallFrame; children?: number[] }[]; startTime: number; endTime: number; samples: number[]; timeDeltas: number[] }

/** Overridable for a deeper look (`TRACE_CATEGORIES=...,fonts,cc` showed the font and raster cost in #782). */
const CATEGORIES = process.env.TRACE_CATEGORIES ?? ["toplevel", "devtools.timeline", "disabled-by-default-devtools.timeline", "v8", "v8.execute", "blink.user_timing", "loading"].join(",");

export async function startTrace(browser: Browser, page: Page): Promise<() => Promise<{ events: TraceEvent[]; profile: CpuProfile | null }>> {
  const events: TraceEvent[] = [];
  let done: (() => void) | null = null;
  let collecting = true;
  const finished = new Promise<void>((r) => { done = r; });
  browser.on((method, params) => {
    if (!collecting) return;
    if (method === "Tracing.dataCollected") events.push(...(params.value as TraceEvent[]));
    if (method === "Tracing.tracingComplete") done?.();
  });
  await page.cdp("Profiler.enable");
  await page.cdp("Profiler.setSamplingInterval", { interval: 200 });
  await page.cdp("Profiler.start");
  await page.cdp("Tracing.start", { transferMode: "ReportEvents", traceConfig: { includedCategories: CATEGORIES.split(","), recordMode: "recordContinuously" } });
  return async () => {
    const profile = await page.cdp<{ profile: CpuProfile }>("Profiler.stop").then((r) => r.profile).catch(() => null);
    await page.cdp("Tracing.end");
    await Promise.race([finished, new Promise((r) => setTimeout(r, 30000))]);
    collecting = false;
    return { events, profile };
  };
}

export interface LongTaskBreakdown {
  /** From the first long task of the trace. */
  startMs: number;
  ms: number;
  /** Timeline events by self time, largest first (ms). */
  byEvent: [string, number][];
  /** Functions by self time in the task, from the profile samples (ms), largest first. */
  byFunction: [string, number][];
  /** The app's own source files (`src/...`) by inclusive time in the task (ms): which part of the app the task was spent under. */
  bySource: [string, number][];
}

type Labeler = (cf: CallFrame) => string;

const short = (url: string) => url.replace(/^.*\/_next\/static\/chunks\//, "chunks/").replace(/^https?:\/\/[^/]+/, "");
const minified: Labeler = (cf) => `${cf.functionName || "(anonymous)"} ${short(cf.url)}:${cf.lineNumber + 1}:${cf.columnNumber + 1}`;

/** A labeler that names a frame by its original source and line, or `null` when the build has no maps or `source-map-js` is absent. */
export async function chunkLabeler(chunksDir: string): Promise<Labeler | null> {
  let SourceMapConsumer: new (raw: unknown) => { originalPositionFor(p: { line: number; column: number }): { source: string | null; line: number | null; name: string | null } };
  try {
    // Optional: a transitive package (postcss's), present in this repo's node_modules but not promised by package.json.
    const spec = "source-map-js";
    ({ SourceMapConsumer } = (await import(spec)) as { SourceMapConsumer: typeof SourceMapConsumer });
  } catch {
    return null;
  }
  const maps = new Map<string, InstanceType<typeof SourceMapConsumer> | null>();
  const consumer = (url: string) => {
    const m = /\/_next\/static\/chunks\/(.+\.js)$/.exec(url);
    if (!m) return null;
    if (!maps.has(m[1])) {
      const js = path.join(chunksDir, m[1]);
      const ref = fs.existsSync(js) ? /sourceMappingURL=(\S+)\s*$/.exec(fs.readFileSync(js, "utf8")) : null;
      const file = ref ? path.join(path.dirname(js), ref[1]) : `${js}.map`;
      maps.set(m[1], fs.existsSync(file) ? new SourceMapConsumer(JSON.parse(fs.readFileSync(file, "utf8"))) : null);
    }
    return maps.get(m[1]) ?? null;
  };
  const found = fs.existsSync(chunksDir) && fs.readdirSync(chunksDir).some((f) => f.endsWith(".map"));
  if (!found) return null;
  const cache = new Map<string, string>();
  return (cf) => {
    const key = `${cf.url}:${cf.lineNumber}:${cf.columnNumber}:${cf.functionName}`;
    let out = cache.get(key);
    if (out) return out;
    out = minified(cf);
    const c = cf.url ? consumer(cf.url) : null;
    if (c) {
      const p = c.originalPositionFor({ line: cf.lineNumber + 1, column: cf.columnNumber });
      if (p.source) out = `${p.name || cf.functionName || "(anonymous)"} ${p.source.replace(/^.*?(src\/|node_modules\/)/, "$1")}:${p.line}`;
    }
    cache.set(key, out);
    return out;
  };
}

/** The page's renderer main thread: the `CrRendererMain` with the most top-level task time. */
function mainThread(events: TraceEvent[]): { pid: number; tid: number } | null {
  const mains = events.filter((e) => e.ph === "M" && e.name === "thread_name" && e.args?.name === "CrRendererMain");
  let best: { pid: number; tid: number; t: number } | null = null;
  for (const m of mains) {
    const t = events.filter((e) => e.pid === m.pid && e.tid === m.tid && e.ph === "X" && e.name === "RunTask").reduce((a, e) => a + (e.dur ?? 0), 0);
    if (!best || t > best.t) best = { pid: m.pid, tid: m.tid, t };
  }
  return best;
}

export function longTasks(events: TraceEvent[], profile: CpuProfile | null, o: { minMs?: number; label?: Labeler | null } = {}): LongTaskBreakdown[] {
  const minMs = o.minMs ?? 50;
  const label = o.label ?? minified;
  const main = mainThread(events);
  if (!main) return [];
  const own = events.filter((e) => e.pid === main.pid && e.tid === main.tid && e.ph === "X" && typeof e.dur === "number").sort((a, b) => a.ts - b.ts || b.dur! - a.dur!);
  const tasks = own.filter((e) => e.name === "RunTask" && e.dur! >= minMs * 1000);
  const parent = new Map<number, number>();
  const byId = new Map<number, CpuProfile["nodes"][number]>();
  const sampleTs: number[] = [];
  if (profile) {
    for (const n of profile.nodes) { byId.set(n.id, n); for (const c of n.children ?? []) parent.set(c, n.id); }
    let t = profile.startTime;
    for (const d of profile.timeDeltas) { t += d; sampleTs.push(t); }
  }
  const origin = tasks[0]?.ts ?? 0;
  const top = (m: Map<string, number>, n: number) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => [k, Math.round(v * 10) / 10] as [string, number]);
  return tasks.map((task) => {
    const end = task.ts + task.dur!;
    // Timeline self time: each event's duration minus that of the events directly inside it.
    const inner = own.filter((e) => e !== task && e.ts >= task.ts && e.ts + e.dur! <= end);
    const childTime = new Map<TraceEvent, number>();
    const stack: TraceEvent[] = [];
    for (const e of inner) {
      while (stack.length && stack[stack.length - 1].ts + stack[stack.length - 1].dur! <= e.ts) stack.pop();
      const p = stack[stack.length - 1] ?? task;
      childTime.set(p, (childTime.get(p) ?? 0) + e.dur!);
      stack.push(e);
    }
    const self = new Map<string, number>();
    for (const e of [task, ...inner]) {
      const d = e.args?.data;
      const name = ["FunctionCall", "EvaluateScript", "TimerFire", "EventDispatch"].includes(e.name) ? `${e.name}${d?.type ? ` ${d.type}` : ""}${d?.url ? ` ${short(d.url)}` : ""}${d?.functionName ? ` ${d.functionName}` : ""}` : e.name;
      self.set(name, (self.get(name) ?? 0) + Math.max(0, (e.dur! - (childTime.get(e) ?? 0)) / 1000));
    }
    const fn = new Map<string, number>();
    const src = new Map<string, number>();
    if (profile) {
      for (let i = 0; i < profile.samples.length; i++) {
        if (sampleTs[i] < task.ts || sampleTs[i] > end) continue;
        const dt = (profile.timeDeltas[i + 1] ?? 0) / 1000;
        const node = byId.get(profile.samples[i]);
        if (!node) continue;
        const l = label(node.callFrame);
        fn.set(l, (fn.get(l) ?? 0) + dt);
        const files = new Set<string>();
        for (let id: number | undefined = node.id; id !== undefined; id = parent.get(id)) {
          const f = label(byId.get(id)!.callFrame).split(" ")[1]?.replace(/:\d+(:\d+)?$/, "");
          if (f?.startsWith("src/")) files.add(f);
        }
        for (const f of files) src.set(f, (src.get(f) ?? 0) + dt);
      }
    }
    return { startMs: Math.round((task.ts - origin) / 100) / 10, ms: Math.round(task.dur! / 100) / 10, byEvent: top(self, 12), byFunction: top(fn, 15), bySource: top(src, 12) };
  });
}
