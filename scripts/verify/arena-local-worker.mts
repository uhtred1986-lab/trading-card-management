/**
 * #652 (plan O3-02): the revisioned local match worker protocol, without a browser.
 *
 * The host (`src/lib/arena/local/worker.ts`) runs behind an in-process channel that clones every
 * message and delivers each as its own macrotask, as a Worker port does; the page client
 * (`src/components/arena/session/local.ts`) plays the human seat from its snapshots
 * (`arena-local-worker-driver.ts`). The pack is the audited SD15/SD5 pair, staged to qualify
 * (`arena-local-worker-fixture.mts`, test-only).
 *
 *   1. A whole match: start, human moves, AI advances in batches, to the end. On the way every
 *      refusal a page can provoke — foreign session, the AI's seat as actor, a stale revision, a
 *      hidden or out-of-date alias, malformed and other-version messages, a duplicate (answered from
 *      its receipt), a conflicting reuse of a request id, a move out of turn — and forged worker
 *      messages the client must ignore (unknown request, other session, older revision, other game,
 *      other version, extra field). After each, the host's journal is byte-identical.
 *   2. Every message the host posts: exactly the protocol's field set, and no card instance id the
 *      human may not read (#719); every snapshot equals the projection of the host's state and is
 *      unchanged when the hidden state is permuted (#644's `permutedFor`), with the unconcealed
 *      projection as negative control. Revisions never go back.
 *   3. Cancellation and dispose: the same match with every AI turn cancelled after its first batch
 *      (and once at once), disposed mid-advance and resumed from the journal, ends in the identical
 *      game (final board and trace): dropped batches leave the match, the AI's RNG and the journal
 *      exactly as they were. Late answers after dispose never reach the board.
 *   4. Explicit failure: an unqualified pack (open blockers, unread mechanics), another interpreter
 *      revision, another policy version, a tampered or unknown-format pack, an unknown deck, a busy
 *      worker, and for resume an unknown match, another pack, a doctored journal (policy version,
 *      a changed AI decision). An AI that meets a question it cannot answer stops the session as
 *      `interrupted`, reports why, plays nothing and invents no outcome.
 *   5. Boundary: the worker entry's import graph is the offline pack runtime's (no database,
 *      catalog source, provider, Node builtin, package, `process.env`); the page
 *      client reaches no engine at all; sabotaged copies prove both checks bite.
 *
 *   npx tsx scripts/verify/arena-local-worker.mts      (part of `npm test`; about 30 s)
 * The real-Worker half: `npm run arena:local-worker-browser` (needs Chrome).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { checkImportGraph, diskRead, offlinePackRule } from "../lib/import-graph.ts";
import { LOCAL_POLICY_VERSION, memoryJournalStore, type LocalMatchHost, type MatchJournal } from "../../src/lib/arena/local/worker.ts";
import { LOCAL_PROTOCOL, LOCAL_PROTOCOL_VERSION, parseResponse, type LocalResponse } from "../../src/lib/arena/local/protocol.ts";
import { LocalSessionError, LocalWorkerSession, type LocalNewMatch } from "../../src/components/arena/session/local.ts";
import { projectSnapshot } from "../../src/lib/arena/browser.ts";
import { interruptingPolicy, stableJson } from "../../src/lib/arena/policy/contract.ts";
import { canonicalJson, replayHash } from "../../src/lib/arena/replay-core.ts";
import { hiddenFrom, permutedFor, strings } from "./arena-policy-permute.ts";
import { humanPick, rawChannel, requestIds, runScripted, scriptedStart } from "./arena-local-worker-driver.ts";
import { inProcessChannel } from "./arena-local-worker-channel.ts";
import { auditPack, GAME_ID, LOCAL_REVISION, OTHER_REVISION, stagedPack, withheldCostsPack } from "./arena-local-worker-fixture.mts";
import type { Snapshot } from "../../src/lib/arena/snapshot-core.ts";

const ROOT = process.cwd();
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const env = { protocol: LOCAL_PROTOCOL, v: LOCAL_PROTOCOL_VERSION };
const quantile = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))] : 0; };

const t0 = performance.now();
const pack = await stagedPack();
const startInput = (matchId: string, extra: Partial<LocalNewMatch> = {}) => scriptedStart(pack, matchId, extra);

// ── 2. The leak audit, run on every message the host posts ─────────────────────────────────────
const audit = { messages: 0, snapshots: 0, permuted: 0, nontrivial: 0, controls: 0, lastRevision: new Map<string, number>() };
let salt = 1;
function auditMessage(message: LocalResponse, host: LocalMatchHost): void {
  audit.messages++;
  const parsed = parseResponse(message);
  assert.ok(parsed.ok, `every message is exactly the protocol's (${parsed.ok ? "" : parsed.message})`);
  const keys = strings(message).keys;
  for (const k of ["aiMemory", "receipts", "entries", "policySeed", "journal", "rng"]) assert.ok(!keys.has(k), `no message carries the worker's ${k}`);
  const m = message as LocalResponse & { sessionId?: string | null; revision?: number; snapshot?: Snapshot | null };
  if (m.sessionId && typeof m.revision === "number" && m.type !== "error") {
    const last = audit.lastRevision.get(m.sessionId) ?? 0;
    assert.ok(m.revision >= last, `revisions never go back (${m.sessionId}: ${last} then ${m.revision})`);
    audit.lastRevision.set(m.sessionId, m.revision);
  }
  const ins = host.inspect();
  if (!ins) return;
  const hidden = hiddenFrom(ins.match.state, ins.human);
  const seen = strings(message);
  const leaked = [...hidden].filter((id) => seen.values.has(id) || seen.keys.has(id));
  assert.deepEqual(leaked, [], `a ${message.type} message names cards ${ins.human} may not read`);
  if (!m.snapshot) return;
  audit.snapshots++;
  assert.equal(m.snapshot.game.revision, ins.revision, "a posted snapshot is of the host's current revision");
  assert.equal(canonicalJson(m.snapshot), canonicalJson(ins.project(ins.match)), "a posted snapshot is the projection of the host's state");
  if (audit.snapshots % 3 !== 1) return; // every third: the permutation costs a projection
  const twin = permutedFor(ins.match, ins.human, salt++);
  if (canonicalJson(twin.state) !== canonicalJson(ins.match.state)) audit.nontrivial++;
  assert.equal(canonicalJson(ins.project(twin)), canonicalJson(m.snapshot), `revision ${ins.revision}: a permuted hidden state changes the human's board`);
  audit.permuted++;
  const raw = (match: typeof ins.match) => canonicalJson(projectSnapshot(match, ins.human, { id: GAME_ID, revision: ins.revision, mode: "sparring", unconcealedForProof: true }));
  if (raw(ins.match) !== raw(twin)) audit.controls++;
}

/** After a refusal the journal is exactly what it was at that revision. */
function journalGuard(host: () => LocalMatchHost) {
  const at = new Map<number, string>();
  let checked = 0;
  return {
    get checked() { return checked; },
    unchanged: (what: string, session: LocalWorkerSession) => {
      const ins = host().inspect();
      assert.ok(ins, `${what}: the session is still there`);
      assert.equal(ins.revision, session.revision, `${what}: the host is where the board is`);
      assert.equal(ins.journal.entries.length, ins.revision - 1, `${what}: one journal entry per revision`);
      const text = stableJson({ ...ins.journal, receipts: ins.journal.receipts.length });
      const before = at.get(ins.revision);
      if (before !== undefined) assert.equal(text, before, `${what}: the journal did not change`);
      at.set(ins.revision, text);
      checked++;
    },
  };
}

