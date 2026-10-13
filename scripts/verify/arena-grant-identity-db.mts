/**
 * #683: grant identity through the real saved-session path (PGlite, no Neon).
 *
 * One watcher Battle Card holds a timed Villainous grant and a standing
 * ([Permanent] "gains [Villainous]") grant at once. Each successful Extra
 * [Activate] skill must pay exactly one opponent discard per live grant
 * identity, saved prompt by saved prompt, through `applyToGame`: version CAS,
 * request receipts, wrong actor and stale refusals, replay, and a regrant that
 * pays once more. Both seat projections are rebuilt from the persisted row.
 */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import type { Db } from "../../src/db/index.ts";
import { arenaGames } from "../../src/db/schema.ts";
import { engineFor } from "../../src/lib/arena/engines.ts";
import { applyToGame, loadGame, mutationFingerprint, RequestIdentityConflict, StaleGame, type LoadedGame } from "../../src/lib/arena/games.ts";
import { snapshotOfGame } from "../../src/lib/arena/session.ts";
import { rulesetFor } from "../../src/lib/arena/rulesets/index.ts";
import { moveCard } from "../../src/lib/arena/vm/zones.ts";
import { addEffect as vmAddEffect } from "../../src/lib/arena/vm/effects.ts";
import { addEffect as legacyAddEffect, move as legacyMove } from "../../src/lib/arena/engine/state.ts";
import type { VmState } from "../../src/lib/arena/vm/state.ts";
import type { Action, EngineContext, GameState, PlayerId } from "../../src/lib/arena/types.ts";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness.ts";

const defs = { ...DEFS,
  "DB683G-WATCH": card("DB683G-WATCH", { energyCost: 0, skill: "[Permanent] This card gains [Villainous]." }),
  "DB683G-EXTRA": card("DB683G-EXTRA", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Villainous]<br>[Activate: Main]: Draw 1 card." }),
  "DB683G-S1": card("DB683G-S1", { skill: null }),
  "DB683G-S2": card("DB683G-S2", { skill: null }),
  "DB683G-S3": card("DB683G-S3", { skill: null }),
  "DB683G-S4": card("DB683G-S4", { skill: null }),
};
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromCompiler(defs) };
const OWN = ["DB683G-WATCH", "DB683G-EXTRA", "DB683G-S1", "DB683G-S2", "DB683G-S3", "DB683G-S4"];

interface Effect { id: number; kind: string; target?: string; value?: unknown }

interface Adapter {
  hand(state: unknown, player: PlayerId): string[];
  cards(state: unknown): Record<string, { cardId: string }>;
  toBattle(state: unknown, id: string): void;
  grantTimed(state: unknown, watcher: string): number;
  effects(state: unknown): Effect[];
  start(): unknown;
}

const legacyAdapter: Adapter = {
  hand: (s, p) => (s as GameState).players[p].hand,
  cards: (s) => (s as GameState).cards,
  toBattle: (s, id) => legacyMove(ctx, s as GameState, [], id, "battle", "p1", { reason: "effect" }),
  grantTimed: (s, w) => legacyAddEffect(s as GameState, [], { master: "p1", source: w, target: w, kind: "keyword", value: { name: "Villainous" }, until: "turn" }).id,
  effects: (s) => (s as GameState).effects as unknown as Effect[],
  start() {
    const engine = engineFor("legacy");
    let state = engine.createGame(ctx, { seed: 68303,
      p1: { name: "Alice", leader: "L-RED", main: fifty("V1") },
      p2: { name: "Bob", leader: "L-BLUE", main: fifty("V-BLUE") },
    }).state as GameState;
    state = engine.apply(ctx, state, { type: "chooseFirst", player: (state.prompt as { player: PlayerId }).player, first: "p1" }).state as GameState;
    for (let i = 0; i < 24 && state.prompt.kind !== "main"; i++) {
      const action = engine.legalActions(ctx, state)[0]?.action;
      assert.ok(action);
      state = engine.apply(ctx, state, action).state as GameState;
    }
    return state;
  },
};

