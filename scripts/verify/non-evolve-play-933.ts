/**
 * #933: "[Permanent] This card can't be played from any area with non-[Evolve]
 * skills." (BT13-017, BT13-021, BT13-024) — printed text -> compile -> stored-row
 * JSON round-trip -> the real VM.
 *
 * Ordinary play for the printed five energy and the printed [EX-Evolve] stay
 * legal; so does a skill that explicitly evolves the card (P-336's
 * [Activate: Main], and an [Auto] saying the same). A skill that merely plays it
 * — from hand, Drop or Warp, or "on top of" a card without evolving — does not.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard, findCard } from "../../src/lib/arena/vm/zones";
import { forbids } from "../../src/lib/arena/vm/program";
import { addEffect } from "../../src/lib/arena/vm/effects";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const RESTRICTION = "[Permanent] This card can't be played from any area with non-[Evolve] skills.";
const exEvolve = (who: string, full = false) => `[EX-Evolve]{r}{r}{r}${full ? ", if you have 3 or more energy and you draw 1 card" : ""}: Red <${who}: Br> card with an energy cost of 3.`;
/** The three printed cards (official card search, 16 Oct 2026), reduced to the lines this rule is about. */
const PRINTED: Record<string, { name: string; who: string }> = {
  "BT13-017": { name: "SSB Son Goku, at Full Power", who: "Son Goku" },
  "BT13-021": { name: "SSB Vegeta, at Full Power", who: "Vegeta" },
  "BT13-024": { name: "SS Broly, Brawn Amplified", who: "Broly" },
};
const P336 = "[Activate: Main]{r}{g}, if you have 3 or more energy: Choose up to 1 red <Broly: Br> card with an energy cost of 5 and [Evolve] in your hand and evolve it on top of this card in Active Mode.";
const SKILL_PLAYS: Record<string, string> = {
  HAND933: "[Activate: Main] Choose up to 1 red card with an energy cost of 5 in your hand and play it.",
  DROP933: "[Activate: Main] Choose up to 1 red card with an energy cost of 5 in your drop area and play it.",
  WARP933: "[Activate: Main] Choose up to 1 red card with an energy cost of 5 in your warp and play it.",
  TOP933: "[Activate: Main] Choose up to 1 red <Broly: Br> card with an energy cost of 5 in your hand and play it on top of this card.",
};
const defs: Record<string, CardDef> = { ...DEFS,
  ...Object.fromEntries(Object.entries(PRINTED).map(([id, p]) => [id, card(id, { name: p.name, energyCost: 5, specifiedCost: { Red: 2 }, power: 25000, characters: [`${p.who}: Br`], skill: `${exEvolve(p.who)}<br>${RESTRICTION}` })])),
  // The EX-Evolve line exactly as printed, with and without the restriction: see control 2b.
  ...Object.fromEntries(Object.entries(PRINTED).flatMap(([id, p]) => [
    [`${id}-FULL`, card(`${id}-FULL`, { energyCost: 5, specifiedCost: { Red: 2 }, characters: [`${p.who}: Br`], skill: `${exEvolve(p.who, true)}<br>${RESTRICTION}` })],
    [`${id}-FREE`, card(`${id}-FREE`, { energyCost: 5, specifiedCost: { Red: 2 }, characters: [`${p.who}: Br`], skill: exEvolve(p.who, true) })],
  ])),
  "P-336": card("P-336", { name: "SS Broly, Evolution's Harbinger", energyCost: 4, power: 25000, characters: ["Broly: Br"], skill: P336 }),
  // The same reading under a different tag: an [Auto] that explicitly evolves.
  AUTOEVO933: card("AUTOEVO933", { energyCost: 0, skill: "[Auto] When this card is played, choose up to 1 red <Broly: Br> card with an energy cost of 5 and [Evolve] in your hand and evolve it on top of this card." }),
  ...Object.fromEntries(Object.values(PRINTED).flatMap((p) => [
    [`BASE3-${p.who}`, card(`BASE3-${p.who}`, { energyCost: 3, characters: [`${p.who}: Br`] })],
    [`BASE4-${p.who}`, card(`BASE4-${p.who}`, { energyCost: 4, characters: [`${p.who}: Br`] })],
  ])),
  GREEN933: card("GREEN933", { colors: ["Green"] }),
  ...Object.fromEntries(Object.entries(SKILL_PLAYS).map(([id, skill]) => [id, card(id, { energyCost: 0, skill })])),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => [r, id] as const).filter(([r]) => r.kind !== "keyword").map(([r, id]) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

// ── the reading ──────────────────────────────────────────────────────────────
for (const id of Object.keys(PRINTED)) {
  const r = skillRecords(defs[id]).filter((x) => x.kind === "permanent");
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].unread, [], `${id}: the whole Permanent reads`);
  assert.deepEqual(r[0].ops, [{ op: "forbid", what: "play", until: "game", target: { sel: { special: "self" } }, bySkill: true, exceptEvolve: true }]);
  const ex = skillRecords(defs[`${id}-FULL`]).find((x) => x.printed.toLowerCase().includes("ex-evolve"));
  assert.ok(ex && ex.unread.length === 0, `${id}: its [EX-Evolve] still reads`);
}
{
  const r = skillRecords(defs["P-336"]).find((x) => x.kind === "activate:main")!;
  assert.deepEqual(r.unread, [], "P-336's evolution reads");
  assert.deepEqual(r.ops.map((o) => o.op), ["choose", "play"]);
  assert.deepEqual(r.ops[1], { op: "play", target: { var: "c0" }, onto: { sel: { special: "self" } }, mode: "active", using: "Evolve" });
  const a = skillRecords(defs.AUTOEVO933).find((x) => x.kind === "auto")!;
  assert.deepEqual(a.unread, []); assert.equal((a.ops[1] as { using?: string }).using, "Evolve");
  const t = skillRecords(defs.TOP933).find((x) => x.kind === "activate:main")!;
  assert.equal((t.ops.find((o) => o.op === "play") as { using?: string } | undefined)?.using, undefined, "a bare 'on top of' is no evolution");
}