// ── 1. A whole match, with every refusal on the way ─────────────────────────────────────────────
const aiMs: number[] = [];
const chA = inProcessChannel({ observe: (e) => aiMs.push(e.ms), onPost: auditMessage });
const guardA = journalGuard(() => chA.host);
const runA = await runScripted("a", chA.port, chA.inject, pack, { unchanged: guardA.unchanged, clock: () => performance.now() });
const sessionA = runA.session;
assert.equal(sessionA.policyVersion, LOCAL_POLICY_VERSION, "the worker announces its policy version");
const opened = chA.posted.find((m) => m.type === "result");
assert.ok(opened?.type === "result" && opened.revision === 1 && opened.snapshot?.game.you === "p1" && opened.snapshot.game.id === GAME_ID, "a new match is at revision 1, drawn for the human seat, under the page's game id");
assert.equal(runA.final.game.status, "over", `the scripted match ends (${runA.humanMoves} human moves, ${runA.aiDecisions} AI decisions)`);
assert.ok(runA.final.over, "with a recorded outcome");
assert.ok(runA.humanMoves >= 10 && runA.aiDecisions >= 20, `a real match: ${runA.humanMoves} human moves, ${runA.aiDecisions} AI decisions`);
assert.ok(runA.checks.length >= 15, `the abuse checks ran (${runA.checks.length})`);
for (let i = 1; i < runA.watched.length; i++) assert.ok(runA.watched[i] > runA.watched[i - 1], "the board's watcher sees strictly increasing revisions");
const journalA = chA.host.inspect()!.journal;
const memoryA = stableJson(chA.host.inspect()!.memory);
assert.equal(journalA.entries.length + 1, runA.final.game.revision, "every revision is one committed decision");
assert.equal(journalA.entries.filter((e) => e.kind === "human").length, runA.humanMoves, "the journal has exactly the human moves the board made (no duplicate, conflict or stale request added one)");
assert.equal(journalA.receipts.length, runA.humanMoves + runA.advances, "one receipt per accepted mutation");
assert.ok(audit.snapshots > 50 && audit.permuted > 15, `snapshots audited: ${audit.snapshots}, permuted: ${audit.permuted}`);
assert.ok(audit.nontrivial > 0 && audit.controls > 0, `the permutations were real (${audit.nontrivial}) and the unconcealed control tells them apart (${audit.controls})`);
assert.ok(sessionA.diagnostics.ignored.some((x) => x.includes("not pending")), "answers to the raw requests never reached the board");
{
  let previous = 0;
  let largest = 0;
  for (const m of chA.posted) {
    if (m.type !== "result" && m.type !== "snapshot") continue;
    if (m.type === "snapshot") largest = Math.max(largest, m.revision - previous);
    previous = m.revision;
  }
  assert.ok(largest >= 1 && largest <= 4, `no AI batch commits more than its bound of 4 (largest ${largest})`);
}
const streamA = await replayHash(chA.posted);
await sessionA.dispose();

