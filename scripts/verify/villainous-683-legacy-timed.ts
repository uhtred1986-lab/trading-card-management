/** #683: legacy timed keyword grants keep distinct identities through saved prompts. */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { engineFor } from "../../src/lib/arena/engines";
import { addEffect, has, move } from "../../src/lib/arena/engine/state";
import type { GameState, PlayerId } from "../../src/lib/arena/types";

export function verifyLegacyTimedGrants(): void {
  const engine = engineFor("legacy");
  const IDs = ["V683T_WATCH", "V683T_PRINT", "V683T_SOURCE", "V683T_EXTRA", "V683T_HERO", "V683T_REMOVE", "V683T_STANDING"];
  const old = new Map(IDs.map((id) => [id, DEFS[id]]));
  DEFS.V683T_WATCH = card("V683T_WATCH", { energyCost: 0, skill: null });
  DEFS.V683T_PRINT = card("V683T_PRINT", { energyCost: 0, skill: "[Villainous]" });
  DEFS.V683T_SOURCE = card("V683T_SOURCE", { energyCost: 0, skill: null });
  DEFS.V683T_EXTRA = card("V683T_EXTRA", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Villainous]<br>[Activate: Main]: Draw 1 card." });
  DEFS.V683T_HERO = card("V683T_HERO", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Heroic]<br>[Activate: Main]: Draw 1 card." });
  DEFS.V683T_REMOVE = card("V683T_REMOVE", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Villainous]<br>[Activate: Main]: Choose 1 of your Battle Cards and place it in its owner's Drop Area." });
  DEFS.V683T_STANDING = card("V683T_STANDING", { energyCost: 0, skill: "[Permanent] This card gains [Villainous]." });

  function main(seed: number): GameState {
    let s = engine.createGame(CTX, { seed, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as GameState;
    s = engine.apply(CTX, s, { type: "chooseFirst", player: (s.prompt as { player: PlayerId }).player, first: "p1" }).state as GameState;
    for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) {
      const next = engine.legalActions(CTX, s)[0]?.action;
      assert.ok(next);
      s = engine.apply(CTX, s, next).state as GameState;
    }
    assert.equal(s.prompt.kind, "main");
    return s;
  }

  function stage(s: GameState, cardId: string, zone: "hand" | "battle", player: PlayerId = "p1"): string {
    const id = s.players[player].hand.find((c) => !IDs.includes(s.cards[c].cardId))!;
    assert.ok(id);
    s.cards[id].cardId = cardId;
    if (zone === "battle") move(CTX, s, [], id, "battle", player, { reason: "effect" });
    return id;
  }

  function grant(s: GameState, source: string, target: string, name: "Villainous" | "Heroic", until: "turn" | "whileSourceInPlay" = "turn"): number {
    return addEffect(s, [], { master: "p1", source, target, kind: "keyword", value: { name }, until }).id;
  }

  function activate(s: GameState, cardId = "V683T_EXTRA") {
    const source = stage(s, cardId, "hand");
    const action = engine.legalActions(CTX, s).find((entry) => entry.action.type === "activate" && entry.action.card === source)?.action;
    assert.ok(action, "real legal Extra Main activation");
    return engine.apply(CTX, s, action);
  }

  function payPending(state: GameState, count: number): GameState {
    let s = JSON.parse(JSON.stringify(state)) as GameState;
    for (let i = 0; i < count; i++) {
      assert.equal(s.prompt.kind, "chooseCards", `Villainous choice ${i + 1}/${count}`);
      assert.equal(s.prompt.player, "p2");
      const choice = s.prompt.choice.candidates[0]!;
      assert.ok(choice);
      s = engine.apply(CTX, JSON.parse(JSON.stringify(s)), { type: "choose", player: "p2", cards: [choice] }).state as GameState;
    }
    assert.equal(s.prompt.kind, "main", "no duplicate keyword payout");
    return s;
  }

  function assertPrivateViews(state: GameState, watcher: string): void {
    const saved = JSON.parse(JSON.stringify(state)) as GameState;
    for (const viewer of ["p1", "p2"] as const) {
      const view = engine.boardView(CTX, saved, viewer, {});
      assert.equal(view.you.player, viewer);
      assert.equal(view.them.hand, null, "neither seat sees the other seat's hand");
      const visible = [...view.you.battle, ...view.them.battle].find((card) => card.id === watcher);
      assert.ok(visible, "the timed watcher remains public to both seats");
      for (const effect of visible.effects ?? []) {
        assert.ok(!Object.hasOwn(effect, "id") && !Object.hasOwn(effect, "value"), "public effect labels omit the private spend ID");
      }
      const rendered = JSON.stringify(view);
      assert.ok(!rendered.includes("grantEffectId") && !rendered.includes("afterSkillKeyword") && !rendered.includes("negateGrantedSkill"), "pending identity and raw effect kind stay out of both projections");
    }
  }

  // Printed and two separately granted Villainous instances all answer the
  // same successful Extra skill, spend separately, and survive JSON reload.
  {
    const s = main(683201);
    const watcher = stage(s, "V683T_PRINT", "battle");
    const first = grant(s, watcher, watcher, "Villainous");
    const second = grant(s, watcher, watcher, "Villainous");
    const opposingHand = s.players.p2.hand.length;
    const started = activate(s);
    assert.equal(started.state.prompt.kind, "chooseCards");
    assert.deepEqual((started.state as GameState).pending.filter((p) => p.card === watcher).map((p) => p.grantEffectId), [first, second]);
    const done = payPending(started.state as GameState, 3);
    assert.equal(done.players.p2.hand.length, opposingHand - 3);
    assert.ok(done.effects.some((e) => e.kind === "negateSkill" && e.target === watcher && e.value === 0));
    for (const id of [first, second]) assert.equal(done.effects.filter((e) => e.kind === "negateGrantedSkill" && e.target === watcher && e.value === id).length, 1);
    assert.ok(!has(CTX, done, watcher, "Villainous"), "all three identities are individually spent");
    console.log("  legacy printed + two timed Villainous: three choices and three distinct spends");
  }

  // A new timed grant is a new skill on the same card during the same turn.
  {
    const s = main(683202);
    const watcher = stage(s, "V683T_WATCH", "battle");
    const first = grant(s, watcher, watcher, "Villainous");
    const done = payPending(activate(s).state as GameState, 1);
    assert.ok(!has(CTX, done, watcher, "Villainous"));
    const second = grant(done, watcher, watcher, "Villainous");
    assert.notEqual(first, second);
    assert.ok(has(CTX, done, watcher, "Villainous"));
    const again = payPending(activate(done).state as GameState, 1);
    assert.equal(again.effects.filter((e) => e.kind === "negateGrantedSkill" && e.target === watcher).length, 2);
    assert.ok(!has(CTX, again, watcher, "Villainous"));
    console.log("  legacy timed Villainous: same-turn regrant gets a fresh payout");
  }

  // A prior standing/old-save payout uses the legacy -1 mark. That mark is
  // not the identity of a later timed grant, even if its source expires after
  // the event captures the new grant but before the pending choice resolves.
  {
    const s = main(683206);
    const watcher = stage(s, "V683T_STANDING", "battle");
    const oldDone = payPending(activate(s).state as GameState, 1);
    assert.ok(oldDone.effects.some((e) => e.kind === "negateSkill" && e.target === watcher && e.value === -1), "standing grant used the legacy -1 spend");
    const source = stage(oldDone, "V683T_SOURCE", "battle");
    const id = grant(oldDone, source, watcher, "Villainous", "whileSourceInPlay");
    const started = activate(oldDone, "V683T_REMOVE");
    assert.equal(started.state.prompt.kind, "chooseCards");
    assert.equal(started.state.prompt.player, "p1");
    assert.deepEqual((started.state as GameState).pending.filter((p) => p.card === watcher).map((p) => p.grantEffectId), [id], "-1 standing spend cannot suppress the new timed pending identity");
    assertPrivateViews(started.state as GameState, watcher);
    const opposingHand = (started.state as GameState).players.p2.hand.length;
    const removed = engine.apply(CTX, JSON.parse(JSON.stringify(started.state)), { type: "choose", player: "p1", cards: [source] });
    assert.ok(!(removed.state as GameState).effects.some((e) => e.id === id), "timed grant expired with its source before resolution");
    const done = payPending(removed.state as GameState, 1);
    assert.equal(done.players.p2.hand.length, opposingHand - 1);
    assert.equal(done.effects.filter((e) => e.kind === "negateGrantedSkill" && e.target === watcher && e.value === id).length, 1);
    assert.equal(done.effects.filter((e) => e.kind === "negateSkill" && e.target === watcher && e.value === -1).length, 1, "old -1 mark is unchanged");
    assertPrivateViews(done, watcher);
    console.log("  legacy -1 standing spend does not suppress a later timed grant after source expiry and reload");
  }

  // The pending hook is captured at activation. Its timed source can leave
  // before the Extra effect completes without erasing that pending activation.
  {
    const s = main(683203);
    const watcher = stage(s, "V683T_WATCH", "battle");
    const source = stage(s, "V683T_SOURCE", "battle");
    const id = grant(s, source, watcher, "Villainous", "whileSourceInPlay");
    const started = activate(s, "V683T_REMOVE");
    assert.equal(started.state.prompt.kind, "chooseCards", "the Extra effect first chooses its target");
    assert.equal(started.state.prompt.player, "p1");
    assert.ok((started.state as GameState).pending.some((p) => p.card === watcher && p.grantEffectId === id), JSON.stringify({ pending: (started.state as GameState).pending, effects: (started.state as GameState).effects, watcher }));
    const removed = engine.apply(CTX, JSON.parse(JSON.stringify(started.state)), { type: "choose", player: "p1", cards: [source] });
    assert.ok((removed.state as GameState).players.p1.drop.includes(source));
    assert.ok(!(removed.state as GameState).effects.some((e) => e.id === id), "source departure expired grant before payout");
    const done = payPending(removed.state as GameState, 1);
    assert.ok(done.effects.some((e) => e.kind === "negateGrantedSkill" && e.target === watcher && e.value === id));
    assert.ok(!has(CTX, done, watcher, "Villainous"));
    move(CTX, done, [], source, "battle", "p1", { reason: "effect" });
    const fresh = grant(done, source, watcher, "Villainous", "whileSourceInPlay");
    assert.notEqual(id, fresh);
    const again = payPending(activate(done).state as GameState, 1);
    assert.ok(again.effects.some((e) => e.kind === "negateGrantedSkill" && e.target === watcher && e.value === fresh));
    console.log("  legacy timed Villainous: captured hook survives source expiry; new source entry regrants");
  }

  // A bearer that leaves its area is a new card there. The pending old grant
  // still resolves; on reentry neither its timed grant nor its spend remains.
  {
    const s = main(683204);
    const watcher = stage(s, "V683T_WATCH", "battle");
    stage(s, "V683T_SOURCE", "battle"); // keep the effect target choice pending
    const id = grant(s, watcher, watcher, "Villainous");
    const started = activate(s, "V683T_REMOVE");
    assert.equal(started.state.prompt.kind, "chooseCards");
    assert.equal(started.state.prompt.player, "p1");
    assert.ok((started.state as GameState).pending.some((p) => p.card === watcher && p.grantEffectId === id), JSON.stringify({ pending: (started.state as GameState).pending, effects: (started.state as GameState).effects, watcher }));
    const removed = engine.apply(CTX, JSON.parse(JSON.stringify(started.state)), { type: "choose", player: "p1", cards: [watcher] });
    assert.ok((removed.state as GameState).players.p1.drop.includes(watcher));
    const done = payPending(removed.state as GameState, 1);
    assert.ok(done.effects.some((e) => e.kind === "negateGrantedSkill" && e.target === watcher && e.value === id));
    move(CTX, done, [], watcher, "battle", "p1", { reason: "effect" });
    assert.ok(!done.effects.some((e) => e.kind === "negateGrantedSkill" && e.target === watcher && e.value === id));
    const fresh = grant(done, watcher, watcher, "Villainous");
    const again = payPending(activate(done).state as GameState, 1);
    assert.ok(again.effects.some((e) => e.kind === "negateGrantedSkill" && e.target === watcher && e.value === fresh));
    console.log("  legacy timed Villainous: pending bearer departure and fresh area-entry regrant");
  }

  // Event keyword, owner and spend ID must all agree. Heroic pays its own
  // watcher once and leaves Villainous and the opposite player's grant alone.
  {
    const s = main(683205);
    const watcher = stage(s, "V683T_WATCH", "battle");
    const opposite = stage(s, "V683T_WATCH", "battle", "p2");
    const villainous = grant(s, watcher, watcher, "Villainous");
    const heroic = grant(s, watcher, watcher, "Heroic");
    const oppositeHeroic = addEffect(s, [], { master: "p2", source: opposite, target: opposite, kind: "keyword", value: { name: "Heroic" }, until: "turn" }).id;
    const started = activate(s, "V683T_HERO");
    assert.equal(started.state.prompt.kind, "main", "Heroic draw needs no choice");
    assert.equal(started.events.filter((e) => e.type === "draw" && e.player === "p1").length, 2, "Extra effect and one Heroic grant each draw once");
    assert.ok(!(started.state as GameState).effects.some((e) => e.kind === "negateGrantedSkill" && e.value === villainous));
    assert.ok((started.state as GameState).effects.some((e) => e.kind === "negateGrantedSkill" && e.value === heroic));
    assert.ok(!(started.state as GameState).effects.some((e) => e.kind === "negateGrantedSkill" && e.value === oppositeHeroic));
    assert.ok(has(CTX, started.state as GameState, watcher, "Villainous"));
    const done = payPending(activate(started.state as GameState).state as GameState, 1);
    assert.ok(done.effects.some((e) => e.kind === "negateGrantedSkill" && e.value === villainous));
    assert.ok(!done.effects.some((e) => e.kind === "negateGrantedSkill" && e.value === oppositeHeroic));
    console.log("  legacy timed Heroic/Villainous: opposite keyword and owner never cross-spend");
  }

  for (const id of IDs) {
    const prior = old.get(id);
    if (prior) DEFS[id] = prior;
    else delete DEFS[id];
  }
}
