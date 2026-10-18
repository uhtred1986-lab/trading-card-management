/**
 * #925: [Union-Fusion] / [Union-Potara] materials are an exact set — one
 * distinct physical Battle Card per specified character, each meeting only the
 * words printed beside its own name — from the printed text through the
 * compiler's records to the VM.
 *
 * Sources: rulemanual 22-13-4-1/-2 (Fusion: "1 of each of the specified
 * character's Battle Cards … each Battle Card's power being equal. If such a
 * set of cards can't be revealed, you can't declare activation"), 22-13-5-2
 * (Potara: "choosing one of each specified character's Battle Card in your
 * Battle Area. If the player can't choose all … they can't activate"), 22-13-5-4
 * (placed on top of the two cards, in any order); the card FAQ has no
 * per-character ruling beyond these. Labelled best guesses (owner's guidance of
 * 18 Oct 2026, nothing in the manual/FAQ says otherwise):
 *  - the words around a name up to the joining "and" qualify that name only;
 *    ", both black" (SD23-07, P-519, BT22-121) qualifies every name;
 *  - "with 5000 power" reads printed power (the ruling of 13 Oct 2026 for
 *    equal power), so a buffed Goku in the Battle Area still qualifies;
 *  - Potara asks for no equal power (the manual states none; BT7-118 prints
 *    a blue Goku and a yellow Vegeta of any powers); Fusion keeps it.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { namedSetCandidates } from "../../src/lib/arena/text/cards";
import { unionNeedsOf } from "../../src/lib/arena/text/union";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";

const engine = RULES;
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok);
const game = loaded.definition;

// ── 1. the reading: each printed name keeps its own words ──
{
  const needs = (text: string) => unionNeedsOf(text).map((n) => ({ name: n.name, colors: n.filter.colors, type: n.filter.type, z: n.filter.z, costMin: n.filter.costMin, costMax: n.filter.costMax, powerMin: n.filter.powerMin, powerMax: n.filter.powerMax, mono: n.filter.monoColor }));
  assert.deepEqual(needs("Yellow <Son Goku> card with 5000 power and blue <Vegeta> card with 5000 power."), [
    { name: "Son Goku", colors: ["Yellow"], type: null, z: null, costMin: null, costMax: null, powerMin: 5000, powerMax: 5000, mono: false },
    { name: "Vegeta", colors: ["Blue"], type: null, z: null, costMin: null, costMax: null, powerMin: 5000, powerMax: 5000, mono: false },
  ], "BT22-136: yellow Goku 5000 and blue Vegeta 5000, never the pooled colours");
  assert.deepEqual(needs("Green <Vegeta> Z-Battle Card and green <Son Goku> card."), [
    { name: "Vegeta", colors: ["Green"], type: "BATTLE", z: true, costMin: null, costMax: null, powerMin: null, powerMax: null, mono: false },
    { name: "Son Goku", colors: ["Green"], type: null, z: null, costMin: null, costMax: null, powerMin: null, powerMax: null, mono: false },
  ], "BT23-084: only Vegeta is a Z-Battle Card");
  assert.deepEqual(needs("Blue <Kale> and yellow <Caulifla> with energy costs of 4 or more."), [
    { name: "Kale", colors: ["Blue"], type: null, z: null, costMin: null, costMax: null, powerMin: null, powerMax: null, mono: false },
    { name: "Caulifla", colors: ["Yellow"], type: null, z: null, costMin: 4, costMax: null, powerMin: null, powerMax: null, mono: false },
  ], "BT7-121: the cost belongs to Caulifla");
  assert.deepEqual(needs("<Son Goku> card and <Vegeta> card, both black.").map((n) => n.colors), [["Black"], ["Black"]], "BT22-121: 'both black' reaches each name");
  assert.deepEqual(needs("<Son Goku> and <Vegeta> card, both black.").map((n) => n.colors), [["Black"], ["Black"]], "SD23-07");
  assert.deepEqual(needs("White <Son Goku> card and black <Vegeta> card").map((n) => n.colors), [["White"], ["Black"]], "BT29-142");
  assert.deepEqual(needs("Blue <Zamasu> Z-Battle Card with an energy cost of 3 and <Goku Black>.").map((n) => [n.name, n.costMin, n.z, n.colors.join()]), [["Zamasu", 3, true, "Blue"], ["Goku Black", null, null, ""]], "EX22-06");
  assert.deepEqual(needs("Mono green <Son Goku: GT> card and mono-green <Vegeta: GT> card.").map((n) => [n.name, n.colors.join(), n.mono]), [["Son Goku: GT", "Green", false], ["Vegeta: GT", "Green", true]].map((r) => r), "BT31-052 (the first 'Mono green' spelling is the colour reader's own business)");
  assert.deepEqual(needs("<V1> <UNI-B>").map((n) => n.name), ["V1", "UNI-B"], "names with no joining word");
}

// ── 2. the set search: distinct cards, per-name tests ──
{
  type P = { id: string; characters: string[]; power: number; colour: string };
  const need = (name: string, colour?: string) => ({ name, accepts: colour ? (c: P) => c.colour === colour : undefined });
  const pool: P[] = [
    { id: "gy", characters: ["Son Goku"], power: 5000, colour: "Y" },
    { id: "gb", characters: ["Son Goku"], power: 5000, colour: "B" },
    { id: "vy", characters: ["Vegeta"], power: 5000, colour: "Y" },
    { id: "vb", characters: ["Vegeta"], power: 5000, colour: "B" },
    { id: "dual", characters: ["Son Goku", "Vegeta"], power: 5000, colour: "B" },
  ];
  assert.deepEqual(namedSetCandidates([need("Son Goku", "Y"), need("Vegeta", "B")], pool.slice(0, 4), [], true).sort(), ["gy", "vb"], "yellow Goku + blue Vegeta: the swapped colours are on no set");
  assert.deepEqual(namedSetCandidates([need("Son Goku", "Y"), need("Vegeta", "B")], [pool[1], pool[2]], [], true), [], "blue Goku + yellow Vegeta is not the set");
  assert.deepEqual(namedSetCandidates(["Son Goku", "Vegeta"], pool.slice(0, 2), [], true), [], "two Gokus are not a Goku and a Vegeta");
  assert.deepEqual(namedSetCandidates(["Son Goku", "Vegeta"], [pool[4]], [], true), [], "one card that prints both names fills one name, never both");
  assert.deepEqual(namedSetCandidates(["Son Goku", "Vegeta"], [pool[0], pool[4]], [], true).sort(), ["dual", "gy"], "…but it can be the Vegeta beside a Goku");
  assert.deepEqual(namedSetCandidates(["Son Goku", "Vegeta"], [pool[0], pool[4]], ["gy"], true), ["dual"], "after the Goku it is the only Vegeta");
  assert.deepEqual(namedSetCandidates(["Son Goku", "Vegeta"], pool.slice(0, 3), ["gy"], true), ["vy"], "after a Goku, a second Goku is never offered");
}

// ── 3. the VM ──
const FUSION_136 = "[union-fusion]{1}, if you have 2 or more energy: Yellow <Son Goku> card with 5000 power and blue <Vegeta> card with 5000 power.";
const POTARA_084 = "[union-potara]{g}{g}{g}: Green <Vegeta> Z-Battle Card and green <Son Goku> card.";
const POTARA_121 = "[union-potara] {y}: Blue <Kale> and yellow <Caulifla> with energy costs of 4 or more.";
const POTARA_BLACK = "[union-potara] [limit 1] <Son Goku> and <Vegeta> card, both black.";
const FUSION_PLAIN = "[union-fusion]{1}: <Son Goku> and <Vegeta>";
const POTARA_ANY = "[union-potara]{1}: Blue <Son Goku> and yellow <Vegeta>";
const BACK_PERMANENT = "[permanent] You can choose the specified Battle Cards in your Battle Area or your Drop when choosing cards to use with the [union] skill of a red <Veku> or <Gogeta> card from your hand. If you do, send the chosen cards to their owner's Warp.";
const WARP_PERMANENT = "[permanent] You can choose Battle Cards in your Warp when choosing cards to use with this card's [union] skill from your hand. If you do, place the chosen cards in your Drop Area from your Warp.";
const c = (id: string, o: Partial<CardDef>): CardDef => card(id, { colors: ["Red"], power: 5000, energyCost: 2, skill: null, ...o });

const defs: Record<string, CardDef> = { ...DEFS,
  F136: c("F136", { characters: ["Gogeta"], energyCost: 3, power: 20000, colors: ["Yellow"], skill: FUSION_136 }),
  GY5: c("GY5", { characters: ["Son Goku"], colors: ["Yellow"] }),
  GB5: c("GB5", { characters: ["Son Goku"], colors: ["Blue"] }),
  GY5B: c("GY5B", { characters: ["Son Goku"], colors: ["Yellow"] }),
  VB5: c("VB5", { characters: ["Vegeta"], colors: ["Blue"] }),
  VY5: c("VY5", { characters: ["Vegeta"], colors: ["Yellow"] }),
  VB10: c("VB10", { characters: ["Vegeta"], colors: ["Blue"], power: 10000 }),
  GY10: c("GY10", { characters: ["Son Goku"], colors: ["Yellow"], power: 10000 }),
  DUAL: c("DUAL", { characters: ["Son Goku", "Vegeta"], colors: ["Blue"] }),
  EXTRAV: c("EXTRAV", { type: "EXTRA", characters: ["Vegeta"], colors: ["Blue"] }),
  PLAINF: c("PLAINF", { characters: ["Gogeta"], energyCost: 3, power: 20000, skill: FUSION_PLAIN }),
  G0: c("G0", { characters: ["Son Goku"], power: 10000 }),
  G0B: c("G0B", { characters: ["Son Goku"], power: 10000 }),
  V0: c("V0", { characters: ["Vegeta"], power: 10000 }),
  P084: c("P084", { characters: ["Vegito"], colors: ["Green"], energyCost: 3, power: 20000, skill: POTARA_084 }),
  VGZ: c("VGZ", { type: "Z-BATTLE", characters: ["Vegeta"], colors: ["Green"] }),
  VG: c("VG", { characters: ["Vegeta"], colors: ["Green"] }),
  GG: c("GG", { characters: ["Son Goku"], colors: ["Green"], power: 15000 }),
  GBL: c("GBL", { characters: ["Son Goku"], colors: ["Blue"] }),
  P121: c("P121", { characters: ["Kefla"], colors: ["Yellow"], energyCost: 3, power: 20000, skill: POTARA_121 }),
  KB: c("KB", { characters: ["Kale"], colors: ["Blue"], energyCost: 2 }),
  KY: c("KY", { characters: ["Kale"], colors: ["Yellow"], energyCost: 2 }),
  CY4: c("CY4", { characters: ["Caulifla"], colors: ["Yellow"], energyCost: 4 }),
  CY3: c("CY3", { characters: ["Caulifla"], colors: ["Yellow"], energyCost: 3 }),
  PBLK: c("PBLK", { characters: ["Vegito"], colors: ["Black"], energyCost: 3, power: 20000, skill: POTARA_BLACK }),
  GBK: c("GBK", { characters: ["Son Goku"], colors: ["Black"] }),
  VBK: c("VBK", { characters: ["Vegeta"], colors: ["Black"] }),
  VRD: c("VRD", { characters: ["Vegeta"], colors: ["Red"] }),
  PANY: c("PANY", { characters: ["Vegito"], colors: ["Blue"], energyCost: 3, power: 20000, skill: POTARA_ANY }),
  GBL20: c("GBL20", { characters: ["Son Goku"], colors: ["Blue"], power: 20000 }),
  VYL5: c("VYL5", { characters: ["Vegeta"], colors: ["Yellow"], power: 5000 }),
  RGOG: c("RGOG", { characters: ["Gogeta"], energyCost: 3, power: 20000, skill: "[Union-Fusion]{r}: Yellow <Son Goku> card with 5000 power and blue <Vegeta> card with 5000 power" }),
  WARPF: c("WARPF", { characters: ["Gogeta"], energyCost: 3, power: 20000, colors: ["Yellow"], skill: `${FUSION_136}\n${WARP_PERMANENT}` }),
  LEAD925: { ...card("LEAD925", { type: "LEADER", colors: ["Red"], energyCost: null, comboCost: null, comboPower: null, power: 10000, characters: ["Son Goku", "Vegeta"], skill: null }),
    back: { name: "SS Gogeta, Situation Reversal Fusion", power: 15000, skill: `${BACK_PERMANENT}\n[br]\n[auto] When this card attacks, draw 1 card.` } },
};
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromCompiler(defs) };

const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
const apply = (s: VmState, a: Action): VmState => engine.apply(ctx, reload(s), a).state as VmState;
type Area = "hand" | "battle" | "energy" | "warp" | "drop";
function stage(s: VmState, p: PlayerId, id: string, area: Area): string {
  const physical = s.sides[p].zones.deck[0]; assert.ok(physical);
  s.cards[physical].cardId = id;
  assert.ok(moveCard(s, game, physical, area, { owner: p }).ok);
  return physical;
}
const candidates = (s: VmState): string[] => (s.prompt.kind === "chooseCards" ? s.prompt.choice.candidates : []);
const choose = (s: VmState, ids: string[], player: PlayerId = "p2") => apply(s, { type: "choose", player, cards: ids });
const offer = (s: VmState, id: string) => engine.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === id);
const refusal = (s: VmState, id: string) => engine.rejectedActions(ctx, s, engine.legalActions(ctx, s)).find((x) => x.action.type === "activate" && x.action.card === id);
/** p2's first Main Phase under `lead`, with `energy` energy cards of every colour the prices need. */
function board(seed: number, lead = "L-RED", flipped = false): VmState {
  let s = engine.createGame(ctx, { seed, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Other", leader: lead, main: fifty("V1") } }).state as VmState;
  s = apply(s, { type: "chooseFirst", player: s.chooser, first: "p1" });
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) s = apply(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player });
  s = apply(s, { type: "endMain", player: "p1" }); s = apply(s, { type: "charge", player: "p2", card: null });
  assert.equal(s.turnPlayer, "p2"); assert.equal(s.prompt.kind, "main");
  for (const p of ["p1", "p2"] as const) for (const area of ["hand", "energy"] as const) for (const id of s.sides[p].zones[area].slice()) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  if (flipped) s.cards[s.sides.p2.zones.leader[0]].flipped = true;
  return s;
}
/** Energy of the right colours: V1 is red, so the colour-specific prices stage their own energy. */
function energy(s: VmState, ...ids: string[]) { for (const id of ids) stage(s, "p2", id, "energy"); }
function start(s: VmState, id: string): VmState {
  const o = offer(s, id); assert.ok(o, `${s.cards[id].cardId} is offered — ${JSON.stringify(refusal(s, id)?.why)}`);
  let d = apply(s, o.action);
  while (d.prompt.kind === "payCost") d = apply(d, { type: "payCost", player: "p2", option: 0 });
  return d;
}
/** Answer every remaining question with the first candidate. */
function settle(s: VmState): VmState {
  for (let i = 0; i < 12 && s.prompt.kind === "chooseCards"; i++) s = choose(s, [candidates(s)[0]]);
  return s;
}
const ENERGY = ["EY", "EB", "EG", "EY2", "EB2", "EG2", "ER"];
Object.assign(defs, {
  EY: c("EY", { colors: ["Yellow"] }), EY2: c("EY2", { colors: ["Yellow"] }), EB: c("EB", { colors: ["Blue"] }), EB2: c("EB2", { colors: ["Blue"] }),
  EG: c("EG", { colors: ["Green"] }), EG2: c("EG2", { colors: ["Green"] }), ER: c("ER", { colors: ["Red"] }),
});

