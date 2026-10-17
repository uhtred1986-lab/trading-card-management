/**
 * #916: "[Auto][Once per turn] When your opponent switches their energy to
 * Active Mode using a [Counter] skill, place up to 1 card in your opponent's
 * life and 1 card in your opponent's energy in their Drop Area."
 * (DB3-013, DB3-040, DB3-059, DB3-089, DB3-105) — printed text -> compile ->
 * stored-row JSON round-trip -> the real VM.
 *
 * Official basis: the Bandai card list prints the line on all five; the card Q&A
 * and the errata list carry no entry for any of them (searched 17 Oct 2026).
 * Manual 5-2-4 (up to N: 0..N), 5-10 (damage is not plain area movement),
 * 22-11 ([Once per turn], per copy), 1-10 (switching a mode).
 *
 * Owner-agreed reading, not re-asked: the trigger is a real Rest -> Active
 * change caused by the *opponent's own* [Counter] skill (their energy); the
 * Auto's controller chooses up to one Life and up to one energy of the
 * opponent, who has no say; the Life goes straight to the Drop (no damage, no
 * hand).
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { autoTriggerMatches } from "../../src/lib/arena/text/triggers";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId, Prompt, Trigger } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const NAMES: Record<string, string> = {
  "DB3-013": "Mai, King Piccolo's Underling", "DB3-040": "Borgos, Bardock's Crewmate", "DB3-059": "Vegeta, Protecting His Loved Ones",
  "DB3-089": "Chi-Chi, Melee Matriarch", "DB3-105": "Son Gohan, Changing History",
};
/** The printed skills as the Bandai card list shows them (the keyword lines aside). */
const PRINTED = "[Auto] When this card is played, draw 1 card.<br>[Auto][Once per turn] When your opponent switches their energy to Active Mode using a [Counter] skill, place up to 1 card in your opponent's life and 1 card in your opponent's energy in their Drop Area.";
const IDS = Object.keys(NAMES);
const TRIGGER = "opponentOwnEnergyActiveByCounter";

const extra = (id: string, skill: string): CardDef => card(id, { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, skill });
const defs: Record<string, CardDef> = { ...DEFS,
  ...Object.fromEntries(IDS.map((id) => [id, card(id, { name: NAMES[id], energyCost: 0, power: 10000, skill: PRINTED })])),
  PLAY916: card("PLAY916", { energyCost: 0, power: 10000, skill: null }),
  SECRET916: card("SECRET916", { name: "Secret Life Card 916", skill: null }),
  // Counters, one per subtype the engine plays; "up to 2" readies two energy at once.
  CTRP2_916: extra("CTRP2_916", "[Counter: Play] Switch up to 2 of your energy to Active Mode."),
  CTRP1_916: extra("CTRP1_916", "[Counter: Play] Switch up to 1 of your energy to Active Mode."),
  CTRA_916: extra("CTRA_916", "[Counter: Attack] Negate the attack. Switch up to 2 of your energy to Active Mode."),
  STOP916: extra("STOP916", "[Counter: Counter] Negate the [Counter]."),
  // Not a Counter skill: a Main skill, and an Auto on a card that also prints a Counter line.
  MAIN916: card("MAIN916", { energyCost: 0, power: 10000, skill: "[Activate: Main] Switch up to 2 of your energy to Active Mode." }),
  MIXED916: card("MIXED916", { energyCost: 0, power: 10000, skill: "[Counter: Play] Draw 1 card.<br>[Auto] When this card is played, switch up to 2 of your energy to Active Mode." }),
  // The existing, narrower energy triggers are untouched (BT7-003 / SD8-09 shapes).
  BT7916: card("BT7916", { energyCost: 0, power: 10000, skill: "[Auto][Once per turn] When your opponent switches energy to Active Mode using a non-[Awaken] skill during their turn, draw 1 card." }),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r) => ({ ...r, id: 0, source: "compiler", status: "draft" } as unknown as RuleRow)));
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

