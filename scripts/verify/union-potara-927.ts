/**
 * #927: [Union-Potara] stacking semantics and its two source extensions.
 *
 * Sources. rulemanual 22-13-5 (-2: "choosing one of each specified character's
 * Battle Card in your Battle Area"; -2-1: a [Permanent] may expand the areas the
 * cards are chosen from; -2-1-1: with such a skill, "first move any Battle Cards
 * in that area to the Battle Area, and then resolve the keyword skill normally ...
 * any area movement triggers ... are not made pending, nor does counter timing
 * occur"; -4: the card is played "by placing it on top of the two Battle Cards
 * chosen ..., which can be in any order"; -4-1: "All continuous effects affecting
 * the power of the played Battle Cards carry over"; -4-2: a card that fails to
 * enter play is placed in its owner's Drop Area) and the printed reminder on
 * BT2-012 and a dozen more ("Place this card in Active Mode on top of the 2
 * specified cards stacked together"; the official keyword page says Active too).
 * The card FAQ says nothing further. Labelled best guesses (owner's guidance of
 * 18 Oct 2026):
 *  - the order the two cards are chosen is the stack, top to bottom: the played
 *    card, the first chosen with the pile it carried, the second with its pile;
 *    it takes the first chosen's place in the Battle Area;
 *  - the power effects on both cards, and on the cards in their piles, carry;
 *    every other effect on them ends (they are under a new top card);
 *  - BT24-112's back (cards under your black Z-Unison for a black card's Potara)
 *    and BT20-125 (Battle Cards you own in the opponent's Battle Area; the card
 *    is played there, so every material is brought to that Battle Area) use the
 *    -2-1-1 move; a material that has not moved since it was chosen is still
 *    valid when the card lands, whatever the permission says by then.
 *
 * Every case runs on both seats and every answer goes through a JSON round
 * trip, so a choice that is open when the game is saved resumes the same.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { attrsNow } from "../../src/lib/arena/vm/program";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";

const engine = RULES;
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok);
const game = loaded.definition;

const AUTO = "\n[auto] When this card is played, draw 1 card.";
const c = (id: string, o: Partial<CardDef>): CardDef => card(id, { colors: ["Red"], power: 10000, energyCost: 2, skill: null, ...o });
const counter = (id: string, skill: string): CardDef => card(id, { type: "EXTRA", energyCost: 0, comboCost: null, comboPower: null, skill });
const BACK_PERMANENT = "[permanent] You can choose Battle Cards from under your black Z-Unison when choosing cards to use with a black card's [Union-Potara] skill from your hand.";
const OPP_PERMANENT = "[permanent] This card is played from your hand in your opponent's Battle Area, and when choosing cards to use with this card's [Union] skill from your hand, you can choose Battle Cards you own in your opponent's Battle Area.";
const defs: Record<string, CardDef> = { ...DEFS,
  POT: c("POT", { characters: ["Vegito"], energyCost: 3, power: 20000, skill: `[union-potara]{1}: <Son Goku> and <Vegeta> (Place this card in Active Mode on top of the 2 specified cards stacked together)${AUTO}` }),
  POTB: c("POTB", { characters: ["Vegito"], colors: ["Black"], energyCost: 3, power: 20000, skill: `[union-potara]{1}: <Son Goku> and <Vegeta>${AUTO}` }),
  POTO: c("POTO", { characters: ["Vegito"], energyCost: 3, power: 20000, skill: `[union-potara]{1}: <Son Goku> and <Vegeta>\n${OPP_PERMANENT}` }),
  G0: c("G0", { characters: ["Son Goku"], power: 10000 }), V0: c("V0", { characters: ["Vegeta"], power: 25000 }),
  PILE: c("PILE", { characters: ["Pile"], power: 5000 }), PILE2: c("PILE2", { characters: ["Pile"], power: 5000 }),
  ER: c("ER", { colors: ["Red"] }),
  WATCH: c("WATCH", { skill: "[Auto] When a card is placed in your Battle Area, draw 1 card." }),
  CDRAW: counter("CDRAW", "[Counter: Play] Draw 1 card."),
  CDROP: counter("CDROP", "[Counter: Play] The Battle Card being played is placed in its owner's Drop Area instead of being played."),
  UNIBLK: c("UNIBLK", { type: "Z-UNISON", colors: ["Black"], energyCost: null, comboCost: null, comboPower: null, power: 0, characters: ["Unison"] }),
  UNIRED: c("UNIRED", { type: "Z-UNISON", colors: ["Red"], energyCost: null, comboCost: null, comboPower: null, power: 0, characters: ["Unison"] }),
  LEADBK: { ...card("LEADBK", { type: "LEADER", colors: ["Black"], energyCost: null, comboCost: null, comboPower: null, power: 10000, characters: ["Son Goku", "Vegeta"], skill: null }),
    back: { name: "Awakened", power: 15000, skill: BACK_PERMANENT } },
};
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromCompiler(defs) };

const events: GameEvent[] = [];
const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
const apply = (s: VmState, a: Action): VmState => { const out = engine.apply(ctx, reload(s), a); events.push(...out.events); return out.state as VmState; };
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");
const zone = (s: VmState, p: PlayerId, area: string) => s.sides[p].zones[area];
type Area = "hand" | "battle" | "energy" | "warp" | "drop" | "deck" | "unison";
function stage(s: VmState, p: PlayerId, id: string, area: Area, owner: PlayerId = p): string {
  const physical = s.sides[owner].zones.deck[0]; assert.ok(physical);
  s.cards[physical].cardId = id;
  assert.ok(moveCard(s, game, physical, area, { owner: p }).ok);
  return physical;
}
/** A card placed under `host`, as 23-2 does it. */
function under(s: VmState, host: string, id: string, owner: PlayerId): string {
  const physical = s.sides[owner].zones.deck[0]; assert.ok(physical);
  s.cards[physical].cardId = id;
  assert.ok(moveCard(s, game, physical, "drop", { under: host }).ok);
  return physical;
}
function board(seed: number, seat: PlayerId, leader = "L-RED", flipped = false): VmState {
  let s = engine.createGame(ctx, { seed, p1: { name: "You", leader, main: fifty("V1") }, p2: { name: "Other", leader, main: fifty("V1") } }).state as VmState;
  s = apply(s, { type: "chooseFirst", player: s.chooser, first: "p1" });
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) s = apply(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player });
  if (seat === "p2") { s = apply(s, { type: "endMain", player: "p1" }); s = apply(s, { type: "charge", player: "p2", card: null }); }
  assert.equal(s.turnPlayer, seat); assert.equal(s.prompt.kind, "main");
  for (const p of ["p1", "p2"] as const) for (const area of ["hand", "energy"] as const) for (const id of s.sides[p].zones[area].slice()) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  if (flipped) s.cards[s.sides[seat].zones.leader[0]].flipped = true;
  return s;
}
const invariant = (s: VmState): void => {
  const seen = new Map<string, number>();
  for (const side of Object.values(s.sides)) for (const ids of Object.values(side.zones)) for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1);
  for (const k of Object.values(s.cards)) for (const id of k.under) seen.set(id, (seen.get(id) ?? 0) + 1);
  for (const id of Object.keys(s.cards)) assert.equal(seen.get(id), 1, `${id} is in exactly one area or pile`);
};
const power = (s: VmState, id: string) => attrsNow(ctx, game, s, id).power;
const offer = (s: VmState, id: string) => engine.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === id);
const candidates = (s: VmState): string[] => (s.prompt.kind === "chooseCards" ? s.prompt.choice.candidates : []);
const choose = (s: VmState, ids: string[], player: PlayerId) => apply(s, { type: "choose", player, cards: ids });

