/** Durable Arena advance leases and crash recovery on the shared PGlite DB. */
import assert from "node:assert/strict";
import { desc, eq } from "drizzle-orm";
import type { Db } from "../../src/db/index.ts";
import { aiRuns, aiSettings, arenaAdvanceCalls, arenaAiUsage, arenaDecisions, arenaGames, cards, deckCards, decks } from "../../src/db/schema.ts";
import { claimAdvance, failAdvance, finishAdvance, markProviderAttempt, saveAdvanceCheckpoint } from "../../src/lib/arena/ai/advance-lease.ts";
import { recordedMove } from "../../src/lib/arena/ai/opponent.ts";
import { createFakeProvider } from "../../src/lib/ai/providers/fake.ts";
import { recordDecision } from "../../src/lib/arena/ai/debug.ts";
import { accountArenaUsage, advance } from "../../src/lib/arena/ai/run.ts";
import { applyToGame, loadGame, startGame } from "../../src/lib/arena/games.ts";
import { readFileSync } from "node:fs";
import type { AiSettings } from "../../src/lib/ai/settings.ts";

export async function verifyArenaAdvanceLeases(db: Db): Promise<void> {
  // Loaded dynamically, the way the feature code and the other DB fixtures load them: a static import from
  // this .mts can resolve to a second copy of the provider registry/settings loader (tsx 4.23, Node 22), so
  // registerProvider() would never reach the router that advance() uses.
  const { registerProvider, resetProviders } = await import("../../src/lib/ai/providers/index.ts");
  const { forgetAvailability } = await import("../../src/lib/ai/router.ts");
  const { loadSettings, readSettingsFromDatabase, saveSettings } = await import("../../src/lib/ai/settings-db.ts");
  const { setSettingsLoader } = await import("../../src/lib/ai/settings.ts");
  const [normal] = await db.insert(arenaGames).values({ p1Name: "Lease P1", p2Name: "Lease AI", seed: 566, mode: "sparring", state: { prompt: { kind: "main", player: "p2" } } }).returning({ id: arenaGames.id });
  let providerCalls = 0;
  const fake = createFakeProvider({ id: "arena-advance-test", script: [{ json: { move: 0, say: "Recovered." }, usage: { input: 11, output: 3 } }] });
  const hasResult = async (callId: string) => !!(await db.select({ id: aiRuns.id }).from(aiRuns).where(eq(aiRuns.arenaCallId, callId)).limit(1))[0];

  // Two independent advance requests contend on one revision. Only the winner
  // can cross the durable pre-provider fence and invoke the fake provider.
  const [first, second] = await Promise.all([
    claimAdvance(db, normal.id, 0, hasResult),
    claimAdvance(db, normal.id, 0, hasResult),
  ]);
  const winner = first.kind === "claimed" ? first : second.kind === "claimed" ? second : null;
  assert.ok(winner, `one concurrent request owns the revision lease (${JSON.stringify([first, second])})`);
  assert.deepEqual([first.kind, second.kind].sort(), ["busy", "claimed"].sort());
  if (winner) {
    await markProviderAttempt(db, winner);
    await fake.generate({} as never);
    providerCalls = fake.requests.length;
    await saveAdvanceCheckpoint(db, winner, { kind: "move", index: 1, action: { type: "pass", player: "p2" }, say: "Ready.", how: "chosen by Claude", spend: { model: "fake", provider: "fake", input: 2, output: 1, cached: 0 } });
    const decision = { gameId: normal.id, arenaCallId: winner.callId, turn: 1, phase: "main", promptKind: "main", player: "p2", kind: "move" as const, decidedBy: "claude" as const, how: "chosen by Claude", chosenIndex: 1, chosenLabel: "second" };
    await recordDecision(db, decision);
    await recordDecision(db, decision);
    await finishAdvance(db, winner);
  }
  assert.equal(providerCalls, 1, "normal competing advances start one provider call");
  assert.equal(fake.requests.length, 1, "the fake provider receives one request for two competing advances");
  assert.equal((await db.select().from(arenaDecisions).where(eq(arenaDecisions.arenaCallId, winner!.callId))).length, 1, "replaying a checkpoint does not duplicate its decision projection");
  const [normalRow] = await db.select().from(arenaAdvanceCalls).where(eq(arenaAdvanceCalls.gameId, normal.id));
  assert.equal(normalRow.phase, "applied");
  assert.equal((await claimAdvance(db, normal.id, 0, hasResult)).kind, "applied", "a finished revision is not replayed");

  // A provider result durably written to ai_runs is recovered under the same
  // stable call id after an expired lease, without invoking the fake again.
  const [recover] = await db.insert(arenaGames).values({ p1Name: "Recover P1", p2Name: "Recover AI", seed: 567, mode: "sparring", state: { prompt: { kind: "main", player: "p2" } } }).returning({ id: arenaGames.id });
  const attempted = await claimAdvance(db, recover.id, 0, hasResult);
  assert.equal(attempted.kind, "claimed");
  if (attempted.kind !== "claimed") throw new Error("recovery fixture did not get a lease");
  await markProviderAttempt(db, attempted);
  await fake.generate({} as never);
  providerCalls = fake.requests.length;
  await db.insert(aiRuns).values({
    kind: "arena_move",
    arenaCallId: attempted.callId,
    model: "fake-model",
    provider: "fake",
    billed: true,
    input: {
      arena: {
        gameId: recover.id,
        callId: attempted.callId,
        revision: 0,
        selectedIndex: 0,
        selectedAction: { type: "pass", player: "p2" },
      },
    },
    output: { move: 0, say: "Recovered." },
    inputTokens: 11,
    outputTokens: 3,
    cacheReadTokens: 1,
    cacheCreationTokens: 0,
    costMicros: 0,
  });
  // The worker may throw after recordRun persisted the provider response but
  // before it checkpointed/applied the choice. Keep it fenced as attempted;
  // recovery must read ai_runs instead of making a second provider call.
  await failAdvance(db, attempted, true);
  const [failedAfterRecord] = await db.select().from(arenaAdvanceCalls).where(eq(arenaAdvanceCalls.gameId, recover.id));
  assert.equal(failedAfterRecord.phase, "attention", "an attempted request remains fenced after a post-recording failure");
  const resumed = await claimAdvance(db, recover.id, 0, hasResult, new Date(Date.now() + 120_000));
  assert.equal(resumed.kind, "claimed", "a stored result permits safe recovery from attention state");
  if (resumed.kind !== "claimed") throw new Error("stored result was not recoverable");
  assert.equal(resumed.callId, attempted.callId, "retry keeps the original provider call identity");
  const reloadedLegal = [
    { label: "now first, old second", action: { type: "endMain", player: "p2" } },
    { label: "now second, old first", action: { type: "pass", player: "p2" } },
  ];
  const recoveredChoice = await recordedMove(db, resumed.callId, reloadedLegal as never);
  assert.deepEqual(recoveredChoice && [recoveredChoice.index, recoveredChoice.say, recoveredChoice.spend?.input], [1, "Recovered.", 11], "resume follows the persisted semantic action after the legal menu is reordered");
  await assert.rejects(
    recordedMove(db, resumed.callId, [{ label: "different action at old index", action: { type: "endMain", player: "p2" } }] as never),
    /no longer legal/,
    "a changed legal menu cannot reinterpret a provider's old index as a different move",
  );
  await saveAdvanceCheckpoint(db, resumed, { kind: "move", index: recoveredChoice!.index, action: reloadedLegal[recoveredChoice!.index].action as never, say: recoveredChoice!.say, how: recoveredChoice!.how, spend: recoveredChoice!.spend });
  const afterCheckpointCrash = await claimAdvance(db, recover.id, 0, hasResult, new Date(Date.now() + 240_000));
  assert.equal(afterCheckpointCrash.kind, "claimed", "a durable checkpoint can be reclaimed after its lease expires");
  if (afterCheckpointCrash.kind !== "claimed") throw new Error("durable checkpoint did not resume");
  assert.deepEqual(afterCheckpointCrash.checkpoint && [afterCheckpointCrash.checkpoint.kind, afterCheckpointCrash.checkpoint.kind === "move" ? afterCheckpointCrash.checkpoint.index : -1, afterCheckpointCrash.checkpoint.kind === "move" ? afterCheckpointCrash.checkpoint.action : null], ["move", 1, { type: "pass", player: "p2" }], "the original semantic action survives worker restart");
  await accountArenaUsage(db, { gameId: recover.id, callId: afterCheckpointCrash.callId, revision: 0 }, recoveredChoice!.spend!);
  await accountArenaUsage(db, { gameId: recover.id, callId: afterCheckpointCrash.callId, revision: 0 }, recoveredChoice!.spend!);
  const [recoveredGame] = await db.select().from(arenaGames).where(eq(arenaGames.id, recover.id));
  assert.equal(recoveredGame.aiCalls, 1, "resuming the stored result accounts the provider charge once");
  assert.equal((await db.select().from(arenaAiUsage).where(eq(arenaAiUsage.callId, resumed.callId))).length, 1, "the stable usage receipt survives a recovery retry");
  await finishAdvance(db, afterCheckpointCrash);
  assert.equal(providerCalls, 2, "checkpoint recovery did not make another provider call");

  // An expired attempt with no durable answer is explicitly blocked. Repeated
  // requests cannot turn ambiguity into an automatic second charge.
  const [unknown] = await db.insert(arenaGames).values({ p1Name: "Unknown P1", p2Name: "Unknown AI", seed: 568, mode: "sparring", state: { prompt: { kind: "main", player: "p2" } } }).returning({ id: arenaGames.id });
  const uncertain = await claimAdvance(db, unknown.id, 0, hasResult);
  assert.equal(uncertain.kind, "claimed");
  if (uncertain.kind !== "claimed") throw new Error("unknown-outcome fixture did not get a lease");
  await markProviderAttempt(db, uncertain);
  await fake.generate({} as never);
  providerCalls = fake.requests.length;
  const expired = await claimAdvance(db, unknown.id, 0, hasResult, new Date(Date.now() + 120_000));
  assert.equal(expired.kind, "attention", "unknown provider outcome becomes attention-required");
  assert.equal((await claimAdvance(db, unknown.id, 0, hasResult, new Date(Date.now() + 240_000))).kind, "attention", "later retries still do not resend the request");
  const [unknownRow] = await db.select().from(arenaAdvanceCalls).where(eq(arenaAdvanceCalls.gameId, unknown.id));
  assert.equal(unknownRow.phase, "attention");
  assert.equal((await db.select().from(aiRuns).where(eq(aiRuns.arenaCallId, uncertain.callId))).length, 0, "no result was fabricated for an ambiguous request");
  assert.equal(providerCalls, 3, "the unknown attempt is never automatically retried");

  // A late free-choice worker cannot revive its expired claim after a newer
  // owner crossed the provider boundary and the revision became ambiguous.
  const [freeRace] = await db.insert(arenaGames).values({ p1Name: "Free Race P1", p2Name: "Free Race AI", seed: 570, mode: "sparring", state: { prompt: { kind: "main", player: "p2" } } }).returning({ id: arenaGames.id });
  const freeOwner = await claimAdvance(db, freeRace.id, 0, hasResult);
  assert.equal(freeOwner.kind, "claimed");
  if (freeOwner.kind !== "claimed") throw new Error("free-choice fixture did not get its first lease");
  const providerOwner = await claimAdvance(db, freeRace.id, 0, hasResult, new Date(Date.now() + 120_000));
  assert.equal(providerOwner.kind, "claimed", "an expired pre-provider claim can be taken by a new worker");
  if (providerOwner.kind !== "claimed") throw new Error("expired free-choice lease was not reclaimed");
  await markProviderAttempt(db, providerOwner);
  assert.equal((await claimAdvance(db, freeRace.id, 0, hasResult, new Date(Date.now() + 240_000))).kind, "attention");
  await assert.rejects(
    saveAdvanceCheckpoint(db, freeOwner, { kind: "move", index: 0, action: { type: "pass", player: "p2" }, say: null, how: "free rule choice", spend: null }),
    /lease was lost/,
    "an old free-choice owner cannot overwrite a newer ambiguous provider attempt",
  );
  const [freeRaceRow] = await db.select().from(arenaAdvanceCalls).where(eq(arenaAdvanceCalls.gameId, freeRace.id));
  assert.equal(freeRaceRow.phase, "attention", "the rejected late free choice leaves the provider attempt fenced");

  // The original provider owner may recover a late response after expiry, but
  // only when the exact choice and stable call identity were durably recorded.
  const [lateResultGame] = await db.insert(arenaGames).values({ p1Name: "Late Result P1", p2Name: "Late Result AI", seed: 571, mode: "sparring", state: { prompt: { kind: "main", player: "p2" } } }).returning({ id: arenaGames.id });
  const lateOwner = await claimAdvance(db, lateResultGame.id, 0, hasResult);
  assert.equal(lateOwner.kind, "claimed");
  if (lateOwner.kind !== "claimed") throw new Error("late-result fixture did not get a lease");
  await markProviderAttempt(db, lateOwner);
  assert.equal((await claimAdvance(db, lateResultGame.id, 0, async () => false, new Date(Date.now() + 120_000))).kind, "attention");
  const lateSpend = { model: "fake-model", provider: "fake", billed: true, input: 7, output: 2, cached: 0, cacheWrite: 0, costMicros: 0 };
  const lateAction = { type: "pass", player: "p2" };
  await db.insert(aiRuns).values({
    kind: "arena_move",
    arenaCallId: lateOwner.callId,
    model: lateSpend.model,
    provider: lateSpend.provider,
    billed: lateSpend.billed,
    input: { arena: { gameId: lateResultGame.id, callId: lateOwner.callId, revision: 0, selectedIndex: 0, selectedAction: lateAction } },
    output: { move: 0, say: "Late but recorded." },
    inputTokens: lateSpend.input,
    outputTokens: lateSpend.output,
    cacheReadTokens: lateSpend.cached,
    cacheCreationTokens: lateSpend.cacheWrite,
    costMicros: lateSpend.costMicros,
  });
  await saveAdvanceCheckpoint(db, lateOwner, { kind: "move", index: 0, action: lateAction as never, say: "Late but recorded.", how: "chosen by Claude", spend: lateSpend });
  const [lateResultRow] = await db.select().from(arenaAdvanceCalls).where(eq(arenaAdvanceCalls.gameId, lateResultGame.id));
  assert.equal(lateResultRow.phase, "checkpoint", "the matching durable provider response can safely revive attention");
  assert.deepEqual(lateResultRow.checkpoint && (lateResultRow.checkpoint as { action?: unknown }).action, lateAction);

  // An attention transition is conditional. A stale attempt that read an
  // expired row must not report attention after another worker applied it.
  const [attemptTransitionRace] = await db.insert(arenaGames).values({ p1Name: "Transition Race P1", p2Name: "Transition Race AI", seed: 572, mode: "sparring", state: { prompt: { kind: "main", player: "p2" } } }).returning({ id: arenaGames.id });
  const transitionOwner = await claimAdvance(db, attemptTransitionRace.id, 0, hasResult);
  assert.equal(transitionOwner.kind, "claimed");
  if (transitionOwner.kind !== "claimed") throw new Error("attempt-transition fixture did not get a lease");
  await markProviderAttempt(db, transitionOwner);
  let readTransition!: () => void;
  let releaseTransition!: () => void;
  const transitionRead = new Promise<void>((resolve) => { readTransition = resolve; });
  const transitionRelease = new Promise<void>((resolve) => { releaseTransition = resolve; });
  const staleAttentionClaim = claimAdvance(db, attemptTransitionRace.id, 0, async () => {
    readTransition();
    await transitionRelease;
    return false;
  }, new Date(Date.now() + 120_000));
  await transitionRead;
  await db.insert(aiRuns).values({
    kind: "arena_move",
    arenaCallId: transitionOwner.callId,
    model: "fake-model",
    provider: "fake",
    billed: true,
    input: { arena: { gameId: attemptTransitionRace.id, callId: transitionOwner.callId, revision: 0, selectedIndex: 0, selectedAction: { type: "pass", player: "p2" } } },
    output: { move: 0, say: null },
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costMicros: 0,
  });
  await saveAdvanceCheckpoint(db, transitionOwner, { kind: "move", index: 0, action: { type: "pass", player: "p2" }, say: null, how: "chosen by Claude", spend: { model: "fake-model", provider: "fake", billed: true, input: 1, output: 1, cached: 0, cacheWrite: 0, costMicros: 0 } });
  await finishAdvance(db, transitionOwner);
  releaseTransition();
  assert.equal((await staleAttentionClaim).kind, "applied", "a stale attempt-to-attention writer reports the current terminal phase");

  // Fence a stale SELECT from reviving a revision after another recovery
  // claimant finishes it. Both requests observe the saved result, but only one
  // may own the row; the delayed claimant must return `applied` and make no
  // provider request.
  const [interleaved] = await db.insert(arenaGames).values({ p1Name: "Lease Race P1", p2Name: "Lease Race AI", seed: 569, mode: "sparring", state: { prompt: { kind: "main", player: "p2" } } }).returning({ id: arenaGames.id });
  const originalOwner = await claimAdvance(db, interleaved.id, 0, hasResult);
  assert.equal(originalOwner.kind, "claimed");
  if (originalOwner.kind !== "claimed") throw new Error("race fixture did not get its first lease");
  await markProviderAttempt(db, originalOwner);
  await db.insert(aiRuns).values({
    kind: "arena_move",
    arenaCallId: originalOwner.callId,
    model: "fake-model",
    provider: "fake",
    billed: true,
    input: { arena: { gameId: interleaved.id, callId: originalOwner.callId, revision: 0 } },
    output: { move: 0, say: "Saved before the race." },
    inputTokens: 4,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costMicros: 0,
  });
  await failAdvance(db, originalOwner, true);
  const interleave = { observedRow: undefined as (() => void) | undefined, releaseObserved: undefined as (() => void) | undefined };
  const didRead = new Promise<void>((resolve) => { interleave.observedRow = resolve; });
  const keepWaiting = new Promise<void>((resolve) => { interleave.releaseObserved = resolve; });
  const delayedClaim = claimAdvance(db, interleaved.id, 0, async (callId) => {
    assert.equal(callId, originalOwner.callId);
    interleave.observedRow?.();
    await keepWaiting;
    return true;
  }, new Date(Date.now() + 120_000));
  await didRead;
  const winningClaim = await claimAdvance(db, interleaved.id, 0, async () => true, new Date(Date.now() + 120_000));
  assert.equal(winningClaim.kind, "claimed");
  if (winningClaim.kind !== "claimed") throw new Error("race fixture did not recover the saved result");
  await finishAdvance(db, winningClaim);
  interleave.releaseObserved?.();
  assert.equal((await delayedClaim).kind, "applied", "stale read cannot resurrect a row another owner finished");
  assert.equal((await claimAdvance(db, interleaved.id, 0, async () => true)).kind, "applied", "the completed row stays terminal");
  assert.equal((await db.select().from(aiRuns).where(eq(aiRuns.arenaCallId, originalOwner.callId))).length, 1, "the read/finish race keeps the one recorded provider request");

  // Exercise the real advance loop with a deferred fake provider. A human
  // action is persisted first, then two advance requests race while the only
  // provider request is held open. The acknowledgement has already completed
  // and the second advance returns without creating another request.
  const [leader] = await db.insert(cards).values({ id: "BT18-566A", setCode: "BT18", name: "Lease Leader", cardType: "LEADER", rarity: "Leader[L]", rarityCode: "L", searchText: "lease leader", colors: ["Red"], power: 10000, backName: "Lease Leader Awake", backPower: 15000 }).returning({ id: cards.id });
  await db.insert(cards).values({ id: "BT18-566B", setCode: "BT18", name: "Lease Battle", cardType: "BATTLE", rarity: "Common[C]", rarityCode: "C", searchText: "lease battle", colors: ["Red"], power: 10000, energyCost: "1", comboPower: 5000 });
  const [deck] = await db.insert(decks).values({ name: "Advance Lease Fixture", game: "dbs" }).returning({ id: decks.id });
  await db.insert(deckCards).values([
    { deckId: deck.id, cardId: leader.id, zone: "leader", quantity: 1 },
    { deckId: deck.id, cardId: "BT18-566B", zone: "main", quantity: 50 },
  ]);
  const previousSettings = await loadSettings(db);
  const [previousRow] = await db.select().from(aiSettings);
  const liveFake = createFakeProvider({ id: "arena-advance-test", script: [{ json: { move: 0, say: "" }, usage: { input: 11, output: 3 } }] });
  const originalGenerate = liveFake.generate.bind(liveFake);
  let delayNext = false;
  const release = { model: undefined as (() => void) | undefined };
  let providerStarted: (() => void) | null = null;
  let startedWait = new Promise<void>((resolve) => { providerStarted = resolve; });
  let ackFinishedBeforeProvider = false;
  let humanAckReturned = false;
  let providerInvocations = 0;
  liveFake.generate = async (request) => {
    providerInvocations++;
    if (delayNext) {
      delayNext = false;
      ackFinishedBeforeProvider = humanAckReturned;
      providerStarted?.();
      await new Promise<void>((resolve) => { release.model = resolve; });
    }
    return originalGenerate(request);
  };
  registerProvider(liveFake);
  forgetAvailability();
  readSettingsFromDatabase(db);
  const fakeSettings = {
    ...previousSettings,
    arena: { ...previousSettings.arena, sparring: { provider: liveFake.id, model: "fake/model" } },
  } as AiSettings;
  await saveSettings(db, fakeSettings);
  const gameId = await startGame(db, deck.id, deck.id, "sparring", false, { p1User: null, p2User: null }, "rules");
  try {
    let observedSlowCall = false;
    for (let i = 0; i < 80 && !observedSlowCall; i++) {
      const game = await loadGame(db, gameId);
      assert.ok(game && game.status === "playing", "slow-provider fixture remains playable");
      if (!game || game.status !== "playing") break;
      if (!("player" in game.state.prompt) || game.state.prompt.player !== "p1") {
        await advance(db, gameId);
        continue;
      }
      humanAckReturned = false;
      const acknowledged = await applyToGame(db, gameId, game.legal[0].action, undefined, { game, clearBeats: true });
      humanAckReturned = true;
      assert.equal(acknowledged.version, game.version + 1, "the human action CAS finishes before advance begins");
      delayNext = true;
      startedWait = new Promise<void>((resolve) => { providerStarted = resolve; });
      const firstAdvance = advance(db, gameId);
      const slowStarted = await Promise.race([startedWait.then(() => true), firstAdvance.then(() => false)]);
      if (!slowStarted) {
        await firstAdvance;
        delayNext = false;
        continue;
      }
      observedSlowCall = true;
      assert.equal(ackFinishedBeforeProvider, true, "the human acknowledgement preceded the slow AI request");
      const requestsAtBlock = liveFake.requests.length;
      const invocationsAtBlock = providerInvocations;
      const [attemptRow] = await db.select().from(arenaAdvanceCalls)
        .where(eq(arenaAdvanceCalls.gameId, gameId))
        .orderBy(desc(arenaAdvanceCalls.revision));
      assert.equal(attemptRow.phase, "attempting", "the provider boundary is durably marked before the fake response");
      const beforeAiWrite = await loadGame(db, gameId);
      assert.equal(beforeAiWrite?.version, attemptRow.revision, "the checkpoint is tied to the authoritative board revision");
      const chosenAction = beforeAiWrite!.legal[0].action;
      const actionCountBefore = beforeAiWrite!.actions.length;
      const secondAdvance = await advance(db, gameId);
      assert.equal(secondAdvance.error, null, "a competing advance reports busy without failing the game");
      assert.equal(providerInvocations, invocationsAtBlock, "the competing advance starts no second provider request");
      release.model?.();
      const finishedAdvance = await firstAdvance;
      assert.equal(finishedAdvance.error, null, `the lease owner finishes its decision (${finishedAdvance.error ?? ""})`);
      assert.ok(liveFake.requests.length >= requestsAtBlock + 1, "the held model request is recorded once before the turn resumes");
      const afterAiWrite = await loadGame(db, gameId);
      assert.ok(afterAiWrite);
      const replayedActionCount = afterAiWrite!.actions.slice(actionCountBefore).filter((action) => JSON.stringify(action) === JSON.stringify(chosenAction)).length;
      assert.equal(replayedActionCount, 1, "the recorded decision is applied exactly once under revision CAS");
      assert.equal((await db.select().from(arenaAiUsage).where(eq(arenaAiUsage.callId, attemptRow.callId))).length, 1, "the provider usage receipt is billed once for its stable call id");
      const savedRuns = await db.select().from(aiRuns).where(eq(aiRuns.arenaCallId, attemptRow.callId));
      assert.equal(savedRuns.length, 1, "the provider result is recorded once for recovery");
      assert.deepEqual((savedRuns[0].input as { arena: { selectedAction: unknown } }).arena.selectedAction, chosenAction, "the durable model result records the semantic action selected from its original menu");
      assert.equal((await db.select().from(arenaDecisions).where(eq(arenaDecisions.arenaCallId, attemptRow.callId))).length, 1, "the decision projection is recorded once");
    }
    assert.ok(observedSlowCall, "fixture reached a real AI decision that blocks on the fake provider");
  } finally {
    release.model?.();
    await db.delete(arenaGames).where(eq(arenaGames.id, gameId));
    await db.delete(decks).where(eq(decks.id, deck.id));
    await db.delete(cards).where(eq(cards.id, leader.id));
    await db.delete(cards).where(eq(cards.id, "BT18-566B"));
    if (previousRow) await saveSettings(db, previousSettings);
    else await db.delete(aiSettings);
    setSettingsLoader(null);
    resetProviders();
    forgetAvailability();
  }

  // The actual web action returns after applyToGame and dispatches advance as
  // a background request. Keep those boundary guarantees from regressing into
  // an awaited provider response in the server action.
  const actionSource = readFileSync("src/app/arena/actions.ts", "utf8");
  const actBody = actionSource.slice(actionSource.indexOf("export async function act("), actionSource.indexOf("async function refuse("));
  assert.doesNotMatch(actBody, /await\s+advance\s*\(/, "the action acknowledgement does not await AI work");
  const stageSource = readFileSync("src/components/arena/stage/ArenaStage.tsx", "utf8");
  assert.match(stageSource, /void session\.advance\(\)/, "the web client launches the AI advance without holding the action transition open");
  // #648: and the session it calls is the online one, which is `advanceGame` — not an awaited provider response.
  assert.match(readFileSync("src/components/arena/session/online.ts", "utf8"), /advance: \(\) => advanceGame\(gameId\)/, "the online session's advance is the server action");

  await db.delete(arenaGames).where(eq(arenaGames.id, normal.id));
  await db.delete(arenaGames).where(eq(arenaGames.id, recover.id));
  await db.delete(arenaGames).where(eq(arenaGames.id, unknown.id));
  await db.delete(arenaGames).where(eq(arenaGames.id, interleaved.id));
  console.log("verify-db: Arena advance lease contention, recorded-result recovery and unknown-outcome fencing ok");
}
