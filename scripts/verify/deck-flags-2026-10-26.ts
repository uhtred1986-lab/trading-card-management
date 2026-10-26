/**
 * Deck flags of 26 Oct 2026: the review flags on the owner's deck cards, each
 * compiled from its printed text with the current compiler (`skillRecords`),
 * then played from stored-row JSON (`rulesFromRows`) in the rules engine with
 * the card's master in either seat and every action reloaded from JSON.
 *
 * Fixed here (record + VM unless said):
 *  - SD13-04 f0 "…add up to 1 green Unison Card … or 1 green ≪Frieza's Army≫
 *    card … among them": a type noun in a pooled choice ("Unison Card", "Battle
 *    Card") is not an area — the looked-at cards are still in the deck (20-11),
 *    so the choice had no candidate at all.
 *  - BT3-119 f10, BT3-120 f10, BT2-001 f10 "place up to N cards from the top of
 *    your deck in the Drop Area": the owner's ruling of 20 Oct 2026 (recorded on
 *    BT3-120 f10) — optional, one card at a time — now the compiler's reading.
 *  - BT1-064 f10 "[Counter: Attack] Play this card from your hand": the counter
 *    card is in the Drop by then (22-10-7); the play names no area.
 *  - BT1-073 f20 "…from your opponent's hand at random": no player picks
 *    (official Q&A on BT1-073).
 *  - BT30-082 f10 "[Awaken] … or you have 2 or more energy and {Support
 *    Broadcast} in your Battle Area" (record + condition on a board).
 *  - BT29-040 f10 "Add this card in your Drop to your hand": the Drop is named.
 *  - SD3-04 f10 "…reduce the energy cost of this card in your hand and Warp by
 *    1" (owner ruling 26 Oct 2026: 7 or more cards in your Warp; the Warp half).
 *  - BT28-121 f0 "…switch the card that was switched to Hidden Mode by this
 *    skill to Revealed Mode at the end of the turn": not after another skill
 *    revealed it and it was hidden again (official Q&A on BT28-121).
 *  - BT30-104 f0 "…you may remove this card in your Warp from the game
 *    instead": a substitute that keeps the ≪Maiden Squadron≫ card, standing
 *    while BT30-104 is in the Warp (it read as the Maiden card itself being
 *    removed from the game).
 *  - BT31-110 f10 "At the start of your Main Phase, add this card from under
 *    your Leader to your Z-Energy": heard from the Leader's pile, and only there.
 *
 * And a lock on the readings already right on main for the other flagged rows
 * (the owner's 4 Oct 2026 card-review rulings and the 20/25 Oct reviews).
 *
 * Printed texts: the flagged faces as the review quotes them (card ids, not a
 * database read). Costs, powers and companion cards are synthetic.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords, type SkillRecord } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { attrsNow, condHolds } from "../../src/lib/arena/vm/program";
import { parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import { other, type Action, type CardDef, type EngineContext, type PlayerId } from "../../src/lib/arena/types";
import type { Op } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";

// ── printed texts ────────────────────────────────────────────────────────────
const T = {
  SD13_04: "[auto] When this card is played, look at up to 5 cards from the top of your deck, add up to 1 green Unison Card with a specified cost of 2 or 1 green ≪Frieza's Army≫ card with an energy cost of 4 or less among them to your hand, then shuffle your deck.<br>[activate: battle]{g}, if your Leader Card is a green <Frieza> card, you have a green Unison Card in play, and you send this card from your Drop Area to your Warp: Choose 1 of your Leader Cards or Unison Cards and it gets +10000 power for the battle.",
  BT3_119: "[Blocker] (When one of your other cards is attacked, you may switch this card to Rest Mode and change the target of the attack to this card)<br>[Auto] When you play this card, place up to 2 cards from the top of your deck in the Drop Area.<br>[Auto] When this card is attacked, if your opponent's Leader Card is red or blue, this card gains +15000 power for the duration of the turn.",
  BT3_120: "[Critical] (When this card inflicts damage to your opponent's life, they place that many cards in their Drop Area instead of their hand)<br>[Auto] When you play this card, place up to 2 cards from the top of your deck in the Drop Area.<br>[Auto] When you play this card, if your opponent's Leader Card is green or yellow, choose up to 4 of your energy and switch them to Active Mode.",
  BT2_001: "[Permanent] Each &lt;Son Goku&gt; and &lt;Vegeta&gt; in all of your areas gain red, blue, and green colors.<br>[Auto] When this card attacks, place up to 1 card from the top of your deck in the Drop Area. If that card is red, this card gains +5000 power for the duration of the turn.<br>[Awaken] When your life is at 4 or less: You may draw 2 cards and flip this card over.",
  BT1_064: "[Double Strike]<br>[Counter: Attack] Play this card from your hand.<br>[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards with an energy cost of 4 or less and KO it.",
  BT1_073: "[evolve] {g}{g}{g}{g}{1}: <Broly> <br>[double strike]<br>[auto] When you play this card, choose up to 2 cards from your opponent's hand at random and place them in the Drop Area.",
  BT30_082: "[activate: main][once per turn] Send the top 2 cards of your deck to your Warp, then discard 1 ≪Maiden Squadron≫ card from your hand: Draw 2 cards.\n[br]\n[awaken] When your life is at 4 or less, or you have 2 or more energy and {Support Broadcast} in your Battle Area: Draw 2 cards and add cards from your life to your hand until you have 6 life left.",
  BT29_040: "[activate: main/battle][limit 1] If your Leader is blue: Until the end of your opponent's turn, if your opponent's Battle Card would be returned to its owner's hand by a skill on your card, place it at the bottom of its owner's deck instead.\n[activate: main][limit 1]{u}, if your Leader is a blue <Cooler> card, you choose 1 blue Extra in your Battle Area, and return it to its owner's hand: Add this card in your Drop to your hand.",
  SD3_04: "[Permanent] This card can attack Battle Cards that are in Active Mode.<br>[Permanent] When you've sent 7 or more cards to your Warp, reduce the energy cost of this card in your hand and Warp by 1.",
  BT28_121: "[Counter: Play][Limit 1] Choose 1 of your white Battle Cards and switch it to Hidden Mode: Play this card, then switch the card that was switched to Hidden Mode by this skill to Revealed Mode at the end of the turn.\n[br]\n[Permanent] If your Leader is a white ≪Universe 7≫ card and you have a Hidden Mode card in your Battle Area, reduce the energy cost of this card in your hand by 2.\n[br]\n[Auto] When this card is played, draw 1 card.",
  BT30_104: "[permanent] During your turn, if your black ≪Maiden Squadron≫ card would be removed from a Battle Area by an opponent's skill, you may remove this card in your Warp from the game instead.\n[br]\n[auto] [limit 1] When this card is played, look at up to 5 cards from the top of your deck, choose up to 2 ≪Universe 2≫ cards, add up to 1 card to your hand, send up to 1 card to your Warp, then shuffle your deck.",
  BT31_110: "[counter: attack] [limit 1] If your Leader is black: Negate the attack and place this card under your Leader and your Leader gets +5000 power for the turn.\n[br]\n[auto] At the start of your Main Phase, add this card from under your Leader to your Z-Energy. Additionally, you may discard 1 card from your hand. If you do, play up to 1 black ≪Saiyan≫ card with a [union] skill from your Warp with its skills negated for the game.",
};

const rec = (def: CardDef, index: number, side: "front" | "back" = "front"): SkillRecord => {
  const r = skillRecords(def).find((x) => x.side === side && x.skillIndex === index);
  assert.ok(r, `${def.id} ${side} ${index} has a record`);
  // As stored: through JSON, so an absent field is absent.
  return JSON.parse(JSON.stringify(r)) as SkillRecord;
};
/** The rules language says the record and reads it back the same (stored rows are written and read as one). */
const roundTripsInLanguage = (r: SkillRecord) => {
  const rule = JSON.parse(JSON.stringify({ kind: r.kind, trigger: r.trigger, cost: r.cost, usage: r.usage, validity: r.validity, cond: r.cond, ops: r.ops })) as Rule;
  const what = `${r.cardId} ${r.side} ${r.skillIndex}`;
  assert.equal(validateRule(rule, r.kind), null, `${what}: the record validates`);
  const round = parseRule(printRule(rule));
  assert.ok(round.ok, `${what}: the rules language prints and reparses it`);
  // `upTo: false` is the selector default, and a selector over several areas prints its `areas` alone.
  const plain = (v: unknown) =>
    JSON.parse(JSON.stringify(v, function (this: Record<string, unknown>, k, x) {
      if (k === "upTo" && x === false) return undefined;
      if (k === "area" && Array.isArray(this.areas) && this.areas[0] === x) return undefined;
      return x;
    }));
  assert.deepEqual(plain(round.value), plain(rule), `${what}: …unchanged`);
};
const b = (o: Partial<CardDef> & { id: string }): CardDef => card(o.id, o);
const leader = (id: string, o: Partial<CardDef>): CardDef => card(id, { type: "LEADER", energyCost: null, comboCost: null, comboPower: null, skill: null, ...o });
const extra = (id: string, o: Partial<CardDef>): CardDef => card(id, { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, ...o });

