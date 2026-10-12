/** Rule 21-6's confirmative Battle Card power check. */
import assert from "node:assert/strict";
import { engineFor } from "../../src/lib/arena/engines";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { CTX, DEFS, fifty } from "./harness";
import type { CardDef, EngineContext } from "../../src/lib/arena/types";
import type { PlayerId, VmState } from "./harness";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { attrsNow } from "../../src/lib/arena/vm/program";

const rules = engineFor("rules");
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok, "the DBS ruleset loads for rule-processing scenarios");
const DBS = loaded.definition;
const DECKS = {
  seed: 184,
  p1: { name: "You", leader: "L-RED", main: fifty("V1") },
  p2: { name: "Claude", leader: "L-BLUE", main: fifty("V-BLUE") },
};

function mainPhase(): VmState {
  let state = rules.createGame(CTX, DECKS).state as VmState;
  state = rules.apply(CTX, state, { type: "chooseFirst", player: state.chooser, first: "p1" }).state as VmState;
  state = rules.apply(CTX, state, { type: "mulligan", player: "p1", redraw: false }).state as VmState;
  state = rules.apply(CTX, state, { type: "mulligan", player: "p2", redraw: false }).state as VmState;
  state = rules.apply(CTX, state, { type: "charge", player: "p1", card: null }).state as VmState;
  state = rules.apply(CTX, state, { type: "endMain", player: "p1" }).state as VmState;
  state = rules.apply(CTX, state, { type: "charge", player: "p2", card: null }).state as VmState;
  state = rules.apply(CTX, state, { type: "endMain", player: "p2" }).state as VmState;
  state = rules.apply(CTX, state, { type: "charge", player: "p1", card: null }).state as VmState;
  assert.equal(state.prompt.kind, "main", "fixture reaches p1's second Main Phase");
  return state;
}

function stage(state: VmState, player: PlayerId, cardId: string): string {
  const id = state.sides[player].zones.deck.pop();
  assert.ok(id, `${player}'s deck has a fixture card`);
  state.cards[id!].cardId = cardId;
  assert.equal(moveCard(state, DBS, id!, "battle", { owner: player }).ok, true, `${cardId} stages in battle`);
  return id!;
}

function replacementContext(lines: { to: "warp" | "hand" | "battle"; mode?: "rest"; by?: "skill"; bySide?: "opponent"; optional?: boolean }[], power = 10000): EngineContext {
  const id = "RULE-ZERO";
  const definition: CardDef = {
    ...DEFS.V1,
    id,
    name: "Rule Zero",
    power,
    skill: lines.map(() => "[Permanent] This card is governed by a zero-power replacement.").join("<br>"),
  };
  const scripts = {
    complete: true,
    unsupported: [],
    bySkill: Object.fromEntries(lines.map((line, i) => [i * 10, {
      unsupported: [],
      ops: [{ op: "replaceLeave", to: line.to, ...(line.mode ? { mode: line.mode } : {}), ...(line.by ? { by: line.by } : {}), ...(line.bySide ? { bySide: line.bySide } : {}), ...(line.optional ? { optional: true } : {}) }],
    }])),
  };
  return {
    ...CTX,
    defs: new Proxy(CTX.defs, { get: (target, key: string) => key === id ? definition : Reflect.get(target, key) }) as Record<string, CardDef>,
    scripts: new Proxy(CTX.scripts ?? {}, { get: (target, key: string) => key === id ? scripts : Reflect.get(target, key) }),
  };
}

function sourceStaticContext(): EngineContext {
  const source = "RULE-SOURCE";
  const weak = "RULE-WEAK";
  const defs = {
    [source]: { ...DEFS.V1, id: source, name: source, power: 0, skill: "[Permanent] This card reduces opposing Battle Card power." },
    [weak]: { ...DEFS.V1, id: weak, name: weak, power: 5000, skill: null },
  };
  const sourceScripts = {
    complete: true,
    unsupported: [],
    bySkill: { 0: { unsupported: [], ops: [{ op: "power", target: { sel: { side: "opponent", area: "battle" } }, amount: -5000 }] } },
  };
  return {
    ...CTX,
    defs: new Proxy(CTX.defs, { get: (target, key: string) => defs[key as keyof typeof defs] ?? Reflect.get(target, key) }),
    scripts: new Proxy(CTX.scripts ?? {}, { get: (target, key: string) => key === source ? sourceScripts : Reflect.get(target, key) }),
  };
}

