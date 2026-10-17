/**
 * #922: TB3-019 Final Strike Bardock —
 * "[Auto] When this card is switched from Rest Mode to Active Mode, if your
 * Leader Card is a ≪Bardock's Crew≫ card, your opponent chooses 1 card in their
 * hand and places it at the bottom of their deck."
 *
 * Official basis: the Bandai card list prints the line as above (checked 17 Oct
 * 2026). The card Q&A has one entry for TB3-019 (the Mafuba / Evil Psyche Zamasu
 * [Unique] case, unrelated to this Auto) and DB3-027 Q1: evolving over a Rest
 * Mode TB3-019 in energy does NOT activate this Auto. The errata list has no
 * entry for TB3-019. Manual 1-10-1 (modes), 0-2-4-1 (a card already in a mode does not
 * switch), 5-2 (a player chooses among their own cards), 22-5-3-1-1 (the
 * preliminary base move of an energy-base [EX-Evolve] fires no trigger).
 *
 * The printed text -> compile -> stored-row JSON round-trip -> the real VM, on
 * both seats, with the official negative paired with genuine positives.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CTX, DEFS, card, fifty, parseSkills } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { policyTurn } from "../../src/lib/arena/policy/boundary";
import { answerFor, resolveAnswer } from "../../src/lib/arena/policy/contract";
import { autoTriggerMatches } from "../../src/lib/arena/text/triggers";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId, Prompt, Trigger } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const printed = JSON.parse(readFileSync(new URL("../../docs/arena-backlog/evidence/913/cards.json", import.meta.url), "utf8")) as CardDef[];
const REAL = printed.find((d) => d.id === "TB3-019")!;
const GREAT_APE = printed.find((d) => d.id === "DB3-027")!;
assert.ok(REAL && GREAT_APE);
assert.match(REAL.skill!, /switched from Rest Mode to Active Mode, if your Leader Card is a ≪Bardock's Crew≫ card, your opponent chooses 1 card in their hand and places it at the bottom of their deck\.$/);

const TRIGGER = "selfRestToActive";
// DB3-027 reduced to the lines the energy-base evolution needs (as energy-evolve-913 does).
const evolver: CardDef = { ...GREAT_APE, skill: parseSkills(GREAT_APE.skill).filter((sk) => sk.keyword?.name === "Evolve" || (sk.kind === "permanent" && /when using this card/i.test(sk.effect))).map((sk) => sk.raw).join("<br>") };
assert.ok(/ex-evolve/i.test(evolver.skill!) && /choose battle cards from your energy/i.test(evolver.skill!));

const defs: Record<string, CardDef> = { ...DEFS,
  "TB3-019": REAL,
  "DB3-027": evolver,
  "L-CREW922": { ...DEFS["L-BLUE"], id: "L-CREW922", traits: ["Saiyan", "Bardock's Crew"] },
  "L-PLAIN922": { ...DEFS["L-BLUE"], id: "L-PLAIN922", traits: ["Saiyan"] },
  // Genuine Rest -> Active switches by a skill: a Battle Card's and an energy skill.
  SWITCH922: card("SWITCH922", { colors: ["Blue"], energyCost: 0, power: 10000, skill: "[Activate: Main] Switch up to 1 of your Battle Cards to Active Mode." }),
  ENERGYSW922: card("ENERGYSW922", { colors: ["Blue"], energyCost: 0, power: 10000, skill: "[Activate: Main] Switch up to 1 of your energy to Active Mode." }),
  HANDA922: card("HANDA922", { name: "Secret Hand Alpha 922", skill: null }),
  HANDB922: card("HANDB922", { name: "Secret Hand Beta 922", skill: null }),
  DECK922: card("DECK922", { name: "Own Deck Card 922", skill: null }),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r) => ({ ...r, id: 0, source: "compiler", status: "draft" } as unknown as RuleRow)));
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

// ── the reading ──────────────────────────────────────────────────────────────
{
  const auto = skillRecords(REAL).filter((r) => r.kind === "auto");
  assert.equal(auto.length, 1);
  const r = roundtrip(auto[0]);
  assert.deepEqual(r.trigger, [TRIGGER], "the exact Rest -> Active self-transition, and no other moment");
  assert.deepEqual(r.unread, [], "the whole Auto reads");
  assert.equal((r.cond as { kind: string; filter: { traits: string[] } }).kind, "leaderMatches");
  assert.deepEqual((r.cond as { filter: { traits: string[] } }).filter.traits, ["bardock's crew"]);
  assert.deepEqual(r.ops.map((o) => o.op), ["choose", "moveTo"], "choose then move: not a discard, not a Leader move");
  const [choose, move] = r.ops as unknown as { sel: unknown; chooser: string; as: string; target: unknown; to: string; position: string }[];
  assert.deepEqual(choose.sel, { side: "opponent", area: "hand", count: 1 }, "exactly 1 card of the opponent's hand");
  assert.equal(choose.chooser, "opponent", "the opponent chooses");
  assert.deepEqual(move.target, { var: choose.as }, "the same chosen card moves");
  assert.equal(move.to, "deck"); assert.equal(move.position, "bottom");
  // The trigger's wording is exact: no other mode phrase reads as it.
  const sk = (text: string) => parseSkills(`[Auto] ${text}, draw 1 card.`)[0];
  assert.ok(autoTriggerMatches(sk("When this card is switched from Rest Mode to Active Mode"), TRIGGER as Trigger));
  for (const text of ["When this card is switched to Active Mode", "When your energy is switched to Active Mode by a skill", "When this card is played", "When a card evolves into this card", "When this card is switched from Active Mode to Rest Mode"]) {
    assert.ok(!autoTriggerMatches(sk(text), TRIGGER as Trigger), `not: ${text}`);
  }
  // The same sentence shape elsewhere in the catalog stays the plain discard / its own reading.
  const triggersOf = (d: CardDef) => skillRecords(d).flatMap((x) => x.trigger);
  assert.deepEqual(triggersOf(card("X922", { skill: "[Auto] When this card is played, your opponent chooses 1 card in their hand and places it in their Drop Area." })), ["played"]);
  const drop = skillRecords(card("Y922", { skill: "[Auto] When this card is played, your opponent chooses 1 card in their hand and places it in their Drop Area." }))[0];
  assert.deepEqual(drop.ops.map((o) => o.op), ["discard"], "the Drop wording is still the plain discard");
}

// ── the VM ───────────────────────────────────────────────────────────────────
const events: GameEvent[] = [];
function take(s: VmState, action: Action): VmState {
  const r = RULES.apply(ctx, roundtrip(s), action); events.push(...(r.events as GameEvent[])); return r.state as VmState;
}
function fresh(seat: PlayerId, leaders: { seat: string; foe: string }): VmState {
  const foe = other(seat);
  const l = { [seat]: leaders.seat, [foe]: leaders.foe } as Record<PlayerId, string>;
  let s = RULES.createGame(ctx, { seed: 922, p1: { name: "First", leader: l.p1, main: fifty("DECK922") }, p2: { name: "Second", leader: l.p2, main: fifty("DECK922") } }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: s.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null },
    ...(seat === "p1" ? [{ type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null }] : []),
  ] as Action[]) s = take(s, action);
  assert.equal(s.prompt.kind, "main"); assert.equal((s.prompt as { player: PlayerId }).player, seat);
  for (const p of ["p1", "p2"] as const) for (const id of [...s.sides[p].zones.hand, ...s.sides[p].zones.energy]) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  s.pending = []; events.length = 0; return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string, mode?: "active" | "rest"): string {
  const id = s.sides[p].zones.deck[0]; assert.ok(id); s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (mode) s.cards[id].mode = mode;
  return id;
}
const zone = (s: VmState, p: PlayerId, area: string): string[] => s.sides[p].zones[area].slice();

function privacy(s: VmState): void {
  for (const viewer of ["p1", "p2"] as const) {
    const opponent = other(viewer);
    const out = JSON.stringify(buildSnapshot({ id: 922, revision: 1, mode: "versus", status: "playing", p1Name: "P1", p2Name: "P2", ctx, state: roundtrip(s), legal: RULES.legalActions(ctx, s), log: [], beats: null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} }));
    for (const id of zone(s, opponent, "hand")) assert.ok(!out.includes(`"${id}"`), "the viewer never sees the opposing hand identities");
    const turn = policyTurn({ ctx, state: roundtrip(s), beats: null, art: {}, names: { p1: "P1", p2: "P2" } }, viewer, 922);
    const wire = JSON.stringify(turn.input);
    for (const id of zone(s, opponent, "hand")) assert.ok(!wire.includes(`"${id}"`), "the policy observation hides the opposing hand too");
    for (const decision of turn.input.decisions.decisions.filter((d) => d.kind === "menu")) {
      const trip = resolveAnswer(turn.key, answerFor(turn.input.decisions, decision.id));
      assert.ok(trip.ok && trip.actions.length === 1);
      assert.ok(RULES.legalActions(ctx, s).some((l) => JSON.stringify(l.action) === JSON.stringify(trip.actions[0])), "the policy menu resolves to a current legal action");
    }
  }
}

type Asked = { player: PlayerId; kind: Prompt["kind"]; candidates?: string[] };
/** Drive every prompt to the next quiet Main. `pick` answers a chooseCards; the foe's choice is recorded. */
function settle(s: VmState, pick: (q: Extract<Prompt, { kind: "chooseCards" }>) => string[], check = true): { s: VmState; asked: Asked[] } {
  const asked: Asked[] = [];
  for (let n = 0; n < 40 && !(s.prompt.kind === "main" && !s.pending.length); n++) {
    const q = s.prompt; let action: Action;
    if (q.kind === "chooseCards") {
      asked.push({ player: q.player, kind: q.kind, candidates: q.choice.candidates.slice() });
      if (check) privacy(s);
      action = { type: "choose", player: q.player, cards: pick(q) };
    } else if (q.kind === "orderPending") action = { type: "orderPending", player: q.player, index: 0 };
    else if (q.kind === "counter") action = { type: "counter", player: q.player, card: null };
    else if (q.kind === "payCost") action = { type: "payCost", player: q.player, option: 0 };
    else if (q.kind === "charge") action = { type: "charge", player: q.player, card: null };
    else if (q.kind === "combo") action = { type: "pass", player: (q as { player: PlayerId }).player };
    else throw new Error(`unexpected prompt ${q.kind}`);
    s = take(s, action);
  }
  assert.equal(s.prompt.kind, "main"); return { s, asked };
}
const activateOf = (s: VmState, id: string): Action => {
  const a = RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === id);
  assert.ok(a, `${id} can be activated`); return a.action;
};
/** The seat's switch target is its Battle Card; the foe picks `chosen`. */
const picker = (seat: PlayerId, target: string | null, chosen: string | null) => (q: Extract<Prompt, { kind: "chooseCards" }>): string[] =>
  q.player === seat ? (target && q.choice.candidates.includes(target) ? [target] : []) : (chosen ? [chosen] : q.choice.candidates.slice(0, q.choice.min || 1));