const defs: Record<string, CardDef> = {
  ...DEFS,
  F_SD1304: b({ id: "F_SD1304", colors: ["Green"], energyCost: 0, traits: ["Frieza's Army"], skill: T.SD13_04 }),
  F_GUNI2: card("F_GUNI2", { type: "UNISON", colors: ["Green"], energyCost: "X", specifiedCost: { Green: 2 }, power: 5000, comboCost: null, comboPower: null }),
  F_GUNI3: card("F_GUNI3", { type: "UNISON", colors: ["Green"], energyCost: "X", specifiedCost: { Green: 3 }, power: 5000, comboCost: null, comboPower: null }),
  F_GFA3: b({ id: "F_GFA3", colors: ["Green"], energyCost: 3, traits: ["Frieza's Army"] }),
  F_GFA5: b({ id: "F_GFA5", colors: ["Green"], energyCost: 5, traits: ["Frieza's Army"] }),
  F_BT3119: b({ id: "F_BT3119", colors: ["Blue"], energyCost: 0, skill: T.BT3_119 }),
  F_BT3120: b({ id: "F_BT3120", colors: ["Green"], energyCost: 0, skill: T.BT3_120 }),
  F_BT2001: leader("F_BT2001", { colors: ["Red", "Blue", "Green"], characters: ["Vegito"], power: 10000, skill: T.BT2_001, back: { name: "F_BT2001 awakened", power: 15000, skill: null } }),
  F_BT1064: b({ id: "F_BT1064", energyCost: 0, characters: ["Vegeta"], skill: T.BT1_064 }),
  F_BT1073: b({ id: "F_BT1073", colors: ["Green"], energyCost: 0, characters: ["Broly"], skill: T.BT1_073 }),
  F_BT30082: leader("F_BT30082", { colors: ["Black"], skill: T.BT30_082, back: { name: "F_BT30082 awakened", power: 15000, skill: null } }),
  F_SB: b({ id: "F_SB", name: "Support Broadcast", colors: ["Black"], energyCost: 1 }),
  F_BT29040: extra("F_BT29040", { colors: ["Blue"], skill: T.BT29_040 }),
  F_SD304: b({ id: "F_SD304", colors: ["Blue"], energyCost: 4, skill: T.SD3_04 }),
  F_BT28121: b({ id: "F_BT28121", colors: ["White"], energyCost: 0, skill: T.BT28_121 }),
  F_WHITE: b({ id: "F_WHITE", colors: ["White"], energyCost: 1, power: 15000 }),
  // The same price and delayed reveal as BT28-121's [Counter: Play], as an [Activate: Main] to reach it from a Main Phase.
  F_HIDE121: b({ id: "F_HIDE121", colors: ["White"], energyCost: 0, skill: "[Activate: Main][Once per turn] Choose 1 of your white Battle Cards and switch it to Hidden Mode: Draw 1 card, then switch the card that was switched to Hidden Mode by this skill to Revealed Mode at the end of the turn." }),
  F_REVEAL: extra("F_REVEAL", { colors: ["White"], skill: "[Activate: Main] Choose up to 1 Hidden Mode card in your Battle Area and switch it to Revealed Mode." }),
  F_REHIDE: extra("F_REHIDE", { colors: ["White"], skill: "[Activate: Main] Choose up to 1 of your Battle Cards and switch it to Hidden Mode." }),
  F_BT30104: b({ id: "F_BT30104", colors: ["Black"], energyCost: 3, traits: ["Maiden Squadron", "Universe 2"], skill: T.BT30_104 }),
  F_MAIDEN: b({ id: "F_MAIDEN", colors: ["Black"], energyCost: 1, traits: ["Maiden Squadron"] }),
  F_REDMAID: b({ id: "F_REDMAID", colors: ["Red"], energyCost: 1, traits: ["Maiden Squadron"] }),
  // The opponent's skill that removes a card from your Battle Area during your turn.
  F_BOUNCE: b({ id: "F_BOUNCE", colors: ["Blue"], energyCost: 0, skill: "[Auto] When your opponent plays a Battle Card, choose up to 1 of your opponent's Battle Cards and return it to its owner's hand." }),
  F_PLAY0: b({ id: "F_PLAY0", energyCost: 0 }),
  F_BT31110: extra("F_BT31110", { colors: ["Black"], skill: T.BT31_110 }),
  F_LBLACK: leader("F_LBLACK", { colors: ["Black"] }),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const rt = <V,>(v: V): V => JSON.parse(JSON.stringify(v));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(rt(rows), defs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;

// ── the VM, both seats ──────────────────────────────────────────────────────
const take = (s: VmState, a: Action): VmState => RULES.apply(ctx, rt(s), a).state as VmState;
/** `p`'s Main Phase: p1's first turn, or p2's first turn. */
function mainOf(p: PlayerId, seed = 1026, leaders: { p1?: string; p2?: string } = {}): VmState {
  let s = RULES.createGame(ctx, { seed, p1: { name: "First", leader: leaders.p1 ?? "L-RED", main: fifty("V1") }, p2: { name: "Second", leader: leaders.p2 ?? "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  const script: Action[] = [
    { type: "chooseFirst", player: s.chooser!, first: "p1" } as Action,
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null },
    ...(p === "p2" ? [{ type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null }] as Action[] : []),
  ];
  for (const a of script) s = take(s, a);
  assert.equal(s.prompt.kind, "main");
  assert.equal(s.turnPlayer, p);
  return s;
}
/** Put a card of `def` into `area` for `p` (the bottom card of their deck, renamed). */
function stage(s: VmState, p: PlayerId, def: string, area: string, under?: string): string {
  const deck = s.sides[p].zones.deck;
  const id = deck[deck.length - 1];
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p, ...(under ? { under } : {}) }).ok, `could not stage ${def} in ${area}`);
  if (area === "battle") { s.cards[id].mode = "active"; delete s.cards[id].placedThisTurn; }
  s.pending = [];
  return id;
}
type Answer = (s: VmState) => Action | undefined;
/** Answer every question until the board is back at a Main Phase (or `until` holds): `answer` first, then a plain default. */
function drive(s: VmState, answer: Answer = () => undefined, until?: (s: VmState) => boolean): VmState {
  for (let i = 0; i < 120 && !(until?.(s)); i++) {
    const q = s.prompt as { kind: string; player: PlayerId; options?: string[]; choice?: { candidates: string[]; min: number } };
    if (q.kind === "main" && !s.battle && !s.programs?.length) break;
    const mine = answer(s);
    if (mine) { s = take(s, mine); continue; }
    const legal = RULES.legalActions(ctx, s).map((l) => l.action);
    let a: Action | undefined;
    if (q.kind === "counter") a = { type: "counter", player: q.player, card: null } as Action;
    else if (q.kind === "blocker" || q.kind === "combo") a = { type: "pass", player: q.player } as Action;
    else if (q.kind === "orderPending") a = { type: "orderPending", player: q.player, index: 0 } as Action;
    else if (q.kind === "chooseCards") a = { type: "choose", player: q.player, cards: q.choice!.candidates.slice(0, Math.max(q.choice!.min, 1)) } as Action;
    else if (q.kind === "chooseMode") a = { type: "chooseMode", player: q.player, index: 0 } as Action;
    else a = legal[0];
    assert.ok(a, `no answer for ${q.kind}`);
    s = take(s, a);
  }
  return s;
}
const zoneNow = (s: VmState, id: string): string | undefined => {
  for (const p of ["p1", "p2"] as const) for (const [z, ids] of Object.entries(s.sides[p].zones)) if ((ids as string[]).includes(id)) return z;
  return Object.values(s.cards).some((c) => c.under.includes(id)) ? "pile" : undefined;
};
const playFromHand = (s: VmState, id: string): VmState => {
  const a = RULES.legalActions(ctx, s).find((l) => l.action.type === "play" && (l.action as { card: string }).card === id);
  assert.ok(a, `${s.cards[id].cardId} can be played`);
  return take(s, a.action);
};
/** End the turn under way and play on to `who`'s Main Phase, declining every offer on the way. */
function nextMain(s: VmState, who: PlayerId): VmState {
  s = drive(take(s, { type: "endMain", player: s.turnPlayer } as Action), (x) => no(x), (x) => x.prompt.kind === "charge");
  assert.equal(s.turnPlayer, who);
  s = drive(take(s, { type: "charge", player: who, card: null } as Action), (x) => no(x));
  assert.equal(s.prompt.kind, "main");
  return s;
}
const yes = (s: VmState): Action | undefined => (s.prompt.kind === "chooseMode" ? { type: "chooseMode", player: s.prompt.player, index: 0 } as Action : undefined);
const no = (s: VmState): Action | undefined => {
  const q = s.prompt as { kind: string; player: PlayerId; options?: string[] };
  return q.kind === "chooseMode" ? { type: "chooseMode", player: q.player, index: q.options!.length - 1 } as Action : undefined;
};

