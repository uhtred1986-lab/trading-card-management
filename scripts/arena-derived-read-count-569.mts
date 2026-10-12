/** Exact static-evaluation counter; run unchanged on the #569 base and candidate. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import inspector from "node:inspector";
import { arenaG, CTX, ENGINE, IMPL } from "./verify/harness";
import { snapshotOfGame } from "../src/lib/arena/session";
import type { LoadedGame } from "../src/lib/arena/games";
import type { VmState } from "../src/lib/arena/vm/state";
import type { Db } from "../src/db";

assert.equal(ENGINE, "rules", "run with --engine rules");
assert.equal(process.env.DATABASE_URL ?? "", "", "do not connect this counter to a database");
const state = arenaG({ hand: ["V1", "V1"], energy: ["V1", "V1"], battle: ["AURA", "AURA", "V1"], oppHand: ["V-BLUE"], oppBattle: ["V-BLUE"] }) as VmState;
const row = {
  id: 569, version: 7, mode: "versus", engine: "rules", game: "dbs", status: "playing", p1Name: "One", p2Name: "Two",
  ctx: CTX, state, log: [], beats: null, spotlight: null, art: {},
  spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 },
} as unknown as LoadedGame;
let legalReads = 0;
Object.defineProperty(row, "legal", { enumerable: true, get: () => { legalReads++; return IMPL.legalActions(CTX, state); } });

const session = new inspector.Session();
session.connect();
const post = <T,>(method: string, params?: object) => new Promise<T>((resolve, reject) => session.post(method, params ?? {}, (error, value) => error ? reject(error) : resolve(value as T)));
await post("Profiler.enable");
await post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
const snapshot = await snapshotOfGame({} as Db, row, "p1");
const coverage = await post<{ result: Array<{ url: string; functions: Array<{ functionName: string; ranges: Array<{ count: number }> }> }> }>("Profiler.takePreciseCoverage");
await post("Profiler.stopPreciseCoverage");
session.disconnect();

const staticsCalls = coverage.result.flatMap((script) => script.functions.filter((fn) => fn.functionName === "readStatics" && script.url.includes("/vm/program.ts")).map((fn) => fn.ranges[0]?.count ?? 0));
assert.equal(legalReads, 1);
assert.equal(staticsCalls.length, 1, "precise coverage found one `readStatics` function");
console.log(JSON.stringify({
  head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  engine: "rules", revision: 7, viewer: "p1", legalReads,
  staticsCalls: staticsCalls[0],
  snapshotHash: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
}));
