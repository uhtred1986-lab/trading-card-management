/**
 * #541 (22-13-4-2-1): BT31-001's awakened side, SS Gogeta, Situation Reversal
 * Fusion — "[Permanent] You can choose the specified Battle Cards in your
 * Battle Area or your Drop when choosing cards to use with the [Union] skill of
 * a red <Veku> or <Gogeta> card from your hand. If you do, send the chosen
 * cards to their owner's Warp."
 *
 * There is no official Q&A for BT31-001; the readings below are the owner's
 * ruling of 13 Oct 2026 (issue #541):
 *  1. only [Union-Fusion] is widened (never Potara, whose card is placed on
 *     top of its materials, nor Absorb, which is not activated from the hand);
 *  2. each specified card may come from the hand, the Battle Area or the Drop,
 *     in any mix, both from outside the hand included;
 *  3. cards chosen from the Battle Area or the Drop go to their owner's Warp,
 *     the hand's go to the Drop (22-13-4-4);
 *  4. equal power (22-13-4-2) compares printed power;
 *  5. a card moved from the Battle Area to the Warp this way triggers its
 *     normal area-movement [Auto]s (no counterpart of 22-13-5-2-1-1 for Fusion).
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { compileCard } from "../../src/lib/arena/compile";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { namedSetCandidates } from "../../src/lib/arena/text/cards";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";

const engine = RULES;
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok);
const game = loaded.definition;

const BACK_PERMANENT = "[permanent] You can choose the specified Battle Cards in your Battle Area or your Drop when choosing cards to use with the [union] skill of a red <Veku> or <Gogeta> card from your hand. If you do, send the chosen cards to their owner's Warp.";
const leader = (id: string, withBack: boolean): CardDef => ({
  ...card(id, { type: "LEADER", colors: ["Red"], energyCost: null, comboCost: null, comboPower: null, power: 10000, characters: ["Son Goku", "Vegeta"], skill: null }),
  back: withBack ? { name: "SS Gogeta, Situation Reversal Fusion", power: 15000, skill: `${BACK_PERMANENT}\n[br]\n[auto] When this card attacks, draw 1 card.` } : { name: "plain back", power: 15000, skill: null },
});
const red = (id: string, o: Partial<CardDef>): CardDef => card(id, { colors: ["Red"], ...o });
const FUSION = "[Union-Fusion]{r}: <Son Goku> <Vegeta>";

const defs: Record<string, CardDef> = { ...DEFS,
  LEAD541: leader("LEAD541", true),
  PLAINLEAD541: leader("PLAINLEAD541", false),
  GOG541: red("GOG541", { characters: ["Gogeta"], energyCost: 3, power: 20000, skill: FUSION }),
  VEKU541: red("VEKU541", { characters: ["Veku"], energyCost: 3, power: 20000, skill: FUSION }),
  BLUEGOG541: card("BLUEGOG541", { colors: ["Blue"], characters: ["Gogeta"], energyCost: 3, power: 20000, skill: FUSION }),
  GOKUFUSE541: red("GOKUFUSE541", { characters: ["Son Goku"], energyCost: 3, power: 20000, skill: FUSION }),
  POTARA541: red("POTARA541", { characters: ["Gogeta"], energyCost: 3, power: 20000, skill: "[Union-Potara]{r}: <Son Goku> <Vegeta>" }),
  GOKU541: red("GOKU541", { characters: ["Son Goku"], power: 10000, skill: null }),
  GOKU5541: red("GOKU5541", { characters: ["Son Goku"], power: 5000, skill: null }),
  VEG541: red("VEG541", { characters: ["Vegeta"], power: 10000, skill: null }),
  VEG20541: red("VEG20541", { characters: ["Vegeta"], power: 20000, skill: null }),
  WATCH541: red("WATCH541", { characters: ["Vegeta"], power: 10000, skill: "[Auto] When this card is removed from a Battle Area by a skill, add it to your hand." }),
};
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromCompiler(defs) };

const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
function apply(s: VmState, action: Action) { return engine.apply(ctx, reload(s), action) as { state: VmState }; }
function stage(s: VmState, p: PlayerId, id: string, area: "battle" | "energy" | "warp" | "hand" | "drop"): string {
  const physical = s.sides[p].zones.deck[0]; assert.ok(physical);
  s.cards[physical].cardId = id;
  assert.ok(moveCard(s, game, physical, area, { owner: p }).ok);
  return physical;
}
const candidates = (s: VmState): string[] => (s.prompt.kind === "chooseCards" ? s.prompt.choice.candidates : []);
const choose = (s: VmState, ids: string[], player: PlayerId = "p2") => apply(s, { type: "choose", player, cards: ids });
const fusion = (s: VmState, id: string) => engine.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === id);
/** Activate the card's line and pay its {r} (the one red energy), arriving at the first question about the specified cards. */
function start(s: VmState, id: string): VmState {
  let d = apply(s, fusion(s, id)!.action).state;
  if (d.prompt.kind === "payCost") d = apply(d, { type: "payCost", player: "p2", option: 0 }).state;
  return d;
}
const rejection =(s: VmState, id: string) => engine.rejectedActions(ctx, s, engine.legalActions(ctx, s)).find((x) => x.action.type === "activate" && x.action.card === id);

