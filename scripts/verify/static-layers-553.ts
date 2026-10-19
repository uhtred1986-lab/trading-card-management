/** Fixed rules-engine assertions for #553's continuous identity and keyword layers. */
import assert from "node:assert/strict";
import type { CardDef, EngineContext, GameEvent, GameOptions, KeywordSkill } from "../../src/lib/arena/types";
import { RULES } from "../../src/lib/arena/vm";
import { attrsNow, hasKeyword, keywordsInForce, staticsNow } from "../../src/lib/arena/vm/program";
import { addEffect, endEffects } from "../../src/lib/arena/vm/effects";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { predicateOf } from "../../src/lib/arena/vm/filters";
import { coversColors } from "../../src/lib/arena/text/cards";
import { vmHost } from "../../src/lib/arena/vm/host";
import { stepScript, validateProgram, type Op, type Ref, type ScriptFrame } from "../../src/lib/arena/vm/script";
import { compileSkill } from "../../src/lib/arena/compile";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { typedRecords } from "./records";
import { CTX } from "./harness";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import type { VmState } from "../../src/lib/arena/vm/state";

const rules = RULES;
const dbs = rulesetFor("dbs");
if (!dbs.ok) throw new Error(`could not load DBS rules for #553: ${JSON.stringify(dbs.errors)}`);
const DBS = dbs.definition;
const gainsMacro = DBS.ops.gains as unknown as { takes: { name: string }[]; do: Op[] };
assert.ok(gainsMacro.takes.some((field) => field.name === "allAreas"), "the gains macro omitted its explicit source-validity qualifier");
assert.equal(gainsMacro.do.length, 4, "gains macro no longer expands each list identity attribute");
assert.ok(
  gainsMacro.do.every((op) => op.op === "modifyAttr" && "allAreas" in op),
  "the gains macro dropped allAreas while expanding into list modifyAttr operations",
);
const card = (id: string, skill: string): CardDef => ({
  ...CTX.defs.V1,
  id,
  name: id,
  colors: ["Red"],
  traits: [],
  characters: [id],
  alsoNames: [],
  skill,
});

const targetId = "R553-TARGET";
const identityId = "R553-IDENTITY";
const grantId = "R553-GRANT";
const negateId = "R553-NEGATE";
const timedId = "R553-TIMED";
const blueTargetId = "R553-BLUE-TARGET";
const shieldId = "R553-SHIELD";
const handIdentityId = "R553-HAND-IDENTITY";
const handOrdinaryIdentityId = "R553-HAND-ORDINARY-IDENTITY";
const targetAllBattle: Ref = { sel: { side: "you", area: "battle", count: 99 } };
const identityAllAreas: Extract<Op, { op: "gains" }> = { op: "gains", traits: ["Saiyan"], colors: ["Blue"], names: ["Planet M-2"], allAreas: true };
const identityOps: Op[] = [
  { ...identityAllAreas, target: targetAllBattle },
  { ...identityAllAreas, target: { sel: { side: "you", area: "hand", count: 99 } } },
];
const grantOps: Op[] = [{ op: "grant", target: targetAllBattle, keyword: { name: "Blocker" } as KeywordSkill, until: "game" }];
const negateOps: Op[] = [{ op: "negateKeyword", target: targetAllBattle, keyword: "Blocker" }];
const timedOps: Op[] = [{ op: "modifyAttr", target: { var: "target" }, attr: "traits", values: ["Earthling"], until: "turn" }];
const shieldOps: Op[] = [{ op: "forbid", what: "beNegated", target: targetAllBattle, until: "game" }];