// ── the reading ──────────────────────────────────────────────────────────────
for (const id of IDS) {
  const auto = skillRecords(defs[id]).filter((r) => r.kind === "auto" && r.printed.includes("[Counter]"));
  assert.equal(auto.length, 1, `${id}: one Counter-qualified Auto`);
  const r = roundtrip(auto[0]);
  assert.deepEqual(r.trigger, [TRIGGER], `${id}: the declared Counter-qualified trigger, and no other`);
  assert.deepEqual(r.unread, [], `${id}: the whole Auto reads`);
  assert.deepEqual(r.ops.map((o) => o.op), ["choose", "moveTo", "choose", "moveTo"], `${id}: Life, then energy, each chosen and moved`);
  const [life, , energy] = r.ops as { sel: { side: string; area: string; count: number; upTo: boolean } }[];
  assert.deepEqual(life.sel, { side: "opponent", area: "life", count: 1, upTo: true });
  assert.deepEqual(energy.sel, { side: "opponent", area: "energy", count: 1, upTo: true });
  assert.deepEqual([r.ops[1], r.ops[3]].map((o) => (o as { to: string }).to), ["drop", "drop"]);
  assert.deepEqual([r.ops[0], r.ops[2]].map((o) => (o as { blind?: boolean }).blind), [true, undefined], `${id}: the face-down Life is chosen blind; the open energy is not`);
  const sk = parseSkills(defs[id].skill!).find((s) => s.kind === "auto" && s.raw.includes("[Counter]"))!;
  assert.equal(sk.oncePerTurn, true, `${id}: [Once per turn]`);
  assert.ok(autoTriggerMatches(sk, TRIGGER as Trigger));
  for (const t of ["opponentEnergyActiveBySkill", "opponentOwnEnergyActiveBySkill", "played"]) assert.ok(!autoTriggerMatches(sk, t as Trigger), `${id}: not ${t}`);
}
{
  const triggersOf = (id: string) => skillRecords(defs[id]).flatMap((r) => r.trigger);
  assert.deepEqual(triggersOf("BT7916"), ["opponentEnergyActiveBySkill", "opponentOwnEnergyActiveBySkill"], "BT7-003's wording keeps its two triggers");
  assert.ok(!autoTriggerMatches(parseSkills(defs.BT7916.skill!)[0], TRIGGER as Trigger), "and does not become a Counter trigger");
  // A plain-wording Auto with no Counter in it never answers to the new moment.
  assert.ok(!triggersOf("MIXED916").includes(TRIGGER), "a Counter line elsewhere on the card is not the trigger");
}

// ── the VM ───────────────────────────────────────────────────────────────────
function take(s: VmState, action: Action): { state: VmState; events: GameEvent[] } {
  const r = RULES.apply(ctx, roundtrip(s), action);
  return { state: r.state as VmState, events: r.events as GameEvent[] };
}
const refused = (s: VmState, action: Action, why: string) => {
  const before = JSON.stringify(s);
  assert.throws(() => take(s, action), IllegalAction, why);
  assert.equal(JSON.stringify(s), before, `${why}: nothing changed`);
};
function fresh(player: PlayerId): VmState {
  let s = RULES.createGame(ctx, { seed: 916, p1: { name: "First", leader: "L-RED", main: fifty("V1") }, p2: { name: "Second", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: s.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null },
    ...(player === "p1" ? [{ type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null }] : []),
  ] as Action[]) s = take(s, action).state;
  assert.equal(s.prompt.kind, "main");
  assert.equal((s.prompt as { player: PlayerId }).player, player);
  // Both hands and both energy areas go back to the deck so every card is placed on purpose.
  for (const p of ["p1", "p2"] as const) for (const id of [...s.sides[p].zones.hand, ...s.sides[p].zones.energy]) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  s.pending = [];
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string, mode?: "active" | "rest"): string {
  const id = s.sides[p].zones.deck[0]; s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (mode) s.cards[id].mode = mode;
  return id;
}
const energy = (s: VmState, p: PlayerId, rest: number, active = 0): string[] => [
  ...Array.from({ length: rest }, () => stage(s, p, "ENERGY916", "energy", "rest")),
  ...Array.from({ length: active }, () => stage(s, p, "ENERGY916", "energy", "active")),
];
DEFS["ENERGY916"] = defs["ENERGY916"] = card("ENERGY916", { skill: null });
const zone = (s: VmState, p: PlayerId, area: string) => s.sides[p].zones[area].slice();
const lifeOf = (s: VmState, p: PlayerId) => zone(s, p, "life");
const restOf = (s: VmState, p: PlayerId) => zone(s, p, "energy").filter((id) => s.cards[id].mode === "rest").length;
const snapshot = (s: VmState, viewer: PlayerId) => buildSnapshot({ id: 916, revision: 1, mode: "versus", status: "playing",
  p1Name: "Player 1", p2Name: "Player 2", ctx, state: s, legal: RULES.legalActions(ctx, s), log: [], beats: null, spotlight: null,
  spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} });