// ── BT22-136: yellow Goku 5000 + blue Vegeta 5000 (Fusion, hand) ──
{
  const base = (seed: number) => { const s = board(seed); energy(s, "ER", "ER", "ER"); return s; };
  // Wrong colours on each side: a blue Goku and a yellow Vegeta are not the set.
  let s = base(9251); let f = stage(s, "p2", "F136", "hand"); stage(s, "p2", "GB5", "hand"); stage(s, "p2", "VY5", "hand");
  assert.equal(offer(s, f), undefined, "blue Goku + yellow Vegeta: refused although both names and both colours are printed");
  assert.equal(refusal(s, f)?.why[0]?.kind, "target");
  // Right colours but a wrong power on one: refused.
  s = base(9252); f = stage(s, "p2", "F136", "hand"); stage(s, "p2", "GY5", "hand"); stage(s, "p2", "VB10", "hand");
  assert.equal(offer(s, f), undefined, "Vegeta 10000 is not 5000");
  // Two yellow Gokus and no Vegeta.
  s = base(9253); f = stage(s, "p2", "F136", "hand"); stage(s, "p2", "GY5", "hand"); stage(s, "p2", "GY5B", "hand");
  assert.equal(offer(s, f), undefined, "two Gokus never make a pair");
  // The set, with distractors: only the two that fit are on offer, and the wrong ones are refused.
  s = base(9254); f = stage(s, "p2", "F136", "hand");
  const gy = stage(s, "p2", "GY5", "hand"), vb = stage(s, "p2", "VB5", "hand");
  const gb = stage(s, "p2", "GB5", "hand"), vy = stage(s, "p2", "VY5", "hand"), gy2 = stage(s, "p2", "GY5B", "hand"), vb10 = stage(s, "p2", "VB10", "hand");
  s = start(s, f);
  assert.deepEqual(candidates(s).sort(), [gy, gy2, vb].sort(), "yellow Gokus of 5000 and the one blue Vegeta of 5000; no blue Goku, no yellow Vegeta, no Vegeta 10000");
  for (const bad of [gb, vy, vb10, f]) assert.throws(() => choose(s, [bad]), IllegalAction, "a card outside the set is refused");
  assert.throws(() => choose(s, [gy, gy2]), IllegalAction, "a forged answer naming both Gokus is refused");
  assert.throws(() => choose(s, [gy, gy]), IllegalAction, "a card cannot answer twice");
  s = choose(s, [gy]);
  assert.deepEqual(candidates(s), [vb], "after the Goku only the blue Vegeta of 5000 — not the second Goku");
  assert.throws(() => choose(s, [gy2]), IllegalAction, "a second Goku is refused");
  assert.throws(() => choose(s, [gy]), IllegalAction, "reusing the Goku is refused");
  // A stale pick: the Vegeta leaves the hand while the question stands.
  const stale = reload(s); assert.ok(moveCard(stale, game, vb, "energy", { owner: "p2" }).ok);
  assert.throws(() => choose(stale, [vb]), IllegalAction, "a Vegeta that left the hand cannot be paid");
  const before = JSON.stringify(s);
  assert.throws(() => choose(s, [vb], "p1"), IllegalAction, "only the player answers");
  assert.equal(JSON.stringify(s), before, "a refused pick changes nothing");
  assert.equal(JSON.stringify(choose(reload(s), [vb])), JSON.stringify(choose(reload(s), [vb])), "serialized mid-choice, it resolves the same");
  const done = settle(s);
  assert.ok(done.sides.p2.zones.drop.includes(gy) && done.sides.p2.zones.drop.includes(vb), "22-13-4-4: both materials go to the Drop");
  assert.ok(done.sides.p2.zones.battle.includes(f), "the fusion card is played");
  for (const keep of [gb, vy, gy2, vb10]) assert.ok(done.sides.p2.zones.hand.includes(keep), "an unchosen card stays in the hand");
}