const records: Record<string, unknown> = {
  [identityId]: { bySkill: { 0: { ops: identityOps, unsupported: [], ...typedRecords() } }, complete: true, unsupported: [] },
  [grantId]: { bySkill: { 0: { ops: grantOps, unsupported: [], ...typedRecords() } }, complete: true, unsupported: [] },
  [negateId]: { bySkill: { 0: { ops: negateOps, unsupported: [], ...typedRecords() } }, complete: true, unsupported: [] },
  [shieldId]: { bySkill: { 0: { ops: shieldOps, unsupported: [], ...typedRecords() } }, complete: true, unsupported: [] },
  [handIdentityId]: {
    bySkill: { 0: { ops: [{ op: "modifyAttr", target: { sel: { special: "self" } }, attr: "colors", values: ["Blue"], allAreas: true }], unsupported: [], ...typedRecords() } },
    complete: true,
    unsupported: [],
  },
  [handOrdinaryIdentityId]: {
    bySkill: { 0: { ops: [{ op: "modifyAttr", target: { sel: { special: "self" } }, attr: "colors", values: ["Blue"] }], unsupported: [], ...typedRecords() } },
    complete: true,
    unsupported: [],
  },
};
const defs = {
  ...CTX.defs,
  [targetId]: card(targetId, "[Blocker]"),
  [identityId]: card(identityId, "[Permanent] This card counts as another colour and trait."),
  [grantId]: card(grantId, "[Permanent] This card grants a keyword."),
  [negateId]: card(negateId, "[Permanent] This card negates a keyword."),
  [timedId]: card(timedId, "[Activate: Main] This card changes a trait for the turn."),
  [blueTargetId]: { ...card(blueTargetId, ""), colors: ["Blue"] },
  [shieldId]: card(shieldId, "[Permanent] This card protects its Battle Cards from negation."),
  [handIdentityId]: card(handIdentityId, "[Permanent] This card is also treated as blue in all areas."),
  [handOrdinaryIdentityId]: card(handOrdinaryIdentityId, "[Permanent] This card is also treated as blue."),
};
const scripts = new Proxy(CTX.scripts, {
  get: (base, key) => (typeof key === "string" && records[key] ? records[key] : Reflect.get(base, key)),
});
const ctx = { ...CTX, defs, scripts } as EngineContext;

function atMain(): VmState {
  const options: GameOptions = {
    seed: 7,
    p1: { name: "You", leader: "L-RED", main: Array.from({ length: 50 }, () => "V1") },
    p2: { name: "Claude", leader: "L-BLUE", main: Array.from({ length: 50 }, () => "V-BLUE") },
  };
  let state = rules.createGame(ctx, options).state as VmState;
  state = rules.apply(ctx, state, { type: "chooseFirst", player: state.chooser, first: "p1" }).state as VmState;
  for (let i = 0; i < 20 && state.prompt.kind !== "main"; i++) {
    const player = (state.prompt as { player: "p1" | "p2" }).player;
    state = rules.apply(ctx, state, { type: "pass", player }).state as VmState;
  }
  assert.equal(state.prompt.kind, "main", "fixture did not reach p1's Main Phase");
  return state;
}

function stage(s: VmState, cardId: string): string {
  const id = s.sides.p1.zones.hand.shift();
  assert.ok(id, "fixture ran out of hand cards");
  s.cards[id!].cardId = cardId;
  assert.ok(moveCard(s, DBS, id!, "battle", { owner: "p1" }).ok, `could not stage ${cardId}`);
  return id!;
}

function expectedPermanentState(): VmState {
  const s = atMain();
  stage(s, targetId);
  stage(s, identityId);
  stage(s, grantId);
  stage(s, negateId);
  assert.deepEqual(s.pending, [], "staging permanent fixtures unexpectedly pended triggers");
  return s;
}

// Only the explicit 20-1 “in all areas” wording extends a static identity
// skill's source validity beyond play. The compiler must retain that qualifier;
// an ordinary identity-changing Permanent in hand remains invalid by 9-1-3.
{
  const explicit = compileSkill(parseSkills("[Permanent] This card is also treated as blue in all areas.")[0]!);
  assert.deepEqual(explicit.unsupported, [], "explicit all-area identity wording did not compile");
  assert.equal((explicit.ops[0] as Extract<Op, { op: "gains" }>).allAreas, true, "compiler lost the all-areas qualifier");
  assert.equal(validateProgram(explicit.ops), true, "rules schema rejected the compiler's all-areas marker");
  const ordinary = compileSkill(parseSkills("[Permanent] This card is also treated as blue.")[0]!);
  assert.deepEqual(ordinary.unsupported, [], "ordinary identity wording did not compile");
  assert.equal((ordinary.ops[0] as Extract<Op, { op: "gains" }>).allAreas, undefined, "ordinary identity wording was widened to all areas");

  const s = atMain();
  const explicitSource = s.sides.p1.zones.hand[0]!;
  const ordinarySource = s.sides.p1.zones.hand[1]!;
  s.cards[explicitSource].cardId = handIdentityId;
  s.cards[ordinarySource].cardId = handOrdinaryIdentityId;
  assert.deepEqual(attrsNow(ctx, DBS, s, explicitSource).colors, ["Red", "Blue"], "explicit all-area identity source was not read in hand");
  assert.deepEqual(attrsNow(ctx, DBS, s, ordinarySource).colors, ["Red"], "ordinary Permanent identity source escaped 9-1-3 in hand");

  const target = stage(s, targetId);
  const offTableNegator = s.sides.p1.zones.hand[2]!;
  s.cards[offTableNegator].cardId = negateId;
  assert.equal(hasKeyword(ctx, DBS, s, target, "Blocker"), true, "an ordinary static keyword negation escaped 9-1-3 from hand");
}

