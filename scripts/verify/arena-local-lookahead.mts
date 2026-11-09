/**
 * The offline worker with the lookahead difficulties (owner's request, 8 Nov 2026), without a
 * browser. The worker half of `scripts/verify/arena-lookahead.mts`.
 *
 *  1. A Hard match: the page asks for `difficulty: "hard"`, the journal records the policy version
 *     `…+look1-hard`, every AI decision is committed and shown one at a time, and the match plays
 *     on (human moves and AI advances) without a refusal.
 *  2. Resume: the saved journal is replayed WITHOUT searching again (`replayPolicy`), and gives the
 *     identical board, trace and AI memory; the page's resume check accepts the recorded version.
 *  3. Refusals: a start whose policy version does not match its difficulty, an unknown difficulty
 *     (the protocol), and a journal whose policy version this worker does not play.
 *
 *   npx tsx scripts/verify/arena-local-lookahead.mts
 */
import assert from "node:assert/strict";
import { LOCAL_POLICY_VERSION, memoryJournalStore, policyVersionFor, difficultyOfVersion } from "../../src/lib/arena/local/worker.ts";
import { parseRequest, LOCAL_PROTOCOL, LOCAL_PROTOCOL_VERSION } from "../../src/lib/arena/local/protocol.ts";
import { LocalSessionError, LocalWorkerSession } from "../../src/components/arena/session/local.ts";
import { canonicalJson } from "../../src/lib/arena/replay-core.ts";
import { stableJson } from "../../src/lib/arena/policy/contract.ts";
import { humanPick, requestIds, scriptedStart } from "./arena-local-worker-driver.ts";
import { inProcessChannel } from "./arena-local-worker-channel.ts";
import { GAME_ID, LOCAL_REVISION, stagedPack } from "./arena-local-worker-fixture.mts";

const t0 = performance.now();
const pack = await stagedPack();
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

assert.equal(difficultyOfVersion(LOCAL_POLICY_VERSION), null, "the plain heuristic's version names no difficulty");
assert.equal(difficultyOfVersion(policyVersionFor("hard")), "hard");
assert.equal(difficultyOfVersion(policyVersionFor("normal")), "normal");
assert.equal(difficultyOfVersion(`${LOCAL_POLICY_VERSION}+look0-hard`), undefined, "another lookahead version is not played");

// 1. A Hard match, played for a while.
const store = memoryJournalStore();
const ch = inProcessChannel({ store });
const ids = requestIds(0x10a);
const session = await LocalWorkerSession.start(ch.port, scriptedStart(pack, "match-hard", { difficulty: "hard", human: "p1" }), { newRequestId: ids, sessionId: "session-hard" });
let humanMoves = 0;
let advances = 0;
for (let round = 0; round < 400 && session.snapshot!.game.status !== "over" && humanMoves < 25; round++) {
  const snap = session.snapshot!;
  if (snap.decision?.actor === snap.game.you && snap.legal.length) {
    await session.act(humanPick(snap), session.revision, ids());
    humanMoves++;
  } else {
    await session.advance(6);
    advances++;
  }
}
const ins = ch.host.inspect()!;
assert.equal(ins.journal.policyVersion, policyVersionFor("hard"), "the journal records the Hard policy");
const aiEntries = ins.journal.entries.filter((e) => e.kind === "ai").length;
assert.ok(aiEntries >= 10 && humanMoves >= 10, `a real stretch of a match (${humanMoves} human moves, ${aiEntries} AI decisions)`);
{
  let previous = 0;
  let largest = 0;
  for (const m of ch.posted) {
    if (m.type === "snapshot") largest = Math.max(largest, m.revision - previous);
    if (m.type === "result" || m.type === "snapshot") previous = m.revision;
  }
  assert.equal(largest, 1, "every lookahead decision is committed and shown on its own");
}
const before = { board: canonicalJson(session.snapshot), trace: ins.journal.trace, memory: stableJson(ins.memory), revision: session.revision };
await session.dispose();

// 2. Resume from the journal: replayed without searching, the same game.
const ch2 = inProcessChannel({ store });
const replayStarted = performance.now();
const resumed = await LocalWorkerSession.resume(ch2.port, { matchId: "match-hard", gameId: GAME_ID, pack: clone(pack), interpreterRevision: LOCAL_REVISION, policyVersion: policyVersionFor("hard") }, { newRequestId: ids, sessionId: "session-hard-2" });
const replayMs = performance.now() - replayStarted;
const ins2 = ch2.host.inspect()!;
assert.equal(resumed.revision, before.revision, "the resumed match is at the same revision");
assert.equal(ins2.journal.trace, before.trace, "the identical game (trace)");
assert.equal(stableJson(ins2.memory), before.memory, "the AI's memory and RNG are where they were");
assert.equal(canonicalJson(resumed.snapshot), before.board, "the identical board");
// The match goes on after the resume.
const snapBefore = resumed.revision;
if (resumed.snapshot!.game.status !== "over") {
  const snap = resumed.snapshot!;
  if (snap.decision?.actor === snap.game.you && snap.legal.length) await resumed.act(humanPick(snap), resumed.revision, ids());
  else await resumed.advance(1);
  assert.ok(resumed.revision > snapBefore, "and plays on");
}
await resumed.dispose();

// 3. Refusals.
{
  const ch3 = inProcessChannel();
  await assert.rejects(
    LocalWorkerSession.start(ch3.port, scriptedStart(pack, "match-wrong", { difficulty: "hard", policyVersion: LOCAL_POLICY_VERSION }), { newRequestId: ids, sessionId: "session-wrong" }),
    (e: unknown) => e instanceof LocalSessionError && e.code === "policy",
    "a start whose policy version is not its difficulty's is refused",
  );
  const bad = parseRequest({ protocol: LOCAL_PROTOCOL, v: LOCAL_PROTOCOL_VERSION, type: "start", requestId: ids(), ...scriptedStart(pack, "match-x"), sessionId: "session-x", difficulty: "impossible" });
  assert.ok(!bad.ok && bad.message.includes("difficulty"), "an unknown difficulty is malformed");
  // A journal recorded by a policy this worker does not play.
  const doctored = memoryJournalStore();
  const j = clone(store.journals.get("match-hard")!);
  doctored.journals.set("match-hard", { ...j, policyVersion: `${LOCAL_POLICY_VERSION}+look0-hard` });
  const ch4 = inProcessChannel({ store: doctored });
  await assert.rejects(
    LocalWorkerSession.resume(ch4.port, { matchId: "match-hard", gameId: GAME_ID, pack: clone(pack), interpreterRevision: LOCAL_REVISION }, { newRequestId: ids, sessionId: "session-doctored" }),
    (e: unknown) => e instanceof LocalSessionError && e.code === "policy",
    "a journal of another policy version is not continued",
  );
}

console.log(`arena-local-lookahead: ok — ${humanMoves} human moves, ${aiEntries} AI decisions, ${advances} advances; resume replayed ${before.revision - 1} decisions in ${replayMs.toFixed(0)} ms without searching; ${((performance.now() - t0) / 1000).toFixed(0)} s`);
