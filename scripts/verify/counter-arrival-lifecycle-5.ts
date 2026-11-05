/** R435 serialized ownership protocol, not a native gameplay support claim. */
import assert from "node:assert/strict";
import type { ScriptFrame } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";
import { finishSkillPlayScope, type SkillPlayScope } from "../../src/lib/arena/vm/skill-play-scope";
import { ultrasonicArrivalProgram } from "../../src/lib/arena/vm/counter-arrival-policy";
import { captureCounterArrivalBatch } from "../../src/lib/arena/vm/counter-arrival-batch";
import { beginCounterArrivalDecision, completeCounterArrivalDecision, requireCounterArrivalDecision, retainCounterArrivalTemplate, retireCounterArrivalTemplates } from "../../src/lib/arena/vm/counter-arrival-runtime";

let cases = 0;
for (const master of ["p1", "p2"] as const) {
  const player: "p1" | "p2" = master === "p1" ? "p2" : "p1";
  const owner: SkillPlayScope = { version: 2, id: 1, source: "parent", master: player,
    profile: { arrivals: "many", tokens: false, explicitWindow: false }, phase: "effect", played: [] };
  const original: SkillPlayScope = { version: 2, id: 2, parent: 1, source: "counter", master, skillIndex: 0,
    purpose: "counterArrivalDecision", profile: { arrivals: 0, tokens: false, explicitWindow: false }, phase: "effect", played: [] };
  const frame: ScriptFrame = { ops: ultrasonicArrivalProgram(), ip: 0, vars: { original: ["paid"] },
    card: "counter", master, skillIndex: 0, counterPlay: true, counterSource: { version: 1, card: "counter", epoch: 5 },
    counterDeclaredScript: { version: 1, card: "counter", skillIndex: 0, kind: "counter:play", script: { kind: "counter:play", unsupported: [], ops: ultrasonicArrivalProgram() } },
    skillEffectOrigin: { version: 2, kind: "counter", scope: 2 } };
  // Only fields consumed by this protocol are present; this is not a game fixture.
  const state = { skillPlayScopes: [owner, original], nextSkillPlayScope: 2,
    cards: { first: { zoneEpoch: 2 }, second: { zoneEpoch: 8 } },
    programs: [{ ops: [], ip: 0, vars: {}, card: "counter", master, skillPlayFinish: { version: 1, scope: 2 } }],
    resolving: null } as unknown as VmState;
  retainCounterArrivalTemplate(state, owner, frame);
  assert.equal(state.skillPlayScopes?.length, 1);
  assert.equal(state.programs.length, 0);
  const template = owner.arrivalCounters![0];
  assert.equal(template.state, "ready");
  const options = { player, playPermission: { source: "parent", player, bySkill: true, evolution: false } };
  const parent: ScriptFrame = { ops: [{ op: "play", target: { var: "picked" } }], ip: 1, vars: {}, card: "parent", master: player,
    skillEffectOrigin: { version: 2, kind: "activate", scope: 1 } };
  parent.arrivalBatch = captureCounterArrivalBatch(1, ["first", "second"], state.cards, { source: "parent", master: player, operation: parent.ops[0], options });
  for (const [index, card] of ["first", "second"].entries()) {
    parent.arrivalBatch!.cursor = index;
    state.resolving = { card, player };
    parent.pendingArrival = { version: 1, owner: 1, card, epoch: state.cards[card].zoneEpoch!, cursor: 0, previous: null, decisions: [] };
    beginCounterArrivalDecision(state, owner, template, { card, epoch: state.cards[card].zoneEpoch! },
      { cards: ["first", "second"], options, frame: parent });
    assert.equal(template.state, "running");
    const [execution, finish, resumeFrame] = state.programs;
    assert.equal(execution.master, master);
    assert.equal(execution.skillEffectOrigin?.scope, index + 3);
    assert.equal(execution.counterMotion, undefined);
    assert.equal(execution.counterCost, undefined);
    assert.equal(execution.afterSkillSource, undefined);
    requireCounterArrivalDecision(state, execution);
    assert.throws(() => retireCounterArrivalTemplates(owner), /unfinished/);
    execution.vars.original.push("modified only in this execution");
    assert.deepEqual(template.vars.original, ["paid"]);
    finishSkillPlayScope(state, finish);
    state.programs = [];
    const resume = resumeFrame.arrivalResume!;
    assert.throws(() => completeCounterArrivalDecision(state, { ...resume, cards: [card] }), /held play/);
    for (const fault of ["ops", "ip", "master", "source", "options"] as const) {
      const bad = JSON.parse(JSON.stringify(resume));
      if (fault === "ops") delete bad.frame.ops;
      if (fault === "ip") bad.frame.ip = -1;
      if (fault === "master") bad.frame.master = master;
      if (fault === "source") bad.frame.card = "changed";
      if (fault === "options") bad.options.mode = "rest";
      assert.throws(() => completeCounterArrivalDecision(state, bad), /rebuild.*held play/);
      cases++;
    }
    completeCounterArrivalDecision(state, JSON.parse(JSON.stringify(resume)));
    assert.equal(template.state, "ready");
    assert.equal(template.active, undefined);
    assert.equal(state.skillPlayScopes?.at(-1), owner);
    cases++;
  }
  retireCounterArrivalTemplates(owner);
  assert.equal(owner.arrivalCounters, undefined);
  assert.equal(state.programs.length, 0, "retirement queues no zero-arrival fallback");
  cases++;
}
console.log(`counter-arrival-lifecycle-5: ${cases} serialized lifecycle cases passed`);