// 20-1: a standing identity gain reaches filters and targets; it is not a
// rewrite of printed attributes. Moving only its source out of play removes
// that contribution on the next read.
{
  const s = expectedPermanentState();
  const target = s.sides.p1.zones.battle.find((id) => s.cards[id].cardId === targetId)!;
  const source = s.sides.p1.zones.battle.find((id) => s.cards[id].cardId === identityId)!;
  const printed = ctx.defs[targetId].colors;
  const effective = attrsNow(ctx, DBS, s, target);
  assert.deepEqual(printed, ["Red"], "fixture's original colour changed before a skill applied");
  assert.deepEqual(effective.colors, ["Red", "Blue"], "static colour gain did not reach the effective card identity");
  assert.ok((effective.traits as string[]).includes("Saiyan"), "static trait gain was not read");
  assert.ok((effective.alsoNames as string[]).includes("Planet M-2"), "static name gain was not read");
  assert.ok(predicateOf({ colors: ["Blue"], traits: ["Saiyan"] }, DBS)(effective), "effective identity was not used by generic selectors");

  // The Aegis cost wording in §22-30-3 asks whether ORIGINAL colours cover
  // the named colours. Current generic `covers` correctly uses effective
  // colours, so Aegis must opt into a narrow original-colour selector instead
  // of changing every filter/covers call. This assertion records the failing
  // split for the #555 keyword body without changing generic color semantics.
  assert.equal(coversColors([effective.colors as string[]], ["Blue"]), true, "generic coverage stopped using effective colours");
  assert.equal(coversColors([printed], ["Blue"]), false, "original colour fixture unexpectedly covers Blue");

  // Aegis's `REFUSE ... covers(sel: IN you.hand, colors: $colors)` reads the
  // same effective identity. This in-hand Red card therefore incorrectly
  // satisfies a Red/Blue original-colour cost after the static all-area gain,
  // even though no originally Blue card is available. Keep this as a precise
  // regression witness; the narrow original-colour Aegis selector belongs to
  // the follow-up that owns the keyword body.
  const handCandidate = s.sides.p1.zones.hand[0]!;
  s.cards[handCandidate].cardId = targetId;
  const handNow = attrsNow(ctx, DBS, s, handCandidate);
  assert.deepEqual(ctx.defs[targetId].colors, ["Red"], "Aegis hand candidate is not originally Red");
  assert.equal(coversColors([handNow.colors as string[]], ["Red", "Blue"]), true, "effective selector no longer reproduces Aegis's false coverage");
  assert.equal(coversColors([ctx.defs[targetId].colors], ["Red", "Blue"]), false, "Aegis original-colour coverage unexpectedly passes");

  const originallyBlue = stage(s, blueTargetId);
  addEffect(s, [], {
    source,
    target: originallyBlue,
    kind: "gains",
    value: { traits: [], characters: [], colors: ["Red"], names: [] },
    until: "turn",
  });
  const blueNow = attrsNow(ctx, DBS, s, originallyBlue);
  assert.deepEqual(blueNow.colors, ["Blue", "Red"], "fixture's originally Blue card did not gain Red");
  assert.equal(coversColors([ctx.defs[blueTargetId].colors], ["Blue"]), true, "original Blue no longer covers Aegis's Blue cost after gaining Red");

  assert.ok(moveCard(s, DBS, source, "drop", { owner: "p1" }).ok, "identity source could not leave play");
  const afterSourceLeaves = attrsNow(ctx, DBS, s, target);
  assert.deepEqual(afterSourceLeaves.colors, ["Red"], "leaving identity source left its colour behind");
  assert.ok(!(afterSourceLeaves.traits as string[]).includes("Saiyan"), "leaving identity source left its trait behind");
  assert.ok(!(afterSourceLeaves.alsoNames as string[]).includes("Planet M-2"), "leaving identity source left its name behind");
}