function sourceReplacementContext(): EngineContext {
  const source = "RULE-REPLACER";
  const definition = { ...DEFS.V1, id: source, name: source, power: 0, skill: "[Permanent] This card reduces opposing power and replaces a zero-power departure." };
  const weak = { ...DEFS.V1, id: "RULE-REPLACEMENT-WEAK", name: "Replacement Weak", power: 5000, skill: null };
  const scripts = {
    complete: true,
    unsupported: [],
    bySkill: { 0: { unsupported: [], ops: [
      { op: "power", target: { sel: { side: "opponent", area: "battle" } }, amount: -5000 },
      { op: "replaceLeave", to: "warp", by: "skill", bySide: "opponent", target: { sel: { side: "opponent", area: "battle" } } },
    ] } },
  };
  return {
    ...CTX,
    defs: new Proxy(CTX.defs, { get: (target, key: string) => key === source ? definition : key === weak.id ? weak : Reflect.get(target, key) }),
    scripts: new Proxy(CTX.scripts ?? {}, { get: (target, key: string) => key === source ? scripts : Reflect.get(target, key) }),
  };
}

function askingSubstituteContext(): EngineContext {
  const id = "RULE-SUBSTITUTE";
  const definition: CardDef = {
    ...DEFS.V1,
    id,
    name: "Questioning Substitute",
    power: 0,
    skill: "[Permanent] This card replaces leaving the Battle Area.<br>[Auto] This card draws after the replacement completes.",
  };
  const scripts = {
    complete: true,
    unsupported: [],
    bySkill: {
      0: {
        unsupported: [],
        ops: [{
          op: "replace",
          event: "leave",
          with: [
            { op: "choose", sel: { side: "you", area: "hand", count: 1 }, as: "pick" },
            { op: "moveTo", target: { var: "pick" }, to: "warp" },
          ],
        }],
      },
      10: { unsupported: [], ops: [{ op: "draw", n: 1, side: "you" }] },
    },
  };
  return {
    ...CTX,
    defs: new Proxy(CTX.defs, { get: (target, key: string) => key === id ? definition : Reflect.get(target, key) }) as Record<string, CardDef>,
    scripts: new Proxy(CTX.scripts ?? {}, { get: (target, key: string) => key === id ? scripts : Reflect.get(target, key) }),
  };
}

{
  let state = mainPhase();
  const target = stage(state, "p2", "V-BLUE");
  const source = stage(state, "p1", "V1");
  addEffect(state, [], { target, kind: "power", value: -10000, until: "turn", source, master: "p1" });
  const result = rules.apply(CTX, state, { type: "endMain", player: "p1" });
  state = result.state as VmState;
  assert.ok(!state.sides.p2.zones.battle.includes(target), "21-6 moves a 0-power Battle Card out of battle at the next checkpoint");
  assert.ok(state.sides.p2.zones.drop.includes(target), "21-6 sends the zero-power card to its owner's Drop Area");
  assert.ok(result.events.some((event) => event.type === "move" && event.card === target && event.to === "drop"), "the rule movement is present in the checkpoint's event stream");
}

{
  const state = mainPhase();
  const positive = stage(state, "p2", "V-BLUE");
  const source = stage(state, "p1", "V1");
  addEffect(state, [], { target: positive, kind: "power", value: -5000, until: "turn", source, master: "p1" });
  const result = rules.apply(CTX, state, { type: "endMain", player: "p1" });
  assert.ok((result.state as VmState).sides.p2.zones.battle.includes(positive), "a Battle Card still above zero power stays in battle");
}

for (const protectedCard of ["INDESTRUCT", "WALL"]) {
  const state = mainPhase();
  const target = stage(state, "p2", protectedCard);
  const source = stage(state, "p1", "V1");
  addEffect(state, [], { target, kind: "power", value: -10000, until: "turn", source, master: "p1" });
  const result = rules.apply(CTX, state, { type: "endMain", player: "p1" });
  assert.ok((result.state as VmState).sides.p2.zones.drop.includes(target), `21-6 applies through ${protectedCard === "INDESTRUCT" ? "Indestructible" : "Barrier"}`);
}