/** p2's first Main Phase (p1 went first) under `lead`, awakened or not, with one red energy to pay {r}. */
function board(seed: number, lead: string, flipped: boolean) {
  let s = engine.createGame(ctx, { seed, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Other", leader: lead, main: fifty("V1") } }).state as VmState;
  const pass = (a: Action) => { s = apply(s, a).state; };
  pass({ type: "chooseFirst", player: s.chooser, first: "p1" });
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) pass({ type: "pass", player: (s.prompt as { player: PlayerId }).player });
  pass({ type: "endMain", player: "p1" }); pass({ type: "charge", player: "p2", card: null });
  assert.equal(s.turnPlayer, "p2"); assert.equal(s.prompt.kind, "main");
  for (const id of s.sides.p2.zones.energy.slice()) assert.ok(moveCard(s, game, id, "deck", { owner: "p2" }).ok);
  for (const id of s.sides.p2.zones.hand.slice()) assert.ok(moveCard(s, game, id, "deck", { owner: "p2" }).ok);
  stage(s, "p2", "V1", "energy");
  if (flipped) s.cards[s.sides.p2.zones.leader[0]].flipped = true;
  return s;
}

// ── the reading: BT31-001's text through the compiler, not a hand-written record ──
{
  const programs = Object.values(compileCard(defs.LEAD541, "back").bySkill);
  assert.ok(programs.every((p) => p.unsupported.length === 0), "the leader's skills read whole");
  const permits = programs.flatMap((p) => p.ops).filter((o) => o.op === "permit");
  assert.equal(permits.length, 1, "the [Permanent] is one permit");
  const op = permits[0] as Extract<(typeof permits)[number], { op: "permit" }>;
  assert.equal(op.what, "unionFusionAreas");
  assert.equal(op.until, "game");
  assert.deepEqual(op.filter?.colors, ["Red"], "a red card");
  assert.deepEqual(op.filter?.characters, ["Veku", "Gogeta"], "<Veku> or <Gogeta>");
  assert.ok(!JSON.stringify(programs.map((p) => p.ops)).includes('"to":"warp"'), "the Warp is the keyword's, not a second clause that moves a choice");
}

// ── the set search: names, distinct cards, one printed power ──
{
  const pool = [
    { id: "a", characters: ["Son Goku"], power: 5000 },
    { id: "b", characters: ["Son Goku"], power: 10000 },
    { id: "c", characters: ["Vegeta"], power: 10000 },
  ];
  assert.deepEqual(namedSetCandidates(["Son Goku", "Vegeta"], pool, [], true).sort(), ["b", "c"], "a Goku of another power is on no complete set");
  assert.deepEqual(namedSetCandidates(["Son Goku", "Vegeta"], pool, ["c"], true), ["b"], "after Vegeta only the Goku of his power");
  assert.deepEqual(namedSetCandidates(["Son Goku", "Vegeta"], pool, ["a"], true), [], "no Vegeta of 5000");
  assert.deepEqual(namedSetCandidates(["Son Goku", "Vegeta"], pool.slice(0, 2), [], true), [], "no Vegeta at all");
  assert.deepEqual(namedSetCandidates(["Son Goku", "Vegeta"], pool, ["b"], false).sort(), ["c"], "a plain set ignores power: Vegeta is the only other name");
}

// ── awakened: both cards from outside the hand ──
{
  const s0 = board(5411, "LEAD541", true);
  const gog = stage(s0, "p2", "GOG541", "hand");
  const goku = stage(s0, "p2", "GOKU541", "drop");
  const veg = stage(s0, "p2", "VEG541", "battle");
  const wrongPower = stage(s0, "p2", "VEG20541", "drop");
  const offer = fusion(s0, gog); assert.ok(offer, `the red <Gogeta> is offered with its cards in the Drop and Battle Area — ${JSON.stringify(rejection(s0, gog)?.why)}`);
  let d = start(s0, gog);
  assert.equal(d.prompt.kind, "chooseCards");
  assert.deepEqual(candidates(d).sort(), [goku, veg].sort(), "the Drop and the Battle Area are on offer; a Vegeta of 20000 with no Goku to match is on no set");
  d = choose(d, [goku]).state;
  assert.deepEqual(candidates(d).sort(), [veg], "then only the Vegeta of the Goku's printed power");

  // Refused picks leave the state unchanged.
  const before = JSON.stringify(d);
  for (const bad of [wrongPower, gog, goku, s0.sides.p2.zones.leader[0], s0.sides.p1.zones.hand[0]]) assert.throws(() => choose(d, [bad]), IllegalAction);
  assert.throws(() => choose(d, [veg], "p1"), IllegalAction, "only the player answers");
  assert.equal(JSON.stringify(d), before, "a refused pick changes nothing");

  // A reload mid-choice resolves the same.
  const done = choose(reload(d), [veg]).state;
  assert.equal(JSON.stringify(choose(reload(d), [veg]).state), JSON.stringify(done), "reload-stable");
  assert.ok(done.sides.p2.zones.warp.includes(goku) && done.sides.p2.zones.warp.includes(veg), "both outside cards ended in their owner's Warp");
  assert.ok(!done.sides.p2.zones.drop.includes(goku) && !done.sides.p2.zones.battle.includes(veg));
  assert.ok(done.sides.p2.zones.battle.includes(gog), "the card is played");
  assert.ok(done.sides.p2.zones.drop.includes(wrongPower), "the card not chosen stays");

  // Both viewers' projections: the Warp is public, so both see the cards there.
  for (const viewer of ["p1", "p2"] as PlayerId[]) {
    const view = engine.boardView(ctx, done, viewer, {});
    const json = JSON.stringify(view);
    assert.ok(json.includes("GOKU541") && json.includes("VEG541"), `${viewer} sees the two cards the cost put in the Warp`);
  }
}

// ── awakened: the hand's card goes to the Drop, the others to the Warp ──
{
  const s0 = board(5412, "LEAD541", true);
  const gog = stage(s0, "p2", "GOG541", "hand");
  const goku = stage(s0, "p2", "GOKU541", "hand");
  const veg = stage(s0, "p2", "VEG541", "drop");
  let d = start(s0, gog);
  d = choose(d, [goku]).state;
  assert.deepEqual(candidates(d), [veg]);
  d = choose(d, [veg]).state;
  assert.ok(d.sides.p2.zones.drop.includes(goku), "22-13-4-4: the hand's card goes to the Drop");
  assert.ok(d.sides.p2.zones.warp.includes(veg), "the Drop's card goes to the Warp");
  assert.ok(d.sides.p2.zones.battle.includes(gog));

  // All from the hand: both to the Drop, nothing to the Warp.
  const h0 = board(5413, "LEAD541", true);
  const g2 = stage(h0, "p2", "VEKU541", "hand"), a = stage(h0, "p2", "GOKU541", "hand"), b = stage(h0, "p2", "VEG541", "hand");
  let h = start(h0, g2);
  h = choose(h, [a]).state; h = choose(h, [b]).state;
  assert.ok(h.sides.p2.zones.drop.includes(a) && h.sides.p2.zones.drop.includes(b) && !h.sides.p2.zones.warp.includes(a) && !h.sides.p2.zones.warp.includes(b), "a red <Veku> too; hand cards go to the Drop");
}

// ── printed power: a buffed Battle Area card still qualifies, a differently-printed one does not ──
{
  const s0 = board(5414, "LEAD541", true);
  const gog = stage(s0, "p2", "GOG541", "hand");
  const goku = stage(s0, "p2", "GOKU541", "drop");
  const veg = stage(s0, "p2", "VEG541", "battle");
  addEffect(s0, [], { target: veg, kind: "power", value: 5000, until: "turn", source: veg, master: "p2" });
  let d = start(s0, gog);
  d = choose(d, [goku]).state;
  assert.deepEqual(candidates(d), [veg], "printed 10000 = 10000 although the Vegeta is 15000 now");
  d = choose(d, [veg]).state;
  assert.ok(d.sides.p2.zones.warp.includes(goku) && d.sides.p2.zones.warp.includes(veg));

  // Equal now, different printed: refused.
  const t0 = board(5415, "LEAD541", true);
  const g = stage(t0, "p2", "GOG541", "hand");
  stage(t0, "p2", "GOKU5541", "drop");
  const v = stage(t0, "p2", "VEG541", "battle");
  addEffect(t0, [], { target: stage(t0, "p2", "GOKU5541", "battle"), kind: "power", value: 5000, until: "turn", source: v, master: "p2" });
  assert.equal(fusion(t0, g), undefined, "5000 + 5000 is not 10000 printed: no set, no offer");
  assert.equal(rejection(t0, g)?.why[0]?.kind, "target", "…refused for its cards, not offered");
}

// ── a Battle Area card moved to the Warp triggers its own area-movement [Auto] ──
{
  const s0 = board(5416, "LEAD541", true);
  const gog = stage(s0, "p2", "GOG541", "hand");
  const goku = stage(s0, "p2", "GOKU541", "hand");
  const watch = stage(s0, "p2", "WATCH541", "battle");
  let d = start(s0, gog);
  d = choose(d, [goku]).state;
  d = choose(d, [watch]).state;
  for (let i = 0; i < 6 && d.prompt.kind !== "main"; i++) {
    const rows = engine.legalActions(ctx, d);
    d = apply(d, rows[0].action).state;
  }
  assert.ok(d.sides.p2.zones.hand.includes(watch), "its [Auto] (removed from a Battle Area by a skill) fired and added it to the hand");
}

// ── without the widening: nothing outside the hand is offered ──
{
  for (const [label, lead, flipped] of [["awakened leader without the text", "PLAINLEAD541", true], ["BT31-001 not awakened", "LEAD541", false]] as const) {
    const s0 = board(5417, lead, flipped);
    const gog = stage(s0, "p2", "GOG541", "hand");
    stage(s0, "p2", "GOKU541", "drop");
    stage(s0, "p2", "VEG541", "battle");
    assert.equal(fusion(s0, gog), undefined, `${label}: the Drop and the Battle Area are not offered`);
    assert.equal(rejection(s0, gog)?.why[0]?.kind, "target", `${label}: refused for want of the named cards in hand`);
    // …the ordinary hand payment is untouched, and takes the Drop.
    const goku = stage(s0, "p2", "GOKU541", "hand"), veg = stage(s0, "p2", "VEG541", "hand");
    let d = start(s0, gog);
    while (d.prompt.kind === "chooseCards") d = choose(d, [candidates(d).find((c) => c === goku || c === veg)!]).state;
    assert.ok(d.sides.p2.zones.drop.includes(goku) && d.sides.p2.zones.drop.includes(veg), `${label}: hand cards go to the Drop as always`);
  }
}

// ── scope: only a red <Veku>/<Gogeta> [Union-Fusion]; never Potara ──
{
  const s0 = board(5418, "LEAD541", true);
  const blue = stage(s0, "p2", "BLUEGOG541", "hand");
  const goku541 = stage(s0, "p2", "GOKUFUSE541", "hand");
  const potara = stage(s0, "p2", "POTARA541", "hand");
  stage(s0, "p2", "GOKU541", "drop");
  stage(s0, "p2", "VEG541", "battle");
  assert.equal(fusion(s0, blue), undefined, "a blue <Gogeta> is not widened");
  assert.equal(fusion(s0, goku541), undefined, "a red <Son Goku> is not widened");
  assert.equal(fusion(s0, potara), undefined, "[Union-Potara] on a red <Gogeta> is not widened (it needs both in the Battle Area)");
}