// 9-1-5: the final negation layer beats both printed and granted keywords;
// removing the negator restores just the grant. Silencing all skills blocks a
// later grant, and the hook/public attribute readers agree with hasKeyword.
{
  const s = expectedPermanentState();
  const target = s.sides.p1.zones.battle.find((id) => s.cards[id].cardId === targetId)!;
  const negator = s.sides.p1.zones.battle.find((id) => s.cards[id].cardId === negateId)!;
  const timedGrant = addEffect(s, [], { source: negator, target, kind: "keyword", value: { name: "Blocker" }, until: "turn" });
  assert.ok(timedGrant.id > 0, "timed keyword grant was not stored");
  assert.equal(hasKeyword(ctx, DBS, s, target, "Blocker"), false, "static keyword negation did not beat a static grant");
  assert.ok(!keywordsInForce(ctx, DBS, s, target).some((k) => k.name === "Blocker"), "keyword collection disagreed with hasKeyword");
  assert.ok(!(attrsNow(ctx, DBS, s, target).keywords as string[]).includes("Blocker"), "declared keywords attribute ignored static negation");
  assert.ok(staticsNow(ctx, DBS, s).some((e) => e.kind === "negateKeyword" && e.target === target && e.source === negator), "static negation lost source provenance");

  assert.ok(moveCard(s, DBS, negator, "drop", { owner: "p1" }).ok, "negator could not leave play");
  assert.equal(hasKeyword(ctx, DBS, s, target, "Blocker"), true, "removing the negator also removed a separate grant");
  const silenced = addEffect(s, [], { source: target, target, kind: "negateSkills", value: 0, until: "game" });
  assert.ok(silenced.id > 0);
  assert.equal(hasKeyword(ctx, DBS, s, target, "Blocker"), false, "a silenced card gained a keyword skill from an effect");
  const silencedNow = attrsNow(ctx, DBS, s, target);
  assert.ok(!(silencedNow.keywords as string[]).includes("Blocker"), "keywords attribute advertised a grant while all skills were negated");
  assert.equal(silencedNow.skillLess, true, "all-skill negation did not make the granted keyword skill-less");
  assert.equal(predicateOf({ skillLess: true }, DBS)(silencedNow), true, "the actual skill-less selector disagreed with all-skill negation");
}

// 20-14: the standing keyword negation respects a current prohibition, then
// applies again as soon as that protecting source leaves play.
{
  const s = atMain();
  const target = stage(s, targetId);
  stage(s, identityId);
  stage(s, grantId);
  stage(s, negateId);
  const shield = stage(s, shieldId);
  assert.equal(hasKeyword(ctx, DBS, s, target, "Blocker"), true, "static keyword negation bypassed the target's beNegated prohibition");
  assert.ok(moveCard(s, DBS, shield, "drop", { owner: "p1" }).ok, "protection source could not leave play");
  assert.equal(hasKeyword(ctx, DBS, s, target, "Blocker"), false, "static keyword negation stayed refused after its protection left");
}

// A resolved list-attribute change retains ordinary source and expiry
// provenance. It is effective through filters until its declared duration ends.
{
  const s = atMain();
  const target = stage(s, targetId);
  const actor = stage(s, timedId);
  const events: GameEvent[] = [];
  const frame: ScriptFrame = { ops: timedOps, ip: 0, vars: { target: [target] }, card: actor, master: "p1" };
  assert.equal(stepScript(vmHost(ctx, DBS, s, events), frame), "done", "timed identity operation did not finish");
  const effect = s.effects.find((e) => e.kind === "gains" && e.target === target);
  assert.ok(effect, "timed list-attribute change was not stored as a continuous effect");
  assert.equal(effect.source, actor, "timed identity change lost its source");
  assert.equal(effect.until, "turn", "timed identity change lost its duration");
  assert.ok((attrsNow(ctx, DBS, s, target).traits as string[]).includes("Earthling"), "timed trait did not reach the effective identity");
  assert.ok(moveCard(s, DBS, actor, "drop", { owner: "p1" }).ok, "timed effect source could not leave play");
  assert.ok((attrsNow(ctx, DBS, s, target).traits as string[]).includes("Earthling"), "timed identity gain incorrectly vanished when its source left play");
  const reloaded = JSON.parse(JSON.stringify(s)) as VmState;
  const restored = reloaded.effects.find((e) => e.kind === "gains" && e.target === target);
  assert.ok(restored, "timed identity gain did not survive state serialization");
  assert.equal(restored.source, actor, "reloaded identity effect lost source provenance");
  assert.equal(restored.until, "turn", "reloaded identity effect lost its expiry");
  assert.ok((attrsNow(ctx, DBS, reloaded, target).traits as string[]).includes("Earthling"), "reloaded timed identity was not effective");
  endEffects(s, [], "turn");
  assert.ok(!(attrsNow(ctx, DBS, s, target).traits as string[]).includes("Earthling"), "expired timed trait remained in force");
}
