/** R-400/R-401: choose one actual keyword instance, including Q&A BT2-048's Double Strike examples. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { run } from "../../src/lib/arena/vm/flow";
import { vmHost } from "../../src/lib/arena/vm/host";
import { addEffect, endEffects } from "../../src/lib/arena/vm/effects";
import { attrsNow, hasKeyword, hookBodiesFor, keywordInstancesInForce, queryHookStatics } from "../../src/lib/arena/vm/program";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Op, ScriptFrame } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";

const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const defs: Record<string, CardDef> = {
  KI_LEADER: card("KI_LEADER", { type: "LEADER", colors: ["Blue"], energyCost: null, comboCost: null, comboPower: null }),
  KI_FILLER: card("KI_FILLER", {}),
  KI_SOURCE: card("KI_SOURCE", {}),
  KI_DOUBLE: card("KI_DOUBLE", { skill: "[Double Strike]", power: 30000 }),
  KI_DUPLICATE: card("KI_DUPLICATE", { skill: "[Double Strike][Double Strike]", power: 30000 }),
  KI_PARAMETRIC: card("KI_PARAMETRIC", { skill: "[Double Strike][Triple Strike]", power: 30000 }),
  KI_BOND: card("KI_BOND", { skill: "[Double Strike][Bond 3]<br>[Double Strike]" }),
  KI_BARRIER: card("KI_BARRIER", { skill: "[Barrier][Blocker]" }),
  KI_STANDING: card("KI_STANDING", { skill: "[Permanent] Your Battle Cards gain [Double Strike]." }),
  KI_FLIP: card("KI_FLIP", { skill: "[Double Strike]", back: { name: "Back", power: 30000, skill: "[Triple Strike]" } }),
};
const rows = Object.values(defs).flatMap(d => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow));
assert.deepEqual(rows.flatMap(r => r.unread ?? []), [], "all isolated fixtures compile before game time");
const ctx: EngineContext = { defs, scripts: rulesFromRows(copy(rows), defs) };
let cases = 0;
for (const gameId of ["dbs", "fusion"] as const) {
  const loaded = rulesetFor(gameId); assert.ok(loaded.ok); const game = loaded.definition;
  const fresh = (first: PlayerId = "p1") => {
    let s = RULES.createGame(ctx, { game: gameId, seed: 73, p1: { name: "First", leader: "KI_LEADER", main: fifty("KI_FILLER") }, p2: { name: "Second", leader: "KI_LEADER", main: fifty("KI_FILLER") } }).state as VmState;
    for (const a of [{ type: "chooseFirst", player: s.chooser, first }, { type: "mulligan", player: first, redraw: false }, { type: "mulligan", player: first === "p1" ? "p2" : "p1", redraw: false }, { type: "charge", player: first, card: null }] as Action[]) s = copy(RULES.apply(ctx, s, a).state as VmState);
    return s;
  };
  const stage = (s: VmState, player: PlayerId, def: string) => {
    const id = s.sides[player].zones.deck.at(-1)!;
    s.cards[id].cardId = def;
    assert.ok(moveCard(s, game, id, "battle", { owner: player }).ok);
    s.pending = [];
    return id;
  };
  const enact = (s: VmState, source: string, master: PlayerId, ops: Op[]) => {
    s.programs.push({ ops: copy(ops), ip: 0, vars: {}, card: source, master });
    run(ctx, game, s, []);
  };
  const ask = (s: VmState, source: string, master: PlayerId, victim: string) => {
    const frame: ScriptFrame = { ops: [{ op: "negateChosenKeyword", target: { var: "victim" }, until: "turn", mandatory: true }], ip: 0, vars: { victim: [victim] }, card: source, master };
    s.programs.push(frame); run(ctx, game, s, []);
    assert.equal(s.prompt.kind, "chooseMode");
    return frame;
  };
  const answer = (s: VmState, master: PlayerId, index: number) => RULES.apply(ctx, copy(s), { type: "chooseMode", player: master, index }).state as VmState;
  const grant = (s: VmState, source: string, victim: string, x: 2 | 3 = 2) => addEffect(s, [], { source, target: victim, kind: "keyword", value: { name: "Strike", x }, until: "turn", master: s.cards[source].owner });
  const instances = (s: VmState, victim: string) => keywordInstancesInForce(ctx, game, s, victim);
  const damage = (s: VmState, victim: string) => Math.max(1, ...queryHookStatics(ctx, game, s, victim, "beforeDamage").filter(f => f.op === "battleDamage").map(f => f.op === "battleDamage" ? f.atLeast ?? 1 : 1));
  const actualDamage = (s: VmState, attacker: string) => {
    const player = s.cards[attacker].owner, other = player === "p1" ? "p2" : "p1";
    s = copy(s);
    s.turn = 3; // A later Main Phase: the first turn cannot attack.
    const before = s.sides[other].zones.life.length;
    s = RULES.apply(ctx, copy(s), { type: "attack", player, attacker, target: s.sides[other].zones.leader[0] }).state as VmState;
    for (let i = 0; i < 15 && s.battle; i++) {
      const action = RULES.legalActions(ctx, s).map(a => a.action).find(a => a.type === "pass" || (a.type === "counter" && a.card === null) || (a.type === "block" && a.card === null));
      assert.ok(action, `battle can finish from ${s.prompt.kind}`);
      s = RULES.apply(ctx, s, action).state as VmState;
    }
    assert.equal(s.battle, null);
    return before - s.sides[other].zones.life.length;
  };
  for (const owner of ["p1", "p2"] as const) {
    const master = owner === "p1" ? "p2" : "p1";
    // Official Q&A: two Double Strike copies, one negated, still two damage.
    {
      let s = fresh(owner); const victim = stage(s, owner, "KI_DUPLICATE"), source = stage(s, master, "KI_SOURCE");
      const menu = ask(s, source, master, victim).keywordChoices!;
      assert.equal(menu.length, 2); assert.notEqual(menu[0].skillIndex, menu[1].skillIndex);
      assert.ok(s.prompt.kind === "chooseMode");
      assert.deepEqual(s.prompt.options, ["[Double Strike] (printed copy 1)", "[Double Strike] (printed copy 2)"]);
      s = answer(s, master, 0);
      assert.equal(instances(s, victim).length, 1);
      assert.equal(instances(s, victim)[0].skillIndex, menu[1].skillIndex);
      assert.equal(hookBodiesFor(ctx, game, s, victim, "beforeDamage")[0].skillIndex, menu[1].skillIndex);
      assert.ok(hasKeyword(ctx, game, s, victim, "Strike")); assert.equal(attrsNow(ctx, game, s, victim).skillLess, false);
      assert.equal(actualDamage(s, victim), 2);
      ask(s, source, master, victim); s = answer(s, master, 0);
      assert.equal(instances(s, victim).length, 0); assert.equal(attrsNow(ctx, game, s, victim).skillLess, true);
      assert.deepEqual(attrsNow(ctx, game, s, victim).keywords, []);
      endEffects(s, [], "turn"); assert.equal(instances(s, victim).length, 2);
      cases++;
    }
    // Different parameters keep their own printed identity and damage hook.
    {
      let s = fresh(owner); const victim = stage(s, owner, "KI_PARAMETRIC"), source = stage(s, master, "KI_SOURCE");
      ask(s, source, master, victim); s = answer(s, master, 1);
      assert.equal(damage(s, victim), 2); assert.equal(actualDamage(s, victim), 2);
      assert.equal(hookBodiesFor(ctx, game, s, victim, "beforeDamage")[0].skillIndex, 0); cases++;
    }
    // Printed + two grants are distinct; a new grant after negation still works.
    for (const pick of [0, 1, 2]) {
      let s = fresh(owner); const victim = stage(s, owner, "KI_DOUBLE"), source = stage(s, master, "KI_SOURCE");
      const grants = [grant(s, source, victim), grant(s, source, victim, 3)];
      const menu = ask(s, source, master, victim).keywordChoices!; s = answer(s, master, pick);
      assert.equal(instances(s, victim).length, 2);
      assert.ok(!instances(s, victim).some(k => pick === 0 ? k.skillIndex === menu[pick].skillIndex : k.grantEffectId === grants[pick - 1].id));
      cases++;
    }
    {
      let s = fresh(owner); const victim = stage(s, owner, "KI_DOUBLE"), source = stage(s, master, "KI_SOURCE");
      ask(s, source, master, victim); s = answer(s, master, 0);
      assert.equal(damage(s, victim), 1); assert.equal(attrsNow(ctx, game, s, victim).skillLess, true);
      grant(s, source, victim); assert.equal(damage(s, victim), 2); assert.equal(actualDamage(s, victim), 2);
      assert.equal(attrsNow(ctx, game, s, victim).skillLess, false); cases++;
    }
    // Two standing sources and their area entries are separate instances.
    {
      let s = fresh(owner); const victim = stage(s, owner, "KI_FILLER"), source = stage(s, master, "KI_SOURCE");
      const a = stage(s, owner, "KI_STANDING"), b = stage(s, owner, "KI_STANDING");
      const menu = ask(s, source, master, victim).keywordChoices!; assert.equal(menu.length, 2);
      s = answer(s, master, 0); assert.equal(instances(s, victim).length, 1);
      assert.equal(instances(s, victim)[0].standingGrantId, menu[1].standingGrantId);
      assert.equal(damage(s, victim), 2);
      vmHost(ctx, game, s, []).move(a, "drop", owner); vmHost(ctx, game, s, []).move(a, "battle", owner);
      assert.equal(instances(s, victim).length, 2, "returned source grants a new instance");
      vmHost(ctx, game, s, []).move(b, "drop", owner); assert.equal(instances(s, victim).length, 1);
      cases++;
    }
    // Persisted prompt refuses a removed instance rather than moving the index to a new grant.
    {
      let s = fresh(owner); const victim = stage(s, owner, "KI_FILLER"), source = stage(s, master, "KI_SOURCE");
      const old = grant(s, source, victim); ask(s, source, master, victim);
      s.effects = s.effects.filter(e => e.id !== old.id); const later = grant(s, source, victim);
      s = answer(s, master, 0); assert.equal(instances(s, victim)[0].grantEffectId, later.id); cases++;
    }
    // New card incarnation and another printed face cannot inherit a chosen index.
    {
      let s = fresh(owner); const victim = stage(s, owner, "KI_FLIP"), source = stage(s, master, "KI_SOURCE");
      ask(s, source, master, victim); s = answer(s, master, 0); assert.equal(damage(s, victim), 1);
      s.cards[victim].flipped = true; assert.equal(damage(s, victim), 3); assert.deepEqual(attrsNow(ctx, game, s, victim).keywords, ["Strike"]);
      s.cards[victim].flipped = false; assert.equal(damage(s, victim), 1);
      vmHost(ctx, game, s, []).move(victim, "drop", owner); vmHost(ctx, game, s, []).move(victim, "battle", owner);
      assert.equal(damage(s, victim), 2); assert.equal(s.effects.some(e => e.target === victim && e.kind === "negateSkill"), false);
      ask(s, source, master, victim); vmHost(ctx, game, s, []).move(victim, "drop", owner); vmHost(ctx, game, s, []).move(victim, "battle", owner);
      s = answer(s, master, 0); assert.equal(damage(s, victim), 2); cases++;
    }
    // Legacy pending menu: name order and index survive, while only one copy is negated.
    {
      let s = fresh(owner); const victim = stage(s, owner, "KI_DUPLICATE"), source = stage(s, master, "KI_SOURCE");
      const frame = ask(s, source, master, victim); delete frame.keywordChoices;
      assert.ok(s.prompt.kind === "chooseMode"); s.prompt.options = ["[Strike]"];
      s = answer(s, master, 0); assert.equal(instances(s, victim).length, 1); cases++;
    }
    // A gated-out earlier copy cannot lend its printed index to a surviving hook.
    {
      let s = fresh(owner); const victim = stage(s, owner, "KI_BOND"), source = stage(s, master, "KI_SOURCE");
      const bodies = hookBodiesFor(ctx, game, s, victim, "beforeDamage");
      assert.equal(bodies.length, 1); assert.equal(bodies[0].skillIndex, 10);
      ask(s, source, master, victim); s = answer(s, master, 0);
      assert.equal(damage(s, victim), 1); assert.equal(instances(s, victim).length, 0); cases++;
    }
    // Source and duration are visible when otherwise identical grants differ.
    {
      let s = fresh(owner); const victim = stage(s, owner, "KI_FILLER"), source = stage(s, master, "KI_SOURCE");
      const short = grant(s, source, victim);
      const long = addEffect(s, [], { source, target: victim, kind: "keyword", value: { name: "Strike", x: 2 }, until: "game", master });
      ask(s, source, master, victim); assert.ok(s.prompt.kind === "chooseMode");
      assert.match(s.prompt.options[0], /KI_SOURCE.*turn/); assert.match(s.prompt.options[1], /KI_SOURCE.*game/);
      s = answer(s, master, 0); assert.deepEqual(instances(s, victim).map(k => k.grantEffectId), [long.id]);
      endEffects(s, [], "turn"); assert.ok(!s.effects.some(e => e.id === short.id));
      assert.deepEqual(instances(s, victim).map(k => k.grantEffectId), [long.id]); cases++;
    }
    // Equal old labels on distinct cards still retain the original menu index.
    {
      let s = fresh(owner); const a = stage(s, owner, "KI_DOUBLE"), b = stage(s, owner, "KI_DOUBLE"), source = stage(s, master, "KI_SOURCE");
      const frame: ScriptFrame = { ops: [{ op: "negateChosenKeyword", target: { var: "victims" }, until: "turn", mandatory: true }], ip: 0, vars: { victims: [a, b] }, card: source, master };
      s.programs.push(frame); run(ctx, game, s, []); delete frame.keywordChoices;
      assert.ok(s.prompt.kind === "chooseMode"); s.prompt.options = ["KI_DOUBLE: [Strike]", "KI_DOUBLE: [Strike]"];
      s = answer(s, master, 1); assert.equal(damage(s, a), 2); assert.equal(damage(s, b), 1); cases++;
    }
    // A persisted copied-skill index is independent of the target's printed face.
    {
      let s = fresh(owner); const victim = stage(s, owner, "KI_FLIP"), source = stage(s, master, "KI_SOURCE");
      addEffect(s, [], { source, target: victim, kind: "copiedSkills", value: 0, until: "game", copied: { cardId: "KI_DOUBLE", side: "front", skills: [0] } });
      const frame = ask(s, source, master, victim); assert.equal(frame.keywordChoices!.length, 2);
      s = answer(s, master, 1); const effect = s.effects.find(e => e.kind === "negateSkill")!;
      assert.equal(effect.skillSide, undefined); s.cards[victim].flipped = true;
      assert.equal(instances(s, victim).length, 1); assert.equal(damage(s, victim), 3); cases++;
    }
    // Hidden/Revealed starts a fresh skill incarnation under RM 9-9-2.
    if (gameId === "dbs") {
      let s = fresh(owner); const victim = stage(s, owner, "KI_DOUBLE"), source = stage(s, master, "KI_SOURCE");
      ask(s, source, master, victim); s = answer(s, master, 0); assert.equal(damage(s, victim), 1);
      vmHost(ctx, game, s, []).setHidden(victim, true); vmHost(ctx, game, s, []).setHidden(victim, false);
      assert.equal(damage(s, victim), 2);
      ask(s, source, master, victim);
      vmHost(ctx, game, s, []).setHidden(victim, true); vmHost(ctx, game, s, []).setHidden(victim, false);
      s = answer(s, master, 0); assert.equal(damage(s, victim), 2, "a stale menu cannot negate the fresh revealed instance"); cases++;
    }
    // A standing source's Hidden/Revealed transition creates a fresh grant too.
    if (gameId === "dbs") {
      let s = fresh(owner); const victim = stage(s, owner, "KI_FILLER"), source = stage(s, master, "KI_SOURCE"), standing = stage(s, owner, "KI_STANDING");
      const before = instances(s, victim)[0].standingGrantId;
      ask(s, source, master, victim); s = answer(s, master, 0); assert.equal(damage(s, victim), 1);
      vmHost(ctx, game, s, []).setHidden(standing, true); vmHost(ctx, game, s, []).setHidden(standing, false);
      assert.equal(damage(s, victim), 2); assert.equal(instances(s, victim)[0].standingGrantId, before, "general standing IDs retain their saved format");
      ask(s, source, master, victim);
      vmHost(ctx, game, s, []).setHidden(standing, true); vmHost(ctx, game, s, []).setHidden(standing, false);
      s = answer(s, master, 0); assert.equal(damage(s, victim), 2, "pending choice does not follow a new standing source incarnation");
      // Old resolved self-negation used only the standing ID, even on a source
      // already revealed once; keep that stored behavior when metadata is absent.
      addEffect(s, [], { source, target: victim, kind: "negateGrantedSkill", value: { standingGrantId: before! }, until: "turn" });
      assert.equal(damage(copy(s), victim), 1, "legacy resolved grant negation remains effective"); cases++;
    }
    // Generic named negation and old resolved saves deliberately remain name-wide.
    {
      let s = fresh(owner); const victim = stage(s, owner, "KI_DUPLICATE"), source = stage(s, master, "KI_SOURCE");
      enact(s, source, master, [{ op: "negateKeyword", target: { sel: { side: "opponent", area: "battle" } }, keyword: "Strike", until: "turn" }]);
      grant(s, source, victim); s = copy(s); assert.equal(damage(s, victim), 1); assert.equal(hasKeyword(ctx, game, s, victim, "Strike"), false); cases++;
    }
  }
}
console.log(`keyword negation instances: ${cases} scenarios passed (both games/seats, real damage, identity, grants, reload, legacy and cleanup)`);