// ── SD13-04 f0: a type noun in a pooled choice is no area ───────────────────
{
  const r = rec(defs.F_SD1304, 0);
  assert.deepEqual(r.unread, []);
  const choose = r.ops[1] as Extract<Op, { op: "choose" }>;
  assert.equal(choose.sel.fromVar, "looked");
  assert.equal(choose.sel.area, undefined, "the looked-at cards are still in the deck: no area on the choice");
  assert.deepEqual(choose.sel.filter?.anyOf?.map((f) => [f.type, f.specifiedCostMin, f.specifiedCostMax, f.traits, f.costMax]), [["UNISON", 2, 2, [], null], [null, null, null, ["frieza's army"], 4]]);
  roundTripsInLanguage(r);
  // Read the same way: "a Battle Card among them" keeps the type on the filter and no area.
  const battle = skillRecords(b({ id: "R_POOL", skill: "[Auto] When this card is played, look at up to 5 cards from the top of your deck, add up to 1 Battle Card among them to your hand, then shuffle your deck." }))[0];
  const bc = battle.ops[1] as Extract<Op, { op: "choose" }>;
  assert.deepEqual([bc.sel.area, bc.sel.filter?.type], [undefined, "BATTLE"]);
  for (const p of ["p1", "p2"] as const) {
    let s = mainOf(p);
    const id = stage(s, p, "F_SD1304", "hand");
    const deck = s.sides[p].zones.deck;
    s.cards[deck[0]].cardId = "F_GUNI3"; s.cards[deck[1]].cardId = "F_GUNI2"; s.cards[deck[2]].cardId = "F_GFA5"; s.cards[deck[3]].cardId = "F_GFA3";
    s = playFromHand(s, id);
    s = drive(s, () => undefined, (x) => x.prompt.kind === "chooseCards");
    assert.equal(s.prompt.kind, "chooseCards", `${p}: the search asks`);
    const offered = (s.prompt as { choice: { candidates: string[] } }).choice.candidates.map((c) => s.cards[c].cardId).sort();
    assert.deepEqual(offered, ["F_GFA3", "F_GUNI2"], `${p}: a green Unison with specified cost 2 and a ≪Frieza's Army≫ costing 4 or less are offered; cost 3 Unison and cost 5 card are not`);
    const unison = (s.prompt as { choice: { candidates: string[] } }).choice.candidates.find((c) => s.cards[c].cardId === "F_GUNI2")!;
    s = take(s, { type: "choose", player: p, cards: [unison] } as Action);
    s = drive(s);
    assert.equal(zoneNow(s, unison), "hand", `${p}: the green Unison is added to the hand`);
  }
}