// ── plain Fusion: no two Gokus ──
{
  let s = board(9255); energy(s, "ER");
  const f = stage(s, "p2", "PLAINF", "hand");
  const a = stage(s, "p2", "G0", "hand"), b = stage(s, "p2", "G0B", "hand");
  assert.equal(offer(s, f), undefined, "two Gokus and no Vegeta: not offered");
  const v = stage(s, "p2", "V0", "hand");
  const ex = stage(s, "p2", "EXTRAV", "hand");
  s = start(s, f);
  assert.deepEqual(candidates(s).sort(), [a, b, v].sort(), "either Goku or the Vegeta, never the Extra that prints the name");
  s = choose(s, [a]);
  assert.deepEqual(candidates(s), [v], "after one Goku the other Goku is not offered");
  assert.throws(() => choose(s, [b]), IllegalAction, "the second Goku is refused");
  assert.throws(() => choose(s, [ex]), IllegalAction, "an Extra card is no Battle Card");
  const done = choose(s, [v]);
  assert.ok(done.sides.p2.zones.drop.includes(a) && done.sides.p2.zones.drop.includes(v) && done.sides.p2.zones.hand.includes(b) && done.sides.p2.zones.battle.includes(f));
  // Equal power is still required for Fusion.
  const t = board(9256); energy(t, "ER"); const f2 = stage(t, "p2", "PLAINF", "hand");
  stage(t, "p2", "G0", "hand"); stage(t, "p2", "VB5", "hand");
  assert.equal(offer(t, f2), undefined, "Fusion: a Goku of 10000 and a Vegeta of 5000 are not of equal power");
  // A card that prints both names fills one of them.
  const u = board(9257); energy(u, "ER"); const f3 = stage(u, "p2", "PLAINF", "hand");
  stage(u, "p2", "DUAL", "hand");
  assert.equal(offer(u, f3), undefined, "one card printing both names cannot be both materials");
  const dual = stage(u, "p2", "DUAL", "hand"); void dual;
  assert.ok(offer(u, f3), "two such cards are two materials");
}

