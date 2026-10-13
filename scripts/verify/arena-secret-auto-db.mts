/** #549: persisted silent-decline projection for both versus viewers (PGlite only). */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import type { Db } from "../../src/db/index.ts";
import { arenaGames } from "../../src/db/schema.ts";
import { applyToGame, describeEvents, loadGame, StaleGame } from "../../src/lib/arena/games.ts";
import { snapshotOfGame } from "../../src/lib/arena/session.ts";
import { engineFor } from "../../src/lib/arena/engines.ts";
import { rulesetFor } from "../../src/lib/arena/rulesets/index.ts";
import { run } from "../../src/lib/arena/vm/flow.ts";
import type { VmState } from "../../src/lib/arena/vm/state.ts";
import type { EngineContext, PlayerId } from "../../src/lib/arena/types.ts";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness.ts";

export async function verifyArenaSecretAuto(db: Db): Promise<void> {
  const engine = engineFor("rules");
  const loadedRules = rulesetFor("dbs");
  assert.ok(loadedRules.ok);
  const defs = { ...DEFS,
    SECRET549: card("SECRET549", { energyCost: 0, skill: "[Auto] When you play this card, draw 1 card." }),
    OTHER549: card("OTHER549", { energyCost: 0, skill: null }),
  };
  const scripts = rulesFromCompiler(defs);
  const original = scripts.SECRET549.bySkill[0];
  assert.ok(original);
  scripts.SECRET549.bySkill[0] = { ...original, trigger: ["played"], unsupported: [], ops: [{ op: "draw", n: 1 }], price: { ...original.price, condition: null, ops: null } };
  const ctx: EngineContext = { ...CTX, defs, scripts };
  let state = engine.createGame(ctx, { seed: 5492, p1: { name: "Alice", leader: "L-RED", main: fifty("V1") }, p2: { name: "Bob", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  state = engine.apply(ctx, state, { type: "chooseFirst", player: state.chooser, first: "p1" }).state as VmState;
  for (let i = 0; i < 24 && state.prompt.kind !== "main"; i++) state = engine.apply(ctx, state, { type: "pass", player: (state.prompt as { player: PlayerId }).player }).state as VmState;
  assert.equal(state.prompt.kind, "main");
  const [secret, other] = state.sides.p1.zones.hand.slice(0, 2);
  assert.ok(secret && other);
  state.cards[secret].cardId = "SECRET549";
  state.cards[other].cardId = "OTHER549";
  state.pending.push({ card: secret, master: "p1", skillIndex: 0, trigger: "played" });
  run(ctx, loadedRules.definition, state, []);
  assert.equal(state.prompt.kind, "orderPending");
  const publicSource = state.sides.p1.zones.leader[0];
  assert.ok(publicSource);
  assert.match(describeEvents(ctx, state, [{ type: "skill", card: publicSource, skill: 0, master: "p1", text: "normal public Auto", inBattle: false }])[0], /normal public Auto/, "ordinary public skill lines remain logged");

  const [created] = await db.insert(arenaGames).values({
    p1Name: "Alice", p2Name: "Bob", p1User: "alice", p2User: "bob",
    seed: 5492, mode: "versus", engine: "rules", state, version: 7,
  }).returning({ id: arenaGames.id });
  try {
    const loadFixture = async () => {
      const game = await loadGame(db, created.id);
      assert.ok(game);
      game.ctx = ctx;
      return game;
    };
    const loaded = await loadFixture();
    const before = (await db.select().from(arenaGames).where(eq(arenaGames.id, created.id)))[0];
    assert.throws(() => engine.apply(ctx, state, { type: "orderPending", player: "p2", index: 0, decline: true }), /p1's decision/);
    await assert.rejects(() => applyToGame(db, created.id, { type: "orderPending", player: "p2", index: 0, decline: true }, undefined, { game: loaded }), /p1's decision/);
    await assert.rejects(() => applyToGame(db, created.id, { type: "orderPending", player: "p1", index: 0, decline: true }, undefined, { game: loaded, expectedRevision: 6 }), StaleGame);
    assert.deepEqual((await db.select().from(arenaGames).where(eq(arenaGames.id, created.id)))[0], before, "refused actor and stale CAS never mutate the row");

    const declined = await applyToGame(db, created.id, { type: "orderPending", player: "p1", index: 0, decline: true },
      { say: "I decline my SECRET549 hidden Auto", aside: "[debug] declined SECRET549" }, { game: loaded, expectedRevision: 7 });
    assert.equal(declined.version, 8);
    assert.deepEqual(declined.actions.at(-1), { type: "orderPending", player: "p1", index: 0, decline: true }, "private replay retains the actual action");
    assert.deepEqual(declined.log, []);
    const reloaded = await loadFixture();
    for (const viewer of ["p1", "p2"] as const) {
      const projected = await snapshotOfGame(db, reloaded, viewer);
      assert.deepEqual(projected.log, []);
      assert.equal(projected.beats?.list.some((beat) => beat.t === "skill" && beat.card === secret) ?? false, false);
      if (viewer === "p2") {
        const publicData = JSON.stringify(projected);
        assert.ok(!publicData.includes("SECRET549") && !publicData.includes("OTHER549"));
      }
    }
    const ordinary = await applyToGame(db, created.id, { type: "pass", player: "p1" }, { say: "A quiet pass." }, { game: reloaded, expectedRevision: 8 });
    assert.ok(ordinary.log.some((line) => line.includes("A quiet pass.")), "ordinary later table talk remains available");
  } finally {
    await db.delete(arenaGames).where(eq(arenaGames.id, created.id));
  }

  // The declared branch persists its temporary public witness with the beat.
  // A later unrelated action ends that witness, so a retained beat history
  // cannot keep identifying the card in its current secret area.
  const [declaring] = await db.insert(arenaGames).values({
    p1Name: "Alice", p2Name: "Bob", p1User: "alice", p2User: "bob",
    seed: 5492, mode: "versus", engine: "rules", state, version: 3,
  }).returning({ id: arenaGames.id });
  try {
    const pending = await loadGame(db, declaring.id);
    assert.ok(pending);
    pending.ctx = ctx;
    const activated = await applyToGame(db, declaring.id, { type: "orderPending", player: "p1", index: 0 }, undefined, { game: pending, expectedRevision: 3 });
    assert.equal(activated.version, 4);
    assert.ok(!activated.log.join(" ").includes("SECRET549") && !activated.log.join(" ").includes("When you play this card"), "a transient declaration leaves no permanent identifying log line");
    const reread = await loadGame(db, declaring.id);
    assert.ok(reread);
    reread.ctx = ctx;
    const shown = await snapshotOfGame(db, reread, "p2");
    // Shown to p2 under an opaque name, never its instance id, a hidden decklist position (`conceal.ts`).
    assert.equal(shown.beats?.art["?shown:0"]?.cardId, "SECRET549");
    assert.equal(shown.beats?.art[secret], undefined);
    assert.equal(shown.beats?.art[other], undefined);
    assert.equal(shown.spotlight, null, "VM declarations do not create a persistent spotlight");
    assert.ok(!shown.log.join(" ").includes("SECRET549") && !shown.log.join(" ").includes("When you play this card"));
    assert.ok(!JSON.stringify(shown).includes("revealEpoch"));
    const later = await applyToGame(db, declaring.id, { type: "pass", player: "p1" }, undefined, { game: reread, expectedRevision: 4 });
    assert.equal(later.version, 5);
    const concealed = await loadGame(db, declaring.id);
    assert.ok(concealed);
    concealed.ctx = ctx;
    const masked = await snapshotOfGame(db, concealed, "p2");
    assert.equal(masked.beats?.art[secret], undefined);
    assert.equal(masked.beats?.art["?shown:0"], undefined);
    assert.equal(masked.spotlight, null);
    assert.ok(!masked.log.join(" ").includes("SECRET549") && !masked.log.join(" ").includes("When you play this card"), "later saved log cannot restore the secret declaration");
    const oldSkill = masked.beats?.list.find((beat) => beat.t === "skill");
    assert.equal(oldSkill?.t === "skill" ? oldSkill.card : undefined, "?", "an expired declaration names no card");
    assert.equal(oldSkill?.t === "skill" ? oldSkill.text : undefined, "", "retained skill beat is masked after the declaration expires");
    assert.ok(!JSON.stringify(masked).includes("SECRET549"), "the whole later viewer snapshot conceals the previously declared card");
  } finally {
    await db.delete(arenaGames).where(eq(arenaGames.id, declaring.id));
  }
}