// ── "place up to N cards from the top of your deck in the Drop Area" ──────────
{
  for (const [def, n] of [["F_BT3119", 2], ["F_BT3120", 2]] as const) {
    const r = rec(defs[def], 10);
    assert.deepEqual(r.unread, []);
    assert.equal(r.reads, "you may: 1 from the top of the deck to the Drop, if the offer was taken: you may: 1 from the top of the deck to the Drop");
    roundTripsInLanguage(r);
    for (const p of ["p1", "p2"] as const) {
      // accept + accept, accept + decline, decline.
      for (const [answers, milled] of [[[true, true], n], [[true, false], 1], [[false], 0]] as const) {
        let s = mainOf(p);
        const id = stage(s, p, def, "hand");
        const drop = s.sides[p].zones.drop.length;
        let asked = 0;
        s = playFromHand(s, id);
        s = drive(s, (x) => {
          const q = x.prompt as { kind: string; options?: string[] };
          if (q.kind !== "chooseMode" || !/place 1 card from the top of your deck/i.test(q.options?.[0] ?? "")) return undefined;
          return (answers[asked++] ? yes : no)(x);
        });
        assert.equal(asked, answers.length, `${def} ${p}: asked once per card, and not again after a decline`);
        assert.equal(s.sides[p].zones.drop.length - drop, milled, `${def} ${p}: ${answers.join("/")} places ${milled}`);
      }
    }
  }
  // BT2-001 f10: up to 1, and "that card" is the card placed.
  const r = rec(defs.F_BT2001, 10);
  assert.deepEqual(r.unread, []);
  assert.equal(r.reads, "you may: 1 from the top of the deck to the Drop, if that card is red: this card +5000 power for the turn");
  roundTripsInLanguage(r);
}

// ── BT1-064 f10: [Counter: Attack] Play this card from your hand ─────────────
{
  const r = rec(defs.F_BT1064, 10);
  const pick = r.ops[0] as Extract<Op, { op: "choose" }>;
  assert.deepEqual(pick.sel, { special: "self" }, "the counter's play names no area: the card is in the Drop by then (22-10-7)");
  roundTripsInLanguage(r);
  // An [Activate: Main] "play this card from your hand" keeps the hand (9-1-3-2).
  const main = skillRecords(b({ id: "R_HANDPLAY", skill: "[Activate: Main] Play this card from your hand." }))[0];
  assert.deepEqual((main.ops[0] as Extract<Op, { op: "choose" }>).sel, { special: "self", area: "hand" });
  for (const defender of ["p1", "p2"] as const) {
    const attacker = other(defender);
    let s = mainOf(attacker);
    if (attacker === "p1") {
      // p1 cannot attack on its first turn (7-3-4-4-1): to p1's second turn.
      for (const a of [{ type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null }, { type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null }] as Action[]) s = take(s, a);
      s = drive(s);
    }
    const atk = stage(s, attacker, "V1", "battle");
    const ctr = stage(s, defender, "F_BT1064", "hand");
    const a = RULES.legalActions(ctx, s).find((l) => l.action.type === "attack" && (l.action as { attacker: string }).attacker === atk && (l.action as { target: string }).target === s.sides[defender].zones.leader[0]);
    assert.ok(a);
    let used = false;
    s = drive(take(s, a.action), (x) => {
      if (x.prompt.kind !== "counter" || x.prompt.player !== defender || used) return undefined;
      const mine = RULES.legalActions(ctx, x).find((l) => l.action.type === "counter" && (l.action as { card: string | null }).card === ctr);
      assert.ok(mine, `${defender}: BT1-064's [Counter] is offered`);
      used = true;
      return mine.action;
    });
    assert.ok(used);
    assert.equal(zoneNow(s, ctr), "battle", `${defender}: the counter plays the card into the Battle Area, not left in the Drop`);
  }
}