/** What happened after the Counter: every question asked, and who was asked. */
type Asked = { kind: Prompt["kind"]; player: PlayerId; candidates?: string[]; min?: number; max?: number };
type Pick = (q: Extract<Prompt, { kind: "chooseCards" }>) => string[];
function settle(s: VmState, pick: Pick | null): { s: VmState; asked: Asked[]; events: GameEvent[] } {
  const asked: Asked[] = []; const events: GameEvent[] = [];
  for (let i = 0; i < 24 && !(s.prompt.kind === "main" && !s.pending.length); i++) {
    const q = s.prompt; let action: Action;
    if (q.kind === "chooseCards") {
      asked.push({ kind: q.kind, player: q.player, candidates: q.choice.candidates.slice(), min: q.choice.min, max: q.choice.max });
      action = { type: "choose", player: q.player, cards: pick ? pick(q) : [] };
    } else if (q.kind === "orderPending") { asked.push({ kind: q.kind, player: q.player }); action = { type: "orderPending", player: q.player, index: 0 }; }
    else if (q.kind === "counter") action = { type: "counter", player: q.player, card: null };
    else throw new Error(`unexpected prompt ${q.kind}`);
    const r = take(s, action); s = r.state; events.push(...r.events);
  }
  assert.equal(s.prompt.kind, "main"); assert.equal(s.pending.length, 0);
  return { s, asked, events };
}
/** Choose `life` Life cards and `energy` energy cards of `foe`'s from whatever is offered (0 declines). */
const choosing = (s: VmState, foe: PlayerId, life: number, energy: number): Pick => {
  const lives = lifeOf(s, foe);
  // The Counter's own player readies its rested energy; the Auto's controller is the other seat.
  return (q) => q.player === foe
    ? q.choice.candidates.filter((c) => s.cards[c].mode === "rest").slice(0, q.choice.max)
    : q.choice.candidates.slice(0, q.choice.candidates.every((c) => lives.includes(c)) ? life : energy);
};

/** `seat` plays PLAY916; its opponent answers with `counters` held in hand. Returns the state at the opponent's [Counter] window. */
function playInto(s: VmState, seat: PlayerId): VmState {
  stage(s, seat, "PLAY916", "hand");
  const play = RULES.legalActions(ctx, s).find((l) => l.action.type === "play" && s.cards[(l.action as { card: string }).card].cardId === "PLAY916");
  assert.ok(play, "the card can be played");
  return take(s, play.action).state;
}
const counterOf = (player: PlayerId, card: string): Action => ({ type: "counter", player, card });
function asCounter(s: VmState, foe: PlayerId, card: string): { state: VmState; events: GameEvent[] } {
  assert.equal(s.prompt.kind, "counter", "the [Counter] window is open");
  assert.equal((s.prompt as { player: PlayerId }).player, foe);
  return take(s, counterOf(foe, card));
}
const setLife = (s: VmState, p: PlayerId) => { for (const id of lifeOf(s, p)) s.cards[id].cardId = "SECRET916"; };