// ── the area extensions keep the same exact sets ──
{
  // BT31-001's widening: hand, Battle Area, Drop in any mix.
  let s = board(9258, "LEAD925", true); energy(s, "ER");
  const f = stage(s, "p2", "RGOG", "hand");
  const gy = stage(s, "p2", "GY5", "drop"), gb = stage(s, "p2", "GB5", "battle");
  const vb = stage(s, "p2", "VB5", "battle"), vy = stage(s, "p2", "VY5", "drop");
  s = start(s, f);
  assert.deepEqual(candidates(s).sort(), [gy, vb].sort(), "Drop yellow Goku + Battle Area blue Vegeta; the blue Goku and yellow Vegeta are on no set");
  assert.throws(() => choose(s, [gb]), IllegalAction); assert.throws(() => choose(s, [vy]), IllegalAction);
  s = choose(s, [gy]); assert.deepEqual(candidates(s), [vb]);
  s = choose(s, [vb]);
  assert.ok(s.sides.p2.zones.warp.includes(gy) && s.sides.p2.zones.warp.includes(vb), "outside materials go to the Warp");
  assert.ok(s.sides.p2.zones.battle.includes(f));
  const none = board(9259, "LEAD925", true); energy(none, "ER"); const f2 = stage(none, "p2", "RGOG", "hand");
  stage(none, "p2", "GB5", "drop"); stage(none, "p2", "VY5", "battle");
  assert.equal(offer(none, f2), undefined, "the wrong colours stay wrong in every area");
}
{
  // The card's own Warp permission: hand or Warp, in any mix, both to the Drop.
  let s = board(9260); energy(s, "ER", "ER");
  const f = stage(s, "p2", "WARPF", "hand");
  const gy = stage(s, "p2", "GY5", "warp"), vb = stage(s, "p2", "VB5", "hand");
  const gb = stage(s, "p2", "GB5", "warp"), vy = stage(s, "p2", "VY5", "warp");
  s = start(s, f);
  assert.deepEqual(candidates(s).sort(), [gy, vb].sort());
  s = settle(s);
  assert.ok(s.sides.p2.zones.drop.includes(gy) && s.sides.p2.zones.drop.includes(vb) && s.sides.p2.zones.warp.includes(gb) && s.sides.p2.zones.warp.includes(vy));
  const wrong = board(9261); energy(wrong, "ER", "ER"); const f2 = stage(wrong, "p2", "WARPF", "hand");
  stage(wrong, "p2", "GB5", "warp"); stage(wrong, "p2", "VY5", "hand");
  assert.equal(offer(wrong, f2), undefined, "swapped colours in the Warp/hand mix");
}

