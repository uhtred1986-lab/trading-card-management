/**
 * The prohibition catalog, batch 5 (20-14, 20-14-1, 22-5-7) — the same `forbid`
 * machinery as `prohibition-catalog.ts` … `prohibition-catalog-4.ts`:
 *
 * - owner ruling of 26 Oct 2026 (the A4 follow-up): a keyword play of a card
 *   under a play tax — [Evolve] here, [Revive] beside it — is not offered when
 *   the tax can't be paid, so the keyword's own price is never paid for
 *   nothing; a tax declined mid-play is a failed play (22-5-7: the card goes
 *   to the Drop, what was paid stays paid);
 * - EX25-37: the catalog's one line cut into its three skills (errata.ts);
 * - BT13-030, the rule manual's own 20-14-1 example: an attack tax paid by
 *   giving the attacking card -5000 power;
 * - BT30-146: the player's Battle Cards and Unisons in the Charge Phase;
 * - BT4-003: "you may not activate [EX-Evolve]" (`keywordSkill`);
 * - BT4-104: plays from the hand by the skills of [Super Combo] cards;
 * - escapes printed in front of the ban (BT6-081, P-021, BT3-016);
 * - P-676: markers on Unisons and the opponent's skills (`removeMarkers`);
 * - BT9-087: a list of actions kept whole, with its span;
 * - BT8-089: the attacking player's tokens and cost-7-or-less Battle Cards,
 *   the attacking card excepted (`turnPlayer`, `exceptCards`).
 *
 * Part 1 reads one printed card per group (and the reading text); part 2 plays
 * the actions on the VM from **both seats**, with a JSON reload of the state
 * between steps.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { correctSkillText } from "../../src/lib/catalog/errata";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { attrsNow, forbiddenBy } from "../../src/lib/arena/vm/program";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { Op } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";

// ── 1. readings ──────────────────────────────────────────────────────────────

const compact = (_k: string, v: unknown) => (v === null || v === false || (Array.isArray(v) && v.length === 0) ? undefined : v);
function record(text: string, index = 0, id = "X") {
  const rec = skillRecords({ ...DEFS.V1, id, skill: text } as CardDef)[index];
  assert.deepEqual(rec.unread, [], `reads whole: ${text}`);
  return rec;
}
const ops = (text: string, index = 0): Op[] => (JSON.parse(JSON.stringify({ ops: record(text, index).ops }, compact)) as { ops?: Op[] }).ops ?? [];
const reads = (text: string, index = 0): string => record(text, index).reads;
function forbids(list: Op[]): Extract<Op, { op: "forbid" }>[] {
  const out: Extract<Op, { op: "forbid" }>[] = [];
  for (const o of list) {
    if (o.op === "forbid") out.push(o);
    if (o.op === "if") out.push(...forbids(o.then), ...forbids(o.else ?? []));
    if (o.op === "chooseMode") for (const mode of (o as { modes: { ops: Op[] }[] }).modes) out.push(...forbids(mode.ops));
  }
  return out;
}
const SELF = { sel: { special: "self" } };

// EX25-37: the catalog's copy runs [Energy-Exhaust], [Arrival] and the [Permanent] into one line.
{
  const printed = "[energy-exhaust] [arrival red/yellow]{y}, if your Leader is {Super Baby 2, Awakened Malevolence}: [permanent] This card can't [evolve] into other cards. [activate: battle][once per turn] Play up to 1 red or yellow non-<Trunks: GT> ≪Brainwashed≫ card with an energy cost of 3 or less from your Drop.";
  const fixed = correctSkillText("EX25-37", printed);
  assert.ok(fixed && fixed !== printed, "EX25-37: corrected");
  const recs = skillRecords({ ...DEFS.V1, id: "EX25-37", skill: fixed } as CardDef);
  assert.deepEqual(recs.map((r) => [r.skillIndex, r.kind, r.unread.length]), [[10, "keyword", 0], [20, "permanent", 0], [30, "activate:battle", 0]], "EX25-37: [Arrival], the [Permanent] and the [Activate: Battle], each read whole");
  assert.equal(recs[0].cost?.condition?.kind, "leaderMatches", "EX25-37: the [Arrival]'s Leader condition");
  assert.deepEqual(forbids(JSON.parse(JSON.stringify(recs[1].ops, compact))), [{ op: "forbid", what: "evolveOnto", until: "game", target: SELF }]);
  assert.equal(recs[1].reads, "this card can't be the base of an [Evolve]", "EX25-37: the reading says what the rule is");
}
// BT13-030 (20-14-1's example): the price is a power change to the attacking card.
{
  const text = "[Counter: Attack] If your Leader Card is a mono-red ≪Saiyan≫ card: You may choose the attacking card, ignoring [Barrier], and it gets -10000 power for the turn; your opponent can't attack with cards for the turn unless they give the attacking card -5000 power for the turn each time. You can't activate copies of this card from your hand for the turn.";
  const [tax] = forbids(ops(text)).filter((f) => f.what === "attack");
  assert.deepEqual([tax.side, tax.until, tax.unlessPay], ["opponent", "turn", [{ op: "power", target: SELF, amount: -5000, until: "turn" }]], "BT13-030: the attacker pays with its own power");
  assert.match(reads(text), /your opponent can't attack unless, each time, the player doing it first pays: give the attacking card -5000 power for the turn/, "BT13-030: the reading names the attacking card");
}
// BT30-146: the Charge Phase's switch of that player's Battle Cards and Unisons.
{
  const text = "[auto] When this card attacks, choose one -- ・Draw 1 card ・Your opponent can't switch Battle Cards or Unisons to Active Mode during the next Charge Phase.";
  assert.deepEqual(forbids(ops(text)).map((f) => [f.what, f.side, f.until, f.filter?.type, f.fromArea]), [
    ["switchToActiveInCharge", "opponent", "afterOpponentCharge", "BATTLE", "battle"],
    ["switchToActiveInCharge", "opponent", "afterOpponentCharge", "UNISON", "unison"],
  ], "BT30-146");
  assert.match(reads(text), /your opponent can't switch Battle Cards in their Battle Area to Active Mode in the Charge Phase/);
}
// BT4-003, BT4-104: one keyword skill; plays by the skills of [Super Combo] cards.
{
  assert.deepEqual(forbids(ops("[auto] When you play this card, draw 2 cards, and you may not activate [ex-evolve] for the duration of the turn.")), [{ op: "forbid", what: "activateSkill", side: "you", until: "turn", keywordSkill: "EX-Evolve" }], "BT4-003");
  assert.match(reads("[auto] When you play this card, draw 2 cards, and you may not activate [ex-evolve] for the duration of the turn."), /you can't activate \[EX-Evolve\] for the turn/);
  const bt4 = "[Auto] When you play this card, draw 1 card, and your opponent may not play Battle Cards from their hand with the skills of cards with [Super Combo] for the duration of the game.";
  const [f] = forbids(ops(bt4));
  assert.deepEqual([f.what, f.side, f.until, f.bySkill, f.fromArea, f.filter?.type, f.byFilter?.keywords], ["play", "opponent", "game", true, "hand", "BATTLE", ["Super Combo"]], "BT4-104");
  assert.match(reads(bt4), /your opponent can't play Battle Cards from their hand with the skills of cards with \[Super Combo\]/);
}
// Escapes printed in front of the ban.
{
  const [bt6] = forbids(ops("[Permanent] Unless {Display of Power Son Gohan} is in play in your Battle Area, you can't place this card in your Combo Area from any area."));
  assert.deepEqual([bt6.what, bt6.target, (bt6.unless as { kind: string; sel: { area: string } }).sel.area], ["combo", SELF, "battle"], "BT6-081");
  const [p021] = forbids(ops("[Permanent] If you don't have <Son Gohan: Adolescence>, <Son Goten> and <Trunks: Youth> in your Drop Area, you can't play this card from any area."));
  const each = p021.unless as { kind: string; conds: { sel: { area: string; filter: { characters: string[] } } }[] };
  assert.deepEqual([p021.what, p021.target, each.kind, each.conds.map((c) => [c.sel.area, c.sel.filter.characters])], ["play", SELF, "all", [["drop", ["son gohan: adolescence"]], ["drop", ["son goten"]], ["drop", ["trunks: youth"]]]], "P-021: each of the three");
  const [bt3] = forbids(ops("[Permanent] If <Pan> is not under this card, it cannot attack."));
  assert.deepEqual([bt3.what, bt3.target, (bt3.unless as { sel: { area: string } }).sel.area], ["attack", SELF, "under"], "BT3-016");
  assert.equal(reads("[Permanent] If <Pan> is not under this card, it cannot attack."), "this card can't attack unless there are 1 or more <pan> cards under this card");
}
// P-676, BT9-087, BT8-089.
{
  const p676 = "[permanent] Markers on your Unisons can't be removed by your opponent's skills, and cards in your hand can't be placed into their owner's Drop by your opponent's skills.";
  const [m] = forbids(ops(p676));
  assert.deepEqual([m.what, m.side, m.cardsOf, m.filter?.type], ["removeMarkers", "opponent", "you", "UNISON"], "P-676");
  assert.match(reads(p676), /^markers on your Unison Cards can't be removed by your opponent's skills/);
  const bt9 = "[Counter: Attack] If your Leader Card is black: Negate the attack, and you may choose 1 card from your hand and place it in your Drop Area. If you placed a card in your Drop Area, choose up to 1 of your opponent's Battle Cards, ignoring [Barrier], and it can't attack, be placed in your opponent's Combo Area, or activate skills until the end of your next turn.";
  assert.deepEqual(forbids(ops(bt9)).map((f) => [f.what, f.until]), [["attack", "ownTurn"], ["combo", "ownTurn"], ["activateSkill", "ownTurn"], ["block", "ownTurn"]], "BT9-087: every action, through the next turn of yours");
  const bt8 = "[Auto] When a Battle Card attacks, the player who attacked can't attack with tokens or Battle Cards with energy costs of 7 or less other than the card they attacked with for the duration of the turn.";
  const [b] = forbids(ops(bt8));
  assert.deepEqual([b.what, b.side, b.turnPlayer, b.until, b.exceptCards, b.filter?.anyOf?.map((f) => [f.token, f.type, f.costMax])], ["attack", "both", true, "turn", { sel: { special: "attacker" } }, [[true, undefined, undefined], [undefined, "BATTLE", 7]]], "BT8-089");
  assert.equal(reads(bt8), "the turn player can't attack with tokens or Battle Cards with an energy cost of 7 or less other than the attacking card for the turn");
}

// ── 2. the VM, from both seats ───────────────────────────────────────────────

const C = (id: string, o: Partial<CardDef>) => card(id, { energyCost: 0, comboCost: 0, ...o });
const defs: Record<string, CardDef> = {
  ...DEFS,
  BT6_017: C("BT6_017", { power: 40000, skill: "[Permanent] You and your opponent can't play Battle Cards with 30000 power or less unless they choose 4 cards from their life and place them in their Drop Area as they play the Battle Card." }),
  EVO: C("EVO", { power: 10000, energyCost: 1, characters: ["Baby"], skill: "[Evolve] {R}: <Baby>" }),
  BIG_EVO: C("BIG_EVO", { power: 40000, energyCost: 1, characters: ["Baby"], skill: "[Evolve] {R}: <Baby>" }),
  EXEVO: C("EXEVO", { power: 40000, energyCost: 1, characters: ["Baby"], skill: "[EX-Evolve] {R}: <Baby>" }),
  BABY: C("BABY", { characters: ["Baby"] }),
  REV: C("REV", { power: 10000, colors: ["Green"], skill: "[Revive red/blue]" }),
  RED: C("RED", { colors: ["Red"] }),
  BLUE: C("BLUE", { colors: ["Blue"] }),
  PLAIN: C("PLAIN", { power: 30000 }),
  TAXER: C("TAXER", { skill: "[Auto] When your opponent attacks, your opponent can't attack with cards for the turn unless they give the attacking card -5000 power for the turn each time." }),
  LOCKER: C("LOCKER", { skill: "[Activate: Main] Your opponent can't switch Battle Cards or Unisons to Active Mode during the next Charge Phase." }),
  NO_EX: C("NO_EX", { skill: "[Activate: Main] You may not activate [ex-evolve] for the duration of the turn." }),
  BT4_104: C("BT4_104", { skill: "[Activate: Main] Your opponent may not play Battle Cards from their hand with the skills of cards with [Super Combo] for the duration of the game." }),
  SUPER_PLAYER: C("SUPER_PLAYER", { skill: "[Super Combo]<br>[Activate: Main] Choose up to 1 Battle Card in your hand and play it." }),
  PLAYER: C("PLAYER", { skill: "[Activate: Main] Choose up to 1 Battle Card in your hand and play it." }),
  BT6_081: C("BT6_081", { skill: "[Permanent] Unless {Display of Power Son Gohan} is in play in your Battle Area, you can't place this card in your Combo Area from any area." }),
  DISPLAY: C("DISPLAY", { name: "Display of Power Son Gohan" }),
  P021: C("P021", { skill: "[Permanent] If you don't have <Son Gohan: Adolescence>, <Son Goten> and <Trunks: Youth> in your Drop Area, you can't play this card from any area." }),
  GOHAN: C("GOHAN", { characters: ["Son Gohan: Adolescence"] }),
  GOTEN: C("GOTEN", { characters: ["Son Goten"] }),
  TRUNKS: C("TRUNKS", { characters: ["Trunks: Youth"] }),
  BT3_016: C("BT3_016", { skill: "[Permanent] If <Pan> is not under this card, it cannot attack." }),
  PAN: C("PAN", { characters: ["Pan"] }),
  P676: C("P676", { skill: "[permanent] Markers on your Unisons can't be removed by your opponent's skills." }),
  UNI: card("UNI", { type: "UNISON", energyCost: null, comboCost: null, comboPower: null, power: 10000 }),
  STRIP: C("STRIP", { skill: "[Activate: Main] Choose up to 1 of your opponent's Unison Cards and remove 2 markers from it." }),
  STRIP_MINE: C("STRIP_MINE", { skill: "[Activate: Main] Choose up to 1 of your Unison Cards and remove 2 markers from it." }),
  BT8_089: C("BT8_089", { skill: "[Auto] When a Battle Card attacks, the player who attacked can't attack with tokens or Battle Cards with energy costs of 7 or less other than the card they attacked with for the duration of the turn." }),
  SEVEN: C("SEVEN", { energyCost: 7, power: 10000 }),
  EIGHT: C("EIGHT", { energyCost: 8, power: 10000 }),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
// A bare keyword line ([Revive]) has no rule row of its own; the compiler's scripts stand in for it.
const fromRows = rulesFromRows(JSON.parse(JSON.stringify(rows)), defs);
const compiled = rulesFromCompiler(defs);
const ctx: EngineContext = { ...CTX, defs, scripts: new Proxy(fromRows, { get: (base, key) => (typeof key === "string" ? base[key] ?? compiled[key] : undefined) }) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");
const take = (s: VmState, action: Action): VmState => RULES.apply(ctx, roundtrip(s), action).state as VmState;
const SEATS: PlayerId[] = ["p1", "p2"];

/** A game at the Main Phase of `turn` (p1's third turn, or p2's after it). */
function game3(turn: PlayerId): VmState {
  let s = RULES.createGame(ctx, { seed: 2017, p1: { name: "First", leader: "L-RED", main: fifty("V1") }, p2: { name: "Second", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  const steps: Action[] = [
    { type: "chooseFirst", player: s.chooser, first: "p1" } as Action,
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null },
    { type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null },
  ] as Action[];
  for (const a of steps) s = take(s, a);
  if (turn === "p2") s = endTurn(s);
  assert.equal(s.prompt.kind, "main");
  assert.equal((s.prompt as { player: PlayerId }).player, turn);
  return roundtrip(s);
}
function stage(s: VmState, p: PlayerId, def: string, area: string, mode: "active" | "rest" = "active"): string {
  const id = s.sides[p].zones.deck[0]; s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle" || area === "energy" || area === "unison") s.cards[id].mode = mode;
  return id;
}
/** Answer every prompt up to the next Main Phase; `mode` answers a "choose one" (0 = pay / do it; -1 stops there). */
function settle(s: VmState, pick: string[] = [], mode = 0, stop: (s: VmState) => boolean = () => false): VmState {
  for (let i = 0; i < 40 && s.prompt.kind !== "main" && s.prompt.kind !== "gameOver" && !stop(s); i++) {
    const q = s.prompt;
    if (q.kind === "chooseCards") {
      const want = q.choice.candidates.filter((c) => pick.includes(c));
      s = take(s, { type: "choose", player: q.player, cards: want.length ? want.slice(0, q.choice.max ?? want.length) : q.choice.candidates.slice(0, q.choice.min) });
    } else if (q.kind === "chooseMode") {
      if (mode < 0) break;
      s = take(s, { type: "chooseMode", player: q.player, index: mode } as Action);
    }
    else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: q.player, index: 0 });
    else if (q.kind === "counter") s = take(s, { type: "counter", player: q.player, card: null });
    else if (q.kind === "blocker" || q.kind === "combo") s = take(s, { type: "pass", player: q.player } as Action);
    else if (q.kind === "charge") s = take(s, { type: "charge", player: q.player, card: null });
    else throw new Error(`unexpected prompt ${q.kind}`);
  }
  return s;
}
function endTurn(s: VmState): VmState {
  const p = (s.prompt as { player: PlayerId }).player;
  return settle(take(s, { type: "endMain", player: p }));
}
const activations = (s: VmState, id: string) => RULES.legalActions(ctx, s).filter((l) => l.action.type === "activate" && l.action.card === id);
function activate(s: VmState, id: string, pick: string[] = [], mode = 0): VmState {
  const [a] = activations(s, id);
  assert.ok(a, `${s.cards[id].cardId} is offered`);
  return settle(take(s, a.action), pick, mode);
}
const zoneOf = (s: VmState, id: string) => (["p1", "p2"] as PlayerId[]).flatMap((p) => Object.entries(s.sides[p].zones).filter(([, ids]) => ids.includes(id)).map(([z]) => z))[0];
const leaderOf = (s: VmState, p: PlayerId) => s.sides[p].zones.leader[0];
/** Empty a pile into the Drop Area down to `keep` cards (a state fixture, not a game action). */
function empty(s: VmState, p: PlayerId, zone: string, keep = 0): void {
  for (const id of s.sides[p].zones[zone].slice(keep)) assert.ok(moveCard(s, game, id, "drop", { owner: p }).ok);
}
const canAttack = (s: VmState, id: string) => RULES.legalActions(ctx, s).some((l) => l.action.type === "attack" && (l.action as { attacker: string }).attacker === id);
const power = (s: VmState, id: string) => attrsNow(ctx, game, s, id).power as number;