// ── 3. The same match, cancelled and disposed on the way, resumed from the journal ───────────────
{
  const ch = inProcessChannel({ onPost: auditMessage });
  const guard = journalGuard(() => ch.host);
  const run = await runScripted("b", ch.port, ch.inject, pack, { unchanged: guard.unchanged });
  assert.equal(canonicalJson(run.final), canonicalJson(runA.final), "in batches of 1 instead of 4, cancelled, disposed and resumed, the match ends in the identical board");
  assert.equal(ch.host.inspect()!.journal.trace, journalA.trace, "and the identical game (trace of every decision and its events)");
  assert.deepEqual(ch.host.inspect()!.journal.entries.map((e) => (e.kind === "ai" ? e.id : stableJson(e.action))), journalA.entries.map((e) => (e.kind === "ai" ? e.id : stableJson(e.action))), "decision for decision");
  assert.equal(stableJson(ch.host.inspect()!.memory), memoryA, "the AI's memory and RNG end where they would have");
  assert.ok(run.cancelsHonoured >= 2, `cancels dropped batches (${run.cancelsHonoured})`);
  assert.ok(run.disposed, "the session was disposed mid-advance and resumed");
  const cancelled = ch.posted.filter((m) => m.type === "error" && m.code === "cancelled");
  assert.ok(cancelled.length >= run.cancelsHonoured, "each dropped batch was answered as cancelled");
  assert.ok(ch.posted.some((m) => m.type === "error" && m.code === "cancelled" && m.sessionId === "session-b" && m.message.includes("dropped")), "the advance running at dispose was dropped, and its late answer posted");
  assert.ok(run.first.diagnostics.ignored.some((x) => x.includes("not pending") || x.includes("after dispose")), "and the disposed client ignored it");
  assert.ok(guard.checked >= 2, `the journal was checked after the cancels (${guard.checked})`);
  await run.session.dispose();
}
// An advance cancelled before its first batch commits keeps the RNG: compare the memory directly.
{
  const ch = inProcessChannel();
  const ids = requestIds(0xd);
  const session = await LocalWorkerSession.start(ch.port, startInput("match-d", { human: "p2" }), { newRequestId: ids, sessionId: "session-d" });
  while (session.snapshot!.decision?.actor === "p2" && session.snapshot!.legal.length) await session.act(humanPick(session.snapshot!), session.revision, ids());
  const before = stableJson(ch.host.inspect()!.journal);
  const running = session.advanceRaw();
  const cancelled = await session.cancel();
  const answer = await running;
  assert.ok(cancelled && !answer.ok && answer.code === "cancelled", "an advance cancelled at once is dropped before it commits");
  assert.equal(stableJson(ch.host.inspect()!.journal), before, "the journal, the match and the AI's memory are exactly as before");
  const again = await session.advanceRaw();
  assert.ok(again.ok, "the next advance plays");
  await session.dispose();
}