// ── BT1-073 f20: at random ──────────────────────────────────────────────────
{
  const r = rec(defs.F_BT1073, 20);
  assert.deepEqual(r.unread, []);
  const pick = r.ops[0] as Extract<Op, { op: "choose" }>;
  assert.deepEqual([pick.sel.side, pick.sel.area, pick.sel.count, pick.sel.atRandom], ["opponent", "hand", 2, true]);
  assert.equal(r.reads, "choose up to 2 cards in your opponent's hand at random, move the chosen cards to drop");
  roundTripsInLanguage(r);
  // "At random" anywhere but a hand is not read as a choice at all.
  assert.ok(skillRecords(b({ id: "R_RANDOM", skill: "[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards at random and KO it." }))[0].unread.length > 0);
  // Owner's ruling of 26 Oct 2026: the master picks HOW MANY (0 to 2, capped by
  // the hand), then that many are taken at random — never which ones.
  for (const p of ["p1", "p2"] as const) {
    /** Play BT1-073 and answer "how many" with `count`; returns the opponent's cards taken. */
    const run = (seed: number, count: number, handSize?: number) => {
      let s = mainOf(p, seed);
      const id = stage(s, p, "F_BT1073", "hand");
      if (handSize !== undefined) while (s.sides[other(p)].zones.hand.length > handSize) moveCard(s, game, s.sides[other(p)].zones.hand[0], "deck", { owner: other(p) });
      const theirs = [...s.sides[other(p)].zones.hand];
      let picked = false;
      let options: string[] = [];
      s = drive(playFromHand(s, id), (x) => {
        const q = x.prompt as { kind: string; player: PlayerId; options?: string[] };
        if (q.kind === "chooseCards") picked = true;
        if (q.kind === "chooseMode" && /at random/.test(q.options?.[0] ?? "")) {
          assert.equal(q.player, p, `${p}: the master says how many`);
          options = q.options!;
          return { type: "chooseMode", player: p, index: options.indexOf(`${count} at random`) } as Action;
        }
        return undefined;
      });
      assert.equal(picked, false, `${p}: nobody picks which cards`);
      return { taken: theirs.filter((c) => s.sides[other(p)].zones.drop.includes(c)), options };
    };
    const two = run(1026, 2);
    assert.deepEqual(two.options, ["2 at random", "1 at random", "0 at random"], `${p}: 0 to 2 offered`);
    assert.equal(two.taken.length, 2, `${p}: two taken`);
    assert.deepEqual(run(1026, 2).taken, two.taken, `${p}: the same seed takes the same cards (a replay reproduces it)`);
    assert.equal(run(7, 1).taken.length, 1, `${p}: the master may take only 1`);
    assert.equal(run(7, 0).taken.length, 0, `${p}: or none`);
    const thin = run(1026, 1, 1);
    assert.deepEqual(thin.options, ["1 at random", "0 at random"], `${p}: capped by a 1-card hand`);
    assert.equal(thin.taken.length, 1);
  }
}

// ── "send up to N cards from the top of your deck to your Warp" (owner, 20 and 26 Oct 2026) ──
{
  for (const [text, n] of [
    ["[Auto] When you play this card, send up to 2 cards from the top of your deck to your Warp.", 2],
    ["[Activate: Main][Once per turn] Send up to 5 cards from the top of your deck to your Warp.", 5],
    ["[Auto] When you play this card, send up to 1 card from the top of your deck to your Warp.", 1],
  ] as const) {
    const r = rec(b({ id: "R_WARP", skill: text }), 0);
    assert.deepEqual(r.unread, [], text);
    assert.equal(JSON.stringify(r.ops).includes('"area":"deck"'), false, `${text}: no free pick from the deck`);
    assert.deepEqual(r.ops.map((o) => o.op), ["may", ...Array(n - 1).fill("if")], `${text}: one card at a time, ${n} offers`);
    assert.deepEqual((r.ops[0] as Extract<Op, { op: "may" }>).ops.map((o) => o.op), ["look", "moveTo"]);
    roundTripsInLanguage(r);
  }
  defs.F_WARP3 = b({ id: "F_WARP3", colors: ["Black"], energyCost: 0, skill: "[Auto] When you play this card, send up to 3 cards from the top of your deck to your Warp." });
  const wctx: EngineContext = { ...ctx, defs, scripts: rulesFromRows(rt(Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)))), defs) };
  const wtake = (s: VmState, a: Action): VmState => RULES.apply(wctx, rt(s), a).state as VmState;
  for (const p of ["p1", "p2"] as const) {
    for (const answers of [[true, true, true], [true, false], [false]] as const) {
      let s = mainOf(p);
      const id = stage(s, p, "F_WARP3", "hand");
      const top = s.sides[p].zones.deck.slice(0, 3);
      const play = RULES.legalActions(wctx, s).find((l) => l.action.type === "play" && (l.action as { card: string }).card === id);
      assert.ok(play);
      s = wtake(s, play.action);
      let asked = 0;
      for (let i = 0; i < 40 && s.prompt.kind !== "main"; i++) {
        const q = s.prompt as { kind: string; player: PlayerId; options?: string[] };
        if (q.kind === "chooseMode" && /top card of your deck/i.test(q.options?.[0] ?? "")) s = wtake(s, { type: "chooseMode", player: p, index: answers[asked++] ? 0 : q.options!.length - 1 } as Action);
        else if (q.kind === "orderPending") s = wtake(s, { type: "orderPending", player: q.player, index: 0 } as Action);
        else assert.fail(`unexpected ${q.kind}`);
      }
      const k = answers.filter(Boolean).length;
      assert.equal(asked, answers.length, `${p}: asked once per card, never again after a decline`);
      assert.deepEqual(top.filter((c) => s.sides[p].zones.warp.includes(c)), top.slice(0, k), `${p}: ${answers.join("/")} sends the top ${k} cards, in order`);
    }
  }
}