// ── the VM ───────────────────────────────────────────────────────────────────
function take(s: VmState, action: Action): VmState { return RULES.apply(ctx, roundtrip(s), action).state as VmState; }
function fresh(player: PlayerId): VmState {
  let s = RULES.createGame(ctx, { seed: 933, p1: { name: "First", leader: "L-RED", main: fifty("V1") }, p2: { name: "Second", leader: "L-RED", main: fifty("V1") } }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: s.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null },
    ...(player === "p1" ? [{ type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null }] : []),
  ] as Action[]) s = take(s, action);
  assert.equal(s.prompt.kind, "main"); assert.equal((s.prompt as { player: PlayerId }).player, player);
  for (const p of ["p1", "p2"] as const) for (const id of [...s.sides[p].zones.hand, ...s.sides[p].zones.energy]) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  s.sides.p1.attrs.energyMarkers = 0; s.sides.p2.attrs.energyMarkers = 0;
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string): string {
  const id = s.sides[p].zones.deck[0]; s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok); return id;
}
const energy = (s: VmState, p: PlayerId, n: number, def = "V1") => { for (let i = 0; i < n; i++) stage(s, p, def, "energy"); };
const zone = (s: VmState, p: PlayerId, a: string) => s.sides[p].zones[a];
const legalOf = (s: VmState, id: string, type: string) => RULES.legalActions(ctx, s).find((l) => l.action.type === type && (l.action as { card?: string }).card === id);
function finish(s: VmState, want?: string): VmState {
  for (let i = 0; i < 40 && s.prompt.kind !== "main"; i++) {
    const q = s.prompt;
    if (q.kind === "payCost") s = take(s, { type: "payCost", player: q.player, option: 0 });
    else if (q.kind === "chooseCards") s = take(s, { type: "choose", player: q.player, cards: want && q.choice.candidates.includes(want) ? [want] : q.choice.candidates.slice(0, q.choice.min) });
    else if (q.kind === "chooseMode") s = take(s, { type: "chooseMode", player: q.player, index: 0 });
    else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: q.player, index: 0 });
    else if (q.kind === "counter") s = take(s, { type: "counter", player: q.player, card: null });
    else throw new Error(`unexpected prompt ${q.kind}`);
  }
  assert.equal(s.prompt.kind, "main"); return s;
}
const restCount = (s: VmState, p: PlayerId) => zone(s, p, "energy").filter((id) => s.cards[id].mode === "rest").length;