const foeAsked = (a: Asked[], foe: PlayerId) => a.filter((x) => x.player === foe);

interface Board { s: VmState; bardock: string; switcher: string; a: string; b: string }
function board(seat: PlayerId, opts: { leader?: "crew" | "plain"; foeLeader?: "crew" | "plain"; bardock?: "rest" | "active" | "energy"; hand?: boolean } = {}): Board {
  const s = fresh(seat, { seat: opts.leader === "plain" ? "L-PLAIN922" : "L-CREW922", foe: opts.foeLeader === "crew" ? "L-CREW922" : "L-PLAIN922" });
  const foe = other(seat);
  const bardock = stage(s, seat, "TB3-019", opts.bardock === "energy" ? "energy" : "battle", opts.bardock === "active" ? "active" : "rest");
  const switcher = stage(s, seat, opts.bardock === "energy" ? "ENERGYSW922" : "SWITCH922", "battle", "active");
  const a = opts.hand === false ? "" : stage(s, foe, "HANDA922", "hand");
  const b = opts.hand === false ? "" : stage(s, foe, "HANDB922", "hand");
  s.pending = []; return { s, bardock, switcher, a, b };
}

for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);

  // 1. Positive: a genuine Rest -> Active switch by a skill. The foe, not the
  //    controller, chooses among exactly its own two hand cards; the chosen card
  //    (not the other one, not the Leader) goes to the bottom of the foe's deck.
  for (const pickB of [true, false]) {
    const { s: s0, bardock, switcher, a, b } = board(seat);
    const foeDeck = zone(s0, foe, "deck"), seatDeck = zone(s0, seat, "deck"), seatHand = zone(s0, seat, "hand");
    const foeDrop = zone(s0, foe, "drop"), leader = zone(s0, seat, "leader");
    const chosen = pickB ? b : a, kept = pickB ? a : b;
    let s = take(s0, activateOf(s0, switcher));
    events.length = 0;
    const done = settle(s, picker(seat, bardock, chosen));
    s = done.s;
    assert.equal(s.cards[bardock].mode, "active", `${seat}: the switch happened`);
    const asked = foeAsked(done.asked, foe);
    assert.equal(asked.length, 1, `${seat}: the opponent is asked exactly once`);
    assert.deepEqual([...asked[0].candidates!].sort(), [a, b].sort(), `${seat}: from exactly their own two hand cards`);
    assert.ok(!done.asked.some((x) => x.player === seat && x.candidates && (x.candidates.includes(a) || x.candidates.includes(b))), "the controller is never asked to pick the foe's card");
    const deck = zone(s, foe, "deck");
    assert.equal(deck.length, foeDeck.length + 1);
    assert.equal(deck[deck.length - 1], chosen, `${seat}: the chosen card is at the very bottom of the foe's deck`);
    assert.deepEqual(deck.slice(0, -1), foeDeck, "the rest of the deck keeps its order");
    assert.deepEqual(zone(s, foe, "hand"), [kept], "the other card stays in hand");
    assert.deepEqual(zone(s, foe, "drop"), foeDrop, "not a discard to the Drop");
    assert.deepEqual(zone(s, seat, "leader"), leader, "the Leader is not moved");
    assert.deepEqual(zone(s, seat, "deck"), seatDeck, "the controller's own deck is untouched");
    assert.deepEqual(zone(s, seat, "hand"), seatHand, "and so is their hand");
    assert.ok(s.cards[bardock] && zone(s, seat, "battle").includes(bardock));
    // The projection after the move does not tell the controller which card went down.
    const seen = JSON.stringify(buildSnapshot({ id: 922, revision: 1, mode: "versus", status: "playing", p1Name: "P1", p2Name: "P2", ctx, state: roundtrip(s), legal: RULES.legalActions(ctx, s), log: [], beats: null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer: seat, images: {} }));
    assert.ok(!seen.includes("Secret Hand"), `${seat}: the controller never reads the foe's hand or the card sent down`);
    privacy(s);
  }

  // 2. Positive: the genuine normal restand (the Charge Phase), as a rule rather than a skill.
  {
    const { s: s0, bardock, a, b } = board(seat);
    let s = take(s0, { type: "endMain", player: seat });
    s = take(s, { type: "charge", player: foe, card: null });
    assert.equal(s.cards[bardock].mode, "rest", "still rested through the foe's turn");
    const foeDeckBefore = zone(s, foe, "deck");
    // The foe ends their turn; the seat's Active step stands Bardock up (a rule, not a skill).
    s = take(s, { type: "endMain", player: foe });
    assert.equal(s.cards[bardock].mode, "active", `${seat}: the Active Phase restood it`);
    assert.ok(events.some((e) => e.type === "mode" && e.card === bardock && e.mode === "active"));
    const done = settle(s, picker(seat, null, b));
    assert.equal(foeAsked(done.asked, foe).length, 1, `${seat}: the Active Phase restand also asks the foe`);
    const deck = zone(done.s, foe, "deck");
    assert.equal(deck[deck.length - 1], b, "the chosen card is at the bottom");
    assert.equal(deck.length, foeDeckBefore.length + 1, "exactly one card went down");
    assert.ok(zone(done.s, foe, "hand").includes(a) && !zone(done.s, foe, "hand").includes(b));
  }

  // 3. Negatives that must stay silent: nothing changes for the foe.
  const silent = (label: string, s: VmState, bardock: string, switcher: string | null, hand: string[]) => {
    const handBefore = zone(s, other(seat), "hand"), deckBefore = zone(s, other(seat), "deck");
    const done = settle(switcher ? take(s, activateOf(s, switcher)) : s, picker(seat, bardock, null));
    assert.equal(foeAsked(done.asked, foe).length, 0, `${seat}: ${label}: the opponent is not asked`);
    assert.deepEqual(zone(done.s, foe, "hand"), hand.length ? handBefore : [], `${label}: hand unchanged`);
    assert.deepEqual(zone(done.s, foe, "deck"), deckBefore, `${label}: deck unchanged`);
    return done.s;
  };
  {
    const { s, bardock, switcher, a, b } = board(seat, { leader: "plain", foeLeader: "crew" });
    const after = silent("wrong Leader (the foe's Leader is the Crew one)", s, bardock, switcher, [a, b]);
    assert.equal(after.cards[bardock].mode, "active", "the switch itself still happened");
  }
  {
    const { s, bardock, switcher, a, b } = board(seat, { bardock: "active" });
    const after = silent("Active -> Active is not a switch", s, bardock, switcher, [a, b]);
    assert.equal(after.cards[bardock].mode, "active");
    assert.ok(!events.some((e) => e.type === "mode" && e.card === bardock), "no mode event for a no-op");
  }
  {
    // The first real switch asks once; switching it again while Active asks nothing more.
    const { s: s0, bardock, switcher, a, b } = board(seat);
    const first = settle(take(s0, activateOf(s0, switcher)), picker(seat, bardock, a));
    assert.equal(foeAsked(first.asked, foe).length, 1);
    const again = settle(take(first.s, activateOf(first.s, switcher)), picker(seat, bardock, b));
    assert.equal(foeAsked(again.asked, foe).length, 0, `${seat}: repeated Active -> Active asks nothing`);
    assert.deepEqual(zone(again.s, foe, "hand"), [b]);
  }
  {
    const { s, bardock, switcher, a, b } = board(seat);
    addEffect(s, [], { target: bardock, kind: "negateSkills", value: 0, until: "game", source: switcher });
    silent("negated skills", s, bardock, switcher, [a, b]);
  }
  {
    const { s, bardock, switcher, a, b } = board(seat, { bardock: "energy" });
    silent("in the Energy Area its skills are not valid (9-1-3-1)", s, bardock, switcher, [a, b]);
  }
  {
    // No hand cards: the Auto resolves quietly, nothing is invented.
    const { s, bardock, switcher } = board(seat, { hand: false });
    for (const id of zone(s, foe, "hand")) assert.ok(moveCard(s, game, id, "deck", { owner: foe }).ok);
    const done = settle(take(s, activateOf(s, switcher)), picker(seat, bardock, null));
    assert.equal(done.s.cards[bardock].mode, "active");
    assert.equal(foeAsked(done.asked, foe).length, 0, `${seat}: an empty hand has nothing to choose`);
    assert.equal(zone(done.s, foe, "hand").length, 0);
  }

  // 4. Control by owner: the foe's own Bardock (their Leader is the Crew one) only answers for them.
  {
    const { s, bardock, switcher, a, b } = board(seat, { leader: "plain", foeLeader: "crew" });
    const mine = stage(s, foe, "TB3-019", "battle", "rest");
    assert.ok(mine);
    silent("the foe's Bardock is not triggered by my switch", s, bardock, switcher, [a, b]);
  }

  // 5. The official DB3-027 negative, paired with the positives above: evolving
  //    over a Rest Mode TB3-019 in energy is a placement, not a Rest -> Active
  //    switch, so the Auto stays silent; the same Bardock switched for real asks.
  {
    const { s: s0, bardock, a, b } = board(seat, { bardock: "energy" });
    for (const id of [bardock]) s0.cards[id].mode = "rest";
    const top = stage(s0, seat, "DB3-027", "hand");
    for (let n = 0; n < 3; n++) stage(s0, seat, "V-BLUE", "energy", "active");
    const evolve = RULES.legalActions(ctx, s0).find((l) => l.action.type === "activate" && l.action.card === top);
    assert.ok(evolve, `${seat}: the energy-base Evolve is offered over the Rest Mode TB3-019`);
    events.length = 0;
    const done = settle(take(s0, evolve.action), (q) => (q.choice.candidates.includes(bardock) ? [bardock] : q.choice.candidates.slice(0, q.choice.min || 1)), false);
    assert.equal(done.s.cards[top].under.includes(bardock), true, "TB3-019 is the base");
    assert.equal(foeAsked(done.asked, foe).length, 0, `${seat}: official DB3-027 Q1: the Auto does not activate`);
    assert.deepEqual(zone(done.s, foe, "hand").sort(), [a, b].sort());
    assert.ok(!events.some((e) => e.type === "mode" && e.card === bardock), "no Rest -> Active switch was emitted for the base");
    // Plain arrival: a Rest Mode TB3-019 moved into the Battle Area is no switch either.
    const arrival = board(seat, { bardock: "energy" });
    arrival.s.cards[arrival.bardock].mode = "rest";
    assert.ok(moveCard(arrival.s, game, arrival.bardock, "battle", { owner: seat }).ok);
    const quiet = settle(arrival.s, picker(seat, null, null), false);
    assert.equal(foeAsked(quiet.asked, foe).length, 0);
  }
}

console.log("final-strike-bardock-922: exact Rest->Active reading, foe-chosen bottom-of-deck, negatives and DB3-027 pairing on both seats passed");