const rulesLoaded = rulesetFor("dbs");
const rulesAdapter: Adapter = {
  hand: (s, p) => (s as VmState).sides[p].zones.hand,
  cards: (s) => (s as VmState).cards,
  toBattle(s, id) {
    assert.ok(rulesLoaded.ok);
    assert.ok(moveCard(s as VmState, rulesLoaded.definition, id, "battle", { owner: "p1" }).ok);
  },
  grantTimed: (s, w) => vmAddEffect(s as VmState, [], { master: "p1", source: w, target: w, kind: "keyword", value: { name: "Villainous" }, until: "turn" }).id,
  effects: (s) => (s as VmState).effects as unknown as Effect[],
  start() {
    const engine = engineFor("rules");
    let state = engine.createGame(ctx, { seed: 68303,
      p1: { name: "Alice", leader: "L-RED", main: fifty("V1") },
      p2: { name: "Bob", leader: "L-BLUE", main: fifty("V-BLUE") },
    }).state as VmState;
    state = engine.apply(ctx, state, { type: "chooseFirst", player: state.chooser, first: "p1" }).state as VmState;
    for (let i = 0; i < 24 && state.prompt.kind !== "main"; i++) {
      const action = engine.legalActions(ctx, state)[0]?.action;
      assert.ok(action);
      state = engine.apply(ctx, state, action).state as VmState;
    }
    return state;
  },
};