// ── BT30-082 f10: [Awaken] "… or you have 2 or more energy and {Support Broadcast} in your Battle Area" ──
{
  const r = rec(defs.F_BT30082, 10);
  assert.deepEqual(r.unread, []);
  const cond = rt(r.cost?.condition) as { kind: string; conds: { kind: string; atMost?: number; conds?: { kind: string; atLeast: number; sel: { area: string; filter?: { names: string[] } } }[] }[] };
  assert.equal(cond.kind, "any");
  assert.deepEqual([cond.conds[0].kind, cond.conds[0].atMost], ["life", 4]);
  assert.equal(cond.conds[1].kind, "all", "(2 or more energy) AND ({Support Broadcast} in your Battle Area)");
  assert.deepEqual(cond.conds[1].conds!.map((c) => [c.kind, c.sel.area, c.atLeast, c.sel.filter?.names ?? []]), [["count", "energy", 2, []], ["count", "battle", 1, ["support broadcast"]]]);
  for (const p of ["p1", "p2"] as const) {
    const holds = (energy: number, where: "battle" | "energy" | null, life?: number) => {
      const s = mainOf(p);
      while (s.sides[p].zones.energy.length > energy) moveCard(s, game, s.sides[p].zones.energy[0], "drop", { owner: p });
      while (s.sides[p].zones.energy.length < energy) stage(s, p, "V1", "energy");
      if (where) stage(s, p, "F_SB", where);
      if (where === "energy") stage(s, p, "F_SB", "energy");
      if (life !== undefined) while (s.sides[p].zones.life.length > life) moveCard(s, game, s.sides[p].zones.life[0], "hand", { owner: p });
      return condHolds(ctx, game, rt(s), { ops: [], ip: 0, vars: {}, card: s.sides[p].zones.leader[0], master: p }, r.cost!.condition!);
    };
    assert.equal(holds(2, "battle"), true, `${p}: 2 energy and {Support Broadcast} in the Battle Area`);
    assert.equal(holds(1, "battle"), false, `${p}: 1 energy is not enough`);
    assert.equal(holds(2, null), false, `${p}: no {Support Broadcast}`);
    assert.equal(holds(0, "energy"), false, `${p}: two {Support Broadcast} in the Energy Area are not the Battle Area`);
    assert.equal(holds(0, null, 4), true, `${p}: life 4 or less on its own`);
  }
}

// ── BT29-040 f10: "Add this card in your Drop to your hand" ────────────────
{
  const r = rec(defs.F_BT29040, 10);
  assert.deepEqual(r.unread, []);
  assert.deepEqual(r.ops, [{ op: "moveTo", target: { sel: { special: "self", area: "drop" } }, to: "hand" }]);
  roundTripsInLanguage(r);
}

// ── SD3-04 f10: 7+ cards in your Warp; the hand AND the Warp ────────────────
{
  const r = rec(defs.F_SD304, 10);
  assert.deepEqual(r.unread, []);
  assert.deepEqual(r.cond, { kind: "count", sel: { side: "you", area: "warp" }, atLeast: 7 });
  const red = r.ops[0] as Extract<Op, { op: "costReduction" }>;
  assert.deepEqual((red.target as { sel: { areas?: string[] } }).sel.areas, ["hand", "warp"]);
  roundTripsInLanguage(r);
  for (const p of ["p1", "p2"] as const) {
    for (const where of ["hand", "warp"] as const) {
      const s = mainOf(p);
      const id = stage(s, p, "F_SD304", where);
      const others = where === "warp" ? 6 : 7;
      for (let i = 0; i < others - 1; i++) stage(s, p, "V1", "warp");
      assert.equal(attrsNow(ctx, game, rt(s), id).costOf, 4, `${p} ${where}: 6 cards in the Warp, no reduction`);
      stage(s, p, "V1", "warp");
      assert.equal(attrsNow(ctx, game, rt(s), id).costOf, 3, `${p} ${where}: 7 cards in the Warp, 1 less`);
      // An opponent's 7 Warp cards are not yours.
      const t = mainOf(p);
      const id2 = stage(t, p, "F_SD304", where);
      for (let i = 0; i < 7; i++) stage(t, other(p), "V1", "warp");
      assert.equal(attrsNow(ctx, game, rt(t), id2).costOf, 4, `${p} ${where}: the opponent's Warp does not count`);
    }
    // In the Battle Area it is no cheaper.
    const s = mainOf(p);
    const id = stage(s, p, "F_SD304", "battle");
    for (let i = 0; i < 8; i++) stage(s, p, "V1", "warp");
    assert.equal(attrsNow(ctx, game, rt(s), id).costOf, 4, `${p}: the reduction is not on the card in play`);
  }
}

// ── BT28-121 f0: only the Hidden Mode this skill made is revealed ───────────
{
  const r = rec(defs.F_BT28121, 0);
  assert.deepEqual(r.unread, []);
  const delay = r.ops.find((o) => o.op === "delay") as Extract<Op, { op: "delay" }>;
  assert.deepEqual(delay.ops, [{ op: "hidden", target: { var: "c0" }, hidden: false, sameHiding: true }]);
  assert.match(r.reads, /at the end of the turn: switch the chosen cards to Revealed Mode \(only a card still in the Hidden Mode this skill switched it to\)$/);
  roundTripsInLanguage(r);
  // The stand-in carries the same delayed op.
  const stand = rec(defs.F_HIDE121, 0);
  assert.deepEqual((stand.ops.find((o) => o.op === "delay") as Extract<Op, { op: "delay" }>).ops, delay.ops);
  for (const p of ["p1", "p2"] as const) {
    for (const rehide of [false, true]) {
      let s = mainOf(p);
      const white = stage(s, p, "F_WHITE", "battle");
      const source = stage(s, p, "F_HIDE121", "battle");
      const reveal = stage(s, p, "F_REVEAL", "hand");
      const hide = stage(s, p, "F_REHIDE", "hand");
      const act = (x: VmState, card: string) => {
        const a = RULES.legalActions(ctx, x).find((l) => l.action.type === "activate" && (l.action as { card: string }).card === card);
        assert.ok(a, `${x.cards[card].cardId} can be activated`);
        return drive(take(x, a.action), (y) => (y.prompt.kind === "chooseCards" ? { type: "choose", player: p, cards: [white] } as Action : undefined));
      };
      s = act(s, source);
      assert.equal(s.cards[white].hidden, true, `${p}: the price switched the white card to Hidden Mode`);
      if (rehide) {
        s = act(s, reveal);
        assert.equal(s.cards[white].hidden, false);
        s = act(s, hide);
        assert.equal(s.cards[white].hidden, true, `${p}: hidden again by another skill`);
      }
      s = drive(take(s, { type: "endMain", player: p } as Action), () => undefined, (x) => x.turnPlayer !== p && x.prompt.kind === "charge");
      assert.equal(s.cards[white].hidden, rehide, rehide ? `${p}: revealed and hidden again since, it stays hidden (official Q&A)` : `${p}: revealed at the end of the turn`);
    }
  }
}

