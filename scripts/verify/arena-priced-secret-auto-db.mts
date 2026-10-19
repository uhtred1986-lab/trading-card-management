import { zeroSkillPrice } from "../../src/lib/arena/vm/skill-payment";
/** #549: persisted priced secret Auto declaration and payment (PGlite only). */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import type { Db } from "../../src/db/index.ts";
import { arenaGames } from "../../src/db/schema.ts";
import { applyToGame, loadGame, StaleGame } from "../../src/lib/arena/games.ts";
import { snapshotOfGame } from "../../src/lib/arena/session.ts";
import { RULES } from "../../src/lib/arena/vm/index.ts";
import { rulesetFor } from "../../src/lib/arena/rulesets/index.ts";
import { run } from "../../src/lib/arena/vm/flow.ts";
import { moveCard } from "../../src/lib/arena/vm/zones.ts";
import type { VmState } from "../../src/lib/arena/vm/state.ts";
import type { EngineContext, PlayerId } from "../../src/lib/arena/types.ts";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness.ts";

export async function verifyArenaPricedSecretAuto(db: Db): Promise<void> {
  const engine = RULES;
  const loadedRules = rulesetFor("dbs");
  assert.ok(loadedRules.ok);
  // Synthetic boundary record: no claim that this is a printed card.
  const defs = { ...DEFS,
    SECRET_PRICE549: card("SECRET_PRICE549", { energyCost: 0, skill: "[Auto] {r}: When you play this card, draw 1 card." }),
    ENERGY_PRICE549: card("ENERGY_PRICE549", { colors: ["Red"], energyCost: 0, skill: null }),
    OTHER_PRICE549: card("OTHER_PRICE549", { energyCost: 0, skill: null }),
  };
  const scripts = rulesFromCompiler(defs);
  const original = scripts.SECRET_PRICE549.bySkill[0];
  assert.ok(original);
  scripts.SECRET_PRICE549.bySkill[0] = { ...original, trigger: ["played"], unsupported: [], ops: [{ op: "draw", n: 1 }], price: { ...zeroSkillPrice(), ...original.price, condition: null, ops: null } };
  const ctx: EngineContext = { ...CTX, defs, scripts };
  let state = engine.createGame(ctx, { seed: 5494, p1: { name: "Alice", leader: "L-RED", main: fifty("V1") }, p2: { name: "Bob", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  state = engine.apply(ctx, state, { type: "chooseFirst", player: state.chooser, first: "p1" }).state as VmState;
  for (let i = 0; i < 24 && state.prompt.kind !== "main"; i++) state = engine.apply(ctx, state, { type: "pass", player: (state.prompt as { player: PlayerId }).player }).state as VmState;
  assert.equal(state.prompt.kind, "main");
  const [source, energy, other] = state.sides.p1.zones.hand.slice(0, 3);
  assert.ok(source && energy && other);
  state.cards[source].cardId = "SECRET_PRICE549";
  state.cards[energy].cardId = "ENERGY_PRICE549";
  state.cards[other].cardId = "OTHER_PRICE549";
  assert.ok(moveCard(state, loadedRules.definition, energy, "energy", { owner: "p1" }).ok);
  state.pending.push({ card: source, master: "p1", skillIndex: 0, trigger: "played" });
  run(ctx, loadedRules.definition, state, []);
  assert.equal(state.prompt.kind, "orderPending");

  const insert = async (version: number) => (await db.insert(arenaGames).values({
    p1Name: "Alice", p2Name: "Bob", p1User: "alice", p2User: "bob",
    seed: 5494, mode: "versus", engine: "rules", state, version,
  }).returning({ id: arenaGames.id }))[0].id;
  const loadFixture = async (id: number) => {
    const game = await loadGame(db, id);
    assert.ok(game);
    game.ctx = ctx;
    return game;
  };
  const concealed = async (id: number) => {
    const reread = await loadFixture(id);
    const result = await snapshotOfGame(db, reread, "p2");
    assert.equal(result.beats?.art[source], undefined);
    assert.equal(result.spotlight, null);
    assert.ok(!JSON.stringify(result).includes("SECRET_PRICE549") && !JSON.stringify(result).includes("When you play this card"));
    return result;
  };

  const declinedId = await insert(10);
  try {
    const waiting = await loadFixture(declinedId);
    const rowBefore = (await db.select().from(arenaGames).where(eq(arenaGames.id, declinedId)))[0];
    await assert.rejects(() => applyToGame(db, declinedId, { type: "orderPending", player: "p2", index: 0, decline: true }, undefined, { game: waiting }), /p1's decision/);
    await assert.rejects(() => applyToGame(db, declinedId, { type: "orderPending", player: "p1", index: 0, decline: true }, undefined, { game: waiting, expectedRevision: 9 }), StaleGame);
    assert.deepEqual((await db.select().from(arenaGames).where(eq(arenaGames.id, declinedId)))[0], rowBefore);
    const declined = await applyToGame(db, declinedId, { type: "orderPending", player: "p1", index: 0, decline: true },
      { say: "SECRET_PRICE549 declined", aside: "SECRET_PRICE549 aside" }, { game: waiting, expectedRevision: 10 });
    assert.equal(declined.version, 11);
    assert.deepEqual(declined.actions.at(-1), { type: "orderPending", player: "p1", index: 0, decline: true });
    assert.deepEqual(declined.log, []);
    assert.equal(declined.beats?.list.some((beat) => beat.t === "autoDeclared" || beat.t === "skill"), false);
    await concealed(declinedId);
  } finally {
    await db.delete(arenaGames).where(eq(arenaGames.id, declinedId));
  }

  const declarationId = await insert(20);
  try {
    const waiting = await loadFixture(declarationId);
    const declared = await applyToGame(db, declarationId, { type: "orderPending", player: "p1", index: 0 }, undefined, { game: waiting, expectedRevision: 20 });
    assert.equal(declared.state.prompt.kind, "chooseMode");
    assert.equal(declared.beats?.list.filter((beat) => beat.t === "autoDeclared" && beat.card === source).length, 1);
    assert.equal(declared.beats?.list.some((beat) => beat.t === "skill" && beat.card === source), false);
    assert.equal((declared.state as VmState).cards[energy].mode, "active");
    assert.ok(!declared.log.join(" ").includes("SECRET_PRICE549"));
    const offered = await loadFixture(declarationId);
    for (const viewer of ["p1", "p2"] as const) {
      const shown = await snapshotOfGame(db, offered, viewer);
      // p1 reads its own hand; p2 is shown the card under an opaque name, never its instance id (`conceal.ts`).
      assert.equal(shown.beats?.art[viewer === "p1" ? source : "?shown:0"]?.cardId, "SECRET_PRICE549");
      assert.equal(shown.beats?.art[other], undefined);
      assert.equal(shown.spotlight, null);
      const publicDeclared = shown.beats?.list.find((beat) => beat.t === "autoDeclared" && beat.card === (viewer === "p1" ? source : "?shown:0"));
      assert.ok(publicDeclared && publicDeclared.t === "autoDeclared");
      assert.equal(Object.hasOwn(publicDeclared, "revealEpoch"), false, "saved-session declaration DTO omits the private epoch for either viewer");
      assert.ok(!JSON.stringify(shown).includes("revealEpoch"));
      assert.ok(!shown.log.join(" ").includes("SECRET_PRICE549"));
    }
    const rowBefore = (await db.select().from(arenaGames).where(eq(arenaGames.id, declarationId)))[0];
    await assert.rejects(() => applyToGame(db, declarationId, { type: "chooseMode", player: "p2", index: 0 }, undefined, { game: offered }), /p1's decision/);
    await assert.rejects(() => applyToGame(db, declarationId, { type: "chooseMode", player: "p1", index: 0 }, undefined, { game: offered, expectedRevision: 20 }), StaleGame);
    assert.deepEqual((await db.select().from(arenaGames).where(eq(arenaGames.id, declarationId)))[0], rowBefore);
    const paid = await applyToGame(db, declarationId, { type: "chooseMode", player: "p1", index: 0 }, undefined, { game: offered, expectedRevision: 21 });
    assert.equal((paid.state as VmState).cards[energy].mode, "rest");
    assert.equal(paid.beats?.list.filter((beat) => beat.t === "skill" && beat.card === source).length, 1);
    assert.ok(!paid.log.join(" ").includes("SECRET_PRICE549") && !paid.log.join(" ").includes("When you play this card"));
    const reread = await loadFixture(declarationId);
    const shown = await snapshotOfGame(db, reread, "p2");
    assert.equal(shown.beats?.art["?shown:0"]?.cardId, "SECRET_PRICE549");
    assert.equal(shown.beats?.list.filter((beat) => (beat.t === "autoDeclared" || beat.t === "skill") && beat.card === "?shown:0").length, 2);
    assert.ok(!JSON.stringify(shown).includes(`"${source}"`), "the declared card's instance id is not on p2's board");
    assert.ok(!JSON.stringify(shown).includes("revealEpoch"));
    const later = await applyToGame(db, declarationId, { type: "pass", player: "p1" }, undefined, { game: reread, expectedRevision: 22 });
    assert.equal(later.version, 23);
    const masked = await concealed(declarationId);
    assert.ok(masked.beats?.list.every((beat) => (beat.t !== "autoDeclared" && beat.t !== "skill") || beat.card !== source || (beat.text === "" && beat.label === "Skill")));
  } finally {
    await db.delete(arenaGames).where(eq(arenaGames.id, declarationId));
  }
}