// ── Potara: BT23-084 (green Z-Battle Vegeta + green Goku) ──
{
  const base = (seed: number) => { const s = board(seed); energy(s, "EG", "EG2", "EG2"); return s; };
  // A plain green Vegeta is not a Z-Battle Card.
  let s = base(9262); let p = stage(s, "p2", "P084", "hand"); stage(s, "p2", "VG", "battle"); stage(s, "p2", "GG", "battle");
  assert.equal(offer(s, p), undefined, "a green Vegeta that is no Z-Battle Card does not answer BT23-084");
  // The Z-Battle qualifier does not reach Goku (green Goku is not a Z-Battle Card), power need not be equal (15000 vs 5000).
  s = base(9263); p = stage(s, "p2", "P084", "hand");
  const z = stage(s, "p2", "VGZ", "battle"), g = stage(s, "p2", "GG", "battle"), blue = stage(s, "p2", "GBL", "battle"), plainV = stage(s, "p2", "VG", "battle");
  s = start(s, p);
  assert.deepEqual(candidates(s).sort(), [g, z].sort(), "the Z-Battle Vegeta and the green Goku; not the blue Goku, not the plain Vegeta");
  assert.throws(() => choose(s, [blue]), IllegalAction); assert.throws(() => choose(s, [plainV]), IllegalAction);
  assert.throws(() => choose(s, [z, plainV]), IllegalAction, "a forged pair with the wrong Vegeta");
  s = choose(s, [g]); assert.deepEqual(candidates(s), [z], "only the Z-Battle Vegeta remains");
  const stale = reload(s); assert.ok(moveCard(stale, game, z, "drop", { owner: "p2" }).ok);
  assert.throws(() => choose(stale, [z]), IllegalAction, "a material that left the Battle Area is refused");
  s = choose(s, [z]);
  // 22-13-5-4: the card is played on top of the two; the first chosen is under it first.
  assert.ok(s.sides.p2.zones.battle.includes(p));
  assert.deepEqual([...s.cards[p].under].sort(), [g, z].sort(), "both chosen cards are under it");
  assert.ok(s.sides.p2.zones.battle.includes(blue) && s.sides.p2.zones.battle.includes(plainV), "the unchosen stay in play");
  assert.deepEqual(s.cards[p].under.length, 2);
}