/** Start the activation, pay, and stop at the first card question (or the end). */
function begin(s: VmState, union: string): VmState {
  const o = offer(s, union); assert.ok(o, "the Union activation is offered");
  let d = apply(s, o.action);
  while (d.prompt.kind === "payCost") d = apply(d, { type: "payCost", player: (d.prompt as { player: PlayerId }).player, option: 0 });
  return d;
}
/** Answer the two picks in the order given, then the foe's windows with `policy`, to the end. */
function finish(s: VmState, picks: string[], policy: (s: VmState, landed: boolean) => string | null = () => null): { s: VmState; windows: boolean[] } {
  const windows: boolean[] = [];
  for (let i = 0; i < 40 && s.prompt.kind !== "main"; i++) {
    const p = s.prompt;
    if (p.kind === "chooseCards") {
      const next = picks.shift(); assert.ok(next, `no pick left for ${p.choice.reason}`);
      assert.ok(p.choice.candidates.includes(next), `${next} is offered`);
      s = choose(s, [next], p.player);
    } else if (p.kind === "payCost") s = apply(s, { type: "payCost", player: p.player, option: 0 });
    else if (p.kind === "orderPending") s = apply(s, { type: "orderPending", player: p.player, index: 0 });
    else if (p.kind === "counter") { const landed = s.resolving?.landed === true; windows.push(landed); s = apply(s, { type: "counter", player: p.player, card: policy(s, landed) }); }
    else throw new Error(`unexpected prompt ${p.kind}`);
  }
  assert.equal(s.prompt.kind, "main"); assert.equal(s.resolving ?? null, null, "no play is left resolving");
  assert.equal(picks.length, 0, "every pick was used");
  invariant(s);
  return { s, windows };
}

