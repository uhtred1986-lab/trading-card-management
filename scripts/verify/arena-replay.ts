import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "../../src/db/index.ts";
import { arenaGames, arenaRuleBundles, cardRules, cards } from "../../src/db/schema.ts";
import { loadGame, startGame } from "../../src/lib/arena/games.ts";
import { clearReplayBundleCacheForTests, makeReplayBundle, pinnedContext, readReplayBundle, replayHash, validateReplayBundle } from "../../src/lib/arena/replay-bundle.ts";
import { loadReplayExport } from "../../src/lib/arena/replay-export.ts";
import { replayOffline } from "../../src/lib/arena/offline-replay.ts";
import { tableOf } from "../../src/lib/arena/ai/table.ts";
import { buildSnapshot } from "../../src/lib/arena/snapshot.ts";
import type { Beats } from "../../src/lib/arena/beats.ts";
import type { EngineContext } from "../../src/lib/arena/types.ts";
import { engineFor } from "../../src/lib/arena/engines.ts";
import type { VmState } from "../../src/lib/arena/vm/state.ts";

/** PGlite coverage for immutable inputs, corrections, offline replay and historical rows. */
export async function verifyArenaReplay(db: Db, gameId: number, deckId: number): Promise<void> {
  const unicodeFirst = { "😀": 4, "ä": 3, a: 1, A: 2 };
  const unicodeReordered = { A: 2, a: 1, "😀": 4, "ä": 3 };
  const utf16SortedJson = '{"A":2,"a":1,"ä":3,"😀":4}';
  const utf16SortedHash = createHash("sha256").update(utf16SortedJson).digest("hex");
  assert.equal(await replayHash(unicodeFirst), utf16SortedHash, "bundle hashes use portable UTF-16 key order rather than host locale collation");
  assert.equal(await replayHash(unicodeReordered), utf16SortedHash, "Unicode-key hashes do not depend on insertion order");
  const route = fs.readFileSync(new URL("../../src/app/api/v1/games/[id]/replay/route.ts", import.meta.url), "utf8");
  const service = fs.readFileSync(new URL("../../src/lib/arena/replay-export.ts", import.meta.url), "utf8");
  const adminAuth = route.indexOf("routeViewer({ sl: true })");
  const serviceCall = route.indexOf("loadReplayExport(db, id, auth.viewer)");
  const firstGameRead = service.indexOf("mode: arenaGames.mode");
  const seatGuard = service.indexOf("!seatOf(access, viewer.login)");
  const sensitiveRead = service.indexOf("seed: arenaGames.seed");
  const bundleRead = service.indexOf("readReplayBundle(db,");
  assert.ok(adminAuth >= 0 && adminAuth < serviceCall, "the route requires an SL before calling the replay service");
  assert.ok(firstGameRead >= 0 && firstGameRead < seatGuard && seatGuard < sensitiveRead && sensitiveRead < bundleRead, "the service checks a minimal versus seat before reading seed, actions, decks or bundle");

  const original = (await loadGame(db, gameId))!;
  const [storedGame] = await db.select().from(arenaGames).where(eq(arenaGames.id, gameId)).limit(1);
  assert.ok(storedGame.rulesBundleHash, "new matches reference an immutable bundle");
  assert.ok(storedGame.replayDecks, "new matches keep both original deck inputs");
  const bundle = await readReplayBundle(db, storedGame.rulesBundleHash!);
  assert.ok(bundle, "the content-addressed bundle is persisted");
  const [storedBundle] = await db.select().from(arenaRuleBundles).where(eq(arenaRuleBundles.hash, storedGame.rulesBundleHash!)).limit(1);
  for (const side of [storedGame.replayDecks!.p1, storedGame.replayDecks!.p2]) {
    assert.equal(side.leader, "BT18-960", "the leader input is frozen");
    assert.equal(side.main.length, 50, "the main-deck inputs are frozen with repeats");
    assert.equal(side.main.filter((id) => id === "BT18-961").length, 25);
    assert.equal(side.main.filter((id) => id === "BT18-962").length, 25);
  }

  const [before] = await db.select({ name: cards.name, energyCost: cards.energyCost }).from(cards).where(eq(cards.id, "BT18-961")).limit(1);
  const [beforeRule] = await db.select().from(cardRules).where(eq(cardRules.cardId, "BT18-961")).limit(1);
  let correctedId: number | null = null;
  let correctedBundleHash: string | null = null;
  try {
  await db.update(arenaGames).set({ mode: "versus", p1User: "replay-seat", p2User: "other-seat" }).where(eq(arenaGames.id, gameId));
  await db.update(arenaRuleBundles).set({ payload: { ...bundle!.payload, defs: { ...bundle!.payload.defs, "BT18-961": { ...bundle!.payload.defs["BT18-961"], name: "tampered before authorization" } } } }).where(eq(arenaRuleBundles.hash, bundle!.hash));
  clearReplayBundleCacheForTests();
  assert.equal((await loadReplayExport(db, gameId, { kind: "player", login: "replay-seat" })).kind, "not_found", "non-SL callers are denied before private export reads");
  assert.equal((await loadReplayExport(db, gameId, { kind: "sl", login: "unseated-sl" })).kind, "not_found", "an unseated SL cannot export a versus opponent's hidden replay inputs");
  assert.equal((await loadReplayExport(db, gameId + 100000, { kind: "sl", login: "replay-seat" })).kind, "not_found", "an unknown game is denied before bundle reads");
  await db.update(arenaRuleBundles).set({ payload: storedBundle!.payload }).where(eq(arenaRuleBundles.hash, bundle!.hash));
  clearReplayBundleCacheForTests();
  assert.equal((await loadReplayExport(db, gameId, { kind: "sl", login: "replay-seat" })).kind, "ok", "a seated SL can export the authorized replay");
  await db.update(arenaGames).set({ mode: storedGame.mode, p1User: storedGame.p1User, p2User: storedGame.p2User }).where(eq(arenaGames.id, gameId));
  await db.update(cards).set({ name: "Corrected Flow Fighter", energyCost: "4" }).where(eq(cards.id, "BT18-961"));
  await db.update(cardRules).set({ ops: [{ op: "power", target: { sel: { special: "self" } }, amount: 5000, until: "game" }] }).where(eq(cardRules.cardId, "BT18-961"));
  const stillOld = (await loadGame(db, gameId))!;
  assert.equal(stillOld.rulesBundleHash, storedGame.rulesBundleHash, "a correction cannot retarget an ongoing game");
  assert.equal(stillOld.ctx.defs["BT18-961"].name, original.ctx.defs["BT18-961"].name, "old game reads its pinned catalogue");

  correctedId = await startGame(db, deckId, deckId, "hotseat", false, { p1User: null, p2User: null }, "rules");
  const corrected = (await loadGame(db, correctedId))!;
  correctedBundleHash = corrected.rulesBundleHash;
  assert.equal(corrected.ctx.defs["BT18-961"].name, "Corrected Flow Fighter", "a new game sees the corrected catalogue");
  assert.notEqual(corrected.rulesBundleHash, original.rulesBundleHash, "a correction creates a different immutable bundle");
  assert.equal((original.ctx.scripts?.["BT18-961"]?.bySkill[0]?.ops[0] as { amount?: number } | undefined)?.amount, 3000, "the old match retains its original compiled card program");
  assert.equal((corrected.ctx.scripts?.["BT18-961"]?.bySkill[0]?.ops[0] as { amount?: number } | undefined)?.amount, 5000, "the new match receives the corrected compiled card program");
  const wrongReuse = (await loadGame(db, correctedId, original))!;
  assert.notEqual(wrongReuse.ctx, original.ctx, "a context from another game cannot cross the pinned identity boundary");
  assert.equal(wrongReuse.ctx.defs["BT18-961"].name, "Corrected Flow Fighter");
  const tampered = structuredClone(bundle!);
  tampered.payload.defs["BT18-961"].name = "Tampered definition";
  assert.equal(await validateReplayBundle(tampered), false, "editing one pinned input invalidates its content hash");

  // The runtime marker is explicit in the exported proof; no fake deployment SHA is written to the game.
  const proofRuntime = "a547000000000000000000000000000000000001";
  const proofBundle = await makeReplayBundle({
    defs: bundle!.payload.defs,
    scripts: bundle!.payload.scripts,
    art: bundle!.payload.art,
    rulesetFiles: bundle!.payload.rulesetFiles,
    runtime: proofRuntime,
  });
  // Put one real copy in play and one active energy into a legal Main prompt. The fixture is a
  // PGlite state clone; both engine observations still run through the production entry points.
  const board = structuredClone(original.state) as VmState;
  const p1 = board.sides.p1;
  const fighterCopies = Object.values(board.cards).filter((card) => card.owner === "p1" && card.cardId === "BT18-961").map((card) => card.id);
  const [inHand, inPlay] = fighterCopies;
  const toZone = (id: string, zone: string, mode?: "active" | "rest") => {
    for (const [from, ids] of Object.entries(p1.zones)) p1.zones[from] = ids.filter((x) => x !== id);
    (p1.zones[zone] ??= []).push(id);
    if (mode) board.cards[id].mode = mode;
  };
  assert.ok(inPlay && inHand, "fixture has multiple copies of the confirmed-skill card");
  for (const id of [...p1.zones.energy]) toZone(id, "drop");
  toZone(inHand, "hand");
  toZone(inPlay, "battle", "active");
  const energy = Object.values(board.cards).find((card) => card.owner === "p1" && card.id !== inPlay && card.id !== inHand && card.cardId !== "BT18-960")?.id;
  assert.ok(energy, "fixture has a non-leader card available as energy");
  toZone(energy, "energy", "active");
  board.phase = "main";
  board.turn = 2;
  board.turnPlayer = "p1";
  board.prompt = { kind: "main", player: "p1" };
  const unchangedView = engineFor("rules").boardView(original.ctx, board, "p1", original.art);
  assert.equal(unchangedView.you.battle.find((card) => card.cardId === "BT18-961")?.power, 13000, "the old match's actual board calculation keeps its confirmed Permanent");
  assert.equal(tableOf(original.ctx, board).power(inPlay), 13000, "the AI table reads the old match's pinned definition and program");
  assert.equal(engineFor("rules").boardView(stillOld.ctx, board, "p1", stillOld.art).you.battle.find((card) => card.cardId === "BT18-961")?.power, 13000, "the old game still renders the old effect after a fresh load");
  const oldPlay = engineFor("rules").legalActions(original.ctx, board).some((entry) => entry.action.type === "play" && entry.action.card === inHand);
  const newPlay = engineFor("rules").legalActions(corrected.ctx, board).some((entry) => entry.action.type === "play" && entry.action.card === inHand);
  assert.equal(oldPlay, true, "the old specified cost remains payable with its one active energy");
  assert.equal(newPlay, false, "the new specified cost uses the corrected four-energy catalogue value");
  const playAction = engineFor("rules").legalActions(original.ctx, board).find((entry) => entry.action.type === "play" && entry.action.card === inHand)!.action;
  const oldEvents = engineFor("rules").apply(original.ctx, board, playAction).events;
  const reloadedEvents = engineFor("rules").apply(stillOld.ctx, board, playAction).events;
  assert.deepEqual(reloadedEvents, oldEvents, "old-game action events are identical after a fresh pinned reload");

  // With enough energy, both pinned revisions can play the same card. The old
  // revision pays one energy; the corrected revision pays four and emits the
  // corresponding extra cost/movement effects. This checks applied behavior,
  // not only the legal-action list.
  const enough = structuredClone(board);
  const extraEnergy = Object.values(enough.cards).filter((card) => card.owner === "p1" && card.id !== inHand && card.id !== inPlay && card.cardId !== "BT18-960").map((card) => card.id).filter((id) => !enough.sides.p1.zones.energy.includes(id)).slice(0, 3);
  assert.equal(extraEnergy.length, 3, "fixture has enough cards to provide four active energy");
  for (const id of extraEnergy) {
    for (const [from, ids] of Object.entries(enough.sides.p1.zones)) enough.sides.p1.zones[from] = ids.filter((x) => x !== id);
    enough.sides.p1.zones.energy.push(id);
    enough.cards[id].mode = "active";
  }
  const oldAffordable = engineFor("rules").legalActions(original.ctx, enough).find((entry) => entry.action.type === "play" && entry.action.card === inHand)?.action;
  const newAffordable = engineFor("rules").legalActions(corrected.ctx, enough).find((entry) => entry.action.type === "play" && entry.action.card === inHand)?.action;
  assert.ok(oldAffordable && newAffordable, "both revisions allow the play when four energy is available");
  const oldApplied = engineFor("rules").apply(original.ctx, enough, oldAffordable);
  const newApplied = engineFor("rules").apply(corrected.ctx, enough, newAffordable);
  const oldAppliedState = oldApplied.state as VmState;
  const newAppliedState = newApplied.state as VmState;
  assert.equal(oldAppliedState.sides.p1.zones.energy.filter((id) => oldAppliedState.cards[id].mode === "rest").length, 1, "the old printed one-energy cost rests one of four energy");
  assert.equal(newAppliedState.sides.p1.zones.energy.filter((id) => newAppliedState.cards[id].mode === "rest").length, 4, "the corrected four-energy cost rests all four energy");
  assert.ok(oldApplied.events.some((event) => event.type === "move" && event.card === inHand && event.to === "battle"));
  assert.ok(newApplied.events.some((event) => event.type === "move" && event.card === inHand && event.to === "battle"));
  assert.notDeepEqual(newApplied.events, oldApplied.events, "the corrected cost changes the actual move event sequence");

  const correctedFiles = { ...bundle!.payload.rulesetFiles };
  correctedFiles["zones.rules"] = correctedFiles["zones.rules"]
    .replace(/(DEFINE ZONE hand[\s\S]*?visibility:) owner/, "$1 all")
    .replace(/(DEFINE ZONE battle[\s\S]*?inPlay:) true/, "$1 false");
  assert.notEqual(correctedFiles["zones.rules"], bundle!.payload.rulesetFiles["zones.rules"], "the test's ruleset correction is concrete");
  const nextDefinitionBundle = await makeReplayBundle({ defs: original.ctx.defs, scripts: original.ctx.scripts ?? {}, art: original.art, rulesetFiles: correctedFiles, runtime: proofRuntime });
  const correctedCtx = await pinnedContext(nextDefinitionBundle);
  const originalHand = board.sides.p2.zones.hand[0];
  assert.ok(originalHand, "fixture has a real opponent-hand card for visibility assertions");
  const opponentDef = original.ctx.defs[board.cards[originalHand].cardId];
  const fakeBeats = { seq: 1, list: [{ t: "draw", n: 1, player: "p2", card: originalHand }], art: { [originalHand]: { cardId: board.cards[originalHand].cardId, name: opponentDef.name, imageUrl: null } } } as Beats;
  const baseSnapshot = (ctx: EngineContext) => buildSnapshot({
    id: original.id, revision: original.version, mode: original.mode, engine: original.engine, game: original.game,
    status: original.status, p1Name: original.p1Name, p2Name: original.p2Name, p1User: original.p1User, p2User: original.p2User,
    ctx, state: board, legal: engineFor("rules").legalActions(ctx, board), log: [], beats: fakeBeats, spotlight: null,
    spend: original.spend, ai: null, viewer: "p1", images: original.art,
  });
  assert.deepEqual(baseSnapshot(original.ctx).beats?.art, {}, "snapshot masks a hidden card using the old pinned zones");
  assert.ok(baseSnapshot(correctedCtx).beats?.art[originalHand], "snapshot uses the corrected ruleset's new public-hand visibility");
  assert.equal(tableOf(correctedCtx, board).power(inPlay), 10000, "the AI rules table uses the corrected declaration and no longer treats battle as in-play");
  const publicShape = JSON.stringify(baseSnapshot(original.ctx));
  for (const privateField of ["rulesBundleHash", "rulesBundle", "replayDecks", "seed", "actions", "rulesetFiles", "programsHash"]) {
    assert.equal(publicShape.includes(privateField), false, `public snapshot does not expose ${privateField}`);
  }
  const replay = await replayOffline({
    bundle: { ...proofBundle, decks: storedGame.replayDecks! },
    engine: "rules",
    seed: storedGame.seed,
    actions: storedGame.actions as import("../../src/lib/arena/types.ts").Action[],
    interpreterRevision: proofRuntime,
  });
  assert.deepEqual(replay.state, JSON.parse(JSON.stringify(storedGame.state)), "an offline replay rebuilds the exact saved state from bundle + seed + actions");
  assert.ok(replay.events.length > 0, "offline replay includes setup and action events");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "arena-replay-"));
  try {
    const exportPath = path.join(tempDir, "bundle.json");
    fs.writeFileSync(exportPath, JSON.stringify({ exact: true, seed: storedGame.seed, engine: "rules", actions: storedGame.actions, decks: storedGame.replayDecks, bundle: proofBundle }));
    const output = execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/arena-replay.mts", exportPath, "--runtime-revision", proofRuntime], { encoding: "utf8", env: { ...process.env, DATABASE_URL: "" } });
    assert.deepEqual(JSON.parse(output).state, JSON.parse(JSON.stringify(storedGame.state)), "the exported JSON runs through the standalone offline CLI with no database");
    const olderDeploymentPath = path.join(tempDir, "older-deployment-export.json");
    fs.writeFileSync(olderDeploymentPath, JSON.stringify({ exact: false, reason: "Use the bundle's interpreter revision.", seed: storedGame.seed, engine: "rules", actions: storedGame.actions, decks: storedGame.replayDecks, bundle: proofBundle }));
    const olderDeploymentOutput = execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/arena-replay.mts", olderDeploymentPath, "--runtime-revision", proofRuntime], { encoding: "utf8", env: { ...process.env, DATABASE_URL: "" } });
    assert.deepEqual(JSON.parse(olderDeploymentOutput).state, JSON.parse(JSON.stringify(storedGame.state)), "a pinned export marked non-exact by a newer deployment replays on its recorded interpreter revision");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  await assert.rejects(replayOffline({ bundle: { ...proofBundle, decks: storedGame.replayDecks! }, engine: "rules", seed: storedGame.seed, actions: storedGame.actions as import("../../src/lib/arena/types.ts").Action[], interpreterRevision: "b547000000000000000000000000000000000001" }), /does not match/, "foreign interpreter provenance is refused");
  const unknownRuntimeBundle = await makeReplayBundle({ defs: bundle!.payload.defs, scripts: bundle!.payload.scripts, art: bundle!.payload.art, rulesetFiles: bundle!.payload.rulesetFiles, runtime: null });
  await assert.rejects(replayOffline({ bundle: { ...unknownRuntimeBundle, decks: storedGame.replayDecks! }, engine: "rules", seed: storedGame.seed, actions: storedGame.actions as import("../../src/lib/arena/types.ts").Action[], interpreterRevision: null }), /missing or does not match/, "unknown interpreter provenance cannot claim exact replay");
  assert.equal(await validateReplayBundle({ ...proofBundle, format: 2 as 1 }), false, "unknown bundle formats are rejected");

  await db.update(arenaGames).set({ rulesBundleHash: null, replayDecks: null }).where(eq(arenaGames.id, correctedId));
  const [historical] = await db.select().from(arenaGames).where(eq(arenaGames.id, correctedId)).limit(1);
  assert.equal(historical.rulesBundleHash, null, "historical rows remain explicitly unpinned");
  assert.equal(historical.replayDecks, null, "no current deck is silently substituted for an old match");
  const historicalLoad = (await loadGame(db, correctedId))!;
  assert.equal(historicalLoad.rulesBundleHash, null, "a historical unpinned row remains loadable via the documented legacy path");
  assert.equal(historicalLoad.ctx.defs["BT18-961"].name, "Corrected Flow Fighter", "the compatibility path is explicit and uses current rows");

  await db.delete(arenaGames).where(eq(arenaGames.id, correctedId));
  await db.delete(arenaRuleBundles).where(eq(arenaRuleBundles.hash, corrected.rulesBundleHash!));
  await db.update(arenaRuleBundles).set({ payload: { ...bundle!.payload, defs: { ...bundle!.payload.defs, "BT18-961": { ...bundle!.payload.defs["BT18-961"], name: "tampered in storage" } } } }).where(eq(arenaRuleBundles.hash, original.rulesBundleHash!));
  clearReplayBundleCacheForTests();
  await assert.rejects(loadGame(db, gameId), /content hash validation/, "a tampered stored bundle fails closed after reload");
  await db.delete(arenaRuleBundles).where(eq(arenaRuleBundles.hash, original.rulesBundleHash!));
  clearReplayBundleCacheForTests();
  await assert.rejects(loadGame(db, gameId), /bundle is missing/, "a missing pinned bundle never falls back to current data");
  } finally {
    if (correctedId !== null) await db.delete(arenaGames).where(eq(arenaGames.id, correctedId));
    if (correctedBundleHash) await db.delete(arenaRuleBundles).where(eq(arenaRuleBundles.hash, correctedBundleHash));
    await db.update(arenaGames).set({ mode: storedGame.mode, p1User: storedGame.p1User, p2User: storedGame.p2User }).where(eq(arenaGames.id, gameId));
    if (storedBundle) {
      await db.insert(arenaRuleBundles).values(storedBundle).onConflictDoUpdate({ target: arenaRuleBundles.hash, set: { payload: storedBundle.payload } });
    }
    if (beforeRule) await db.update(cardRules).set({ ops: beforeRule.ops }).where(eq(cardRules.cardId, "BT18-961"));
    await db.update(cards).set({ name: before!.name, energyCost: before!.energyCost }).where(eq(cards.id, "BT18-961"));
    clearReplayBundleCacheForTests();
  }
}