{
  const ctx = replacementContext([{ to: "battle", mode: "rest", by: "skill", bySide: "opponent" }]);
  const state = mainPhase();
  const target = stage(state, "p2", "RULE-ZERO");
  const source = stage(state, "p1", "V1");
  addEffect(state, [], { target, kind: "power", value: -10000, until: "turn", source, master: "p1" });
  const result = rules.apply(ctx, state, { type: "endMain", player: "p1" });
  const ended = result.state as VmState;
  assert.ok(ended.sides.p2.zones.drop.includes(target), "a Rest-instead replacement applies once, then the same 21-6 event completes its original move");
  assert.equal(result.events.filter((event) => event.type === "note" && event.text.includes("in Rest Mode instead")).length, 1, "the Rest-instead route was actually applied once before 21-6 completed the move");
}

{
  const ctx = replacementContext([{ to: "warp", by: "skill", bySide: "opponent" }], 0);
  const state = mainPhase();
  const target = stage(state, "p2", "RULE-ZERO");
  const result = rules.apply(ctx, state, { type: "endMain", player: "p1" });
  assert.ok((result.state as VmState).sides.p2.zones.drop.includes(target), "an already-zero card is moved by the rule without being misattributed to an absent power effect");
}

{
  const ctx = replacementContext([
    { to: "battle", mode: "rest", by: "skill", bySide: "opponent" },
    { to: "warp", by: "skill", bySide: "opponent" },
  ]);
  const state = mainPhase();
  const target = stage(state, "p2", "RULE-ZERO");
  const source = stage(state, "p1", "V1");
  addEffect(state, [], { target, kind: "power", value: -10000, until: "turn", source, master: "p1" });
  const asked = rules.apply(ctx, state, { type: "endMain", player: "p1" }).state as VmState;
  assert.equal(asked.prompt.kind, "replaceMove");
  const ended = rules.apply(ctx, structuredClone(asked), { type: "chooseMode", player: "p2", index: 0 });
  assert.ok((ended.state as VmState).sides.p2.zones.warp.includes(target), "using one replacement does not suppress another source skill in the same 21-6 event");
  assert.equal(ended.events.filter((event) => event.type === "note" && event.text.includes("in Rest Mode instead")).length, 1, "the first source-skill pair was used once");
}

for (const accept of [true, false]) {
  const ctx = replacementContext([{ to: "warp", by: "skill", bySide: "opponent", optional: true }]);
  const state = mainPhase();
  const target = stage(state, "p2", "RULE-ZERO");
  const source = stage(state, "p1", "V1");
  addEffect(state, [], { target, kind: "power", value: -10000, until: "turn", source, master: "p1" });
  const asked = rules.apply(ctx, state, { type: "endMain", player: "p1" }).state as VmState;
  assert.equal(asked.prompt.kind, "replaceMove", "21-6 asks before honoring an optional replacement");
  const ended = rules.apply(ctx, structuredClone(asked), { type: "chooseMode", player: "p2", index: accept ? 0 : 1 }).state as VmState;
  assert.equal((ended as VmState).sides.p2.zones.warp.includes(target), accept, `the optional replacement ${accept ? "can be accepted" : "can be declined"}`);
  assert.equal((ended as VmState).sides.p2.zones.drop.includes(target), !accept, "21-6 completes when the optional replacement is declined");
}