// ── 4. Explicit failure ──────────────────────────────────────────────────────────────────────────
async function refused(input: LocalNewMatch, code: string, reason: RegExp, what: string) {
  const ch = inProcessChannel({ onPost: auditMessage });
  const error = await LocalWorkerSession.start(ch.port, input, { newRequestId: requestIds(0xe) }).then(() => null, (e: unknown) => e);
  assert.ok(error instanceof LocalSessionError, `${what}: refused (${String(error)})`);
  assert.equal(error.code, code, `${what}: as ${code} (${error.message})`);
  assert.ok(reason.test(`${error.message}\n${error.reasons.join("\n")}`), `${what}: names why (${error.message}; ${error.reasons.join("; ")})`);
  assert.equal(ch.host.inspect(), null, `${what}: no session exists`);
  assert.ok(!ch.posted.some((m) => m.type === "snapshot" || (m.type === "result" && m.snapshot)), `${what}: no board was sent`);
  return error;
}
const audited = await auditPack();
const unplayable = await refused(startInput("x", { pack: audited }), "unplayable", /blocker U1 .*#651/, "the audited pack as it is today");
// Since #728 no program of the pair holds an unread clause (`arena-offline-pack.mts` stages one to
// name that reason), and the owner supplied the Unison costs (migration 0049, #733): what keeps the
// audited pack unplayable is its open blockers alone.
assert.ok(!unplayable.reasons.some((r) => /unresolved mechanic/.test(r)), "no unread mechanic is left (#728)");
assert.ok(!unplayable.reasons.some((r) => /missing input/.test(r)), "the audited pack has no missing input");
assert.ok(unplayable.reasons.every((r) => /^blocker U\d /.test(r)), `only open blockers are named: ${unplayable.reasons.join("; ")}`);
const withheld = await refused(startInput("x", { pack: await withheldCostsPack() }), "unplayable", /missing input/, "the pack without the owner's Unison costs");
assert.ok(withheld.reasons.some((r) => /missing input: DB3-001 specifiedCost/.test(r)), "a missing input is a named reason");
await refused(startInput("x", { interpreterRevision: OTHER_REVISION }), "runtime", /interpreter/, "another interpreter revision");
await refused(startInput("x", { pack: { ...clone(pack), format: 99 } }), "unplayable", /unsupported pack format 99/, "an unknown pack format");
{
  const tampered = clone(pack);
  tampered.bundle.payload.defs["SD15-03"].power = 99999;
  await refused(startInput("x", { pack: tampered }), "unplayable", /content-hash/, "a tampered pack");
}
await refused(startInput("x", { decks: { p1: "A", p2: "Z" } }), "unplayable", /no deck Z/, "an unknown deck");
{
  // Another policy version: the client refuses before sending, and the worker refuses it raw.
  await refused(startInput("x", { policyVersion: "main0+combat0+choices0" }), "policy", /main0/, "another policy version (client)");
  const ch = inProcessChannel();
  const raw = rawChannel(ch.port);
  const id = requestIds(0xf)();
  const a = await raw.send({ ...env, type: "start", requestId: id, ...startInput("x", { policyVersion: "main9+combat1+choices1" }), sessionId: "s" }, id);
  assert.ok(a.type === "error" && a.code === "policy", "another policy version (worker)");
  // A busy worker: one match per worker.
  const ok = await LocalWorkerSession.start(ch.port, startInput("busy-1"), { newRequestId: requestIds(0x10), sessionId: "busy-1", awaitReady: false });
  const second = await LocalWorkerSession.start(ch.port, startInput("busy-2"), { newRequestId: requestIds(0x11), sessionId: "busy-2", awaitReady: false }).then(() => null, (e: LocalSessionError) => e);
  assert.equal(second?.code, "busy", "a second match on a worker that owns one is refused");
  assert.equal(ch.host.inspect()?.sessionId, "busy-1", "and the first is untouched");
  await ok.dispose();
}
{
  // Resume: unknown match, another pack, another revision, a doctored journal.
  const store = memoryJournalStore();
  const ch = inProcessChannel({ store });
  const ids = requestIds(0x12);
  const s = await LocalWorkerSession.start(ch.port, startInput("saved"), { newRequestId: ids, sessionId: "saved-1" });
  for (let i = 0; i < 6 && s.snapshot!.game.status !== "over"; i++) {
    if (s.snapshot!.decision?.actor === "p1" && s.snapshot!.legal.length) await s.act(humanPick(s.snapshot!), s.revision, ids());
    else await s.advanceRaw();
  }
  const savedRevision = s.revision;
  await s.dispose();
  const resume = (input: Partial<{ matchId: string; pack: unknown; interpreterRevision: string }>, sessionId: string) =>
    LocalWorkerSession.resume(ch.port, { matchId: "saved", gameId: GAME_ID, pack: clone(pack), interpreterRevision: LOCAL_REVISION, ...input }, { newRequestId: ids, sessionId, awaitReady: false }).then(() => null, (e: LocalSessionError) => e);
  assert.equal((await resume({ matchId: "nothing-saved" }, "r1"))?.code, "journal", "an unknown match");
  const restart = await LocalWorkerSession.start(ch.port, startInput("saved"), { newRequestId: ids, sessionId: "r0", awaitReady: false }).then(() => null, (e: LocalSessionError) => e);
  assert.equal(restart?.code, "journal", "a new match under a saved match's id is refused, not overwritten");
  assert.equal((await resume({ pack: audited }, "r2"))?.code, "journal", "another pack");
  assert.equal((await resume({ interpreterRevision: OTHER_REVISION }, "r3"))?.code, "runtime", "another interpreter revision");
  const good = store.journals.get("saved")!;
  store.journals.set("saved", { ...clone(good), policyVersion: "main0+combat1+choices1" });
  assert.equal((await resume({}, "r4"))?.code, "policy", "a journal recorded under another policy version");
  const doctored: MatchJournal = clone(good);
  const k = doctored.entries.findIndex((e) => e.kind === "ai");
  doctored.entries[k] = { ...doctored.entries[k], id: "menu:somethingElse" } as MatchJournal["entries"][number];
  store.journals.set("saved", doctored);
  const diverged = await resume({}, "r5");
  assert.equal(diverged?.code, "journal", "a journal whose AI decision was changed does not replay");
  assert.match(diverged!.message, /policy answered/);
  const lostRng: MatchJournal = { ...clone(good), aiMemory: { ...good.aiMemory, rng: { ...good.aiMemory.rng, n: good.aiMemory.rng.n + 1 } } };
  store.journals.set("saved", lostRng);
  assert.equal((await resume({}, "r6"))?.code, "journal", "a journal whose AI RNG state was changed does not resume");
  store.journals.set("saved", good);
  const back = await LocalWorkerSession.resume(ch.port, { matchId: "saved", gameId: GAME_ID, pack: clone(pack), interpreterRevision: LOCAL_REVISION }, { newRequestId: ids, sessionId: "r7", awaitReady: false });
  assert.equal(back.revision, savedRevision, "the untouched journal resumes at its revision");
  await back.dispose();
}
{
  // An AI question the policy cannot answer: interrupted, explicitly, with nothing invented.
  const ch = inProcessChannel({ policy: interruptingPolicy, onPost: auditMessage });
  const ids = requestIds(0x13);
  const reasons: string[] = [];
  const s = await LocalWorkerSession.start(ch.port, startInput("interrupt"), { newRequestId: ids, sessionId: "interrupt", onInterrupted: (r) => reasons.push(r) });
  while (s.snapshot!.decision?.actor === "p1" && s.snapshot!.legal.length) await s.act(humanPick(s.snapshot!), s.revision, ids());
  const before = stableJson(ch.host.inspect()!.journal.entries);
  const at = s.revision;
  const answer = await s.advanceRaw();
  assert.ok(!answer.ok && answer.code === "interrupted", `the advance reports the interruption (${answer.ok ? "ok" : answer.code})`);
  assert.ok(!answer.ok && answer.reasons?.some((r) => /unsupported decision/.test(r)), "with its reason");
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(reasons.length === 1 && /unsupported decision/.test(reasons[0]), "the page hears the interruption");
  assert.equal(s.status, "interrupted");
  assert.equal(s.revision, at, "no move was played");
  assert.equal(stableJson(ch.host.inspect()!.journal.entries), before, "nothing was journalled");
  assert.equal(s.snapshot!.over, null, "and no outcome was invented");
  assert.equal(ch.host.inspect()!.journal.status, "interrupted", "the journal records the interruption");
  const again = await s.advanceRaw();
  assert.ok(!again.ok && again.code === "interrupted", "a later advance is refused the same way");
  await s.dispose();
}

{
  // A worker of another protocol version: the page refuses it, and nothing waits on it forever.
  const fakeWorker = (answer: (message: Record<string, unknown>) => unknown, hello: unknown) => {
    const listeners: ((e: { data: unknown }) => void)[] = [];
    const port = {
      postMessage: (m: unknown) => { const a = answer(m as Record<string, unknown>); if (a) setTimeout(() => listeners.forEach((l) => l({ data: a })), 0); },
      addEventListener: ((type: string, l: (e: { data: unknown }) => void) => { if (type === "message") listeners.push(l); }) as never,
    };
    setTimeout(() => listeners.forEach((l) => l({ data: hello })), 0);
    return port;
  };
  const newer = fakeWorker(() => null, { ...env, v: 2, type: "ready", policyVersion: LOCAL_POLICY_VERSION });
  const refusedNewer = await LocalWorkerSession.start(newer, startInput("v2"), { newRequestId: requestIds(0x14) }).then(() => null, (e: LocalSessionError) => e);
  assert.equal(refusedNewer?.code, "version", "a worker announcing protocol version 2 is refused at start");
  // A worker that announces v1 and then answers in v2: the request fails as `version`, not by hanging.
  const drifting = fakeWorker((m) => ({ ...env, v: 2, type: "result", requestId: m.requestId, sessionId: m.sessionId, ok: true, revision: 1, status: "playing", snapshot: null }), { ...env, type: "ready", policyVersion: LOCAL_POLICY_VERSION });
  const refusedDrift = await LocalWorkerSession.start(drifting, startInput("v2b"), { newRequestId: requestIds(0x15) }).then(() => null, (e: LocalSessionError) => e);
  assert.equal(refusedDrift?.code, "version", "an answer in another protocol version fails the request as version");
}

// ── 5. Boundary ──────────────────────────────────────────────────────────────────────────────────
{
  const entry = path.join(ROOT, "src/lib/arena/local/worker-entry.ts");
  const real = checkImportGraph(entry, ROOT, diskRead, { forbidFile: offlinePackRule });
  for (const v of real.violations) console.error(`  forbidden from worker-entry.ts: ${v.file}: ${v.reason}`);
  assert.equal(real.violations.length, 0, "the worker entry reaches no forbidden import");
  for (const needed of ["src/lib/arena/local/worker.ts", "src/lib/arena/local/protocol.ts", "src/lib/arena/local/pack.ts", "src/lib/arena/browser.ts", "src/lib/arena/policy/boundary.ts", "src/lib/arena/policy/combat.ts", "src/lib/arena/conceal.ts"]) {
    assert.ok(real.files.includes(needed), `the walker followed the worker entry into ${needed}`);
  }
  const workerPath = path.join(ROOT, "src/lib/arena/local/worker.ts");
  for (const [extra, expected] of [
    [`import { db } from "@/db";`, "server-only import @/db"],
    [`import { runAi } from "@/lib/ai/run";`, "server-only import @/lib/ai/run"],
    [`import { rulesFor } from "../rules-store";`, "server-side card source import src/lib/arena/rules-store.ts"],
    [`export const rev = process.env.VERCEL_GIT_COMMIT_SHA;`, "process.env lookup"],
    [`import { readFileSync } from "node:fs";`, "package or builtin import node:fs"],
  ] as const) {
    const read = (file: string) => (file === workerPath ? `${fs.readFileSync(workerPath, "utf8")}\n${extra}\n` : diskRead(file));
    const caught = checkImportGraph(entry, ROOT, read, { forbidFile: offlinePackRule });
    assert.ok(caught.violations.some((v) => v.file === "src/lib/arena/local/worker.ts" && v.reason === expected), `adding \`${extra}\` to worker.ts is caught as "${expected}"`);
  }
  // The page client holds no engine: nothing of src/lib/arena but the protocol in its value graph.
  const client = path.join(ROOT, "src/components/arena/session/local.ts");
  const engineFree = (read = diskRead) => {
    const g = checkImportGraph(client, ROOT, read);
    return { violations: g.violations, arena: g.files.filter((f) => f.startsWith("src/lib/") && f !== "src/lib/arena/local/protocol.ts") };
  };
  const clean = engineFree();
  assert.deepEqual(clean.violations, [], "the client has no runtime dependency");
  assert.deepEqual(clean.arena, [], "the client's value graph reaches no engine, policy or pack module");
  const doctored = engineFree((file) => (file === client ? `${fs.readFileSync(client, "utf8")}\nimport { projectSnapshot } from "@/lib/arena/browser";\n` : diskRead(file)));
  assert.ok(doctored.arena.includes("src/lib/arena/browser.ts"), "an engine import into the client would be caught");
  const protocolGraph = checkImportGraph(path.join(ROOT, "src/lib/arena/local/protocol.ts"), ROOT, diskRead);
  assert.deepEqual(protocolGraph.files, ["src/lib/arena/local/protocol.ts"], "the protocol imports nothing at runtime");
}


console.log(`arena-local-worker: ok — staged SD15/SD5 pack ${pack.hash.slice(0, 12)}…, match of ${runA.final.game.revision - 1} decisions (${runA.humanMoves} human, ${runA.aiDecisions} AI in ${runA.advances} advances) to turn ${runA.final.game.turn}, trace ${journalA.trace}`);
console.log(`  ${runA.checks.length} refusals checked with the journal unchanged; ${audit.messages} messages audited, ${audit.snapshots} snapshots, ${audit.permuted} permuted (${audit.nontrivial} nontrivial, control ${audit.controls}); message stream ${streamA.slice(0, 16)}…`);
console.log(`  Node, in-process: AI decision p50 ${quantile(aiMs, 0.5).toFixed(1)} / p95 ${quantile(aiMs, 0.95).toFixed(1)} / max ${Math.max(...aiMs).toFixed(1)} ms (n=${aiMs.length}); human act round trip p50 ${quantile(runA.actMs, 0.5).toFixed(1)} / p95 ${quantile(runA.actMs, 0.95).toFixed(1)} ms; total ${((performance.now() - t0) / 1000).toFixed(1)} s`);