for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  const tag = (t: string) => `${seat}: ${t}`;
  const base = (seed: number, leader = "L-RED", flipped = false) => { const s = board(seed, seat, leader, flipped); stage(s, seat, "ER", "energy"); stage(s, seat, "ER", "energy"); return s; };

  // 1. stack order, Active Mode, slot, piles and the power carried from BOTH cards ──────────────
  for (const order of ["GV", "VG"] as const) {
    const s = base(9271);
    const pot = stage(s, seat, "POT", "hand");
    const before = stage(s, seat, "ER", "battle");              // a card ahead of the materials
    const g = stage(s, seat, "G0", "battle"), v = stage(s, seat, "V0", "battle");
    const after = stage(s, seat, "ER", "battle");
    const gp = under(s, g, "PILE", seat), vp = under(s, v, "PILE2", seat);
    s.cards[g].mode = "rest"; s.cards[v].mode = "rest";
    addEffect(s, [], { target: g, kind: "power", value: 5000, until: "turn", source: g, master: seat });
    addEffect(s, [], { target: v, kind: "power", value: 3000, until: "turn", source: v, master: seat });
    addEffect(s, [], { target: gp, kind: "power", value: 700, until: "turn", source: g, master: seat });
    addEffect(s, [], { target: g, kind: "keyword", value: { name: "Blocker" }, until: "turn", source: g, master: seat });
    assert.equal(power(s, g), 15000); assert.equal(power(s, v), 28000);
    const first = order === "GV" ? g : v, second = order === "GV" ? v : g;
    const pickFirst = [first, second];
    const out = finish(begin(s, pot), pickFirst).s;
    const stack = out.cards[pot];
    assert.deepEqual(zone(out, seat, "battle"), [before, pot, after], tag(`${order}: the card stands where the first chosen stood`));
    assert.equal(out.cards[pot].mode, "active", tag("it enters in Active Mode, whatever the materials were"));
    const pile = (id: string) => [id, ...(id === g ? [gp] : [vp])];
    assert.deepEqual(stack.under, [...pile(first), ...pile(second)], tag(`${order}: top to bottom, the order chosen, each with its own pile`));
    assert.ok(!out.effects.some((e) => e.kind === "keyword" || e.target === g || e.target === v || e.target === gp), tag("everything else on them ended, nothing is left on a card under the stack"));
    assert.equal(out.effects.filter((e) => e.kind === "power" && e.target === pot).length, 3, tag("each power effect now belongs to the played card (the pile's too)"));
    assert.equal(power(out, pot), 20000 + 5000 + 3000 + 700, tag("including the effect on the card in a pile"));
    // the played-Auto fired once.
    assert.equal(zone(out, seat, "hand").length, zone(s, seat, "hand").length - 1 + 1, tag("the play's own Auto drew"));
  }

  // 2. no equal-power requirement, and the wrong cards are never on offer ───────────────────────
  {
    const s = base(9272);
    const pot = stage(s, seat, "POT", "hand");
    const g = stage(s, seat, "G0", "battle");
    assert.equal(offer(s, pot), undefined, tag("one Goku is not a pair"));
    const foeV = stage(s, foe, "V0", "battle");
    assert.equal(offer(s, pot), undefined, tag("the opponent's Vegeta is not a choice (22-13-5-2: your Battle Area)"));
    const dropV = stage(s, seat, "V0", "drop");
    assert.equal(offer(s, pot), undefined, tag("a Vegeta in the Drop is not a choice"));
    const v = stage(s, seat, "V0", "battle");
    const d = begin(s, pot);
    assert.deepEqual(candidates(d).sort(), [g, v].sort(), tag("10000 and 25000 power make a pair: Potara asks for no equal power"));
    assert.ok(![foeV, dropV].some((id) => candidates(d).includes(id)));
    assert.throws(() => choose(d, [foeV], seat), IllegalAction, tag("a forged answer naming the opponent's card is refused"));
    assert.throws(() => choose(d, [dropV], seat), IllegalAction, tag("so is the Drop's"));
    // a stale pick: the second material leaves while the question stands.
    const one = choose(d, [g], seat);
    const gone = reload(one); assert.ok(moveCard(gone, game, v, "hand", { owner: seat }).ok);
    assert.throws(() => choose(gone, [v], seat), IllegalAction, tag("a material that left the field is refused when answered"));
    // a persisted half-answered choice resumes.
    const again = finish(JSON.parse(JSON.stringify(one)) as VmState, [v]).s;
    assert.deepEqual(again.cards[pot].under, [g, v], tag("reloaded between the two picks, the same stack"));
  }

  // 3. the play fails: nothing premature moves, power effects stay ───────────────────────────────
  for (const [counterId, where] of [["CDROP", "drop"]] as const) {
    const s = base(9273);
    const pot = stage(s, seat, "POT", "hand"); stage(s, foe, counterId, "hand");
    const g = stage(s, seat, "G0", "battle"), v = stage(s, seat, "V0", "battle"); const gp = under(s, g, "PILE", seat);
    addEffect(s, [], { target: g, kind: "power", value: 5000, until: "turn", source: g, master: seat });
    const r = finish(begin(s, pot), [g, v], (st, landed) => (landed ? null : zone(st, foe, "hand")[0]));
    assert.deepEqual(r.windows, [false], tag("one window, no second for a play that did not happen"));
    assert.ok(zone(r.s, seat, where).includes(pot), tag("the card that could not enter play is in the Drop"));
    assert.deepEqual([r.s.cards[g].under, r.s.cards[v].under, r.s.cards[pot].under], [[gp], [], []], tag("no material moved, none went under anything"));
    assert.ok(zone(r.s, seat, "battle").includes(g) && zone(r.s, seat, "battle").includes(v), tag("both stay in the Battle Area"));
    assert.equal(power(r.s, g), 15000, tag("the power effect stayed with its card"));
  }
  // a material gone before the card lands: the first stays as it was, the second is not moved under anything.
  {
    const s = base(9274);
    const pot = stage(s, seat, "POT", "hand"); stage(s, foe, "CDRAW", "hand");
    const g = stage(s, seat, "G0", "battle"), v = stage(s, seat, "V0", "battle");
    let d = begin(s, pot); d = choose(d, [g], seat); d = choose(d, [v], seat);
    assert.equal(d.prompt.kind, "counter");
    assert.ok(moveCard(d, game, g, "hand", { owner: seat }).ok);
    const r = finish(d, []);
    assert.ok(zone(r.s, seat, "drop").includes(pot) && !zone(r.s, seat, "battle").includes(pot), tag("a material that is gone: the card goes to the Drop (22-13-5-4-2)"));
    assert.deepEqual(r.s.cards[v].under, [], tag("the other material was not moved under anything"));
    assert.ok(zone(r.s, seat, "battle").includes(v));
  }

  // 4. BT24-112 back: materials from under your black Z-Unison, brought to the Battle Area silently ──
  {
    const set = (seed: number, uni: string, pot: string, flipped = true) => {
      const s = base(seed, "LEADBK", flipped);
      const p = stage(s, seat, pot, "hand"); const u = stage(s, seat, uni, "unison");
      s.cards[u].markers = 5; const g = under(s, u, "G0", seat); const x = under(s, u, "PILE", seat);
      const v = stage(s, seat, "V0", "battle");
      return { s, p, u, g, x, v };
    };
    const t = set(9275, "UNIBLK", "POTB");
    stage(t.s, foe, "CDRAW", "hand");
    const d = begin(t.s, t.p);
    assert.deepEqual(candidates(d).sort(), [t.g, t.v].sort(), tag("the Goku under the Unison is a choice; the other card under it is no Goku or Vegeta"));
    const h0 = zone(t.s, seat, "hand").length, f0 = zone(t.s, foe, "hand").length;
    const since = events.length;
    const r = finish(d, [t.g, t.v]);
    assert.deepEqual(r.windows, [false, true], tag("the move of the base caused no counter timing of its own: only the play's two windows (22-13-5-2-1-1)"));
    assert.ok(!r.s.pending?.length, tag("no area movement trigger left pending"));
    assert.deepEqual(r.s.cards[t.p].under, [t.g, t.v], tag("the Goku from under the Unison and the Vegeta are under the Potara"));
    assert.deepEqual(r.s.cards[t.u].under, [t.x], tag("the rest of the Unison's pile is untouched"));
    assert.equal(r.s.cards[t.p].mode, "active");
    assert.equal(zone(r.s, seat, "hand").length - h0, 0 + 0, tag("hand: the Potara left, its played-Auto drew (and nothing else)"));
    assert.equal(zone(r.s, foe, "hand").length, f0, tag("declining spent no card"));
    assert.ok(events.slice(since).some((e) => e.type === "move" && e.card === t.g && e.to === "battle"), tag("the move is in the log"));
    // 22-13-5-2-1-1: "any area movement triggers resulting from the chosen Battle Card moving ... are not made pending".
    // A watcher that draws whenever a card is placed in the Battle Area sees the Potara itself arrive, and must see
    // nothing more of the Goku brought out from under the Unison: same hand as the Potara played over two Battle Cards.
    {
      const handAfter = (withPermit: boolean) => {
        let s: VmState; let p: string; let picks: string[];
        if (withPermit) { const w = set(9285, "UNIBLK", "POTB"); s = w.s; p = w.p; picks = [w.g, w.v]; }
        else { s = base(9285); p = stage(s, seat, "POTB", "hand"); picks = [stage(s, seat, "G0", "battle"), stage(s, seat, "V0", "battle")]; }
        stage(s, seat, "WATCH", "battle");
        const h0 = zone(s, seat, "hand").length;
        return zone(finish(begin(s, p), picks).s, seat, "hand").length - h0;
      };
      assert.equal(handAfter(true), handAfter(false), tag("moving the Goku out from under the Unison is not a movement the Battle Area's watchers answer to"));
    }
    // the same Potara, a red one: the permission is for black cards only.
    const red = set(9276, "UNIBLK", "POT");
    assert.equal(offer(red.s, red.p), undefined, tag("a red Potara does not get the black card's permission: one material is not a pair"));
    // not flipped (no awakened Leader): no permission.
    const plain = set(9277, "UNIBLK", "POTB", false);
    assert.equal(offer(plain.s, plain.p), undefined, tag("without the Leader's back, the Goku under the Unison cannot be chosen: one material is not a pair"));
    // a red Unison: not "your black Z-Unison".
    const wrongU = set(9278, "UNIRED", "POTB");
    assert.equal(offer(wrongU.s, wrongU.p), undefined, tag("a red Z-Unison's pile is not on offer"));
    // the counter takes the card at the first window: nothing was brought out from under the Unison.
    const fail = set(9279, "UNIBLK", "POTB"); stage(fail.s, foe, "CDROP", "hand");
    const rf = finish(begin(fail.s, fail.p), [fail.g, fail.v], (st, landed) => (landed ? null : zone(st, foe, "hand")[0]));
    assert.ok(zone(rf.s, seat, "drop").includes(fail.p));
    assert.deepEqual(rf.s.cards[fail.u].under, fail.s.cards[fail.u].under, tag("a failed play leaves the pile under the Unison exactly as it was (nothing was brought out early)"));
  }

  // 5. BT20-125: Battle Cards you own in the opponent's Battle Area; the card is played there ─────
  {
    const s = base(9280);
    const p = stage(s, seat, "POTO", "hand");
    const gOpp = stage(s, foe, "G0", "battle", seat);   // my Goku, standing in the opponent's Battle Area
    const gFoe = stage(s, foe, "G0", "battle", foe);    // the opponent's own Goku: not mine to choose
    const v = stage(s, seat, "V0", "battle");
    assert.equal(s.cards[gOpp].owner, seat);
    const d = begin(s, p);
    assert.deepEqual(candidates(d).sort(), [gOpp, v].sort(), tag("my Goku in the opponent's area is a choice, theirs is not"));
    assert.ok(!candidates(d).includes(gFoe));
    const r = finish(d, [gOpp, v]);
    assert.ok(zone(r.s, foe, "battle").includes(p) && !zone(r.s, seat, "battle").includes(p), tag("the card is played in the opponent's Battle Area"));
    assert.equal(r.s.cards[p].owner, seat, tag("it is still my card"));
    assert.deepEqual(r.s.cards[p].under, [gOpp, v], tag("both materials are under it, the Vegeta brought across first"));
    assert.ok(zone(r.s, foe, "battle").includes(gFoe), tag("the opponent's own card is untouched"));
    assert.ok(!zone(r.s, seat, "battle").includes(v));
    // without the permanent, a Goku in the opponent's area is no choice.
    const plain = base(9281); const pp = stage(plain, seat, "POT", "hand"); stage(plain, foe, "G0", "battle", seat); stage(plain, seat, "V0", "battle");
    assert.equal(offer(plain, pp), undefined, tag("an ordinary Potara cannot use the card in the opponent's area"));
  }
}

console.log("union-potara-927: stack order, Active Mode, power from both materials and their piles, wrong sources, failure, BT24-112 and BT20-125 permissions, both seats, reload-stable");