{
  const ctx = replacementContext([
    { to: "warp", by: "skill", bySide: "opponent" },
    { to: "hand", by: "skill", bySide: "opponent" },
  ]);
  const state = mainPhase();
  const target = stage(state, "p2", "RULE-ZERO");
  const simultaneous = stage(state, "p2", "V-BLUE");
  const source = stage(state, "p1", "V1");
  addEffect(state, [], { target, kind: "power", value: -10000, until: "turn", source, master: "p1" });
  addEffect(state, [], { target: simultaneous, kind: "power", value: -10000, until: "turn", source, master: "p1" });

  const asked = rules.apply(ctx, state, { type: "endMain", player: "p1" }).state as VmState;
  assert.equal(asked.prompt.kind, "replaceMove", "21-6 permits the affected owner to choose between two mandatory 9-10 replacements");
  assert.equal(asked.prompt.player, "p2");
  assert.equal(asked.ruleProcessing?.pass.length, 2, "the simultaneous zero-power set is saved before the replacement question");
  assert.equal(asked.ruleProcessing?.awaiting?.choices.length, 2);

  const reloaded = structuredClone(asked);
  const resumed = rules.apply(ctx, reloaded, { type: "chooseMode", player: "p2", index: 0 }).state as VmState;
  assert.ok(resumed.sides.p2.zones.warp.includes(target), "the chosen redirect survives state reload");
  assert.ok(resumed.sides.p2.zones.drop.includes(simultaneous), "the rest of the frozen simultaneous set resolves after the answer");
  assert.equal(resumed.ruleProcessing, undefined, "the checkpoint continuation clears when all zero-power moves finish");
}

{
  const ctx = askingSubstituteContext();
  const state = mainPhase();
  const target = stage(state, "p2", "RULE-SUBSTITUTE");
  const chosen = state.sides.p2.zones.hand[0];
  assert.ok(chosen, "the owner has a card to choose for the substitute");
  state.pending.push({ card: target, skillIndex: 10, master: "p2", trigger: "played" });
  const asked = rules.apply(ctx, state, { type: "endMain", player: "p1" }).state as VmState;
  assert.equal(asked.prompt.kind, "chooseCards", "the substitute program can ask and suspend at the checkpoint");
  assert.equal(asked.pending.length, 1, "pending Autos wait until the replacement program finishes");
  assert.ok(asked.sides.p2.zones.battle.includes(target), "the substitute keeps its subject in battle while it asks");

  const resumedResult = rules.apply(ctx, structuredClone(asked), { type: "choose", player: "p2", cards: [chosen!] });
  const resumed = resumedResult.state as VmState;
  assert.ok(resumed.sides.p2.zones.warp.includes(chosen!), "the persisted substitute resumes its chosen move");
  assert.ok(resumed.sides.p2.zones.drop.includes(target), "21-6 completes after the substitute program leaves its zero-power subject in battle");
  assert.equal(resumed.pending.length, 0, "the pending Auto resolves after the rule move and its substitute finish");
  const targetMove = resumedResult.events.findIndex((event) => event.type === "move" && event.card === target && event.to === "drop");
  const draw = resumedResult.events.findIndex((event) => event.type === "draw" && event.player === "p2");
  assert.ok(targetMove >= 0 && draw > targetMove, "the pending Auto resolves only after the substitute and the zero-power move have finished");
}

{
  const ctx = sourceStaticContext();
  const state = mainPhase();
  const source = stage(state, "p1", "RULE-SOURCE");
  const target = stage(state, "p2", "RULE-WEAK");
  assert.equal(attrsNow(ctx, DBS, state, target).power, 0, "the source's permanent makes the second subject exactly zero before the checkpoint");
  const result = rules.apply(ctx, state, { type: "endMain", player: "p1" });
  const ended = result.state as VmState;
  assert.ok(ended.sides.p1.zones.drop.includes(source), "the first zero-power subject leaves and its static expires");
  assert.equal(attrsNow(ctx, DBS, ended, target).power, 5000, "the source leaving restores the later subject above zero");
  assert.ok(ended.sides.p2.zones.drop.includes(target), "21-6 processes the full frozen simultaneous set despite the source leaving");
}

{
  const ctx = sourceReplacementContext();
  const state = mainPhase();
  const source = stage(state, "p1", "RULE-REPLACER");
  const target = stage(state, "p2", "RULE-REPLACEMENT-WEAK");
  assert.equal(attrsNow(ctx, DBS, state, target).power, 0, "the source's Permanent both reduces the later subject to zero and grants its replacement");
  const result = rules.apply(ctx, state, { type: "endMain", player: "p1" });
  const ended = result.state as VmState;
  assert.ok(ended.sides.p1.zones.drop.includes(source), "the zero-power source leaves earlier in the simultaneous pass");
  assert.ok(ended.sides.p2.zones.warp.includes(target), "its replacement remains available to the later subject from the frozen pre-pass view");
  assert.ok(!ended.sides.p2.zones.drop.includes(target), "the source leaving does not erase an already-applicable replacement");
}