for (const me of SEATS) {
  const you = other(me);

  // A (owner ruling 26 Oct 2026): [Evolve] under a play tax. Payable: offered,
  // the tax asked mid-play; paid — played; declined — a failed play (22-5-7,
  // the card goes to the Drop, the [Evolve]'s energy stays paid). Unpayable:
  // not offered at all, nothing paid. An untaxed evolution is offered (control).
  {
    const s = game3(me);
    stage(s, you, "BT6_017", "battle");
    const evo = stage(s, me, "EVO", "hand");
    const base = stage(s, me, "BABY", "battle");
    for (let i = 0; i < 2; i++) stage(s, me, "V1", "energy");
    const r = roundtrip(s);
    const life = r.sides[me].zones.life.length;
    assert.ok(life >= 4, "fixture: enough life");
    const asked = roundtrip(settle(take(r, activations(r, evo)[0].action), [base], -1));
    assert.equal(asked.prompt.kind, "chooseMode", `${me}: A — the [Evolve]'s play asks the tax`);
    const restedBefore = asked.sides[me].zones.energy.filter((id) => asked.cards[id].mode === "rest").length;
    assert.ok(restedBefore >= 1, `${me}: the [Evolve]'s own price is paid before the play`);
    const paid = roundtrip(settle(asked, [], 0));
    assert.equal(zoneOf(paid, evo), "battle", `${me}: paid — evolved`);
    assert.equal(paid.sides[me].zones.life.length, life - 4, `${me}: 4 life paid`);
    const declined = roundtrip(settle(asked, [], 1));
    assert.equal(zoneOf(declined, evo), "drop", `${me}: declined — a failed play, the card in the Drop (22-5-7)`);
    assert.equal(zoneOf(declined, base), "battle", `${me}: the base stays`);
    assert.equal(declined.sides[me].zones.life.length, life, `${me}: no life paid`);
    assert.equal(declined.sides[me].zones.energy.filter((id) => declined.cards[id].mode === "rest").length, restedBefore, `${me}: the [Evolve]'s price stays paid`);
    const poor = roundtrip(r);
    empty(poor, me, "life", 3);
    assert.equal(activations(roundtrip(poor), evo).length, 0, `${me}: A — with 3 life the [Evolve] is not offered`);
    assert.equal(forbiddenBy(ctx, game, poor, "play", { player: me, card: evo, bySkill: true }), null, `${me}: a tax, not a ban — the [Evolve] is refused for the price alone`);
    const big = roundtrip(poor);
    big.cards[evo].cardId = "BIG_EVO";
    assert.equal(activations(roundtrip(big), evo).length, 1, `${me}: an untaxed evolution is offered (control)`);
  }

  // A: [Revive] under a play tax nobody can pay is not asked, and no hand card is dropped.
  for (const lifeLeft of [3, 8]) {
    let s = game3(you);
    stage(s, you, "BT6_017", "battle");
    const rev = stage(s, me, "REV", "battle", "rest");
    stage(s, me, "RED", "hand"); stage(s, me, "BLUE", "hand");
    empty(s, me, "life", lifeLeft);
    s = roundtrip(s);
    const hand = s.sides[me].zones.hand.length;
    s = take(s, { type: "attack", player: you, attacker: stage(s, you, "PLAIN", "battle"), target: rev });
    const reviveAsked = (t: VmState) => t.prompt.kind === "chooseCards" && /Revive/.test(t.prompt.choice.reason ?? "");
    s = roundtrip(settle(s, [], 0, reviveAsked));
    const revived = reviveAsked(s);
    assert.equal(zoneOf(s, rev), "drop", `${me}: the Revive card is KO'd`);
    if (lifeLeft === 3) {
      assert.ok(!revived, `${me}: A — [Revive] is not asked when the tax can't be paid`);
      assert.equal(s.sides[me].zones.hand.length, hand, `${me}: no hand card dropped`);
    } else assert.ok(revived, `${me}: with life to pay, [Revive] is asked (control)`);
  }

  // BT13-030: once the rule is in force (here by an [Auto] on the opponent's first
  // attack, as BT13-030's [Counter: Attack] puts it in that attack), each later
  // attack of theirs is paid with the attacking card's own power; the first was not.
  {
    let s = game3(you);
    stage(s, me, "TAXER", "battle");
    const a1 = stage(s, you, "PLAIN", "battle");
    const a2 = stage(s, you, "PLAIN", "battle");
    s = roundtrip(s);
    const before = power(s, a1);
    s = roundtrip(settle(take(s, { type: "attack", player: you, attacker: a1, target: leaderOf(s, me) })));
    assert.equal(power(s, a1), before, `${me}: the attack that put the rule in force paid nothing`);
    assert.ok(canAttack(s, a2), `${me}: BT13-030 — the next attack can be paid for`);
    s = roundtrip(settle(take(s, { type: "attack", player: you, attacker: a2, target: leaderOf(s, me) })));
    assert.equal(power(s, a2), before - 5000, `${me}: the attacking card got -5000 power for the turn`);
    assert.equal(power(s, a1), before, `${me}: no other card paid`);
  }

  // BT30-146: through the opponent's next Charge Phase their rested Battle Card stays rested; their energy stands (control).
  {
    let s = game3(me);
    const theirs = stage(s, you, "PLAIN", "battle", "rest");
    const energy = stage(s, you, "V1", "energy", "rest");
    s = roundtrip(activate(s, stage(s, me, "LOCKER", "battle")));
    s = roundtrip(endTurn(s));
    assert.equal(s.cards[theirs].mode, "rest", `${me}: BT30-146 — not switched to Active in their Charge Phase`);
    assert.equal(s.cards[energy].mode, "active", `${me}: their energy is (control)`);
    assert.ok(!s.effects.some((e) => e.kind === "forbid" && e.forbid?.what === "switchToActiveInCharge"), `${me}: the rule is spent with that Charge Phase`);
    const mine = game3(me);
    const own = stage(mine, me, "PLAIN", "battle", "rest");
    let m = roundtrip(activate(mine, stage(mine, me, "LOCKER", "battle")));
    m = roundtrip(endTurn(endTurn(m)));
    assert.equal(m.cards[own].mode, "active", `${me}: its controller's cards are not bound`);
  }

  // BT4-003: [EX-Evolve] is not offered for the turn; an [Evolve] is (control).
  {
    let s = game3(me);
    const ex = stage(s, me, "EXEVO", "hand");
    const plain = stage(s, me, "BIG_EVO", "hand");
    stage(s, me, "BABY", "battle");
    for (let i = 0; i < 2; i++) stage(s, me, "V1", "energy");
    assert.equal(activations(roundtrip(s), ex).length, 1, `${me}: [EX-Evolve] offered without the rule (control)`);
    s = roundtrip(activate(s, stage(s, me, "NO_EX", "battle")));
    assert.equal(activations(s, ex).length, 0, `${me}: BT4-003 — no [EX-Evolve]`);
    assert.equal(activations(s, plain).length, 1, `${me}: an [Evolve] still is`);
  }

  // BT4-104: a [Super Combo] card's skill plays no Battle Card from the opponent's hand; another card's skill does.
  {
    let s = game3(me);
    s = roundtrip(activate(s, stage(s, me, "BT4_104", "battle")));
    s = roundtrip(endTurn(s));
    const a = stage(s, you, "PLAIN", "hand");
    s = roundtrip(activate(s, stage(s, you, "SUPER_PLAYER", "battle"), [a]));
    assert.equal(zoneOf(s, a), "hand", `${me}: BT4-104 — a [Super Combo] card's skill plays nothing from the hand`);
    s = roundtrip(activate(s, stage(s, you, "PLAYER", "battle"), [a]));
    assert.equal(zoneOf(s, a), "battle", `${me}: another card's skill does`);
  }

  // BT6-081, P-021, BT3-016: the escape printed in front of the ban.
  {
    const s = game3(me);
    const bt6 = stage(s, me, "BT6_081", "hand");
    const p021 = stage(s, me, "P021", "hand");
    const bt3 = stage(s, me, "BT3_016", "battle");
    let r = roundtrip(s);
    assert.ok(forbiddenBy(ctx, game, r, "combo", { player: me, card: bt6 }), `${me}: BT6-081 — no combo without {Display of Power Son Gohan}`);
    assert.ok(forbiddenBy(ctx, game, r, "play", { player: me, card: p021 }), `${me}: P-021 — not playable without the three`);
    assert.ok(!canAttack(r, bt3), `${me}: BT3-016 — no attack without <Pan> under it`);
    stage(r, me, "DISPLAY", "battle");
    stage(r, me, "GOHAN", "drop"); stage(r, me, "GOTEN", "drop");
    r = roundtrip(r);
    assert.ok(!forbiddenBy(ctx, game, r, "combo", { player: me, card: bt6 }), `${me}: BT6-081 — with it, a combo is allowed`);
    assert.ok(forbiddenBy(ctx, game, r, "play", { player: me, card: p021 }), `${me}: P-021 — two of the three are not enough`);
    stage(r, me, "TRUNKS", "drop");
    const pan = r.sides[me].zones.deck[0]; r.cards[pan].cardId = "PAN";
    assert.ok(moveCard(r, game, pan, "under", { owner: me, under: bt3 } as never).ok);
    r = roundtrip(r);
    assert.ok(!forbiddenBy(ctx, game, r, "play", { player: me, card: p021 }), `${me}: P-021 — with all three, playable`);
    assert.ok(canAttack(r, bt3), `${me}: BT3-016 — with <Pan> under it, it attacks`);
  }

  // P-676: the opponent's skill removes no marker from my Unison; my own skill does.
  {
    let s = game3(you);
    stage(s, me, "P676", "battle");
    const uni = stage(s, me, "UNI", "unison");
    s.cards[uni].markers = 3;
    const strip = stage(s, you, "STRIP", "battle");
    s = roundtrip(activate(roundtrip(s), strip, [uni]));
    assert.equal(s.cards[uni].markers, 3, `${me}: P-676 — the opponent's skill removes nothing`);
    s = roundtrip(endTurn(s));
    s = roundtrip(activate(s, stage(s, me, "STRIP_MINE", "battle"), [uni]));
    assert.equal(s.cards[uni].markers, 1, `${me}: my own skill does`);
  }

  // BT8-089: once a Battle Card has attacked, the turn player's other cost-7-or-less Battle Cards can't attack; a cost-8 one and the Leader can.
  {
    let s = game3(me);
    stage(s, you, "BT8_089", "battle");
    const first = stage(s, me, "SEVEN", "battle");
    const second = stage(s, me, "SEVEN", "battle");
    const eight = stage(s, me, "EIGHT", "battle");
    s = roundtrip(s);
    assert.ok(canAttack(s, second), `${me}: before any attack, it may attack (control)`);
    s = roundtrip(settle(take(s, { type: "attack", player: me, attacker: first, target: leaderOf(s, you) })));
    assert.ok(!canAttack(s, second), `${me}: BT8-089 — another cost-7 Battle Card can't attack`);
    assert.ok(canAttack(s, eight), `${me}: a cost-8 one can`);
    assert.ok(canAttack(s, leaderOf(s, me)), `${me}: the Leader can`);
    s = roundtrip(endTurn(s));
    const theirs = stage(s, you, "SEVEN", "battle");
    assert.ok(canAttack(roundtrip(s), theirs), `${me}: gone with the turn — the next turn player's card may attack`);
  }
}
console.log("prohibition catalog 5: owner ruling A4 follow-up (a keyword play under a play tax is offered only when the tax can be paid; declined, it is a failed play), EX25-37's split line, BT13-030's power price, BT30-146's Charge Phase, BT4-003's [EX-Evolve], BT4-104's [Super Combo] plays, escapes printed in front (BT6-081, P-021, BT3-016), P-676's markers, BT9-087's list, BT8-089's attackers — read, and enforced from both seats");