for (const seat of ["p1", "p2"] as const) for (const target of Object.keys(PRINTED)) {
  const tag = `${seat} ${target}`;
  // 1. Ordinary play, five energy: legal, paid, on the table. Four is not enough.
  {
    const s = fresh(seat); const c = stage(s, seat, target, "hand"); energy(s, seat, 4);
    assert.equal(legalOf(s, c, "play"), undefined, `${tag}: four energy cannot pay the printed five`);
    energy(s, seat, 1);
    const play = legalOf(s, c, "play"); assert.ok(play, `${tag}: the ordinary play is offered`);
    const done = finish(take(s, play.action));
    assert.ok(zone(done, seat, "battle").includes(c)); assert.equal(restCount(done, seat), 5, `${tag}: five energy paid`);
    // Blue energy does not pay the two red orbs.
    const b = fresh(seat); const c2 = stage(b, seat, target, "hand"); energy(b, seat, 5, "V-BLUE");
    assert.equal(legalOf(b, c2, "play"), undefined, `${tag}: the two red orbs are required`);
  }
  // 2. Printed [EX-Evolve]: a red <X: Br> cost-3 base, the three red and the draw. A cost-4 base is refused.
  {
    const s = fresh(seat); const c = stage(s, seat, target, "hand"); const base = stage(s, seat, `BASE3-${PRINTED[target].who}`, "battle"); energy(s, seat, 3);
    const hand = zone(s, seat, "hand").length;
    const ev = legalOf(s, c, "activate");
    assert.ok(ev, `${tag}: EX-Evolve is offered`);
    const done = finish(take(s, ev.action), base);
    assert.ok(zone(done, seat, "battle").includes(c)); assert.deepEqual(done.cards[c].under, [base]);
    assert.equal(zone(done, seat, "hand").length, hand - 1, `${tag}: the card left the hand`);
    const bad = fresh(seat); const c3 = stage(bad, seat, target, "hand"); stage(bad, seat, `BASE4-${PRINTED[target].who}`, "battle"); energy(bad, seat, 3);
    assert.equal(legalOf(bad, c3, "activate"), undefined, `${tag}: an invalid base stays refused`);
  }
  // 2b. Control: the line as printed (the 3-energy condition and the draw as a cost) is refused as unread
  // today with or without the restriction — a gap of the keyword's price, not of this rule.
  for (const id of [`${target}-FULL`, `${target}-FREE`]) {
    const s = fresh(seat); const c = stage(s, seat, id, "hand"); stage(s, seat, `BASE3-${PRINTED[target].who}`, "battle"); energy(s, seat, 3);
    assert.equal(legalOf(s, c, "activate"), undefined, `${id}: the printed EX-Evolve price is not chargeable yet`);
  }
  // 3. A plain skill play — from hand, Drop and Warp, and "on top of" with no evolving — does nothing to it.
  for (const [src, area] of [["HAND933", "hand"], ["DROP933", "drop"], ["WARP933", "warp"], ["TOP933", "hand"]] as const) {
    const s = fresh(seat); const user = stage(s, seat, src, "battle"); const c = stage(s, seat, target, area);
    const act = legalOf(s, user, "activate"); assert.ok(act, `${tag} ${src}: the skill is offered`);
    const open = take(s, act.action);
    // Whatever the menu offers, the play itself is refused and nothing moves or doubles.
    if (open.prompt.kind === "chooseCards") {
      const offered = open.prompt.choice.candidates;
      assert.throws(() => take(open, { type: "choose", player: seat, cards: ["forged-card"] }), /./, `${tag} ${src}: a forged choice is refused`);
      const after = finish(take(open, { type: "choose", player: seat, cards: offered.includes(c) ? [c] : [] }));
      assert.ok(zone(after, seat, area).includes(c), `${tag} ${src}: stays in the ${area}`);
      assert.ok(!zone(after, seat, "battle").includes(c));
      const everywhere = (["hand", "drop", "warp", "battle", "energy", "deck", "life"] as const).filter((a) => zone(after, seat, a).includes(c));
      assert.equal(everywhere.length, 1, `${tag} ${src}: in exactly one place`);
      assert.equal(after.cards[c].under.length, 0);
    }
    // The question the VM answers when a play is checked.
    assert.ok(forbids(ctx, game, s, "play", { player: seat, card: c, bySkill: true }), `${tag}: a skill play is stopped`);
    assert.ok(forbids(ctx, game, s, "play", { player: seat, card: c, bySkill: true, evolution: false }));
    assert.ok(!forbids(ctx, game, s, "play", { player: seat, card: c, bySkill: true, evolution: true }), `${tag}: an evolution is let through`);
    assert.ok(!forbids(ctx, game, s, "play", { player: seat, card: c, bySkill: false }), `${tag}: a declared play is not a skill play`);
  }
  // 4. The other seat's skills cannot play it either (it is the card's rule, whoever owns the skill).
  {
    const s = fresh(seat); const foe = other(seat); const c = stage(s, foe, target, "hand");
    assert.ok(forbids(ctx, game, s, "play", { player: foe, card: c, bySkill: true }), `${tag}: the other seat's copy is bound too`);
  }
  // 5. P-336's explicit evolution: allowed for BT13-024, onto P-336, in Active Mode, from an Activate: Main line.
  {
    const s = fresh(seat); const host = stage(s, seat, "P-336", "battle"); const c = stage(s, seat, target, "hand");
    energy(s, seat, 1); energy(s, seat, 1, "GREEN933"); energy(s, seat, 1);
    const act = legalOf(s, host, "activate"); assert.ok(act, `${tag}: P-336 offers the evolution`);
    const open = take(s, act.action);
    const offered = open.prompt.kind === "chooseCards" ? open.prompt.choice.candidates : [];
    if (target === "BT13-024") {
      assert.ok(offered.includes(c), "BT13-024 is a red <Broly: Br> cost-5 card with Evolve");
      const done = finish(open, c);
      assert.ok(zone(done, seat, "battle").includes(c)); assert.deepEqual(done.cards[c].under, [host]); assert.equal(done.cards[c].mode, "active");
      assert.equal(done.cards[c].playedUsing, "Evolve");
    } else assert.ok(!offered.includes(c), `${tag}: not a Broly`);
  }
  // 6. An [Auto] that evolves it — the same effect under another tag, no card id anywhere.
  if (target === "BT13-024") {
    const s = fresh(seat); const auto = stage(s, seat, "AUTOEVO933", "hand"); const c = stage(s, seat, target, "hand");
    const done = finish(take(s, legalOf(s, auto, "play")!.action), c);
    assert.ok(zone(done, seat, "battle").includes(c));
    assert.deepEqual(done.cards[c].under, [auto]); assert.equal(done.cards[c].playedUsing, "Evolve");
  }
  // 7. Negated skills no longer bind the card (9-1-5).
  {
    const s = fresh(seat); const d = stage(s, seat, target, "hand");
    assert.ok(forbids(ctx, game, s, "play", { player: seat, card: d, bySkill: true }));
    addEffect(s, [], { target: d, kind: "negateSkills", value: 0, until: "turn", master: other(seat) });
    assert.ok(!forbids(ctx, game, s, "play", { player: seat, card: d, bySkill: true }), `${tag}: negated, the restriction is gone`);
  }
  // 8. Reload: a state taken through JSON and played on answers the same.
  {
    const s = roundtrip(fresh(seat)); const user = stage(s, seat, "HAND933", "battle"); const c = stage(s, seat, target, "hand");
    const open = take(roundtrip(s), legalOf(s, user, "activate")!.action);
    const after = finish(open.prompt.kind === "chooseCards" ? take(roundtrip(open), { type: "choose", player: seat, cards: open.prompt.choice.candidates.includes(c) ? [c] : [] }) : open);
    assert.equal(findCard(after, c)?.zone, "hand", `${tag}: still in hand after a reload`);
  }
}
console.log("non-evolve-play-933: ok");