for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  const base = (copies: string[] = ["DB3-013"]) => {
    const s = fresh(seat);
    const autos = copies.map((c) => stage(s, seat, c, "battle", "active"));
    const cards = energy(s, foe, 3);
    setLife(s, foe);
    s.pending = [];
    return { s, autos, cards };
  };

  // 1. The normal use: one readied energy pends the Auto; the Auto's controller picks one Life and one energy.
  {
    const { s } = base();
    const lifeBefore = lifeOf(s, foe), energyBefore = zone(s, foe, "energy"), handBefore = zone(s, foe, "hand"), dropBefore = zone(s, foe, "drop");
    const ctr = stage(s, foe, "CTRP1_916", "hand");
    const handWithCounter = zone(s, foe, "hand");
    const r = asCounter(playInto(s, seat), foe, ctr);
    assert.equal(r.state.pending.length + (r.state.prompt.kind === "main" ? 0 : 1) > 0, true, `${seat}: the Auto is pending or being asked`);
    const waiting = settle(roundtrip(r.state), choosing(s, foe, 1, 1));
    const done = waiting.s;
    assert.deepEqual(waiting.asked.map((a) => [a.kind, a.player]), [["chooseCards", foe], ["chooseCards", seat], ["chooseCards", seat]], `${seat}: the Counter's player readies their energy; then only the Auto's controller is asked, once for Life and once for energy`);
    const [lifeQ, energyQ] = waiting.asked.slice(1);
    assert.equal(lifeQ.min, 0); assert.equal(lifeQ.max, 1, "up to 1 Life");
    assert.equal(energyQ.min, 0); assert.equal(energyQ.max, 1, "up to 1 energy");
    assert.deepEqual([...lifeQ.candidates!].sort(), [...lifeBefore].sort(), "only the opponent's Life is offered");
    assert.ok(energyQ.candidates!.every((c) => energyBefore.includes(c)), "only the opponent's energy is offered");
    assert.ok(!lifeQ.candidates!.some((c) => lifeOf(s, seat).includes(c)));
    assert.equal(lifeOf(done, foe).length, lifeBefore.length - 1, "one Life card left");
    assert.equal(zone(done, foe, "energy").length, energyBefore.length - 1, "one energy left");
    assert.ok(zone(done, foe, "drop").includes(lifeBefore[0]) && zone(done, foe, "drop").includes(energyBefore[0]), "both are in their owner's Drop Area");
    assert.equal(zone(done, foe, "drop").length, dropBefore.length + 3, "the used Extra and the two cards, nothing else");
    assert.equal(zone(done, foe, "hand").length, handWithCounter.length - 1, "the Counter left the hand, and nothing came back from Life");
    assert.deepEqual(zone(done, foe, "hand"), handBefore, "no Life card went to a hand");
    assert.deepEqual(zone(done, seat, "life"), lifeOf(s, seat), "the controller's own Life is untouched");
    assert.ok(!waiting.events.some((e) => e.type === "damage") && !r.events.some((e) => e.type === "damage"), "moving Life to the Drop is not damage");
  }

  // 2. Up to: nothing chosen is allowed; so is one without the other.
  for (const [label, life, nrg] of [["none", 0, 0], ["Life only", 1, 0], ["energy only", 0, 1]] as const) {
    const { s } = base();
    const lifeN = lifeOf(s, foe).length, energyN = zone(s, foe, "energy").length;
    const ctr = stage(s, foe, "CTRP1_916", "hand");
    const done = settle(asCounter(playInto(s, seat), foe, ctr).state, choosing(s, foe, life, nrg));
    assert.equal(lifeOf(done.s, foe).length, lifeN - life, `${seat}: ${label}: Life`);
    assert.equal(zone(done.s, foe, "energy").length, energyN - nrg, `${seat}: ${label}: energy`);
  }

  const mine = (a: Asked[]) => a.filter((x) => x.player === seat);
  const kinds = (a: Asked[]) => mine(a).map((x) => x.kind);
  /** The Counter's player readies the first `max` energy offered, rested or not. */
  const readyFirst = (s0: VmState, life: number, nrg: number): Pick => {
    const lives = lifeOf(s0, foe);
    return (q) => q.player === foe ? q.choice.candidates.slice(0, q.choice.max)
      : q.choice.candidates.slice(0, q.choice.candidates.every((c) => lives.includes(c)) ? life : nrg);
  };
  const isLifeQ = (s0: VmState) => (a: Asked) => !!a.candidates && a.candidates.every((c) => lifeOf(s0, foe).includes(c));

  // 3. Several energy readied by one Counter: one use of the Auto, one Life and one energy at most.
  {
    const { s } = base();
    const lifeN = lifeOf(s, foe).length, energyN = zone(s, foe, "energy").length;
    const ctr = stage(s, foe, "CTRP2_916", "hand");
    const r = asCounter(playInto(s, seat), foe, ctr);
    const done = settle(r.state, choosing(s, foe, 1, 1));
    assert.equal(restOf(done.s, foe), 1, `${seat}: two of three rested energy were readied`);
    assert.deepEqual(kinds(done.asked), ["chooseCards", "chooseCards"], `${seat}: Life then energy, once, with no ordering question for the one copy`);
    assert.equal(lifeOf(done.s, foe).length, lifeN - 1); assert.equal(zone(done.s, foe, "energy").length, energyN - 1);
  }

  // 4. A second Counter in the turn does not use the same copy again; two copies are independent; the next turn resets.
  {
    const { s } = base(["DB3-013", "DB3-040"]);
    const lifeN = lifeOf(s, foe).length, energyN = zone(s, foe, "energy").length;
    const c1 = stage(s, foe, "CTRP1_916", "hand"), c2 = stage(s, foe, "CTRP1_916", "hand");
    const first = settle(asCounter(playInto(s, seat), foe, c1).state, choosing(s, foe, 1, 1));
    assert.equal(mine(first.asked).filter(isLifeQ(s)).length, 2, `${seat}: both copies answer the first Counter`);
    assert.equal(lifeOf(first.s, foe).length, lifeN - 2, "one Life per copy"); assert.equal(zone(first.s, foe, "energy").length, energyN - 2);
    const again = settle(asCounter(playInto(first.s, seat), foe, c2).state, choosing(first.s, foe, 1, 1));
    assert.deepEqual(mine(again.asked), [], `${seat}: neither copy answers a second Counter in the same turn`);
    assert.equal(lifeOf(again.s, foe).length, lifeN - 2);
    // Next turn: every use is back.
    let t = again.s;
    const turn0 = t.turn;
    for (let i = 0; i < 16 && !(t.prompt.kind === "main" && t.turnPlayer === seat && t.turn !== turn0); i++) {
      const q = t.prompt as { kind: string; player: PlayerId };
      t = take(t, q.kind === "main" ? { type: "endMain", player: q.player } : q.kind === "charge" ? { type: "charge", player: q.player, card: null } : { type: "pass", player: q.player } as Action).state;
    }
    assert.equal(t.turnPlayer, seat); assert.equal(t.prompt.kind, "main");
    for (const id of zone(t, foe, "energy")) t.cards[id].mode = "rest";
    const c3 = stage(t, foe, "CTRP1_916", "hand");
    const next = settle(asCounter(playInto(t, seat), foe, c3).state, choosing(t, foe, 1, 1));
    assert.equal(mine(next.asked).filter(isLifeQ(t)).length, 2, `${seat}: next turn both copies answer again`);
  }

  // 5. An energy that is already Active does not switch, so nothing triggers; a mixed pick triggers on the real change.
  {
    const { s } = base();
    s.sides[foe].zones.energy.forEach((id) => { s.cards[id].mode = "active"; });
    const ctr = stage(s, foe, "CTRP2_916", "hand");
    const idle = settle(asCounter(playInto(s, seat), foe, ctr).state, readyFirst(s, 1, 1));
    assert.deepEqual(mine(idle.asked), [], `${seat}: Active -> Active is no switch`);
    const mixed = base().s;
    mixed.cards[zone(mixed, foe, "energy")[0]].mode = "active";
    const c = stage(mixed, foe, "CTRP2_916", "hand");
    const run = settle(asCounter(playInto(mixed, seat), foe, c).state, readyFirst(mixed, 1, 1));
    assert.equal(mine(run.asked).length, 2, `${seat}: one of the chosen energy really changed`);
  }

  // 6. Not a Counter skill: the Charge Phase untap, a Main skill, an Auto on a card that also prints a Counter.
  {
    const { s } = base();
    const before = restOf(s, foe);
    let t = take(s, { type: "endMain", player: seat }).state;
    t = take(t, { type: "charge", player: foe, card: null }).state;
    assert.ok(restOf(t, foe) < before, `${seat}: the Charge Phase really stood the energy up`);
    assert.ok(!(t.prompt.kind === "chooseCards" && (t.prompt as { player: PlayerId }).player === seat), "and no Auto answers it");
    assert.equal(t.pending.filter((x) => x.master === seat).length, 0);
  }
  {
    // The punished side's own turn: the opponent (foe) uses a Main skill and a card with a Counter line.
    const s = fresh(foe);
    stage(s, seat, "DB3-013", "battle", "active");
    energy(s, foe, 4); setLife(s, foe); s.pending = [];
    const main = stage(s, foe, "MAIN916", "battle", "active");
    const act = take(s, { type: "activate", player: foe, card: main, skill: 0 });
    const done = settle(act.state, readyFirst(act.state, 1, 1));
    assert.deepEqual(mine(done.asked), [], `${seat}: an opponent's [Activate: Main] is not a [Counter] skill`);
    assert.ok(restOf(done.s, foe) < 4, "the Main skill did ready energy");
    const t = fresh(foe);
    stage(t, seat, "DB3-013", "battle", "active"); energy(t, foe, 4); setLife(t, foe); t.pending = [];
    stage(t, foe, "MIXED916", "hand");
    const play = RULES.legalActions(ctx, t).find((l) => l.action.type === "play" && t.cards[(l.action as { card: string }).card].cardId === "MIXED916");
    assert.ok(play);
    const viaAuto = settle(take(t, play.action).state, readyFirst(t, 1, 1));
    assert.deepEqual(mine(viaAuto.asked), [], `${seat}: an Auto on a card that prints a [Counter] line is not a Counter skill`);
    assert.ok(restOf(viaAuto.s, foe) < 4);
  }

  // 7. The existing triggers keep their behaviour: BT7-003's wording asks for the opponent's turn, which a Counter never is.
  {
    const { s } = base();
    stage(s, seat, "BT7916", "battle", "active");
    const hand = zone(s, seat, "hand").length;
    const ctr = stage(s, foe, "CTRP1_916", "hand");
    const done = settle(asCounter(playInto(s, seat), foe, ctr).state, choosing(s, foe, 0, 0));
    assert.equal(zone(done.s, seat, "hand").length, hand, `${seat}: the played card left the hand and the "non-[Awaken] skill during their turn" Auto drew nothing`);
  }

  // 8. Your own Counter readying your own energy does not answer your own Auto; the opponent's copy does.
  {
    const s = fresh(foe);
    stage(s, seat, "DB3-013", "battle", "active"); stage(s, foe, "DB3-040", "battle", "active");
    energy(s, seat, 3); energy(s, foe, 3); setLife(s, foe); setLife(s, seat); s.pending = [];
    const mineCounter = stage(s, seat, "CTRP1_916", "hand");
    const done = settle(asCounter(playInto(s, foe), seat, mineCounter).state, (q) => q.choice.candidates.slice(0, 1));
    assert.deepEqual(done.asked.filter((a) => a.player === seat && !!a.candidates && a.candidates.every((c) => zone(s, foe, "life").includes(c))), [], `${seat}: not your own Counter`);
    const theirs = done.asked.filter((a) => a.player === foe);
    assert.equal(theirs.length, 2, `${seat}: the other player's copy answers my Counter (a Life choice and an energy choice)`);
    assert.ok(theirs[0].candidates!.every((c) => zone(s, seat, "life").includes(c)), "and it picks among my Life");
  }

  // 9. Chain: the opponent's [Counter] negated by [Counter: Counter] never switches, so nothing triggers.
  {
    const { s } = base();
    const ctr = stage(s, foe, "CTRP2_916", "hand"), stop = stage(s, seat, "STOP916", "hand");
    const lifeN = lifeOf(s, foe).length;
    let t = asCounter(playInto(s, seat), foe, ctr).state;
    assert.equal(t.prompt.kind, "counter", `${seat}: the [Counter: Counter] window opens for the Auto's controller`);
    t = take(t, counterOf(seat, stop)).state;
    const done = settle(t, readyFirst(s, 1, 1));
    assert.deepEqual(mine(done.asked), [], `${seat}: a negated Counter readied nothing`);
    assert.equal(restOf(done.s, foe), 3); assert.equal(lifeOf(done.s, foe).length, lifeN);
  }

  // 10. [Counter: Attack] too (the attack is negated, so no damage is dealt either).
  {
    const { s } = base();
    const ctr = stage(s, foe, "CTRA_916", "hand");
    const lifeN = lifeOf(s, foe).length;
    const t = take(s, { type: "attack", player: seat, attacker: s.sides[seat].zones.leader[0], target: s.sides[foe].zones.leader[0] }).state;
    const { state, events } = asCounter(t, foe, ctr);
    const done = settle(state, choosing(s, foe, 1, 1));
    assert.deepEqual(kinds(done.asked), ["chooseCards", "chooseCards"], `${seat}: [Counter: Attack] answers`);
    assert.equal(lifeOf(done.s, foe).length, lifeN - 1);
    assert.ok(![...events, ...done.events].some((e) => e.type === "damage"), "the negated attack and the placement deal no damage");
  }

  // 11. The controller's selection is the controller's alone, and it is checked.
  {
    const { s } = base();
    const lifeN = lifeOf(s, foe).length;
    const ctr = stage(s, foe, "CTRP1_916", "hand");
    let t = asCounter(playInto(s, seat), foe, ctr).state;
    // The Counter's own energy choice first (the opponent's), then the Auto's.
    while (t.prompt.kind === "chooseCards" && (t.prompt as { player: PlayerId }).player === foe) t = take(t, { type: "choose", player: foe, cards: [(t.prompt as Extract<Prompt, { kind: "chooseCards" }>).choice.candidates[0]] }).state;
    const q = t.prompt as Extract<Prompt, { kind: "chooseCards" }>;
    assert.equal(q.kind, "chooseCards"); assert.equal(q.player, seat, `${seat}: the Auto's controller is asked`);
    assert.ok(RULES.legalActions(ctx, t).every((l) => l.action.player === seat), "the punished player has no action here, in particular no decline");
    assert.ok(RULES.legalActions(ctx, t).filter((l) => l.action.type === "choose" && l.action.cards.length).every((l) => /^Choose face-down card \d+$/.test(l.label)), `${seat}: the menu names Life cards by position only`);
    refused(t, { type: "choose", player: foe, cards: [q.choice.candidates[0]] }, `${seat}: the punished player cannot choose for the Auto`);
    refused(t, { type: "choose", player: foe, cards: [] }, `${seat}: nor decline it`);
    refused(t, { type: "choose", player: seat, cards: q.choice.candidates.slice(0, 2) }, `${seat}: up to one Life`);
    refused(t, { type: "choose", player: seat, cards: [lifeOf(t, seat)[0]] }, `${seat}: not the controller's own Life`);
    // Hidden Life identities stay hidden at the question, for both viewers (a Drop card is public once it lands).
    for (const viewer of [seat, foe]) assert.ok(!JSON.stringify(snapshot(t, viewer)).includes("SECRET916"), `${seat}: ${viewer} sees no face-down Life identity while the choice is open`);
    const done = settle(t, choosing(t, foe, 1, 1));
    assert.equal(lifeOf(done.s, foe).length, lifeN - 1);
    assert.ok(zone(done.s, foe, "drop").some((id) => done.s.cards[id].cardId === "SECRET916"), "the chosen Life card is in the Drop, face up");
  }

  // 12. Control: real damage still emits its event.
  {
    const { s } = base();
    const t = take(s, { type: "attack", player: seat, attacker: s.sides[seat].zones.leader[0], target: s.sides[foe].zones.leader[0] });
    const events: GameEvent[] = [...t.events]; let st = t.state;
    for (let i = 0; i < 20 && st.prompt.kind !== "main"; i++) {
      const q = st.prompt as { kind: string; player: PlayerId };
      const r = take(st, q.kind === "counter" ? { type: "counter", player: q.player, card: null } : q.kind === "chooseCards" ? { type: "choose", player: q.player, cards: [] } : { type: "pass", player: q.player } as Action);
      st = r.state; events.push(...r.events);
    }
    assert.ok(events.some((e) => e.type === "damage"), `${seat}: an attack that connects still deals damage`);
  }
}