// ── BT30-104 f0: "you may remove this card in your Warp from the game instead" ──
{
  const r = rec(defs.F_BT30104, 0);
  assert.deepEqual(r.unread, []);
  assert.deepEqual(r.cond, { kind: "isTurnPlayer" });
  const sub = r.ops[0] as Extract<Op, { op: "replace" }>;
  assert.equal(sub.op, "replace", "a substitute, not a redirect of the Maiden Squadron card");
  // Owner ruling 26 Oct 2026 (prohibition batch 3): the opponent's skill's KO is a removal too.
  assert.deepEqual([sub.event, sub.by, sub.bySide, sub.optional], ["leave", "skillOrKoBySkill", "opponent", true]);
  assert.deepEqual(sub.with, [{ op: "moveTo", target: { sel: { special: "self", area: "warp" } }, to: "removed" }]);
  roundTripsInLanguage(r);
  for (const p of ["p1", "p2"] as const) {
    for (const [accept, inWarp, maiden] of [[true, true, "F_MAIDEN"], [false, true, "F_MAIDEN"], [true, false, "F_MAIDEN"], [true, true, "F_REDMAID"]] as const) {
      let s = mainOf(p);
      const mine = stage(s, p, maiden, "battle");
      const su = stage(s, p, "F_BT30104", inWarp ? "warp" : "drop");
      stage(s, other(p), "F_BOUNCE", "battle");
      const trigger = stage(s, p, "F_PLAY0", "hand");
      let offered = false;
      s = drive(playFromHand(s, trigger), (x) => {
        const q = x.prompt as { kind: string; player: PlayerId; choice?: { candidates: string[] } };
        if (q.kind === "chooseCards" && q.player === other(p)) return { type: "choose", player: q.player, cards: [mine] } as Action;
        if (q.kind === "replaceMove") {
          offered = true;
          const legal = RULES.legalActions(ctx, x).map((l) => l.action);
          return legal[accept ? 0 : legal.length - 1];
        }
        return undefined;
      });
      const protects = inWarp && maiden === "F_MAIDEN";
      assert.equal(offered, protects, `${p} ${maiden} ${inWarp ? "Warp" : "Drop"}: offered only from the Warp, for a black ≪Maiden Squadron≫`);
      if (protects && accept) {
        assert.equal(zoneNow(s, mine), "battle", `${p}: the Maiden Squadron card stays`);
        assert.equal(zoneNow(s, su), "removed", `${p}: BT30-104 is removed from the game instead`);
      } else {
        assert.equal(zoneNow(s, mine), "hand", `${p}: no substitute taken — the card is returned`);
        assert.equal(zoneNow(s, su), inWarp ? "warp" : "drop");
      }
    }
  }
}

// ── BT31-110 f10: from under your Leader to your Z-Energy ───────────────────
{
  const r = rec(defs.F_BT31110, 10);
  assert.deepEqual(r.unread, []);
  assert.deepEqual(r.ops[0], { op: "moveTo", target: { sel: { special: "self", area: "under", underHost: { side: "you", area: "leader" } } }, to: "zEnergy" });
  roundTripsInLanguage(r);
  for (const p of ["p1", "p2"] as const) {
    for (const where of ["under", "hand", "drop"] as const) {
      let s = mainOf(p);
      const id = where === "under" ? stage(s, p, "F_BT31110", "leader", s.sides[p].zones.leader[0]) : stage(s, p, "F_BT31110", where);
      // To this player's next Main Phase.
      const opp = other(p);
      s = nextMain(s, opp);
      const mid = zoneNow(s, id);
      assert.equal(mid, where === "under" ? "pile" : where, `${p} ${where}: the opponent's Main Phase is not "your" Main Phase`);
      s = nextMain(s, p);
      assert.equal(zoneNow(s, id), where === "under" ? "zEnergy" : where, `${p} ${where}: ${where === "under" ? "added from under the Leader to the Z-Energy" : "nothing happens outside the pile"}`);
    }
  }
}