// ── Potara: BT7-121 (blue Kale + yellow Caulifla with cost ≥ 4) ──
{
  const base = (seed: number) => { const s = board(seed); energy(s, "EY"); return s; };
  let s = base(9264); let p = stage(s, "p2", "P121", "hand"); stage(s, "p2", "KB", "battle"); stage(s, "p2", "CY3", "battle");
  assert.equal(offer(s, p), undefined, "Caulifla of cost 3 is below 'energy costs of 4 or more'");
  s = base(9265); p = stage(s, "p2", "P121", "hand"); stage(s, "p2", "KY", "battle"); stage(s, "p2", "CY4", "battle");
  assert.equal(offer(s, p), undefined, "a yellow Kale is not the blue Kale");
  s = base(9266); p = stage(s, "p2", "P121", "hand");
  const kb = stage(s, "p2", "KB", "battle"), cy4 = stage(s, "p2", "CY4", "battle"), cy3 = stage(s, "p2", "CY3", "battle"), ky = stage(s, "p2", "KY", "battle");
  s = start(s, p);
  assert.deepEqual(candidates(s).sort(), [kb, cy4].sort(), "Kale needs no cost (it costs 2); only Caulifla does");
  assert.throws(() => choose(s, [cy3]), IllegalAction); assert.throws(() => choose(s, [ky]), IllegalAction);
  s = choose(s, [cy4]); assert.deepEqual(candidates(s), [kb]);
  s = choose(s, [kb]);
  assert.ok(s.sides.p2.zones.battle.includes(p) && s.cards[p].under.length === 2);
  assert.equal(s.cards[p].under[0] !== undefined, true);
}

