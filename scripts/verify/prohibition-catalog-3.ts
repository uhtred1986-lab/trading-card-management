/**
 * The prohibition catalog, batch 3 (20-14, 20-14-1, 0-2-5) — the same `forbid`
 * machinery as `prohibition-catalog.ts` and `prohibition-catalog-2.ts`, with
 * the owner's rulings 7–9 of 26 Oct 2026 and the next groups of the
 * catalog's unread prohibitions:
 *
 * - ruling 7, DB2-156: "cards in your hand can't be returned to your deck by
 *   your opponent's skills for the turn" is the hand as a zone for the turn,
 *   a card that enters it later included (`cardsOf`, `fromArea: hand`);
 * - ruling 8: "if this card would be removed from the Battle Area by your
 *   opponent's skill, … instead" answers a skill's KO too
 *   (`skillOrKoBySkill`), never the battle's;
 * - ruling 9: "You can't play this card from any area with skills other than
 *   [Revive Blue/Green]" — the declared play is allowed, and of the plays a
 *   skill makes only [Revive]'s (`exceptKeyword`);
 * - prices on attacking particular defenders (BT13-082, BT14-076, BT18-099):
 *   charged on an attack declared against one, and a defender nobody can pay
 *   for is not offered;
 * - the attacker's energy cost against its controller's energy (P-219,
 *   BT15-043, P-299, EX12-02, `costVsEnergy`);
 * - play taxes said "as an additional cost" (BT6-023) and "as they play the
 *   Battle Card", for both players (BT6-017);
 * - "…except with this card's skill" on life to hand (BT6-054);
 * - searches by non-Leader skills (BT9-077, DB3-092, `fromArea: deck`);
 * - activation bans on described cards while this card is in a battle
 *   (BT18-019, BT14-097);
 * - "you can only use blue or green card skills to place cards under this
 *   card" (BT8-040, `placeUnder` + `byFilter`);
 * - "you cannot lose the game … the opponent cannot win the game" (P-032,
 *   `loseGame` / `winGame`).
 *
 * Part 1 reads one printed card per group; part 2 plays the actions on the VM
 * from **both seats**, with a JSON reload of the state between steps.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { rulesFromCompiler, skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { forbiddenBy } from "../../src/lib/arena/vm/program";
import { compileSkill } from "../../src/lib/arena/compile";
import { parseSkills } from "../../src/lib/arena/text/cards";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { Op } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";

// ── 1. readings ──────────────────────────────────────────────────────────────

const compact = (_k: string, v: unknown) => (v === null || v === false || (Array.isArray(v) && v.length === 0) ? undefined : v);
function script(text: string) {
  const [rec] = skillRecords({ ...DEFS.V1, id: "X", skill: text } as CardDef);
  assert.deepEqual(rec.unread, [], `reads whole: ${text}`);
  const out = JSON.parse(JSON.stringify({ ops: rec.ops, cond: rec.cond }, compact)) as { ops?: Op[]; cond?: unknown };
  return { ops: out.ops ?? [], cond: out.cond };
}
const ops = (text: string): Op[] => script(text).ops;
function forbids(list: Op[]): Extract<Op, { op: "forbid" }>[] {
  const out: Extract<Op, { op: "forbid" }>[] = [];
  for (const o of list) {
    if (o.op === "forbid") out.push(o);
    if (o.op === "if") out.push(...forbids(o.then), ...forbids(o.else ?? []));
  }
  return out;
}
const unread = (text: string) => compileSkill(parseSkills(text)[0]).unsupported;
const SELF = { sel: { special: "self" } };

// Ruling 7 (DB2-156): the hand as a zone for the turn.
{
  assert.deepEqual(forbids(ops("[Counter: Play] Play this card, draw 1 card, and cards in your hand can't be returned to your deck by your opponent's skills for the turn.")), [
    { op: "forbid", what: "beMovedBySkill", until: "turn", side: "opponent", cardsOf: "you", fromArea: "hand", toArea: "deck" },
  ], "DB2-156: no card in particular — every card in that hand while the rule holds");
}
// Ruling 8: a skill's KO answers the replacement too.
{
  assert.deepEqual(ops("[Permanent] If this card would be removed from the Battle Area by your opponent's skill, remove it from the game instead."), [
    { op: "replaceLeave", to: "removed", target: SELF, by: "skillOrKoBySkill", bySide: "opponent" },
  ], "a redirect");
  assert.equal((ops("[Permanent] If this card would be removed from your Battle Area by an opponent's skill, you may place all of the cards under this card in their owners' Drop Areas instead.")[0] as { by?: string }).by, "skillOrKoBySkill", "a substitute (BT7-119's family)");
  assert.equal((ops("[Permanent] If this card would be removed from a Battle Area by a skill, remove it from the game instead.")[0] as { by?: string }).by, "skillOrKoBySkill", "any player's skill");
  assert.equal((ops("[Permanent] If this card would be removed from a Battle Area by a skill or KO'd, remove it from the game instead.")[0] as { by?: string }).by, "skillOrKo", "\"…or KO'd\" still takes the battle's KO");
  assert.equal((ops("[Permanent] If this card would be removed from a Battle Area, remove it from the game instead.")[0] as { by?: string }).by, "skill", "no cause named: unchanged");
}
// Ruling 9: [Revive] is the one skill that may play it.
{
  const rule = { op: "forbid", what: "play", until: "game", target: SELF, bySkill: true, exceptKeyword: "Revive" };
  assert.deepEqual(forbids(ops("[Permanent] You can't play this card from any area with skills other than [Revive Blue/Green].")), [{ ...rule, side: "you" }], "the player's sentence");
  assert.deepEqual(forbids(ops("[Permanent] This card can't be played from any area with skills other than [Revive Blue/Green].")), [rule], "the card's sentence");
  assert.ok(unread("[Permanent] You can't play this card from any area with skills other than [Dragon Ball].").length, "a bracket that is no keyword stays unread");
}
// Prices on attacking particular defenders.
{
  assert.deepEqual(forbids(ops("[Auto] When this card is played, your opponent can't attack Leader Cards for the turn unless they choose 1 card in their hand and discard it each time.")), [
    { op: "forbid", what: "attack", side: "opponent", until: "turn", attackTarget: { type: "LEADER" }, unlessPay: [{ op: "discard", n: 1 }] },
  ], "BT13-082");
  assert.deepEqual(forbids(ops("[Permanent] While this card is in Rest Mode, your opponent can't attack your Leader Card unless they choose 2 cards in their hand and discard them each time.")).map((f) => [f.attackTarget, f.unlessPay]), [[{ type: "LEADER" }, [{ op: "discard", n: 2 }]]], "BT14-076");
  const bt18 = forbids(ops("[Auto] When this card is played, your opponent can't attack your non-Leader cards for the turn unless they choose 1 of their cards in Active Mode and switch it to Rest Mode each time."))[0];
  assert.deepEqual(bt18.attackTarget, { notType: "LEADER" }, "BT18-099: the defender");
  assert.deepEqual(bt18.unlessPay?.map((o) => o.op), ["choose", "switchMode"], "BT18-099: the price");
}
// The attacker's cost against its controller's energy.
{
  assert.deepEqual(forbids(ops("[Auto] When this card is played, your opponent can't attack with Battle Cards with energy costs greater than their current energy for the turn unless they choose 2 cards in their hand and place them at the bottom of their deck in any order.")).map((f) => [f.filter, f.costVsEnergy, f.unlessPay?.map((o) => o.op)]), [[{ type: "BATTLE" }, "above", ["choose", "moveTo"]]], "P-219");
  assert.deepEqual(forbids(ops("[permanent] When this card is in Rest Mode, your opponent's Battle Cards with energy costs greater than or equal to their current energy can't attack Leader Cards.")).map((f) => [f.attackTarget, f.costVsEnergy]), [[{ type: "LEADER" }, "atLeast"]], "P-299");
  assert.deepEqual(forbids(ops("[Activate: Main] Your opponent can't attack with Battle Cards with energy costs greater than their current energy until the end of their next turn.")).map((f) => [f.until, f.costVsEnergy]), [["nextTurn", "above"]], "EX12-02");
  assert.ok(unread("[Activate: Main] Your opponent can't play Battle Cards with energy costs greater than their current energy for the turn.").length, "a measure on anything but an attack stays unread");
}
// Play taxes.
{
  assert.deepEqual(forbids(ops("[Activate: Main] Draw 1 card, and for the duration of your opponent's next turn, your opponent can't play Battle Cards with 20000 power or less unless they choose 3 cards from their hand and place them in their Drop Area as an additional cost.")).map((f) => [f.side, f.until, f.filter, f.unlessPay?.length]), [["opponent", "nextTurn", { type: "BATTLE", powerMax: 20000 }, 2]], "BT6-023");
  assert.deepEqual(forbids(ops("[Permanent] You and your opponent can't play Battle Cards with 30000 power or less unless they choose 4 cards from their life and place them in their Drop Area as they play the Battle Card.")).map((f) => [f.side, f.filter, f.unlessPay?.map((o) => o.op)]), [["both", { type: "BATTLE", powerMax: 30000 }, ["choose", "moveTo"]]], "BT6-017: both players, each paying for their own");
}
// Life, searches, activations, placing under, the game's end.
{
  assert.deepEqual(script("[Permanent] You can't add cards from your life to your hand during your turn, except with this card's skill."), { ops: [{ op: "forbid", what: "addLifeToHand", side: "you", until: "game", exceptOwnSkills: true }], cond: { kind: "isTurnPlayer" } }, "BT6-054");
  for (const text of [
    "[Permanent] When this card is in Rest Mode, your opponent can't use non-Leader Card skills to add cards from their deck to their hand.",
    "[Permanent] When this card is in Rest Mode, your opponent can't add cards from their deck to their hand using non-Leader Card skills.",
  ]) assert.deepEqual(forbids(ops(text)), [{ op: "forbid", what: "beMovedBySkill", side: "opponent", until: "game", cardsOf: "opponent", fromArea: "deck", toArea: "hand", byTypes: ["BATTLE", "EXTRA", "UNISON"] }], text);
  assert.deepEqual(forbids(ops("[Permanent] When this card is in a battle, your opponent can't activate non-[super combo] card skills.")).map((f) => [f.what, f.filter]), [["activateSkill", { notKeywords: ["Super Combo"] }], ["activateCounter", { notKeywords: ["Super Combo"] }]], "BT18-019");
  assert.deepEqual(forbids(ops("[Activate: Main] This card gains [Dual Attack] for the turn, and your opponent can't activate skills on Battle Cards with original energy costs of 7 or less from any area when this card is in a battle.")).map((f) => [f.what, f.filter, f.unless]), [
    ["activateSkill", { type: "BATTLE", originalCostMax: 7 }, { kind: "not", cond: { kind: "inBattle", sel: { special: "self" } } }],
    ["activateCounter", { type: "BATTLE", originalCostMax: 7 }, { kind: "not", cond: { kind: "inBattle", sel: { special: "self" } } }],
  ], "BT14-097: only while this card is in a battle");
  assert.deepEqual(forbids(ops("[permanent] Your Battle Cards can't be switched to Rest Mode by your opponent's card skills, and you can only use blue or green card skills to place cards under this card."))[1], { op: "forbid", what: "placeUnder", side: "you", until: "game", target: SELF, byFilter: { notColors: ["Blue", "Green"] } }, "BT8-040");
  assert.deepEqual(forbids(ops("[Auto] When a card evolves into this card, for the duration of the turn, you cannot lose the game and the opponent cannot win the game.")), [
    { op: "forbid", what: "loseGame", side: "you", until: "turn" },
    { op: "forbid", what: "winGame", side: "opponent", until: "turn" },
  ], "P-032");
}

// ── 2. the VM, from both seats ───────────────────────────────────────────────

const C = (id: string, o: Partial<CardDef>) => card(id, { energyCost: 0, comboCost: 0, ...o });
const EXTRA = { type: "EXTRA" as const, power: null, comboCost: null, comboPower: null };
const defs: Record<string, CardDef> = {
  ...DEFS,
  DB2_156: C("DB2_156", { ...EXTRA, skill: "[Counter: Play] Draw 1 card, and cards in your hand can't be returned to your deck by your opponent's skills for the turn." }),
  WARDED: C("WARDED", { skill: "[Permanent] If this card would be removed from the Battle Area by your opponent's skill, remove it from the game instead." }),
  REVIVER: C("REVIVER", { skill: "[Revive red/blue]<br>[Permanent] You can't play this card from any area with skills other than [Revive Red/Blue]." }),
  BT14_076: C("BT14_076", { skill: "[Permanent] While this card is in Rest Mode, your opponent can't attack your Leader Card unless they choose 2 cards in their hand and discard them each time." }),
  P299: C("P299", { skill: "[permanent] When this card is in Rest Mode, your opponent's Battle Cards with energy costs greater than or equal to their current energy can't attack Leader Cards." }),
  BT6_017: C("BT6_017", { power: 40000, skill: "[Permanent] You and your opponent can't play Battle Cards with 30000 power or less unless they choose 4 cards from their life and place them in their Drop Area as they play the Battle Card." }),
  BT6_054: C("BT6_054", { skill: "[Permanent] You can't add cards from your life to your hand during your turn, except with this card's skill.<br>[Activate: Main] Add the top card of your life to your hand." }),
  DB3_092: C("DB3_092", { skill: "[Permanent] When this card is in Rest Mode, your opponent can't add cards from their deck to their hand using non-Leader Card skills." }),
  BT18_019: C("BT18_019", { skill: "[Permanent] When this card is in a battle, your opponent can't activate non-[super combo] card skills." }),
  BT8_040: C("BT8_040", { skill: "[permanent] You can only use blue or green card skills to place cards under this card." }),
  P032: C("P032", { skill: "[Activate: Main] For the duration of the turn, you cannot lose the game and the opponent cannot win the game." }),
  // The skills that try the forbidden actions.
  KO_THEIRS: C("KO_THEIRS", { skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and KO it." }),
  KO_MINE: C("KO_MINE", { skill: "[Activate: Main] Choose up to 1 of your Battle Cards and KO it." }),
  PLAYER: C("PLAYER", { skill: "[Activate: Main] Choose up to 1 Battle Card in your hand and play it." }),
  RETURN_THEIRS: C("RETURN_THEIRS", { skill: "[Activate: Main] Choose up to 1 card in your opponent's hand and return it to its owner's deck." }),
  RETURN_MINE: C("RETURN_MINE", { skill: "[Activate: Main] Choose up to 1 card in your hand and return it to its owner's deck." }),
  LIFE_ADD: C("LIFE_ADD", { skill: "[Activate: Main] Add the top card of your life to your hand." }),
  SEARCH: C("SEARCH", { skill: "[Activate: Main] Choose up to 1 card from your deck, add it to your hand, then shuffle your deck." }),
  ACT: C("ACT", { skill: "[Activate: Main] Draw 1 card." }),
  SUPER: C("SUPER", { skill: "[Super Combo]<br>[Activate: Main] Draw 1 card." }),
  BLUE: C("BLUE", { colors: ["Blue"] }),
  WEAK: C("WEAK", { power: 10000 }),
  DEAR: C("DEAR", { energyCost: 9, power: 10000 }),
  PLAIN: C("PLAIN", { power: 30000 }),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
// A bare keyword line ("[Revive red/blue]") is the keyword's own program, which a stored row does not carry: that card's rules come from the compiler.
const ctx: EngineContext = { ...CTX, defs, scripts: { ...rulesFromRows(JSON.parse(JSON.stringify(rows)), defs), REVIVER: rulesFromCompiler(defs).REVIVER } };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");
const take = (s: VmState, action: Action): VmState => RULES.apply(ctx, roundtrip(s), action).state as VmState;
const SEATS: PlayerId[] = ["p1", "p2"];

/** A game at the Main Phase of `turn` (p1's third turn, or p2's after it). */
function game3(turn: PlayerId): VmState {
  let s = RULES.createGame(ctx, { seed: 2016, p1: { name: "First", leader: "L-RED", main: fifty("V1") }, p2: { name: "Second", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
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
  if (area === "battle") s.cards[id].mode = mode;
  return id;
}
function settle(s: VmState, pick: string[] = []): VmState {
  for (let i = 0; i < 40 && s.prompt.kind !== "main" && s.prompt.kind !== "gameOver"; i++) {
    const q = s.prompt;
    if (q.kind === "chooseCards") {
      const want = q.choice.candidates.filter((c) => pick.includes(c));
      s = take(s, { type: "choose", player: q.player, cards: want.length ? want.slice(0, q.choice.max ?? want.length) : q.choice.candidates.slice(0, q.choice.min) });
    } else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: q.player, index: 0 });
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
function activate(s: VmState, id: string, pick: string[] = []): VmState {
  const [a] = activations(s, id);
  assert.ok(a, `${s.cards[id].cardId} is offered`);
  return settle(take(s, a.action), pick);
}
function attacks(s: VmState, p: PlayerId): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const l of RULES.legalActions(ctx, s)) {
    const a = l.action;
    if (a.type !== "attack" || a.player !== p) continue;
    if (!out.has(a.attacker)) out.set(a.attacker, new Set());
    out.get(a.attacker)!.add(a.target);
  }
  return out;
}
const zoneOf = (s: VmState, id: string) => (["p1", "p2"] as PlayerId[]).flatMap((p) => Object.entries(s.sides[p].zones).filter(([, ids]) => ids.includes(id)).map(([z]) => z))[0];
const plays = (s: VmState) => RULES.legalActions(ctx, s).filter((l) => l.action.type === "play").map((l) => (l.action as { card: string }).card);
const leaderOf = (s: VmState, p: PlayerId) => s.sides[p].zones.leader[0];
/** Empty a pile into the Drop Area (a state fixture, not a game action). */
function empty(s: VmState, p: PlayerId, zone: string, keep = 0): void {
  for (const id of s.sides[p].zones[zone].slice(keep)) assert.ok(moveCard(s, game, id, "drop", { owner: p }).ok);
}

for (const me of SEATS) {
  const you = other(me);

  // Ruling 7 (DB2-156): played as a [Counter: Play] in the opponent's turn —
  // for the rest of that turn the opponent's skill returns no card of the
  // hand to the deck, one that entered the hand after the rule included; the
  // controller's own skill is not bound; next turn the rule is gone.
  {
    let s = game3(you);
    const counter = stage(s, me, "DB2_156", "hand");
    const played = stage(s, you, "WEAK", "hand");
    const ret = stage(s, you, "RETURN_THEIRS", "battle");
    s = roundtrip(take(s, { type: "play", player: you, card: played } as Action));
    assert.equal(s.prompt.kind, "counter", `${me}: the [Counter: Play] window opens`);
    s = roundtrip(settle(take(s, { type: "counter", player: me, card: counter })));
    // A card that enters the hand after the rule was made.
    const late = s.sides[me].zones.deck[0];
    assert.ok(moveCard(s, game, late, "hand", { owner: me }).ok);
    s = roundtrip(s);
    assert.ok(forbiddenBy(ctx, game, s, "beMovedBySkill", { player: you, card: late, from: "hand", to: "deck" }), `${me}: DB2-156 — a card drawn later is in the zone the rule protects`);
    assert.ok(!forbiddenBy(ctx, game, s, "beMovedBySkill", { player: me, card: late, from: "hand", to: "deck" }), `${me}: its controller's own skill is not bound`);
    assert.ok(!forbiddenBy(ctx, game, s, "beMovedBySkill", { player: you, card: late, from: "hand", to: "drop" }), `${me}: another destination is not this rule's`);
    assert.ok(!forbiddenBy(ctx, game, s, "beMovedBySkill", { player: me, card: s.sides[you].zones.hand[0], from: "hand", to: "deck" }), `${me}: the opponent's hand is not protected`);
    s = roundtrip(activate(s, ret, [late]));
    assert.equal(zoneOf(s, late), "hand", `${me}: DB2-156 — the opponent's skill does not return it to the deck`);
    s = roundtrip(endTurn(s));
    assert.ok(!forbiddenBy(ctx, game, s, "beMovedBySkill", { player: you, card: late, from: "hand", to: "deck" }), `${me}: the rule ends with the turn`);
    // Control: without the rule the same skill returns the card.
    let t = game3(you);
    const held = t.sides[me].zones.hand[0];
    t = roundtrip(activate(t, stage(t, you, "RETURN_THEIRS", "battle"), [held]));
    assert.equal(zoneOf(t, held), "deck", `${me}: without the rule it is returned (control)`);
  }

  // Ruling 8: the opponent's skill's KO is redirected (removed from the game);
  // the controller's own KO and the battle's KO are not.
  {
    let s = game3(you);
    const warded = stage(s, me, "WARDED", "battle");
    s = roundtrip(activate(s, stage(s, you, "KO_THEIRS", "battle"), [warded]));
    assert.equal(zoneOf(s, warded), "removed", `${me}: ruling 8 — the opponent's skill's KO is replaced`);
    let t = game3(me);
    const own = stage(t, me, "WARDED", "battle");
    t = roundtrip(activate(t, stage(t, me, "KO_MINE", "battle"), [own]));
    assert.equal(zoneOf(t, own), "drop", `${me}: its controller's KO is not`);
    let u = game3(you);
    const fought = stage(u, me, "WARDED", "battle", "rest");
    const atk = stage(u, you, "PLAIN", "battle");
    u = roundtrip(settle(take(u, { type: "attack", player: you, attacker: atk, target: fought })));
    assert.equal(zoneOf(u, fought), "drop", `${me}: nor the battle's KO`);
  }

  // Ruling 9: the declared play from the hand is offered; another card's skill
  // does not play it; its own [Revive] does.
  {
    let s = game3(me);
    const rev = stage(s, me, "REVIVER", "hand");
    const player = stage(s, me, "PLAYER", "battle");
    s = roundtrip(s);
    assert.ok(plays(s).includes(rev), `${me}: ruling 9 — the declared play from the hand is allowed`);
    s = roundtrip(activate(s, player, [rev]));
    assert.equal(zoneOf(s, rev), "hand", `${me}: another card's skill does not play it`);
    let t = game3(you);
    const back = stage(t, me, "REVIVER", "battle");
    const red = stage(t, me, "V1", "hand");
    const blue = stage(t, me, "V-BLUE", "hand");
    t = roundtrip(activate(t, stage(t, you, "KO_THEIRS", "battle"), [back, red, blue]));
    assert.equal(zoneOf(t, back), "battle", `${me}: [Revive] plays it back from the Drop`);
    assert.ok(zoneOf(t, red) === "drop" && zoneOf(t, blue) === "drop", `${me}: the [Revive] cost was paid`);
  }

  // BT14-076: while it rests, an attack on the Leader costs 2 cards of the
  // attacker's hand; an attack on a Battle Card costs nothing; with fewer than
  // 2 cards the Leader is not offered as a target.
  {
    let s = game3(you);
    stage(s, me, "BT14_076", "battle", "rest");
    const rested = stage(s, me, "V1", "battle", "rest");
    const atk = stage(s, you, "PLAIN", "battle");
    const atk2 = stage(s, you, "PLAIN", "battle");
    s = roundtrip(s);
    assert.ok(attacks(s, you).get(atk)?.has(leaderOf(s, me)), `${me}: the Leader is offered while the price can be paid`);
    const hand = s.sides[you].zones.hand.length;
    let a = roundtrip(settle(take(s, { type: "attack", player: you, attacker: atk, target: leaderOf(s, me) })));
    assert.equal(a.sides[you].zones.hand.length, hand - 2, `${me}: BT14-076 — 2 cards discarded to attack the Leader`);
    a = roundtrip(settle(take(a, { type: "attack", player: you, attacker: atk2, target: rested })));
    assert.equal(a.sides[you].zones.hand.length, hand - 2, `${me}: an attack on a Battle Card costs nothing`);
    const poor = roundtrip(s);
    empty(poor, you, "hand", 1);
    const m = attacks(roundtrip(poor), you);
    assert.ok(!m.get(atk)?.has(leaderOf(poor, me)) && m.get(atk)?.has(rested), `${me}: with 1 card the Leader is not offered, the rested card is`);
    assert.throws(() => take(poor, { type: "attack", player: you, attacker: atk, target: leaderOf(poor, me) }), `${me}: and a forced attack on it is refused`);
    const active = roundtrip(poor);
    active.cards[active.sides[me].zones.battle.find((id) => active.cards[id].cardId === "BT14_076")!].mode = "active";
    assert.ok(attacks(roundtrip(active), you).get(atk)?.has(leaderOf(active, me)), `${me}: in Active Mode the rule is off (control)`);
  }

  // P-299: an attacker whose cost is at least its controller's energy does not attack the Leader; a cheaper one does.
  {
    const s = game3(you);
    stage(s, me, "P299", "battle", "rest");
    while (s.sides[you].zones.energy.length < 1) stage(s, you, "V1", "energy");
    const dear = stage(s, you, "DEAR", "battle");
    const cheap = stage(s, you, "PLAIN", "battle");
    const m = attacks(roundtrip(s), you);
    assert.ok(!m.get(dear)?.has(leaderOf(s, me)), `${me}: P-299 — cost 9 against ${s.sides[you].zones.energy.length} energy: no attack on the Leader`);
    assert.ok(m.get(cheap)?.has(leaderOf(s, me)), `${me}: cost 0: allowed`);
    const rich = roundtrip(s);
    for (let i = 0; i < 9; i++) stage(rich, you, "V1", "energy");
    assert.ok(attacks(roundtrip(rich), you).get(dear)?.has(leaderOf(rich, me)), `${me}: with more energy than its cost it may (the measure is live)`);
  }

  // BT6-017: each player pays 4 life to play a Battle Card with 30000 power or less; a bigger one is free.
  for (const turn of [me, you]) {
    const s = game3(turn);
    stage(s, me, "BT6_017", "battle");
    const small = stage(s, turn, "WEAK", "hand");
    const big = stage(s, turn, "BT6_017", "hand");
    const r = roundtrip(s);
    const life = r.sides[turn].zones.life.length;
    assert.ok(plays(r).includes(small) && plays(r).includes(big), `${me}/${turn}: both offered`);
    const a = roundtrip(settle(take(r, { type: "play", player: turn, card: small } as Action)));
    assert.equal(a.sides[turn].zones.life.length, life - 4, `${me}/${turn}: BT6-017 — 4 life for a 10000 card`);
    assert.equal(zoneOf(a, small), "battle");
    const b = roundtrip(settle(take(a, { type: "play", player: turn, card: big } as Action)));
    assert.equal(b.sides[turn].zones.life.length, life - 4, `${me}/${turn}: a 40000 card is free`);
    const poor = roundtrip(s);
    empty(poor, turn, "life", 3);
    assert.ok(!plays(roundtrip(poor)).includes(small), `${me}/${turn}: with 3 life it is not offered`);
  }

  // BT6-054: during its controller's turn only its own skill adds life to the hand; in the opponent's turn the rule is off.
  {
    let s = game3(me);
    const src = stage(s, me, "BT6_054", "battle");
    const adder = stage(s, me, "LIFE_ADD", "battle");
    const life = s.sides[me].zones.life.length;
    s = roundtrip(activate(s, adder));
    assert.equal(s.sides[me].zones.life.length, life, `${me}: BT6-054 — another card's skill adds no life card`);
    s = roundtrip(activate(s, src));
    assert.equal(s.sides[me].zones.life.length, life - 1, `${me}: its own skill does`);
    const t = game3(you);
    stage(t, me, "BT6_054", "battle");
    assert.ok(!forbiddenBy(ctx, game, roundtrip(t), "addLifeToHand", { player: me }), `${me}: not during the opponent's turn`);
  }

  // DB3-092: while it rests, the opponent's Battle Card's search adds nothing; in Active Mode it does.
  for (const mode of ["rest", "active"] as const) {
    let s = game3(you);
    stage(s, me, "DB3_092", "battle", mode);
    const searcher = stage(s, you, "SEARCH", "battle");
    const hand = s.sides[you].zones.hand.length;
    const wanted = s.sides[you].zones.deck[3];
    s = roundtrip(activate(s, searcher, [wanted]));
    assert.equal(s.sides[you].zones.hand.length, mode === "rest" ? hand : hand + 1, `${me}: DB3-092 in ${mode} mode`);
    if (mode === "rest") assert.ok(!forbiddenBy(ctx, game, s, "beMovedBySkill", { player: you, card: wanted, from: "deck", to: "hand", source: leaderOf(s, you) }), `${me}: a Leader's skill may still search`);
  }

  // BT18-019: while it is in a battle the opponent activates no non-[Super Combo] skill; a [Super Combo] card's they may; out of battle, anything.
  {
    let s = game3(me);
    const atk = stage(s, me, "BT18_019", "battle");
    const act = stage(s, you, "ACT", "battle");
    const sup = stage(s, you, "SUPER", "battle");
    assert.ok(!forbiddenBy(ctx, game, roundtrip(s), "activateSkill", { player: you, card: act, skillKind: "activate:main" }), `${me}: not in a battle: allowed`);
    s = roundtrip(take(s, { type: "attack", player: me, attacker: atk, target: leaderOf(s, you) }));
    assert.ok(s.battle, `${me}: in a battle`);
    assert.ok(forbiddenBy(ctx, game, s, "activateSkill", { player: you, card: act, skillKind: "activate:main" }), `${me}: BT18-019 — a card with no [Super Combo]`);
    assert.ok(!forbiddenBy(ctx, game, s, "activateSkill", { player: you, card: sup, skillKind: "activate:main" }), `${me}: a [Super Combo] card is not bound`);
    assert.ok(!forbiddenBy(ctx, game, s, "activateSkill", { player: me, card: atk, skillKind: "activate:main" }), `${me}: its controller is not bound`);
  }

  // BT8-040: a red card's skill places nothing under it; a blue card's may.
  {
    const s = roundtrip(game3(me));
    const host = stage(s, me, "BT8_040", "battle");
    const red = stage(s, me, "V1", "battle");
    const blue = stage(s, me, "BLUE", "battle");
    assert.ok(forbiddenBy(ctx, game, roundtrip(s), "placeUnder", { player: me, card: host, source: red }), `${me}: BT8-040 — a red card's skill may not`);
    assert.ok(!forbiddenBy(ctx, game, roundtrip(s), "placeUnder", { player: me, card: host, source: blue }), `${me}: a blue card's may`);
  }

  // P-032: with no life left, the game goes on through the turn; it ends at the next check after the turn.
  {
    let s = game3(me);
    const src = stage(s, me, "P032", "battle");
    s = roundtrip(activate(s, src));
    empty(s, me, "life");
    s = roundtrip(activate(s, stage(s, me, "ACT", "battle")));
    assert.equal(s.prompt.kind, "main", `${me}: P-032 — no life, and the game is not over this turn`);
    assert.equal(s.winner ?? null, null);
    s = roundtrip(settle(take(s, { type: "endMain", player: me })));
    assert.equal(s.winner, you, `${me}: once the turn is over, the loss stands`);
    // Control: without the rule the loss is immediate.
    let t = game3(me);
    empty(t, me, "life");
    t = roundtrip(settle(take(t, { type: "activate", player: me, card: stage(t, me, "ACT", "battle"), skill: 0 } as Action)));
    assert.equal(t.winner, you, `${me}: without the rule the player loses at once (control)`);
  }
}
console.log("prohibition catalog 3: owner rulings 7–9 (the hand as a zone, a skill's KO under a removal replacement, [Revive]'s play), prices on defenders, the attacker's cost against its energy, play taxes, life, searches, activations in a battle, placing under, the game's end — read, and enforced from both seats");