// ── the readings already right on main (owner's 4 Oct 2026 card review; 20/25 Oct reviews) ──
{
  const one = (skill: string, index = 0, o: Partial<CardDef> = {}) => {
    const r = rec(b({ id: "LOCK", skill, ...o }), index);
    assert.deepEqual(r.unread, [], skill);
    return r;
  };
  const firstChoice = (ops: Op[]): Extract<Op, { op: "choose" }> | undefined => {
    for (const o of ops) {
      if (o.op === "choose") return o;
      const inner = o.op === "may" ? firstChoice(o.ops) : o.op === "if" ? firstChoice(o.then) : undefined;
      if (inner) return inner;
    }
    return undefined;
  };
  const choiceOf = (r: SkillRecord) => firstChoice(r.ops)!;
  // 'red' belongs only to the second name (BT6-004, BT6-005, BT6-008).
  for (const [text, a, bb] of [
    ["[Auto] When you play this card, look at up to 5 cards from the top of your deck, choose up to 1 &lt;Gogeta: Br&gt; card or red &lt;Vegeta: Br&gt; card among them and add it to your hand, shuffle your deck.", "Gogeta: Br", "Vegeta: Br"],
    ["[Auto] When you play this card, look at up to 3 cards from the top of your deck, choose up to 1 &lt;Veku: Br&gt; card or red &lt;Vegeta: Br&gt; card among them and add it to your hand, place the remaining cards at the bottom of your deck in any order.", "Veku: Br", "Vegeta: Br"],
    ["[Auto] When you play this card, look at up to 5 cards from the top of your deck, choose up to 1 &lt;Gogeta: Br&gt; card or red &lt;Son Goku: Br&gt; card among them and add it to your hand, shuffle your deck.", "Gogeta: Br", "Son Goku: Br"],
  ] as const) {
    assert.deepEqual(choiceOf(one(text)).sel.filter?.anyOf?.map((f) => [f.colors, f.characters]), [[[], [a]], [["Red"], [bb]]]);
  }
  // Energy cost 0 belongs to the Extra only (BT29-035, BT29-039).
  const cooler = choiceOf(one("[Auto] When this card is played, look at up to 5 cards from the top of your deck, add up to 1 blue <Cooler> card, blue ≪Cooler's Armored Squadron≫ card, or blue Extra with an energy cost of 0 to your hand, then shuffle your deck."));
  assert.deepEqual(cooler.sel.filter?.anyOf?.map((f) => [f.type, f.costMax]), [[null, null], [null, null], ["EXTRA", 0]]);
  // Cost 1 OR 5 (BT29-032); white <Cell> OR white Extras (BT31-119).
  assert.deepEqual(choiceOf(one("[auto] At the end of your turn, you may add 1 blue ≪Cooler's Armored Squadron≫ card with an energy cost of 1 or 5 from your Drop to your energy in Rest Mode. If you do, add 1 card from your energy to your Z-Energy.")).sel.filter?.anyOf?.map((f) => f.costMin), [1, 5]);
  assert.deepEqual(choiceOf(one("[Auto] When this card is played, place a total of up to 2 white &lt;Cell&gt; cards or white Extras from your deck into your Drop, then shuffle your deck.")).sel.filter?.anyOf?.map((f) => [f.characters, f.type]), [[["cell"], null], [[], "EXTRA"]]);
  // Leader OR Unison / Battle Card, the colour on its own kind (SD13-04 f10, DB1-019, SD13-03).
  const modes = (r: SkillRecord) => (r.ops.find((o) => o.op === "chooseMode") as Extract<Op, { op: "chooseMode" }>).modes.map((m) => (m.ops[0] as Extract<Op, { op: "choose" }>).sel);
  assert.deepEqual(modes(one("[Auto] When this card is played, choose up to 1 of your Leader Cards or green Unison Cards and it gets +10000 power for the turn.")).map((x) => [x.area, x.filter?.colors ?? []]), [["leader", []], ["unison", ["Green"]]]);
  assert.deepEqual(modes(one("[Activate: Battle] If your Leader Card is a red ≪Saiyan≫ card: Choose 1 of your Leader Cards or Battle Cards, and for the duration of the turn, that card gets +5000 power.")).map((x) => x.area), ["leader", "battle"]);
  // All of the opponent's Battle Cards AND energy to Rest Mode (BT3-084).
  assert.deepEqual(one("[Auto] When a card evolves into this card, choose all of your opponent's Battle Cards and energy and switch them to Rest Mode.").ops.map((o) => [(o as { target: { sel: { area: string } } }).target.sel.area]), [["battle"], ["energy"]]);
  // Not in a battle (BT29-036); [Swap] required (BT4-095).
  assert.equal(choiceOf(one("[Auto][Limit 1] When this card is played, draw 1 card, then choose up to 1 of your opponent's Battle Cards that's not in a battle and return it to its owner's hand.")).sel.notInBattle, true);
  assert.deepEqual(choiceOf(one("[Activate: Main] Choose up to 1 ≪Goku's Lineage≫ with an energy cost of 5 or less and [Swap] from your deck and add it to your hand, then shuffle your deck.")).sel.filter?.keywords, ["Swap"]);
  // (A or B) and C (BT31-128, BT30-096).
  const andOr = one("[activate: main][limit 1]{2}, if your Leader is white or an 《Android》 card, and you have 3 or more energy: Play this card from your hand.");
  assert.deepEqual([andOr.cond?.kind, (andOr.cond as { conds: { kind: string }[] }).conds.map((c) => c.kind)], ["all", ["any", "count"]]);
  // Only during the opponent's next Charge Phase (BT3-085, BT3-101): a skill may still stand it up.
  const charge = one("[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards in Rest Mode. That card cannot switch to Active Mode during your opponent's next Charge Phase.");
  assert.deepEqual(charge.ops[1], { op: "forbid", what: "switchToActiveInCharge", until: "afterOpponentCharge", target: { var: "c0" } });
  // "When this card attacks a Leader Card / a Battle Card" (SD13-01, BT3-031, EX03-19, BT6-014, BT6-015).
  for (const [text, area] of [["[Auto] When this card attacks a Leader Card, place the top card of your deck under this card. Then, if there are 2 or more cards under this card, draw 1 card.", "leader"], ["[Auto] When this card attacks a Battle Card, switch this card to Active Mode.", "battle"]] as const) {
    assert.deepEqual(one(text).cond, { kind: "inBattle", sel: { area, side: "opponent" }, role: "guard" });
  }
  // A red Unison with a specified cost of 2 and no keyword skills (SD15-01b f0).
  const sd15 = choiceOf(rec(leader("LOCK_L", { skill: "[Auto] When this card attacks, draw 1 card.", back: { name: "b", power: 15000, skill: "[Auto] When this card attacks, draw 1 card, then choose up to 1 of your red Unison Cards with a specified cost of 2 and no keyword skills, and it gains [Double Strike] for the turn." } }), 0, "back"));
  assert.deepEqual([sd15.sel.filter?.specifiedCostMin, sd15.sel.filter?.specifiedCostMax, sd15.sel.filter?.noKeywords], [2, 2, true]);
  // Each <Son Goku> and <Vegeta> in your Drop (BT2-012); a blue or yellow ≪Universe 6≫ played (XD1-01).
  assert.deepEqual((one("[Auto] When this card attacks, this card gains +5000 power for each &lt;Son Goku&gt; and &lt;Vegeta&gt; in your Drop Area for the duration of the turn.").ops[0] as { amount: { count: { area: string; filter: { characters: string[] } } } }).amount.count.filter.characters, ["son goku", "vegeta"]);
  assert.deepEqual(one("[Auto] When a blue or yellow ≪Universe 6≫ card is played in your Battle Area, that card gets +5000 power for the duration of the turn, then choose up to 1 card in your life and add it to your hand.").trigger, ["youPlayed"]);
  // The combo from the hand (BT2-010), the energy switched by a non-[Awaken] skill (BT7-003).
  assert.deepEqual(one("[Auto] At the end of the battle after you combo with this card from your hand, if your Leader Card is red, play this card in Rest Mode.").combo?.origins, ["hand"]);
  assert.deepEqual(one("[Auto][Once per turn] When your opponent switches energy to Active Mode using a non-[Awaken] skill during their turn, choose up to 1 of your opponent's energy and place it in its owner's Drop Area.").trigger, ["opponentEnergyActiveBySkill", "opponentOwnEnergyActiveBySkill"]);
}

console.log("deck flags 26 Oct 2026: SD13-04 pooled Unison, up-to-N Drop and Warp placing, BT1-064 counter play, BT1-073 how many then at random, BT30-082 Awaken, BT29-040 Drop, SD3-04 hand+Warp, BT28-121 same Hidden Mode, BT30-104 Warp substitute, BT31-110 from under the Leader; readings already right on main locked");