async function scenario(db: Db, engineId: "legacy" | "rules", a: Adapter, base: number): Promise<void> {
  const state = a.start() as GameState | VmState;
  assert.equal(state.prompt.kind, "main");
  const stage = (player: PlayerId, cardId: string): string => {
    const id = a.hand(state, player).find((c) => !OWN.includes(a.cards(state)[c].cardId));
    assert.ok(id, "enough unstaged cards in hand");
    a.cards(state)[id].cardId = cardId;
    return id;
  };
  const watcher = stage("p1", "DB683G-WATCH");
  const extras = [stage("p1", "DB683G-EXTRA"), stage("p1", "DB683G-EXTRA"), stage("p1", "DB683G-EXTRA")];
  const secrets = (["DB683G-S1", "DB683G-S2", "DB683G-S3", "DB683G-S4"] as const).map((cardId) => stage("p2", cardId));
  a.toBattle(state, watcher);
  const timedId = a.grantTimed(state, watcher);
  const [created] = await db.insert(arenaGames).values({
    p1Name: "Alice", p2Name: "Bob", p1User: "alice", p2User: "bob",
    seed: 68303, mode: "versus", engine: engineId, state, version: 7,
  }).returning({ id: arenaGames.id });
  const id = created.id;
  let seq = 0;
  try {
    const load = async (): Promise<LoadedGame> => {
      const game = await loadGame(db, id);
      assert.ok(game);
      // Only definitions and compiled rows are synthetic; state, prompt,
      // revision, receipts and beats all come back from the persisted game.
      game.ctx = ctx;
      game.art = {};
      return game;
    };
    const row = async () => (await db.select().from(arenaGames).where(eq(arenaGames.id, id)))[0];
    const request = (revision: number, action: Action, actor: string) => ({
      actor, requestId: `00000000-0000-4000-8000-${String(base + ++seq).padStart(12, "0")}`,
      fingerprint: mutationFingerprint({ revision, action }),
    });
    const spendsOf = (game: LoadedGame) => {
      const spent = a.effects(game.state).filter((e) => e.kind === "negateGrantedSkill" && e.target === watcher);
      return {
        timed: (grant: number) => spent.filter((e) => e.value === grant).length,
        standing: spent.filter((e) => typeof e.value === "object" && e.value !== null && "standingGrantId" in e.value),
      };
    };
    const standingKeys = (game: LoadedGame): string[] => spendsOf(game).standing
      .map((e) => (e.value as { standingGrantId: string }).standingGrantId);
    const secretsInOpposingHand = (game: LoadedGame) => a.hand(game.state, "p2").filter((c) => secrets.includes(c));
    const assertViewers = async (game: LoadedGame, waiting: "p1" | "p2" | "none", privateKeys: string[], revealed: string[]) => {
      for (const viewer of ["p1", "p2"] as const) {
        const snapshot = await snapshotOfGame(db, game, viewer);
        const json = JSON.stringify(snapshot);
        assert.equal(snapshot.game.revision, game.version);
        assert.equal(snapshot.game.you, viewer);
        assert.equal(snapshot.view.them.hand, null, "neither seat is given the other seat's hand");
        assert.equal(snapshot.waiting, (waiting === "none" ? "p1" : waiting) === viewer ? "you" : "opponent", `${viewer} waiting`);
        for (const hidden of ["afterSkillKeyword", "grantEffectId", "standingGrantId", "zoneEpoch", "pendingHookSkill", "continuations", ...privateKeys]) {
          assert.ok(!json.includes(hidden), `${hidden} is not projected to ${viewer}`);
        }
        const unrevealed = a.hand(game.state, "p2").map((c) => a.cards(game.state)[c].cardId).filter((c) => c === "DB683G-S4");
        for (const cardId of unrevealed) assert.equal(json.includes(cardId), viewer === "p2", `unrevealed ${cardId} is visible only to its owner`);
        for (const cardId of revealed) assert.ok(json.includes(cardId), `${cardId} discarded to the public Drop is visible to ${viewer}`);
      }
    };

    // --- First Extra: two live identities -> two saved opponent prompts. ---
    let game = await load();
    const first = game.legal.find((entry) => entry.action.type === "activate" && entry.action.card === extras[0])?.action;
    assert.ok(first, "the Extra is genuinely offered from hand");
    game = await applyToGame(db, id, first, undefined, { game, expectedRevision: game.version, request: request(game.version, first, "alice") });
    assert.equal(game.version, 8);
    const drawsBefore = (game.beats?.list ?? []).filter((b) => b.t === "draw" && b.player === "p1").length;
    assert.equal(drawsBefore, 1, "the Extra's own effect drew once");
    // Reload: nothing is carried in memory between submissions.
    game = await load();
    let prompt = game.state.prompt as { kind: string; player?: PlayerId };
    let ordering = 0; // rules engine: the owner orders simultaneous hooks first
    if (prompt.kind === "orderPending") {
      ordering = 1;
      const order = (await snapshotOfGame(db, game, "p1")).legal.find((e) => e.action.type === "orderPending");
      assert.ok(order, "the Extra's owner orders the two simultaneous keyword hooks");
      game = await applyToGame(db, id, order.action, undefined, { game, expectedRevision: game.version, request: request(game.version, order.action, "alice") });
      game = await load();
      prompt = game.state.prompt as { kind: string; player?: PlayerId };
    }
    assert.equal(prompt.kind, "chooseCards");
    assert.equal(prompt.player, "p2", "the opponent holds the persisted discard prompt");
    await assertViewers(game, "p2", [], []);
    const prompted = await row();
    const choose = (card: string, player: PlayerId = "p2"): Action => ({ type: "choose", player, cards: [card] });
    await assert.rejects(() => applyToGame(db, id, choose(secrets[0], "p1"), undefined, { game, expectedRevision: game.version }), /p2's decision|not your|illegal/i);
    await assert.rejects(() => applyToGame(db, id, choose(secrets[0]), undefined, { game, expectedRevision: game.version - 1 }), StaleGame);
    assert.deepEqual(await row(), prompted, "wrong actor and stale submission write no state, beat or receipt");

    const choice1 = choose(secrets[0]);
    const choice1Request = request(game.version, choice1, "bob");
    game = await applyToGame(db, id, choice1, undefined, { game, expectedRevision: game.version, request: choice1Request });
    game = await load();
    assert.equal(game.state.prompt.kind, "chooseCards", "the second grant identity still owes its own discard");
    assert.equal((game.state.prompt as { player: PlayerId }).player, "p2");
    assert.equal(a.hand(game.state, "p2").includes(secrets[0]), false);
    const midRow = await row();
    const replayMid = await applyToGame(db, id, choice1, undefined, { game: await load(), expectedRevision: game.version - 1, request: choice1Request });
    assert.equal(replayMid.duplicateRequest, true);
    assert.deepEqual(await row(), midRow, "a replayed receipt discards nothing a second time");
    await assert.rejects(async () => applyToGame(db, id, choice1, undefined,
      { game: await load(), expectedRevision: game.version - 1, request: { ...choice1Request, fingerprint: mutationFingerprint({ revision: game.version - 1, action: choose(secrets[1]) }) } }),
      RequestIdentityConflict);
    assert.deepEqual(await row(), midRow, "a conflicting fingerprint changes nothing");
    await assertViewers(game, "p2", [], ["DB683G-S1"]);

    const choice2 = choose(secrets[1]);
    const choice2Request = request(game.version, choice2, "bob");
    game = await applyToGame(db, id, choice2, undefined, { game, expectedRevision: game.version, request: choice2Request });
    game = await load();
    assert.equal(game.state.prompt.kind, "main", "exactly two payouts for two identities");
    const afterFirst = spendsOf(game);
    assert.equal(afterFirst.timed(timedId), 1, "the timed grant is spent once");
    assert.equal(afterFirst.standing.length, 1, "the standing grant is spent once");
    const standingKey = standingKeys(game)[0];
    assert.ok(standingKey);
    assert.deepEqual(secretsInOpposingHand(game), [secrets[2], secrets[3]]);
    assert.equal((game.beats?.list ?? []).filter((b) => b.t === "draw" && b.player === "p1").length, 1, "keyword payouts discard only; no extra draw");
    assert.equal(game.actionReceipts.length, 3 + ordering, "one receipt per accepted submission");
    const doneRow = await row();
    const replayEnd = await applyToGame(db, id, choice2, undefined, { game: await load(), expectedRevision: game.version - 1, request: choice2Request });
    assert.equal(replayEnd.duplicateRequest, true);
    assert.deepEqual(await row(), doneRow, "replaying the final choice writes nothing");
    await assertViewers(game, "none", [standingKey], ["DB683G-S1", "DB683G-S2"]);

    // --- Second Extra, no regrant: both identities are spent, nothing pays. ---
    const second = game.legal.find((entry) => entry.action.type === "activate" && entry.action.card === extras[1])?.action;
    assert.ok(second);
    game = await applyToGame(db, id, second, undefined, { game, expectedRevision: game.version, request: request(game.version, second, "alice") });
    game = await load();
    assert.equal(game.state.prompt.kind, "main", "no prompt: nothing left to pay");
    assert.deepEqual(secretsInOpposingHand(game), [secrets[2], secrets[3]], "the opposing hand is untouched");
    assert.equal(spendsOf(game).timed(timedId), 1);
    assert.equal(spendsOf(game).standing.length, 1);

    // --- Regrant: a fresh timed identity (an effect resolved between turns of
    // play is simulated by writing the grant into the saved row, version + 1). ---
    const regrantState = structuredClone(game.state) as GameState | VmState;
    const regrantId = a.grantTimed(regrantState, watcher);
    assert.notEqual(regrantId, timedId);
    const bumped = await db.update(arenaGames).set({ state: regrantState, version: game.version + 1 }).where(eq(arenaGames.id, id)).returning({ version: arenaGames.version });
    assert.equal(bumped[0].version, game.version + 1);
    game = await load();
    const third = game.legal.find((entry) => entry.action.type === "activate" && entry.action.card === extras[2])?.action;
    assert.ok(third);
    game = await applyToGame(db, id, third, undefined, { game, expectedRevision: game.version, request: request(game.version, third, "alice") });
    game = await load();
    assert.equal(game.state.prompt.kind, "chooseCards", "the regrant pays again");
    assert.equal((game.state.prompt as { player: PlayerId }).player, "p2");
    await assertViewers(game, "p2", [standingKey], ["DB683G-S1", "DB683G-S2"]);
    const choice3 = choose(secrets[2]);
    const choice3Request = request(game.version, choice3, "bob");
    game = await applyToGame(db, id, choice3, undefined, { game, expectedRevision: game.version, request: choice3Request });
    game = await load();
    assert.equal(game.state.prompt.kind, "main", "exactly one payout for the one new identity");
    const finished = spendsOf(game);
    assert.equal(finished.timed(timedId), 1);
    assert.equal(finished.timed(regrantId), 1, "the regrant spends only its own identity");
    assert.equal(finished.standing.length, 1, "the standing grant is not refreshed by a timed regrant");
    assert.deepEqual(secretsInOpposingHand(game), [secrets[3]]);
    const finalRow = await row();
    const replayRegrant = await applyToGame(db, id, choice3, undefined, { game: await load(), expectedRevision: game.version - 1, request: choice3Request });
    assert.equal(replayRegrant.duplicateRequest, true);
    assert.deepEqual(await row(), finalRow, "the regrant payout cannot be replayed");
    await assertViewers(await load(), "none", [standingKey], ["DB683G-S1", "DB683G-S2", "DB683G-S3"]);
  } finally {
    await db.delete(arenaGames).where(eq(arenaGames.id, id));
  }
}

export async function verifyArenaGrantIdentity(db: Db): Promise<void> {
  await scenario(db, "legacy", legacyAdapter, 683200);
  console.log("#683 persisted legacy grant identity: timed + standing payouts, CAS, receipts, regrant and both seat projections passed");
  await scenario(db, "rules", rulesAdapter, 683300);
  console.log("#683 persisted rules grant identity: timed + standing payouts, CAS, receipts, regrant and both seat projections passed");
}
