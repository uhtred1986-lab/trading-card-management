/** R-404: single Battle Card cost bounds observe current area counts, without choosing the counted cards. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import { parseTarget } from "../../src/lib/arena/compile/targets";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { amount, attrsNow, countSelected, resolveSelector } from "../../src/lib/arena/vm/program";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { run } from "../../src/lib/arena/vm/flow";
import { validateProgram, type Op, type ScriptFrame } from "../../src/lib/arena/vm/script";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const PRINTS = {
  "BT22-127": "[auto] When this card is played, choose up to 1 of your opponent's Battle Cards with an energy cost less than or equal to the number of cards in your Z-Deck, ignoring [barrier], and send it to its owner's Warp.",
  "P-300": "[activate: main]{g}{g}, discard this card from your hand: Choose up to 1 of your opponent's Battle Cards with an energy cost less than or equal to the number of cards in their hand, ignoring [barrier], and KO it.",
  "BT20-064": "[auto] If your Leader is a green <Son Goku: GT> card: When this card is played, choose up to 1 of your opponent's Battle Cards with an energy cost less than or equal to the number of mono-green ≪Saiyan≫ cards in your Drop and KO it.",
};
const defs: Record<string, CardDef> = {
  CB4_LEADER: card("CB4_LEADER", { type: "LEADER", energyCost: null, comboCost: null, comboPower: null, colors: ["Green"], characters: ["Son Goku: GT"] }),
  CB4_FILLER: card("CB4_FILLER", {}),
  ...Object.fromEntries(Object.entries(PRINTS).map(([id, skill]) => [id, card(id, { skill })])),
  CB4_EXACT: card("CB4_EXACT", { skill: PRINTS["BT22-127"].replace("up to 1", "1") }),
  CB4_SUM: card("CB4_SUM", { skill: "[Activate: Main] Choose any number of your opponent's Battle Cards for which the total cost adds up to 2 or less and KO them." }),
  CB4_PRIOR: card("CB4_PRIOR", { skill: "[Auto] When this card is played, choose up to 1 of your opponent's Battle Cards and it gets -5000 power for the turn for each card in your Battle Area." }),
  CB4_LARGE: card("CB4_LARGE", { power: 30000 }),
  CB4_ZERO: card("CB4_ZERO", { energyCost: 0 }),
  CB4_EQUAL: card("CB4_EQUAL", { energyCost: 2 }),
  CB4_ABOVE: card("CB4_ABOVE", { energyCost: 3 }),
  CB4_SPECIFIED: card("CB4_SPECIFIED", { energyCost: 1, specifiedCost: { Green: 3 } }),
  CB4_BARRIER: card("CB4_BARRIER", { energyCost: 2, skill: "[Barrier]" }),
  CB4_GREEN: card("CB4_GREEN", { colors: ["Green"], traits: ["Saiyan"] }),
  CB4_EXTRA: card("CB4_EXTRA", { type: "EXTRA", power: null, colors: ["Green"], traits: ["Saiyan"] }),
  CB4_MULTI: card("CB4_MULTI", { colors: ["Green", "Red"], traits: ["Saiyan"] }),
  CB4_WRONG: card("CB4_WRONG", { colors: ["Green"], traits: ["Earthling"] }),
};
const records = Object.values(defs).flatMap(d => skillRecords(d));
assert.deepEqual(records.flatMap(r => r.unread), []);
for (const id of Object.keys(PRINTS)) {
  const rec = records.find(r => r.cardId === id)!;
  const rule = copy({ kind: rec.kind, trigger: rec.trigger, cost: rec.cost, usage: rec.usage, validity: rec.validity, cond: rec.cond, ops: rec.ops }) as Rule;
  assert.equal(validateRule(rule, rec.kind), null);
  const parsed = parseRule(printRule(rule)); assert.ok(parsed.ok);
  assert.deepEqual(parsed.value, rule, `${id}: language roundtrip`);
  assert.match(rec.reads, /whose total energy cost/);
}
const ctx: EngineContext = { defs, scripts: rulesFromRows(copy(records.map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow)), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (p: PlayerId): PlayerId => p === "p1" ? "p2" : "p1";
const take = (s: VmState, a: Action) => RULES.apply(ctx, copy(s), a).state as VmState;
function fresh(first: PlayerId): VmState {
  let s = RULES.createGame(ctx, { seed: 404, p1: { name: "First", leader: "CB4_LEADER", main: fifty("CB4_FILLER") }, p2: { name: "Second", leader: "CB4_LEADER", main: fifty("CB4_FILLER") } }).state as VmState;
  for (const a of [{ type: "chooseFirst", player: s.chooser, first }, { type: "mulligan", player: first, redraw: false }, { type: "mulligan", player: other(first), redraw: false }, { type: "charge", player: first, card: null }] as Action[]) s = take(s, a);
  return s;
}
function stage(s: VmState, owner: PlayerId, def: string, area: string): string {
  const id = s.sides[owner].zones.deck.at(-1)!; s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner }).ok); s.pending = []; return id;
}
function frame(s: VmState, owner: PlayerId, id: string, before: Op[] = []): ScriptFrame {
  const source = stage(s, owner, id, id === "P-300" ? "drop" : "battle");
  // Stored rule body at resolution, after its activation/trigger and price; no runtime compilation.
  return { card: source, master: owner, ops: [...before, ...copy(ctx.scripts![id].bySkill[0].ops)], ip: 0, vars: {} };
}
function offer(s: VmState, f: ScriptFrame): VmState { s.programs.push(f); run(ctx, game, s, []); return copy(s); }
function cands(s: VmState): string[] { assert.equal(s.prompt.kind, "chooseCards"); return (s.prompt as { choice: { candidates: string[] } }).choice.candidates; }
function pick(s: VmState, owner: PlayerId, id: string | null): VmState {
  return take(s, { type: "choose", player: owner, cards: id ? [id] : [] });
}
let cases = 0;
for (const owner of ["p1", "p2"] as const) {
  const foe = other(owner);
  for (const id of Object.keys(PRINTS)) {
    let s = fresh(owner);
    if (id === "BT22-127") { stage(s, owner, "CB4_FILLER", "zDeck"); stage(s, owner, "CB4_FILLER", "zDeck"); stage(s, foe, "CB4_FILLER", "zDeck"); }
    if (id === "P-300") {
      for (const h of [...s.sides[foe].zones.hand]) assert.ok(moveCard(s, game, h, "deck", { owner: foe }).ok);
      const hidden = stage(s, foe, "CB4_FILLER", "hand"); stage(s, foe, "CB4_GREEN", "hand");
      addEffect(s, [], { target: hidden, kind: "forbid", value: 0, until: "game", forbid: { what: "beChosen", player: owner } });
      addEffect(s, [], { target: hidden, kind: "immune", value: 0, until: "game", immune: { from: owner } });
    }
    if (id === "BT20-064") {
      const protectedDrop = stage(s, owner, "CB4_GREEN", "drop"); stage(s, owner, "CB4_EXTRA", "drop");
      addEffect(s, [], { target: protectedDrop, kind: "immune", value: 0, until: "game", immune: { from: owner } });
      stage(s, owner, "CB4_MULTI", "drop"); stage(s, owner, "CB4_WRONG", "drop"); stage(s, foe, "CB4_GREEN", "drop"); stage(s, owner, "CB4_GREEN", "warp");
    }
    const zero = stage(s, foe, "CB4_ZERO", "battle"), equal = stage(s, foe, "CB4_EQUAL", "battle"), above = stage(s, foe, "CB4_ABOVE", "battle");
    const specified = stage(s, foe, "CB4_SPECIFIED", "battle"), barrier = stage(s, foe, "CB4_BARRIER", "battle");
    const own = stage(s, owner, "CB4_EQUAL", "battle"), wrongArea = stage(s, foe, "CB4_EQUAL", "energy");
    const f = frame(s, owner, id);
    if (id === "BT20-064") {
      const invalid = copy(s); invalid.cards[invalid.sides[owner].zones.leader[0]].cardId = "CB4_FILLER";
      const refused = offer(invalid, copy(f)); assert.notEqual(refused.prompt.kind, "chooseCards", "wrong Leader never opens the effect");
    }
    s = offer(s, f);
    assert.deepEqual(new Set(cands(s)), new Set([zero, equal, ...(id === "BT20-064" ? [] : [barrier])]), `${id}: exact side/area/count/cost/Barrier candidates`);
    for (const no of [above, specified, own, wrongArea]) assert.ok(!cands(s).includes(no));
    if (id === "P-300") for (const hidden of s.sides[foe].zones.hand) assert.ok(!JSON.stringify(s.prompt).includes(hidden), "counting opponent hand never exposes its identities in the choice");
    const declined = pick(s, owner, null); assert.ok(declined.sides[foe].zones.battle.includes(equal));
    s = pick(s, owner, equal);
    assert.ok(s.sides[foe].zones[id === "BT22-127" ? "warp" : "drop"].includes(equal), `${id}: selected target actually moves`);
    cases++;
  }
  // An earlier operation changes the hand before the dynamic bound is evaluated; zero still permits a zero-cost card.
  {
    let s = fresh(owner);
    for (const h of [...s.sides[foe].zones.hand]) assert.ok(moveCard(s, game, h, "deck", { owner: foe }).ok);
    const equal = stage(s, foe, "CB4_EQUAL", "battle"), above = stage(s, foe, "CB4_ABOVE", "battle");
    s = offer(s, frame(s, owner, "P-300", [{ op: "draw", n: 2, side: "opponent" }]));
    assert.deepEqual(cands(s), [equal]); assert.ok(!cands(s).includes(above)); cases++;
    s = fresh(owner);
    const zero = stage(s, foe, "CB4_ZERO", "battle"); stage(s, foe, "CB4_EQUAL", "battle");
    s = offer(s, frame(s, owner, "BT22-127")); assert.deepEqual(cands(s), [zero]); cases++;
  }
  // The same bounded grammar preserves a mandatory one-card choice.
  {
    let s = fresh(owner); const zero = stage(s, foe, "CB4_ZERO", "battle"), secondZero = stage(s, foe, "CB4_ZERO", "battle");
    s = offer(s, frame(s, owner, "CB4_EXACT")); assert.deepEqual(cands(s), [zero, secondZero]);
    assert.equal((s.prompt as { choice: { min: number } }).choice.min, 1);
    s = pick(s, owner, zero); assert.ok(s.sides[foe].zones.warp.includes(zero)); cases++;
  }
  // Existing amount expressions also observe protected cards: BT28-022's per-card power reduction.
  {
    let s = fresh(owner); const f = frame(s, owner, "CB4_PRIOR");
    const protectedCard = stage(s, owner, "CB4_LARGE", "battle"), target = stage(s, foe, "CB4_LARGE", "battle");
    addEffect(s, [], { target: protectedCard, kind: "immune", value: 0, until: "game", immune: { from: owner } });
    s = pick(offer(s, f), owner, target);
    assert.equal(attrsNow(ctx, game, s, target).power, 20000); cases++;
  }
  // Cost changes apply now, and the specified orbs still floor the numerical cost (RM 1-2-5).
  {
    let s = fresh(owner); stage(s, owner, "CB4_FILLER", "zDeck"); stage(s, owner, "CB4_FILLER", "zDeck");
    const reduced = stage(s, foe, "CB4_ABOVE", "battle"), raised = stage(s, foe, "CB4_EQUAL", "battle");
    addEffect(s, [], { target: reduced, kind: "cost", value: 1, until: "game" });
    addEffect(s, [], { target: raised, kind: "cost", value: -1, until: "game" });
    s = offer(s, frame(s, owner, "BT22-127")); assert.deepEqual(cands(s), [reduced]); cases++;
  }
  // The pre-existing summed-cost choice uses the same current numerical-cost floor.
  {
    let s = fresh(owner); const cheap = stage(s, foe, "CB4_EQUAL", "battle"), specified = stage(s, foe, "CB4_SPECIFIED", "battle");
    s = offer(s, frame(s, owner, "CB4_SUM")); assert.deepEqual(cands(s), [cheap]); assert.ok(!cands(s).includes(specified)); cases++;
  }
  // Observing cards under a protected host reaches its pile, while a real selection does not.
  {
    const s = fresh(owner), source = stage(s, owner, "CB4_FILLER", "battle"), host = stage(s, foe, "CB4_EQUAL", "battle");
    const buried = s.sides[foe].zones.deck.pop()!; s.cards[host].under.push(buried);
    addEffect(s, [], { target: host, kind: "immune", value: 0, until: "game", immune: { from: owner } });
    const f: ScriptFrame = { card: source, master: owner, ops: [], ip: 0, vars: { pile: [buried] } };
    const sel = { side: "opponent" as const, area: "under" as const, underHost: { side: "opponent" as const, area: "battle" as const } };
    assert.equal(amount(ctx, game, s, f, { count: sel }), 1);
    assert.equal(amount(ctx, game, s, f, { count: { ...sel, fromVar: "pile" } }), 1);
    assert.deepEqual(resolveSelector(ctx, game, s, f, sel), []); cases++;
  }
  // Numerical amounts count protected cards, including alternative selectors, but real choices keep protections.
  {
    const s = fresh(owner), source = stage(s, owner, "CB4_FILLER", "battle"), guarded = stage(s, foe, "CB4_BARRIER", "battle");
    const immune = stage(s, foe, "CB4_EQUAL", "battle"), blocked = stage(s, foe, "CB4_EQUAL", "battle");
    addEffect(s, [], { target: immune, kind: "immune", value: 0, until: "game", immune: { from: owner } });
    addEffect(s, [], { target: blocked, kind: "forbid", value: 0, until: "game", forbid: { what: "beChosen", player: owner } });
    const f: ScriptFrame = { card: source, master: owner, ops: [], ip: 0, vars: {} };
    const sel = { side: "opponent" as const, area: "battle" as const };
    assert.equal(amount(ctx, game, s, f, { count: sel, times: 5000 }), 15000, "pre-existing numeric amount counts all protected cards");
    assert.deepEqual(resolveSelector(ctx, game, s, f, sel), [], "real choices keep all three protections");
    assert.equal(countSelected(ctx, game, s, f, sel), 0, "default selector-count API still applies choice protections");
    assert.equal(amount(ctx, game, s, f, { count: { side: "you", area: "drop", alsoFrom: [sel] } }), 3, "observation reaches alternatives");
    assert.ok([guarded, immune, blocked].every(x => s.sides[foe].zones.battle.includes(x))); cases++;
  }
}
// Non-choice contexts cannot carry a summed choice bound and remain visibly unread.
for (const skill of [
  "[Permanent] Your opponent's Battle Cards with an energy cost less than or equal to the number of cards in their hand get -5000 power.",
]) assert.ok(skillRecords(card("CB4_UNSUPPORTED", { skill }))[0].unread.length, skill);
const prefix = "up to 1 of your opponent's Battle Cards with an energy cost ";
const boundChoice = parseTarget(prefix + "less than or equal to the number of cards in their hand")!;
assert.equal(validateProgram([{ op: "if", cond: { kind: "count", sel: boundChoice, atLeast: 1 }, then: [{ op: "draw", n: 1 }] }]), false, "summed-choice bounds cannot be silently used in condition selectors");
for (const phrase of [
  prefix.replace("up to 1", "up to 2") + "less than or equal to the number of cards in their hand",
  prefix + "greater than the number of cards in their hand",
  prefix + "less than or equal to the number of cards in your Drop and Warp",
  prefix + "less than or equal to the number of Unison Cards and ≪Frieza Clan≫ cards in all Leader Areas, Energy Areas, Battle Areas, Unison Areas, Drop Areas, and Warps",
  prefix + "less than or equal to the number of mono-green ≪Saiyan≫ cards in their hand",
  prefix.replace("Battle Cards", "Leader Cards") + "less than or equal to the number of cards in their hand",
]) assert.equal(parseTarget(phrase), null, phrase);
console.log(`counted cost bound 4: ${cases} runtime scenarios, stored/language roundtrips and unsupported guards passed`);