// ── Potara: no equal power; a shared colour ("both black") ──
{
  let s = board(9267); energy(s, "EB");
  const p = stage(s, "p2", "PANY", "hand");
  const g = stage(s, "p2", "GBL20", "battle"), v = stage(s, "p2", "VYL5", "battle");
  s = start(s, p);
  assert.deepEqual(candidates(s).sort(), [g, v].sort(), "Potara: a Goku of 20000 and a Vegeta of 5000 are fine — no equal power");
  s = choose(s, [g]); s = choose(s, [v]);
  assert.ok(s.sides.p2.zones.battle.includes(p) && s.cards[p].under.length === 2);

  let t = board(9268); energy(t);
  let pb = stage(t, "p2", "PBLK", "hand"); stage(t, "p2", "GBK", "battle"); stage(t, "p2", "VRD", "battle");
  assert.equal(offer(t, pb), undefined, "', both black': a red Vegeta is not enough");
  t = board(9269); pb = stage(t, "p2", "PBLK", "hand");
  const gk = stage(t, "p2", "GBK", "battle"), vk = stage(t, "p2", "VBK", "battle"), vr = stage(t, "p2", "VRD", "battle");
  t = start(t, pb);
  assert.deepEqual(candidates(t).sort(), [gk, vk].sort());
  assert.throws(() => choose(t, [vr]), IllegalAction);
  t = settle(t);
  assert.ok(t.sides.p2.zones.battle.includes(pb) && t.cards[pb].under.length === 2);
  // Potara from the hand only chooses in the Battle Area — materials in hand/drop/warp/energy do not count.
  for (const area of ["hand", "drop", "warp", "energy"] as const) {
    const u = board(9270); const q = stage(u, "p2", "PBLK", "hand");
    stage(u, "p2", "GBK", area); stage(u, "p2", "VBK", area);
    assert.equal(offer(u, q), undefined, `Potara: ${area} is not the Battle Area`);
  }
}

void ENERGY;
console.log("union-exact-sets-925: per-name readings, distinct cards, colour/type/cost/power per character, forged and stale picks, Fusion equal power, Potara without it, area extensions passed");
