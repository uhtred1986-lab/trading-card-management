/**
 * The prohibition catalog, batch 4 (20-14, 20-14-1, 0-2-5) — the same `forbid`
 * machinery as `prohibition-catalog.ts` … `prohibition-catalog-3.ts`, with the
 * owner's rulings A2, A4 and A9 of 26 Oct 2026, the describer fix (B) and the
 * next groups of the catalog's unread prohibitions:
 *
 * - A2: "can't activate skills" also stops [Blocker] (22-4: a [Blocker] is
 *   activated) — BT18-019, BT14-097, P-093 (which takes [Counter] lines too)
 *   and a card's own "it can't activate skills" (BT9-071, BT31-111);
 * - A4: a play tax (BT6-017, BT6-023) binds a skill's play too: the card is
 *   played only once its price is paid (20-14-1);
 * - A9: a bare "would be removed from a Battle Area, … instead" answers every
 *   KO, the battle's included (`skillOrKo`); "…placed in its owner's Drop Area
 *   by one of your skills" (BT12-056) answers that player's skill's KO
 *   (5-12-1, `skillOrKoBySkill`, `bySide: you`);
 * - B: the reading of a skill's move, KO, switch or choice says the cards as
 *   its subject and whose skills they are (DB3-092, BT9-077, DB2-156 …);
 * - evolve-into and on-top bans (BT8-009, DB2-131, BT1-111, BT25-131:
 *   `evolveOnto`, `placeOnTop`); "this card in your Energy Area" (BT18-052);
 *   moves into the energy by a described card's skill (BT17-032, `fromArea:
 *   any`); a named card's skill on the opponent's hand (TB2-045); discards by
 *   a described Leader's skill (P-270); a described defender (BT24-101).
 *
 * Part 1 reads one printed card per group (and the reading text); part 2 plays
 * the actions on the VM from **both seats**, with a JSON reload of the state
 * between steps.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { forbiddenBy } from "../../src/lib/arena/vm/program";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { Op } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";

// ── 1. readings ──────────────────────────────────────────────────────────────

const compact = (_k: string, v: unknown) => (v === null || v === false || (Array.isArray(v) && v.length === 0) ? undefined : v);
function record(text: string, index = 0) {
  const rec = skillRecords({ ...DEFS.V1, id: "X", skill: text } as CardDef)[index];
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
  }
  return out;
}
const SELF = { sel: { special: "self" } };

// A2: [Blocker] is a skill that is activated.
{
  const p093 = "[Auto] When a card evolves into this card, your opponent can't activate skills on Battle Cards for the duration of the turn.";
  assert.deepEqual(forbids(ops(p093)).map((f) => [f.what, f.side, f.filter]), [
    ["activateSkill", "opponent", { type: "BATTLE" }],
    ["activateCounter", "opponent", { type: "BATTLE" }],
    ["block", "opponent", { type: "BATTLE" }],
  ], "P-093: [Activate]/[Auto], [Counter] and [Blocker] of Battle Cards");
  assert.match(reads(p093), /your opponent can't activate \[Blocker\] on Battle Cards for the turn/, "P-093's reading names the [Blocker]");
  assert.deepEqual(forbids(ops("[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards and it can't attack or activate skills for the duration of the turn.")).map((f) => f.what), ["attack", "activateSkill", "block"], "BT9-071: the card's own [Blocker] too");
  assert.deepEqual(forbids(ops("[Activate: Main] Draw 1 card, then choose up to 1 of your opponent's Battle Cards, ignoring [barrier], and until the end of your opponent's turn, that card can't attack and your opponent can't activate its skills.")).map((f) => [f.what, f.until]), [["attack", "nextTurn"], ["activateSkill", "nextTurn"], ["block", "nextTurn"]], "BT31-111: for the same span");
  assert.match(reads("[Activate: Main] This card gains [Dual Attack] for the turn, and your opponent can't activate skills on Battle Cards with original energy costs of 7 or less from any area when this card is in a battle."), /only while this card is in a battle/, "BT14-097: the escape said the way the card says it");
}
// A9: the replacement's cause.
{
  assert.equal((ops("[Permanent] If this card would be removed from a Battle Area, remove it from the game instead.")[0] as { by?: string }).by, "skillOrKo", "a bare removal: every removal by a skill and every KO");
  assert.equal((ops("[Permanent] If this card is removed from your Battle Area, remove it from the game instead.")[0] as { by?: string }).by, "skillOrKo", "the accomplished form (BT15-153) likewise");
  const bt12 = ops("[Permanent] If a ≪Turles Crusher Corps≫ card in your Battle Area would be placed in its owner's Drop Area by one of your skills, it's sent to its owner's Warp instead.")[0] as { by?: string; bySide?: string };
  assert.deepEqual([bt12.by, bt12.bySide], ["skillOrKoBySkill", "you"], "BT12-056: a skill of yours, its KO included");
  assert.match(reads("[Permanent] If a ≪Turles Crusher Corps≫ card in your Battle Area would be placed in its owner's Drop Area by one of your skills, it's sent to its owner's Warp instead."), /removed from the Battle Area or KO'd by one of your skills/);
  assert.equal((ops("[Permanent] If this card would be removed from a Battle Area by your opponent's skill, remove it from the game instead.")[0] as { bySide?: string }).bySide, "opponent", "the opponent's form is unchanged");
}
// B: the reading says whose skills, with the cards as the subject.
{
  const say = (text: string) => reads(text);
  assert.equal(say("[Permanent] When this card is in Rest Mode, your opponent can't add cards from their deck to their hand using non-Leader Card skills."), "if this card is in rest mode: your opponent can't add cards from their deck to their hand with the skills of Battle, Extra or Unison Cards", "DB3-092");
  assert.equal(say("[Permanent] When this card is in Rest Mode, your opponent can't use non-Leader Card skills to add cards from their deck to their hand."), "if this card is in rest mode: your opponent can't add cards from their deck to their hand with the skills of Battle, Extra or Unison Cards", "BT9-077");
  assert.match(say("[Counter: Play] Play this card, draw 1 card, and cards in your hand can't be returned to your deck by your opponent's skills for the turn."), /cards in your hand can't be returned to the deck by your opponent's skills for the turn$/, "DB2-156");
  assert.equal(say("[Permanent] This card can't be removed from your Battle Area by your opponent's skills."), "this card can't be removed from a Battle Area by your opponent's skills, this card can't be KO'd by your opponent's skills", "BT9-077's first line: whose skills is said");
  assert.equal(say("[Permanent] This card can't be returned to your hand by your skills."), "this card can't be returned to the hand by your skills", "DB2-040");
  assert.equal(say("[Permanent] This card can't be removed from Battle Areas by the skills of your opponent's Battle Cards."), "this card can't be removed from a Battle Area by the skills of your opponent's Battle Cards, this card can't be KO'd by the skills of your opponent's Battle Cards", "BT10-058");
  assert.equal(say("[permanent] Your Battle Cards can't be placed at the bottom of their owner's deck by your opponent's skills."), "all Battle Cards in your Battle Area can't be placed at the bottom of the deck by your opponent's skills", "P-672");
  assert.match(say("[Permanent] You and your opponent can't play Battle Cards with 30000 power or less unless they choose 4 cards from their life and place them in their Drop Area as they play the Battle Card."), /other than the card being played/, "a play price's \"other than\" is the card being played");
  for (const text of ["[Permanent] When this card is in Rest Mode, your opponent can't add cards from their deck to their hand using non-Leader Card skills.", "[Counter: Play] Play this card, draw 1 card, and cards in your hand can't be returned to your deck by your opponent's skills for the turn."])
    assert.doesNotMatch(say(text), /your opponent can't be removed|only cards in/, `no player is "removed": ${text}`);
}
// Evolve-into and on-top bans, the Energy Area, moves into the energy, named and described skills, a described defender.
{
  assert.deepEqual(forbids(ops("[Permanent] This card can't [Evolve] into other cards.")), [{ op: "forbid", what: "evolveOnto", until: "game", target: SELF }], "BT8-009");
  assert.deepEqual(forbids(ops("[Permanent] Only 1 copy of this card can be played in your Battle Area, and this card can't [evolve] into other cards.")).map((f) => f.what), ["play", "evolveOnto"], "DB2-131");
  assert.deepEqual(forbids(ops("[Permanent] You can't place cards on top of this card.")), [{ op: "forbid", what: "placeOnTop", side: "you", until: "game", target: SELF }], "BT1-111, BT25-131");
  assert.deepEqual(forbids(ops("[permanent] You can't switch this card in your Energy Area to Active Mode.")), [{ op: "forbid", what: "switchToActive", until: "game", target: SELF, fromArea: "energy" }], "BT18-052");
  assert.equal(reads("[permanent] You can't switch this card in your Energy Area to Active Mode."), "this card can't switch to Active Mode while in the Energy Area");
  const bt17 = forbids(ops("[Permanent] You can't use non-≪Red Ribbon Army≫ card skills to place cards in your energy."))[0];
  assert.deepEqual([bt17.what, bt17.side, bt17.cardsOf, bt17.fromArea, bt17.toArea, bt17.byFilter?.notTraits], ["beMovedBySkill", "you", "you", "any", "energy", ["red ribbon army"]], "BT17-032");
  const tb2 = forbids(ops("[Auto] When you play this card, draw 1 card. You cannot place your opponent's hand in their Drop Area using {Destined Conclusion Hero}'s skill for the duration of the turn."))[0];
  assert.deepEqual([tb2.what, tb2.side, tb2.until, tb2.cardsOf, tb2.fromArea, tb2.toArea, tb2.byFilter?.names], ["beMovedBySkill", "you", "turn", "opponent", "hand", "drop", ["destined conclusion hero"]], "TB2-045");
  const p270 = forbids(ops("[permanent] Cards in your hand can't be discarded by your green <Broly> Leader Card skills."))[0];
  assert.deepEqual([p270.what, p270.side, p270.fromArea, p270.toArea, p270.byFilter?.type, p270.byFilter?.colors, p270.byFilter?.characters], ["beMovedBySkill", "you", "hand", "drop", "LEADER", ["Green"], ["broly"]], "P-270");
  assert.match(reads("[permanent] Cards in your hand can't be discarded by your green <Broly> Leader Card skills."), /can't be placed in the Drop Area by the skills of your green <broly> Leader Cards/);
  const bt24 = forbids(ops("[Permanent] If this card is in Rest Mode, your opponent's Battle Cards and Unisons can't attack your yellow Z-Unisons."))[0];
  assert.deepEqual([bt24.what, bt24.attackTarget?.type, bt24.attackTarget?.colors, bt24.attackTarget?.z], ["attack", "UNISON", ["Yellow"], true], "BT24-101: the described defender");
}

// ── 2. the VM, from both seats ───────────────────────────────────────────────

const C = (id: string, o: Partial<CardDef>) => card(id, { energyCost: 0, comboCost: 0, ...o });
const defs: Record<string, CardDef> = {
  ...DEFS,
  P093: C("P093", { skill: "[Activate: Main] Your opponent can't activate skills on Battle Cards for the duration of the turn." }),
  SEAL: C("SEAL", { skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and it can't activate skills for the duration of the turn." }),
  GUARD: C("GUARD", { skill: "[Blocker]" }),
  BT6_017: C("BT6_017", { power: 40000, skill: "[Permanent] You and your opponent can't play Battle Cards with 30000 power or less unless they choose 4 cards from their life and place them in their Drop Area as they play the Battle Card." }),
  PLAYER: C("PLAYER", { skill: "[Activate: Main] Choose up to 1 Battle Card in your hand and play it." }),
  WEAK: C("WEAK", { power: 10000 }),
  BIG: C("BIG", { power: 40000 }),
  BARE: C("BARE", { power: 5000, skill: "[Permanent] If this card would be removed from a Battle Area, remove it from the game instead." }),
  TCC_LEAD: C("TCC_LEAD", { skill: "[Permanent] If a ≪Turles Crusher Corps≫ card in your Battle Area would be placed in its owner's Drop Area by one of your skills, it's sent to its owner's Warp instead." }),
  TCC: C("TCC", { traits: ["Turles Crusher Corps"] }),
  PLAIN: C("PLAIN", { power: 30000 }),
  KO_THEIRS: C("KO_THEIRS", { skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and KO it." }),
  KO_MINE: C("KO_MINE", { skill: "[Activate: Main] Choose up to 1 of your Battle Cards and KO it." }),
  EVO: C("EVO", { energyCost: 1, characters: ["Baby"], skill: "[Evolve] {R}: <Baby>" }),
  BABY: C("BABY", { characters: ["Baby"] }),
  BT8_009: C("BT8_009", { characters: ["Baby"], skill: "[Permanent] This card can't [Evolve] into other cards." }),
  BT1_111: C("BT1_111", { characters: ["Baby"], skill: "[Permanent] You can't place cards on top of this card." }),
  BT18_052: C("BT18_052", { skill: "[permanent] You can't switch this card in your Energy Area to Active Mode." }),
  BT17_032: C("BT17_032", { skill: "[Permanent] You can't use non-≪Red Ribbon Army≫ card skills to place cards in your energy." }),
  CHARGER: C("CHARGER", { skill: "[Activate: Main] Place the top card of your deck in your energy." }),
  RRA_CHARGER: C("RRA_CHARGER", { traits: ["Red Ribbon Army"], skill: "[Activate: Main] Place the top card of your deck in your energy." }),
  TB2_045: C("TB2_045", { skill: "[Activate: Main] You cannot place your opponent's hand in their Drop Area using {HERO}'s skill for the duration of the turn." }),
  HERO: C("HERO", { skill: "[Activate: Main] Choose 1 card in your opponent's hand and discard it." }),
  NOT_HERO: C("NOT_HERO", { skill: "[Activate: Main] Choose 1 card in your opponent's hand and discard it." }),
  P270: C("P270", { skill: "[permanent] Cards in your hand can't be discarded by your green <Broly> Leader Card skills." }),
  "L-BROLY": card("L-BROLY", { type: "LEADER", colors: ["Green"], characters: ["Broly"], energyCost: null, comboCost: null, comboPower: null }),
  "L-OTHER": card("L-OTHER", { type: "LEADER", colors: ["Green"], characters: ["Goku"], energyCost: null, comboCost: null, comboPower: null }),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(JSON.parse(JSON.stringify(rows)), defs) };
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
  if (area === "battle" || area === "energy") s.cards[id].mode = mode;
  return id;
}
/** Answer every prompt up to the next Main Phase; `mode` answers a "choose one" (0 = pay / do it). */
function settle(s: VmState, pick: string[] = [], mode = 0): VmState {
  for (let i = 0; i < 40 && s.prompt.kind !== "main" && s.prompt.kind !== "gameOver"; i++) {
    const q = s.prompt;
    if (q.kind === "chooseCards") {
      const want = q.choice.candidates.filter((c) => pick.includes(c));
      s = take(s, { type: "choose", player: q.player, cards: want.length ? want.slice(0, q.choice.max ?? want.length) : q.choice.candidates.slice(0, q.choice.min) });
    } else if (q.kind === "chooseMode") s = take(s, { type: "chooseMode", player: q.player, index: mode } as Action);
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
/** Empty a pile into the Drop Area (a state fixture, not a game action). */
function empty(s: VmState, p: PlayerId, zone: string, keep = 0): void {
  for (const id of s.sides[p].zones[zone].slice(keep)) assert.ok(moveCard(s, game, id, "drop", { owner: p }).ok);
}
/** Declare an attack on the Leader and say whether `guard` is offered as a blocker. */
function canBlock(s: VmState, attacker: string, guard: string): boolean {
  const p = (s.prompt as { player: PlayerId }).player;
  const t = roundtrip(take(s, { type: "attack", player: p, attacker, target: leaderOf(s, other(p)) }));
  return t.prompt.kind === "blocker" && (t.prompt as { candidates: string[] }).candidates.includes(guard);
}

for (const me of SEATS) {
  const you = other(me);

  // A2: under P-093 the opponent's Battle Card does not block; under "it can't
  // activate skills" the chosen card does not; without either it does.
  {
    let s = game3(me);
    const atk = stage(s, me, "PLAIN", "battle");
    const guard = stage(s, you, "GUARD", "battle");
    assert.ok(canBlock(roundtrip(s), atk, guard), `${me}: [Blocker] offered without the rule (control)`);
    s = roundtrip(activate(s, stage(s, me, "P093", "battle")));
    assert.ok(!canBlock(s, atk, guard), `${me}: A2 — P-093: no [Blocker] of a Battle Card`);
    assert.ok(forbiddenBy(ctx, game, s, "activateCounter", { player: you, card: stage(s, you, "V-BLUE", "hand"), skillKind: "counter:attack" }), `${me}: P-093 — a Battle Card's [Counter] too`);
    assert.ok(!forbiddenBy(ctx, game, s, "block", { player: me, card: atk }), `${me}: its controller is not bound`);
    s = roundtrip(endTurn(s));
    assert.ok(!forbiddenBy(ctx, game, s, "block", { player: you, card: guard }), `${me}: gone with the turn`);
    let t = game3(me);
    const atk2 = stage(t, me, "PLAIN", "battle");
    const g2 = stage(t, you, "GUARD", "battle");
    const g3 = stage(t, you, "GUARD", "battle");
    t = roundtrip(activate(t, stage(t, me, "SEAL", "battle"), [g2]));
    assert.ok(!canBlock(t, atk2, g2), `${me}: A2 — "it can't activate skills": the chosen card does not block`);
    assert.ok(canBlock(t, atk2, g3), `${me}: another [Blocker] still does`);
  }

  // A4: a skill's play of a taxed card asks the price; paid, the card is
  // played; declined or unpayable, it stays in the hand; an untaxed card is free.
  for (const turn of [me, you]) {
    const s = game3(turn);
    stage(s, me, "BT6_017", "battle");
    const player = stage(s, turn, "PLAYER", "battle");
    const small = stage(s, turn, "WEAK", "hand");
    const big = stage(s, turn, "BIG", "hand");
    const r = roundtrip(s);
    const life = r.sides[turn].zones.life.length;
    const asked = roundtrip(take(r, activations(r, player)[0].action));
    const chose = asked.prompt.kind === "chooseCards" ? roundtrip(take(asked, { type: "choose", player: turn, cards: [small] })) : asked;
    assert.equal(chose.prompt.kind, "chooseMode", `${me}/${turn}: A4 — the skill's play asks the price`);
    const paid = roundtrip(settle(chose, [], 0));
    assert.equal(zoneOf(paid, small), "battle", `${me}/${turn}: paid — played`);
    assert.equal(paid.sides[turn].zones.life.length, life - 4, `${me}/${turn}: 4 life paid`);
    const declined = roundtrip(settle(chose, [], 1));
    assert.equal(zoneOf(declined, small), "hand", `${me}/${turn}: declined — not played`);
    assert.equal(declined.sides[turn].zones.life.length, life, `${me}/${turn}: nothing paid`);
    const free = roundtrip(activate(r, player, [big]));
    assert.equal(zoneOf(free, big), "battle", `${me}/${turn}: a 40000 card is played free`);
    assert.equal(free.sides[turn].zones.life.length, life);
    const poor = roundtrip(r);
    empty(poor, turn, "life", 3);
    const p2 = roundtrip(activate(roundtrip(poor), player, [small]));
    assert.equal(zoneOf(p2, small), "hand", `${me}/${turn}: with 3 life it can't be paid, and is not played`);
    assert.equal(p2.sides[turn].zones.life.length, 3);
  }

  // A9: the bare removal answers the battle's KO and a skill's; BT12-056 its
  // own player's skill's KO, not the opponent's, not the battle's.
  {
    let s = game3(you);
    const bare = stage(s, me, "BARE", "battle", "rest");
    s = roundtrip(settle(take(s, { type: "attack", player: you, attacker: stage(s, you, "PLAIN", "battle"), target: bare })));
    assert.equal(zoneOf(s, bare), "removed", `${me}: A9 — the battle's KO is answered`);
    let t = game3(you);
    const bare2 = stage(t, me, "BARE", "battle");
    t = roundtrip(activate(t, stage(t, you, "KO_THEIRS", "battle"), [bare2]));
    assert.equal(zoneOf(t, bare2), "removed", `${me}: a skill's KO too`);
    let u = game3(me);
    stage(u, me, "TCC_LEAD", "battle");
    const tcc = stage(u, me, "TCC", "battle");
    u = roundtrip(activate(u, stage(u, me, "KO_MINE", "battle"), [tcc]));
    assert.equal(zoneOf(u, tcc), "warp", `${me}: A9 — BT12-056: my skill's KO goes to the Warp`);
    let v = game3(you);
    stage(v, me, "TCC_LEAD", "battle");
    const tcc2 = stage(v, me, "TCC", "battle");
    v = roundtrip(activate(v, stage(v, you, "KO_THEIRS", "battle"), [tcc2]));
    assert.equal(zoneOf(v, tcc2), "drop", `${me}: the opponent's skill's KO is not "one of your skills"`);
    let w = game3(you);
    stage(w, me, "TCC_LEAD", "battle");
    const tcc3 = stage(w, me, "TCC", "battle", "rest");
    w = roundtrip(settle(take(w, { type: "attack", player: you, attacker: stage(w, you, "PLAIN", "battle"), target: tcc3 })));
    assert.equal(zoneOf(w, tcc3), "drop", `${me}: nor the battle's KO`);
  }

  // BT8-009 / BT1-111: no evolution onto such a card — not offered, no price paid; onto another base it is.
  for (const banned of ["BT8_009", "BT1_111"]) {
    const s = game3(me);
    const evo = stage(s, me, "EVO", "hand");
    const base = stage(s, me, banned, "battle");
    for (let i = 0; i < 2; i++) stage(s, me, "V1", "energy");
    const offered = (t: VmState) => RULES.legalActions(ctx, roundtrip(t)).some((l) => l.action.type === "activate" && l.action.card === evo);
    assert.ok(!offered(s), `${me}: ${banned} — no [Evolve] onto it`);
    const t = roundtrip(s);
    t.cards[base].cardId = "BABY";
    assert.ok(offered(t), `${me}: an ordinary base is offered (control)`);
  }

  // BT18-052: in the Energy Area it stays in Rest Mode through its Charge Phase; another rested energy stands up.
  {
    let s = game3(you);
    const locked = stage(s, me, "BT18_052", "energy", "rest");
    const plain = stage(s, me, "V1", "energy", "rest");
    s = roundtrip(endTurn(s));
    assert.equal(s.cards[locked].mode, "rest", `${me}: BT18-052 — not switched to Active in the Charge Phase`);
    assert.equal(s.cards[plain].mode, "active", `${me}: another energy is (control)`);
    const inPlay = roundtrip(s);
    const there = stage(inPlay, me, "BT18_052", "battle", "rest");
    assert.ok(!forbiddenBy(ctx, game, inPlay, "switchToActive", { card: there }) && !forbiddenBy(ctx, game, roundtrip(inPlay), "switchToActive", { card: there, player: me }), `${me}: in the Battle Area the rule is not in force`);
  }

  // BT17-032: a non-≪Red Ribbon Army≫ card's skill places nothing in its controller's energy; an ≪RRA≫ card's does; the opponent is not bound.
  {
    let s = game3(me);
    stage(s, me, "BT17_032", "battle");
    const energy = s.sides[me].zones.energy.length;
    s = roundtrip(activate(s, stage(s, me, "CHARGER", "battle")));
    assert.equal(s.sides[me].zones.energy.length, energy, `${me}: BT17-032 — a non-RRA card's skill places no energy`);
    s = roundtrip(activate(s, stage(s, me, "RRA_CHARGER", "battle")));
    assert.equal(s.sides[me].zones.energy.length, energy + 1, `${me}: an RRA card's skill does`);
    let t = game3(you);
    stage(t, me, "BT17_032", "battle");
    const theirs = t.sides[you].zones.energy.length;
    t = roundtrip(activate(t, stage(t, you, "CHARGER", "battle")));
    assert.equal(t.sides[you].zones.energy.length, theirs + 1, `${me}: the opponent is not bound`);
  }

  // TB2-045: for the turn {HERO}'s skill discards nothing from the opponent's hand; another card's skill does.
  {
    let s = game3(me);
    s = roundtrip(activate(s, stage(s, me, "TB2_045", "battle")));
    const hand = s.sides[you].zones.hand.length;
    s = roundtrip(activate(s, stage(s, me, "HERO", "battle"), [s.sides[you].zones.hand[0]]));
    assert.equal(s.sides[you].zones.hand.length, hand, `${me}: TB2-045 — {HERO}'s skill discards nothing`);
    s = roundtrip(activate(s, stage(s, me, "NOT_HERO", "battle"), [s.sides[you].zones.hand[0]]));
    assert.equal(s.sides[you].zones.hand.length, hand - 1, `${me}: another card's skill does`);
    s = roundtrip(endTurn(s));
    assert.ok(!forbiddenBy(ctx, game, s, "beMovedBySkill", { player: me, card: s.sides[you].zones.hand[0], from: "hand", to: "drop" }), `${me}: gone with the turn`);
  }

  // P-270: a green <Broly> Leader's skill discards no card of that hand; another Leader's, a Battle Card's and the opponent's may.
  {
    const s = game3(me);
    stage(s, me, "P270", "battle");
    const held = s.sides[me].zones.hand[0];
    s.cards[leaderOf(s, me)].cardId = "L-BROLY";
    const r = roundtrip(s);
    assert.ok(forbiddenBy(ctx, game, r, "beMovedBySkill", { player: me, card: held, from: "hand", to: "drop", source: leaderOf(r, me) }), `${me}: P-270 — a green <Broly> Leader's skill`);
    assert.ok(!forbiddenBy(ctx, game, r, "beMovedBySkill", { player: me, card: held, from: "hand", to: "deck", source: leaderOf(r, me) }), `${me}: another destination is not this rule's`);
    assert.ok(!forbiddenBy(ctx, game, r, "beMovedBySkill", { player: you, card: held, from: "hand", to: "drop", source: leaderOf(r, you) }), `${me}: the opponent's skill is not bound`);
    const t = roundtrip(s);
    t.cards[leaderOf(t, me)].cardId = "L-OTHER";
    assert.ok(!forbiddenBy(ctx, game, roundtrip(t), "beMovedBySkill", { player: me, card: held, from: "hand", to: "drop", source: leaderOf(t, me) }), `${me}: a Leader the description does not fit (control)`);
  }
}
console.log("prohibition catalog 4: owner rulings A2 ([Blocker] is a skill activation), A4 (a skill's play pays the play tax), A9 (the removal replacement's cause), the reading of whose skills (B), evolve-into and on-top bans, the Energy Area, moves into the energy, named and described skills, a described defender — read, and enforced from both seats");
