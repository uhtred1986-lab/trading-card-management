/**
 * The prohibition catalog, batch 6 (20-14, 20-14-1, 22-5-7) — the same `forbid`
 * machinery as `prohibition-catalog.ts` … `prohibition-catalog-5.ts`:
 *
 * - owner ruling of 26 Oct 2026 (the batch 5 follow-up): a keyword that plays
 *   its own card under a play tax is judged on the board its whole own price
 *   leaves — [Revive]'s colour cards and [Union-Fusion]'s materials out of the
 *   hand, not only its energy. BT6-023's hand tax that those cards would leave
 *   unpayable means the keyword is not offered (or [Revive] not asked); a tax
 *   still payable after them is asked by the `play` op, and declining it is a
 *   failed play (22-5-7).
 *
 * Part 1 reads one printed card per group (and the reading text); part 2 plays
 * the actions on the VM from **both seats**, with a JSON reload of the state
 * between steps.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { parseFilter } from "../../src/lib/arena/text/filters";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { attrsNow, forbiddenBy, hasKeyword } from "../../src/lib/arena/vm/program";
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

// BT12-001, BT15-091: the Leader flips and the bans on them.
{
  const bt12 = "[Auto] When a card in your life is flipped face up by one of your red card skills, you may flip this card over. If you do, draw 1 card and you can't flip your Leader Card to its front for the turn.";
  assert.deepEqual(forbids(ops(bt12)), [{ op: "forbid", what: "flipLeaderFront", side: "you", until: "turn", cardsOf: "you" }], "BT12-001: the front");
  assert.deepEqual(forbids(ops(bt12.replace("to its front", "to its back"))).map((f) => f.what), ["flipLeaderBack"], "BT12-001: the back");
  const flip = ops(bt12)[0] as Extract<Op, { op: "may" }>;
  assert.deepEqual(flip.ops, [{ op: "flip", target: SELF }], "\"flip this card over\": whichever side it shows");
  const bt15b = "[Auto] When a player's [Field] Extra Card leaves a Battle Area, you may flip this card to its front. If you do, you can't flip your Leader Card to its back for the turn. If it's your opponent's turn, switch up to 1 of your yellow energy to Active Mode, and this card gets +5000 power for the turn.";
  const back = record(bt15b);
  assert.deepEqual(back.trigger, ["aPlayersCardLeftBattle"], "BT15-091's back: its moment");
  assert.match(back.reads, /^if that card is an Extra Card with \[Field\]: you may: flip this card to its front, if the offer was taken: you can't flip your Leader Card to its back for the turn/);
  assert.deepEqual(JSON.parse(JSON.stringify(back.cond, compact)), { kind: "count", sel: { special: "subject", filter: { keywords: ["Field"], type: "EXTRA" } }, atLeast: 1 }, "…of a [Field] Extra Card");
  const front = record("[Auto] If you have 1 or more energy: When a player places a [Field] Extra Card in a Battle Area, you may flip this card over. If you do, switch up to 1 of your yellow energy to Active Mode, you can't flip your Leader Card to its front for the turn, and choose one-<br>・Draw 1 card.<br>・Add up to 1 yellow [Field] Extra Card with an energy cost of 1 from your Drop Area to your hand.");
  assert.deepEqual(front.trigger, ["aPlayerPlacesInBattle"], "BT15-091: its moment");
  assert.deepEqual(record("[Activate: Main] If your Leader Card is a yellow <Boujack> card on its front side, you have 2 or more energy, and you discard this card from your hand: Flip your Leader Card to its back side, then draw 2 cards.").ops[0], { op: "flip", target: { sel: { special: "leader" } }, to: "back" }, "EX13-24: one-way, to the back");
}

// The rest of the batch, each printed line read whole, with what it says.
{
  const sd10 = "[auto] When you play this card, choose all of your opponent's Battle Cards ignoring [barrier], and for the duration of the turn their skills are negated, and they can't be placed in a Combo Area from your opponent's Battle Area; this card gains [dual attack] for the duration of the turn.";
  assert.deepEqual(ops(sd10).map((o) => o.op), ["choose", "negateSkills", "forbid", "grant"], "SD10-04: the negation, then the combo ban");
  assert.equal((ops(sd10)[1] as { until: string }).until, "turn", "SD10-04: for the turn");
  const bt25 = "[Auto]{u}, remove this card from the game: When your opponent plays a Battle Card, place up to 1 {Charging Ultra Buu Buu Volleyball} from your Z-Deck in your Battle Area, choose up to 1 of the placed cards, and it can't attack or be used in a combo for the turn.";
  const placed = JSON.stringify(ops(bt25));
  assert.match(placed, /"op":"choose","sel":\{"fromVar":"c0","count":1,"upTo":true\},"as":"c1"/, "BT25-047: a choice among the placed cards");
  assert.deepEqual(forbids(ops(bt25)).map((f) => [f.what, JSON.stringify(f.target)]), [["attack", '{"var":"c1"}'], ["combo", '{"var":"c1"}']], "BT25-047: …and the bans on it");
  assert.match(reads("[Auto][Limit 1] If your Leader is blue and—your Leader is a Z-Leader, you have 3 or more Z-Energy, or you have a Z-Battle Card in play: When this card is played, for the turn, your opponent can't attack with Battle Cards unless they choose 1 card in their hand and place it at the bottom of their deck each time."), /^if your leader is Blue and \(your leader is a match, or there are 3 or more cards in your Z-Energy Area, or there are 1 or more Z-Battle Cards in your Battle Area\)/, "P-442: the dash list without its first \"or\"");
  assert.equal(reads("[permanent] If <Gotenks> is under this card, and if there are no cards in your opponent's Combo Area, this card cannot be KO'd."), "if there are 1 or more <gotenks> cards under this card: if there are no cards in your opponent's Combo Area: this card can't be KO'd", "BT2-026");
  const ex04 = ops("[permanent] If you played this card with [evolve], it can't be KO'd by your opponent.");
  const ex04Rec = record("[permanent] If you played this card with [evolve], it can't be KO'd by your opponent.");
  assert.deepEqual(JSON.parse(JSON.stringify(ex04Rec.cond ?? (ex04[0] as { cond: unknown }).cond)), { kind: "playedUsing", sel: { special: "self" }, what: "Evolve" }, "EX04-04: the [Evolve] entry");
  assert.deepEqual(forbids(ex04).map((f) => [f.what, f.side]), [["beKOdInBattle", undefined], ["beKOdBySkill", "opponent"]], "EX04-04: any battle, the opponent's skills");
  const bt21 = forbids(ops("[Permanent] If your opponent's Leader is a green <Cell> and this card is in your Battle Area, your Earthling Tokens can't attack, and you can't use your Earthling Tokens or green <Android 17>/<Android 18> cards with an energy cost of 2 in a combo."));
  assert.deepEqual(bt21.filter((f) => f.what === "combo").map((f) => [f.filter?.token, f.filter?.characters]), [[true, undefined], [undefined, ["android 17", "android 18"]]], "BT21-099: two kinds of card, one rule each");
  const tb1 = forbids(ops("[permanent] If your Leader Card is yellow, your opponent's [counter] skills and non-keyword [auto]/[activate] skills cannot be activated unless they place 1 card from their life in their Drop Area."));
  assert.deepEqual(tb1.map((f) => [f.what, f.side, f.skillKinds]), [["activateCounter", "opponent", undefined], ["activateSkill", "opponent", ["auto", "activate:main", "activate:battle", "activate:main/battle"]]], "TB1-077: the [Counter]s and the non-keyword [Auto]/[Activate] lines");
  assert.ok(tb1.every((f) => JSON.stringify(f.unlessPay).includes('"area":"life"')), "TB1-077: each paid with a life card");
  const bt20 = forbids(ops("[Auto] When this card is played, choose up to 1 of your opponent's Battle Cards, ignoring [Barrier], place it in its owner's Drop, and your opponent can't attack with non-Leaders for the turn unless they place 1 card each from their hand and Z-Energy in their owners' Drops each time."));
  assert.deepEqual([bt20[0].filter?.notType, bt20[0].unlessPay?.filter((o) => o.op === "choose").map((o) => (o as { sel: { area: string } }).sel.area)], ["LEADER", ["hand", "zEnergy"]], "BT20-145: non-Leaders, a hand card and a Z-Energy");
  const bt8 = forbids(ops("[Activate: Main][Once per turn] Choose 1 of your Blue/Green multicolor Battle Cards in Rest Mode, and until the start of your next Main Phase, as long as the chosen card is in Rest Mode, your opponent's cards can't attack Leader Cards."));
  assert.deepEqual([bt8[0].side, bt8[0].until, bt8[0].attackTarget?.type, JSON.stringify(bt8[0].unless)], ["opponent", "nextMain", "LEADER", '{"kind":"not","cond":{"kind":"count","sel":{"fromVar":"c0","area":"battle","mode":"rest"},"atLeast":1}}'], "BT8-044's back");
  const bt20125 = forbids(ops("[Auto] If your life is at 4 or more and your opponent's Leader is a black <Cumber> card: When this card is played, for the turn, if your opponent's <Evil Saiyan> or <Cumber> card—both black and with an energy cost of 8—is attacking and in a battle, you can't activate [Counter] skills."));
  assert.deepEqual([bt20125[0].what, bt20125[0].until, (bt20125[0].unless as { cond: { kind: string; role: string } }).cond.role], ["activateCounter", "turn", "attacker"], "BT20-125: only while such a card is the attacking card");
  const bt21b = forbids(ops("[Permanent] Unless there are 1 or more cards of both <Android 17> and <Android 18>―both green and with an energy cost of 2―under this card, you can't activate [Z-Awaken]."));
  assert.deepEqual([bt21b[0].keywordSkill, (bt21b[0].unless as { kind: string; conds: unknown[] }).conds.length], ["Z-Awaken", 2], "BT21-068's back: both Androids");
}

// ── 2. the VM, from both seats ───────────────────────────────────────────────

const C = (id: string, o: Partial<CardDef>) => card(id, { energyCost: 0, comboCost: 0, ...o });
const HAND_TAX = "[Permanent] Your opponent can't play Battle Cards with 20000 power or less unless they choose 3 cards from their hand and place them in their Drop Area as an additional cost.";
const defs: Record<string, CardDef> = {
  ...DEFS,
  HAND_TAX: C("HAND_TAX", { power: 40000, skill: HAND_TAX }),
  REV: C("REV", { power: 10000, colors: ["Green"], skill: "[Revive red/blue]" }),
  RED: C("RED", { colors: ["Red"] }),
  BLUE: C("BLUE", { colors: ["Blue"] }),
  REDBLUE: C("REDBLUE", { colors: ["Red", "Blue"] }),
  YELLOW: C("YELLOW", { colors: ["Yellow"] }),
  PLAIN: C("PLAIN", { power: 30000 }),
  FUS: C("FUS", { power: 20000, energyCost: 1, characters: ["Gogeta: Br"], skill: "[Union-Fusion]{r}: <Son Goku: Br> and <Vegeta: Br>." }),
  BIG_FUS: C("BIG_FUS", { power: 40000, energyCost: 1, characters: ["Gogeta: Br"], skill: "[Union-Fusion]{r}: <Son Goku: Br> and <Vegeta: Br>." }),
  GOKU: C("GOKU", { power: 10000, characters: ["Son Goku: Br"] }),
  VEGETA: C("VEGETA", { power: 10000, characters: ["Vegeta: Br"] }),
  // BT12-001's shape, on an [Activate: Main] so a test can use it at will, with an [Awaken] beside it.
  LFLIP: card("LFLIP", {
    type: "LEADER", energyCost: null, comboCost: null, comboPower: null,
    skill: "[Activate: Main] You may flip this card over. If you do, draw 1 card and you can't flip your Leader Card to its front for the turn.<br>[Awaken] When your life is at 8 or less: Draw 1 card and flip this card over.",
    back: { name: "LFLIP awakened", power: 15000, skill: "[Activate: Main] You may flip this card over. If you do, draw 1 card and you can't flip your Leader Card to its back for the turn." },
  }),
  // BT15-091's two moments.
  LFIELD: card("LFIELD", {
    type: "LEADER", energyCost: null, comboCost: null, comboPower: null,
    skill: "[Auto] When a player places a [Field] Extra Card in a Battle Area, you may flip this card over. If you do, draw 1 card.",
    back: { name: "LFIELD awakened", power: 15000, skill: "[Auto] When a player's [Field] Extra Card leaves a Battle Area, you may flip this card to its front. If you do, you can't flip your Leader Card to its back for the turn." },
  }),
  FIELD: card("FIELD", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Field]" }),
  // BT21-068's back: [Z-Awaken] only with both Androids under the Leader.
  LZAW: card("LZAW", {
    type: "LEADER", energyCost: null, comboCost: null, comboPower: null, characters: ["Son Goku"], skill: null,
    back: { name: "LZAW awakened", power: 15000, skill: "[Permanent] Unless there are 1 or more cards of both <Android 17> and <Android 18>―both green and with an energy cost of 2―under this card, you can't activate [Z-Awaken]." },
  }),
  LZAW_FREE: card("LZAW_FREE", { type: "LEADER", energyCost: null, comboCost: null, comboPower: null, characters: ["Son Goku"], skill: null, back: { name: "LZAW_FREE awakened", power: 15000, skill: null } }),
  ZL: card("ZL", { type: "Z-LEADER", energyCost: null, zEnergyCost: 1, power: 25000, comboCost: null, comboPower: null, skill: "[Z-Awaken] {1} : <Son Goku>" }),
  A17: C("A17", { colors: ["Green"], energyCost: 2, characters: ["Android 17"] }),
  A18: C("A18", { colors: ["Green"], energyCost: 2, characters: ["Android 18"] }),
  A18_RED: C("A18_RED", { colors: ["Red"], energyCost: 2, characters: ["Android 18"] }),
  // BT20-125's ban, put in force as the opponent plays a card.
  NO_COUNTER: C("NO_COUNTER", { skill: "[Auto] When your opponent plays a card, for the turn, if your opponent's <Evil Saiyan> or <Cumber> card—both black and with an energy cost of 8—is attacking and in a battle, you can't activate [Counter] skills." }),
  EVIL: C("EVIL", { colors: ["Black"], energyCost: 8, power: 10000, characters: ["Evil Saiyan"] }),
  EVIL_RED: C("EVIL_RED", { colors: ["Red"], energyCost: 8, power: 10000, characters: ["Evil Saiyan"] }),
  BT8_044: C("BT8_044", { skill: "[Activate: Main][Once per turn] Choose 1 of your Blue/Green multicolor Battle Cards in Rest Mode, and until the start of your next Main Phase, as long as the chosen card is in Rest Mode, your opponent's cards can't attack Leader Cards." }),
  BLUEGREEN: C("BLUEGREEN", { colors: ["Blue", "Green"], power: 10000 }),
  BABY: C("BABY", { characters: ["Baby"] }),
  EVOKO: C("EVOKO", { power: 10000, energyCost: 1, characters: ["Baby"], skill: "[Evolve] {R}: <Baby><br>[permanent] If you played this card with [evolve], it can't be KO'd by your opponent." }),
  KOER: C("KOER", { skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and KO it." }),
  GOTENKS_KO: C("GOTENKS_KO", { skill: "[permanent] If <Gotenks> is under this card, and if there are no cards in your opponent's Combo Area, this card cannot be KO'd." }),
  GOTENKS: C("GOTENKS", { characters: ["Gotenks"] }),
  BT21_099: C("BT21_099", { skill: "[Permanent] If your opponent's Leader is a green <Cell> and this card is in your Battle Area, your Earthling Tokens can't attack, and you can't use your Earthling Tokens or green <Android 17>/<Android 18> cards with an energy cost of 2 in a combo." }),
  LCELL: card("LCELL", { type: "LEADER", colors: ["Green"], characters: ["Cell"], energyCost: null, comboCost: null, comboPower: null }),
  LYELLOW: card("LYELLOW", { type: "LEADER", colors: ["Yellow"], energyCost: null, comboCost: null, comboPower: null }),
  TB1_077: C("TB1_077", { skill: "[permanent] If your Leader Card is yellow, your opponent's [counter] skills and non-keyword [auto]/[activate] skills cannot be activated unless they place 1 card from their life in their Drop Area." }),
  DRAWER: C("DRAWER", { skill: "[Activate: Main] Draw 1 card." }),
  BT20_145: C("BT20_145", { skill: "[Activate: Main] Your opponent can't attack with non-Leaders for the turn unless they place 1 card each from their hand and Z-Energy in their owners' Drops each time." }),
  LADV: card("LADV", { type: "LEADER", energyCost: null, comboCost: null, comboPower: null, skill: null, back: { name: "LADV awakened", power: 15000, skill: "[Permanent] If your green ≪Adventure≫ <Bulma> card is in play in Rest Mode, your green non-<Bulma> ≪Adventure≫ cards can't be removed from a Battle Area by your opponent's skills." } }),
  BULMA: C("BULMA", { colors: ["Green"], traits: ["Adventure"], characters: ["Bulma"] }),
  ADVENT: C("ADVENT", { colors: ["Green"], traits: ["Adventure"], characters: ["Krillin"] }),
  BT21_012: C("BT21_012", { skill: "[Permanent] This card can't be removed from under your Leader by a skill other than this card's skills." }),
  DIGGER: C("DIGGER", { skill: "[Activate: Main] Choose up to 1 card under your Leader and add it to your hand." }),
  BT22_113: C("BT22_113", { skill: "[Permanent] You can't place more than 1 card with the same character name under this card in your Battle Area.<br>[Activate: Main] Choose up to 1 card in your hand and place it under this card." }),
  GOKU_A: C("GOKU_A", { characters: ["Son Goku"] }),
  LANDROID: card("LANDROID", { type: "LEADER", traits: ["Android"], energyCost: null, comboCost: null, comboPower: null }),
  P017: C("P017", { skill: "[Permanent] If your Leader Card is an ≪Android≫, the opponent cannot draw cards when their Leader Card activates [Awaken]. (They still can activate [Awaken])" }),
  P485: C("P485", { skill: "[Activate: Main] Add this card from your hand to your energy, and for the turn, you can't add cards to your energy, can only play mono-blue <Zamasu> or mono-blue <Goku Black> cards." }),
  ZAMASU: C("ZAMASU", { colors: ["Blue"], characters: ["Zamasu"] }),
  ZAMASU_RG: C("ZAMASU_RG", { colors: ["Blue", "Green"], characters: ["Zamasu"] }),
  CHARGER: C("CHARGER", { skill: "[Activate: Main] Place the top card of your deck in your energy." }),
  NO_DECK_PLAY: C("NO_DECK_PLAY", { skill: "[Activate: Main] You can't play cards from your deck for the rest of the game." }),
  DECK_PLAYER: C("DECK_PLAYER", { skill: "[Activate: Main] Choose up to 1 Battle Card in your deck and play it, then shuffle your deck." }),
  ONLY_TRUNKS: C("ONLY_TRUNKS", { skill: "[Activate: Main] You can't play any cards other than red <Trunks: Future> cards for the turn." }),
  TRUNKS_F: C("TRUNKS_F", { colors: ["Red"], characters: ["Trunks: Future"] }),
  LIFELOCK: C("LIFELOCK", { colors: ["Yellow"], skill: "[Permanent] Cards in your life can only be flipped face up by skills on mono-yellow cards; you can't add face-up cards in your life to your hand." }),
  RFLIP: C("RFLIP", { colors: ["Red"], skill: "[Activate: Main] Choose up to 1 card in your life and flip it face up." }),
  YFLIP: C("YFLIP", { colors: ["Yellow"], skill: "[Activate: Main] Choose up to 1 card in your life and flip it face up." }),
  LIFEPICK: C("LIFEPICK", { colors: ["Yellow"], skill: "[Activate: Main] Choose up to 1 card in your life and add it to your hand." }),
  P668: C("P668", { skill: "[permanent] The power of your Battle Cards and Unisons can't be reduced by your opponent's skills." }),
  SHRINK_THEIRS: C("SHRINK_THEIRS", { skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and it gets -5000 power for the turn." }),
  SHRINK_MINE: C("SHRINK_MINE", { skill: "[Activate: Main] Choose up to 1 of your Battle Cards and it gets -5000 power for the turn." }),
  AURA_DOWN: C("AURA_DOWN", { skill: "[Permanent] All of your opponent's Battle Cards get -3000 power." }),
  NO_GAIN: C("NO_GAIN", { skill: "[Activate: Main] Your originally skill-less Battle Cards can't gain skills for the game." }),
  GIVER: C("GIVER", { skill: "[Activate: Main] Choose up to 1 of your Battle Cards and it gains [Blocker] for the turn." }),
  AURA_DS: C("AURA_DS", { skill: "[Permanent] All of your Battle Cards gain [Double Strike]." }),
  CLEAR: C("CLEAR", { skill: "[Activate: Main] Choose up to 1 Extra Card in your opponent's Battle Area and place it in its owner's Drop Area." }),
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
const leaderOf = (s: VmState, p: PlayerId) => s.sides[p].zones.leader[0];
const power = (s: VmState, id: string) => attrsNow(ctx, game, s, id).power as number;
const zoneOf = (s: VmState, id: string) => (["p1", "p2"] as PlayerId[]).flatMap((p) => Object.entries(s.sides[p].zones).filter(([, ids]) => ids.includes(id)).map(([z]) => z))[0];
/** Empty a pile into the Drop Area down to `keep` cards (a state fixture, not a game action). */
function empty(s: VmState, p: PlayerId, zone: string, keep = 0): void {
  for (const id of s.sides[p].zones[zone].slice(keep)) assert.ok(moveCard(s, game, id, "drop", { owner: p }).ok);
}

for (const me of SEATS) {
  const you = other(me);

  // 1 (owner ruling, the batch 5 follow-up): [Revive] under BT6-023's hand tax
  // is judged once its colour cards have left the hand. Hand of RED, BLUE and
  // `extra` more: the colours take two, the tax three more. With 3 extra it is
  // asked; with 2 it is not (it was before the ruling: 4 cards in hand); with a
  // Red/Blue card paying both colours alone, the same four cards in hand are enough (control).
  for (const [label, colours, extra, asked] of [["two colour cards, 3 more", ["RED", "BLUE"], 3, true], ["two colour cards, 2 more", ["RED", "BLUE"], 2, false], ["one Red/Blue card, 3 more", ["REDBLUE"], 3, true]] as const) {
    let s = game3(you);
    stage(s, you, "HAND_TAX", "battle");
    const rev = stage(s, me, "REV", "battle", "rest");
    empty(s, me, "hand");
    const paid = colours.map((c) => stage(s, me, c, "hand"));
    const rest = Array.from({ length: extra }, () => stage(s, me, "YELLOW", "hand"));
    s = roundtrip(s);
    const hand = s.sides[me].zones.hand.length;
    s = take(s, { type: "attack", player: you, attacker: stage(s, you, "PLAIN", "battle"), target: rev });
    const reviveAsked = (t: VmState) => t.prompt.kind === "chooseCards" && /Revive/.test(t.prompt.choice.reason ?? "");
    s = roundtrip(settle(s, [], 0, reviveAsked));
    assert.equal(zoneOf(s, rev), "drop", `${me}: the Revive card is KO'd`);
    assert.equal(reviveAsked(s), asked, `${me}: [Revive] ${asked ? "is" : "is not"} asked — ${label}`);
    if (!asked) {
      assert.equal(s.sides[me].zones.hand.length, hand, `${me}: no hand card dropped (${label})`);
      continue;
    }
    // Paid: the colours, then the tax's three, and the card is back.
    const taxAsked = (t: VmState) => t.prompt.kind === "chooseMode";
    const atTax = roundtrip(settle(s, paid, 0, taxAsked));
    assert.ok(taxAsked(atTax), `${me}: the play asks the tax once the colours are paid (${label})`);
    for (const id of paid) assert.equal(zoneOf(atTax, id), "drop", `${me}: the colour card is paid`);
    const yes = roundtrip(settle(atTax, rest, 0));
    assert.equal(zoneOf(yes, rev), "battle", `${me}: tax paid — revived (${label})`);
    for (const id of rest.slice(0, 3)) assert.equal(zoneOf(yes, id), "drop", `${me}: the tax's three hand cards are paid`);
    // Declined (22-5-7): no play, and the colours stay paid.
    const no = roundtrip(settle(atTax, [], 1));
    assert.equal(zoneOf(no, rev), "drop", `${me}: tax declined — a failed play, the card stays in the Drop (${label})`);
    for (const id of paid) assert.equal(zoneOf(no, id), "drop", `${me}: the colours stay paid`);
    for (const id of rest) assert.equal(zoneOf(no, id), "hand", `${me}: nothing of the tax is paid`);
  }

  // 2: [Union-Fusion] under the same tax is judged once its two materials have
  // left the hand. Hand of the Fusion card, its two materials and `extra` more.
  {
    for (const [extra, offered] of [[3, true], [2, false]] as const) {
      const s = game3(me);
      stage(s, you, "HAND_TAX", "battle");
      empty(s, me, "hand");
      const fus = stage(s, me, "FUS", "hand");
      const goku = stage(s, me, "GOKU", "hand");
      const vegeta = stage(s, me, "VEGETA", "hand");
      const rest = Array.from({ length: extra }, () => stage(s, me, "YELLOW", "hand"));
      for (let i = 0; i < 2; i++) stage(s, me, "V1", "energy");
      const r = roundtrip(s);
      assert.equal(activations(r, fus).length, offered ? 1 : 0, `${me}: [Union-Fusion] ${offered ? "is" : "is not"} offered with ${extra} cards beside its materials`);
      if (!offered) {
        const big = roundtrip(r);
        big.cards[fus].cardId = "BIG_FUS";
        assert.equal(activations(roundtrip(big), fus).length, 1, `${me}: an untaxed [Union-Fusion] is offered on that hand (control)`);
        continue;
      }
      const taxAsked = (t: VmState) => t.prompt.kind === "chooseMode";
      const atTax = roundtrip(settle(take(r, activations(r, fus)[0].action), [goku, vegeta], 0, taxAsked));
      assert.ok(taxAsked(atTax), `${me}: the Fusion's play asks the tax`);
      assert.deepEqual([zoneOf(atTax, goku), zoneOf(atTax, vegeta)], ["drop", "drop"], `${me}: the materials are paid first`);
      const yes = roundtrip(settle(atTax, rest, 0));
      assert.equal(zoneOf(yes, fus), "battle", `${me}: tax paid — the Fusion is played`);
      const no = roundtrip(settle(atTax, [], 1));
      assert.equal(zoneOf(no, fus), "drop", `${me}: declined — a failed play, the card in the Drop (22-13-4-5-1)`);
      for (const id of rest) assert.equal(zoneOf(no, id), "hand", `${me}: nothing of the tax is paid`);
    }
  }

  // 3 (BT12-001, BT15-091): "you can't flip your Leader Card to its front
  // (back) for the turn". The front flips over and forbids the front: the back's
  // own "flip this card over" then does nothing, and "if you do" is false. The
  // next turn the back flips to the front and forbids the back: [Awaken] is not
  // offered, and the front's flip does nothing. Controls: [Awaken] is offered on
  // a board without the rule; the back turns to the front once the rule is gone.
  {
    let s = game3(me);
    const leader = leaderOf(s, me);
    s.cards[leader].cardId = "LFLIP";
    s = roundtrip(s);
    const awaken = () => RULES.legalActions(ctx, s).filter((l) => l.action.type === "activate" && l.action.card === leader && /Awaken/.test(l.label ?? ""));
    assert.equal(awaken().length, 1, `${me}: [Awaken] is offered with no rule in force (control)`);
    const main = () => RULES.legalActions(ctx, s).filter((l) => l.action.type === "activate" && l.action.card === leader && !/Awaken/.test(l.label ?? ""));
    let hand = s.sides[me].zones.hand.length;
    s = roundtrip(settle(take(s, main()[0].action), [], 0));
    assert.equal(s.cards[leader].flipped, true, `${me}: the front flips over`);
    assert.equal(s.sides[me].zones.hand.length, hand + 1, `${me}: and draws`);
    hand = s.sides[me].zones.hand.length;
    s = roundtrip(settle(take(s, main()[0].action), [], 0));
    assert.equal(s.cards[leader].flipped, true, `${me}: BT12-001 — the back can't flip to the front this turn`);
    assert.equal(s.sides[me].zones.hand.length, hand, `${me}: "if you do" is false — no draw`);
    s = roundtrip(endTurn(endTurn(s)));
    hand = s.sides[me].zones.hand.length;
    s = roundtrip(settle(take(s, main()[0].action), [], 0));
    assert.equal(s.cards[leader].flipped, false, `${me}: the next turn the back flips over to its front`);
    assert.equal(s.sides[me].zones.hand.length, hand + 1, `${me}: and draws`);
    empty(s, me, "life", 4);
    s = roundtrip(s);
    assert.equal(awaken().length, 0, `${me}: BT15-091 — [Awaken] is not offered while the back is forbidden`);
    s = roundtrip(settle(take(s, main()[0].action), [], 0));
    assert.equal(s.cards[leader].flipped, false, `${me}: nor does the front's own flip happen`);
    s = roundtrip(endTurn(endTurn(s)));
    assert.equal(awaken().length, 1, `${me}: the rule gone with the turn, [Awaken] is offered again`);
  }

  // 4 (BT15-091's moments): either player placing a [Field] Extra Card turns the
  // front over; another card placed does not (control). Either player's [Field]
  // leaving a Battle Area turns the back to its front.
  {
    let s = game3(you);
    const leader = leaderOf(s, me);
    s.cards[leader].cardId = "LFIELD";
    const plain = stage(s, you, "PLAIN", "hand");
    const field = stage(s, you, "FIELD", "hand");
    s = roundtrip(s);
    s = roundtrip(settle(take(s, { type: "play", player: you, card: plain } as Action), [], 0));
    assert.equal(s.cards[leader].flipped, false, `${me}: a Battle Card placed is not the moment (control)`);
    const [placeField] = RULES.legalActions(ctx, s).filter((l) => l.action.type === "activate" && l.action.card === field);
    assert.ok(placeField, `${me}: the opponent's [Field] is offered`);
    s = roundtrip(settle(take(s, placeField.action), [], 0));
    assert.equal(zoneOf(s, field), "battle", `${me}: the [Field] is in the Battle Area`);
    assert.equal(s.cards[leader].flipped, true, `${me}: BT15-091 — the opponent's [Field] placed turns the front over`);
    s = roundtrip(endTurn(s));
    const clear = stage(s, me, "CLEAR", "battle");
    s = roundtrip(s);
    const [use] = RULES.legalActions(ctx, s).filter((l) => l.action.type === "activate" && l.action.card === clear);
    assert.ok(use, `${me}: the remover is offered`);
    s = roundtrip(settle(take(s, use.action), [field], 0));
    assert.equal(zoneOf(s, field), "drop", `${me}: the [Field] left the Battle Area`);
    assert.equal(s.cards[leader].flipped, false, `${me}: BT15-091's back — the [Field] leaving turns it to its front`);
  }

  // 5 (BT21-068's back): [Z-Awaken] is not offered until a green cost-2
  // <Android 17> and a green cost-2 <Android 18> are both under the Leader; a
  // red <Android 18> is not one (control); without the rule it is offered.
  {
    const board = (leaderDef: string, under: string[]) => {
      const s = game3(me);
      const leader = leaderOf(s, me);
      s.cards[leader].cardId = leaderDef;
      s.cards[leader].flipped = true;
      const zl = stage(s, me, "ZL", "zDeck");
      stage(s, me, "V1", "zEnergy");
      stage(s, me, "V1", "energy");
      for (const def of under) {
        const id = s.sides[me].zones.deck[0]; s.cards[id].cardId = def;
        assert.ok(moveCard(s, game, id, "under", { owner: me, under: leader } as never).ok);
      }
      const r = roundtrip(s);
      return RULES.legalActions(ctx, r).some((l) => l.action.type === "activate" && l.action.card === zl);
    };
    assert.ok(board("LZAW_FREE", []), `${me}: [Z-Awaken] is offered without the rule (control)`);
    assert.ok(!board("LZAW", []), `${me}: BT21-068 — not with nothing under the Leader`);
    assert.ok(!board("LZAW", ["A17"]), `${me}: not with <Android 17> alone`);
    assert.ok(!board("LZAW", ["A17", "A18_RED"]), `${me}: not with a red <Android 18>`);
    assert.ok(board("LZAW", ["A17", "A18"]), `${me}: offered with both under it`);
  }

  // 6 (BT20-125): while a black cost-8 <Evil Saiyan> is the attacking card, my
  // [Counter] is not offered; a red one attacking is no such card (control).
  for (const [attackerDef, offered] of [["EVIL", false], ["EVIL_RED", true]] as const) {
    let s = game3(you);
    stage(s, me, "NO_COUNTER", "battle");
    const counter = stage(s, me, "E-NEGATE", "hand");
    stage(s, me, "V1", "energy");
    const attacker = stage(s, you, attackerDef, "battle");
    const played = stage(s, you, "PLAIN", "hand");
    s = roundtrip(s);
    s = roundtrip(settle(take(s, { type: "play", player: you, card: played } as Action)));
    s = take(s, { type: "attack", player: you, attacker, target: leaderOf(s, me) });
    s = roundtrip(settle(s, [], 0, (t) => t.prompt.kind === "counter"));
    // A window with nothing to offer is not opened at all.
    const counters = s.prompt.kind !== "counter" ? [] : RULES.legalActions(ctx, s).filter((l) => l.action.type === "counter" && (l.action as { card: string | null }).card === counter);
    assert.equal(counters.length > 0, offered, `${me}: BT20-125 — [Counter] ${offered ? "is" : "is not"} offered against ${attackerDef}`);
  }

  // 7 (BT8-044's back): until my next Main Phase, while the chosen card stays
  // in Rest Mode, no card of the opponent's — one played later too — attacks a
  // Leader; a rested Battle Card may still be attacked (control); once the
  // chosen card stands up, the Leader may be attacked again.
  {
    let s = game3(me);
    const chosen = stage(s, me, "BLUEGREEN", "battle", "rest");
    const guard = stage(s, me, "PLAIN", "battle", "rest");
    const bt8 = stage(s, me, "BT8_044", "battle");
    s = roundtrip(s);
    const [use] = RULES.legalActions(ctx, s).filter((l) => l.action.type === "activate" && l.action.card === bt8);
    assert.ok(use, `${me}: BT8-044's skill is offered`);
    s = roundtrip(settle(take(s, use.action), [chosen], 0));
    s = roundtrip(endTurn(s));
    const late = stage(s, you, "PLAIN", "battle");
    s = roundtrip(s);
    const attacks = (t: VmState, target: string) => RULES.legalActions(ctx, t).some((l) => l.action.type === "attack" && (l.action as { attacker: string; target: string }).attacker === late && (l.action as { target: string }).target === target);
    assert.ok(!attacks(s, leaderOf(s, me)), `${me}: BT8-044 — a card played after the rule can't attack the Leader`);
    assert.ok(attacks(s, guard), `${me}: it may attack a rested Battle Card (control)`);
    s.cards[chosen].mode = "active";
    s = roundtrip(s);
    assert.ok(attacks(s, leaderOf(s, me)), `${me}: with the chosen card in Active Mode, the Leader may be attacked`);
  }

  // 8 (EX04-04): evolved, it survives the opponent's KO skill; played any other
  // way it does not (control).
  for (const evolved of [true, false]) {
    let s = game3(me);
    let evo: string;
    if (evolved) {
      evo = stage(s, me, "EVOKO", "hand");
      const base = stage(s, me, "BABY", "battle");
      stage(s, me, "V1", "energy");
      s = roundtrip(s);
      s = roundtrip(settle(take(s, RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === evo)!.action), [base], 0));
      assert.equal(zoneOf(s, evo), "battle", `${me}: evolved`);
    } else {
      evo = stage(s, me, "EVOKO", "battle");
      s = roundtrip(s);
    }
    s = roundtrip(endTurn(s));
    const koer = stage(s, you, "KOER", "battle");
    s = roundtrip(s);
    s = roundtrip(settle(take(s, RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === koer)!.action), [evo], 0));
    assert.equal(zoneOf(s, evo), evolved ? "battle" : "drop", `${me}: EX04-04 — ${evolved ? "played with [Evolve], the opponent's skill can't KO it" : "placed otherwise, it is KO'd (control)"}`);
  }

  // 9 (BT2-026): with <Gotenks> under it and the opponent's Combo Area empty,
  // the opponent's skill can't KO it; without <Gotenks> it can (control).
  for (const under of [true, false]) {
    let s = game3(you);
    const it = stage(s, me, "GOTENKS_KO", "battle");
    if (under) {
      const g = s.sides[me].zones.deck[0]; s.cards[g].cardId = "GOTENKS";
      assert.ok(moveCard(s, game, g, "under", { owner: me, under: it } as never).ok);
    }
    const koer = stage(s, you, "KOER", "battle");
    s = roundtrip(s);
    s = roundtrip(settle(take(s, RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === koer)!.action), [it], 0));
    assert.equal(zoneOf(s, it), under ? "battle" : "drop", `${me}: BT2-026 — ${under ? "not KO'd with <Gotenks> under it" : "KO'd without (control)"}`);
  }

  // 10 (BT21-099): against a green <Cell> Leader, the Earthling Tokens and the
  // green cost-2 Androids can't be used in a combo; another card can (control).
  {
    let s = game3(me);
    s.cards[leaderOf(s, you)].cardId = "LCELL";
    stage(s, me, "BT21_099", "battle");
    const a17 = stage(s, me, "A17", "hand");
    const plain = stage(s, me, "PLAIN", "hand");
    s = roundtrip(s);
    assert.ok(forbiddenBy(ctx, game, s, "combo", { player: me, card: a17 }), `${me}: BT21-099 — a green cost-2 <Android 17> can't combo`);
    assert.equal(forbiddenBy(ctx, game, s, "combo", { player: me, card: plain }), null, `${me}: another card can (control)`);
  }

  // 11 (TB1-077): with my Leader yellow, the opponent's non-keyword [Activate]
  // costs them a life card; with it not yellow, nothing (control).
  for (const yellow of [true, false]) {
    let s = game3(you);
    if (yellow) s.cards[leaderOf(s, me)].cardId = "LYELLOW";
    stage(s, me, "TB1_077", "battle");
    const drawer = stage(s, you, "DRAWER", "battle");
    s = roundtrip(s);
    const life = s.sides[you].zones.life.length;
    const [use] = RULES.legalActions(ctx, s).filter((l) => l.action.type === "activate" && l.action.card === drawer);
    assert.ok(use, `${me}: the opponent's [Activate: Main] is offered`);
    s = roundtrip(settle(take(s, use.action), [], 0));
    assert.equal(s.sides[you].zones.life.length, yellow ? life - 1 : life, `${me}: TB1-077 — ${yellow ? "a life card paid" : "nothing paid (control)"}`);
  }

  // 12 (BT20-145): the opponent's Battle Cards attack only by paying a hand card
  // and a Z-Energy each time; their Leader attacks freely (control).
  // 13 (BT27-044's back): with my green ≪Adventure≫ <Bulma> rested, the
  // opponent's skill can't KO my other green ≪Adventure≫ card; with it in
  // Active Mode it can (control).
  for (const rested of [true, false]) {
    let s = game3(you);
    const leader = leaderOf(s, me);
    s.cards[leader].cardId = "LADV"; s.cards[leader].flipped = true;
    stage(s, me, "BULMA", "battle", rested ? "rest" : "active");
    const adv = stage(s, me, "ADVENT", "battle");
    const koer = stage(s, you, "KOER", "battle");
    s = roundtrip(s);
    s = roundtrip(settle(take(s, RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === koer)!.action), [adv], 0));
    assert.equal(zoneOf(s, adv), rested ? "battle" : "drop", `${me}: BT27-044 — ${rested ? "protected while <Bulma> is rested" : "KO'd with <Bulma> active (control)"}`);
  }

  // 14 (BT21-012): another skill of mine can't take it from under my Leader;
  // a card without the rule under the Leader can be taken (control).
  for (const def of ["BT21_012", "PLAIN"]) {
    let s = game3(me);
    const leader = leaderOf(s, me);
    const pile = s.sides[me].zones.deck[0]; s.cards[pile].cardId = def;
    assert.ok(moveCard(s, game, pile, "under", { owner: me, under: leader } as never).ok);
    const digger = stage(s, me, "DIGGER", "battle");
    s = roundtrip(s);
    s = roundtrip(settle(take(s, RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === digger)!.action), [pile], 0));
    assert.equal(s.cards[leader].under.includes(pile), def === "BT21_012", `${me}: BT21-012 — ${def === "BT21_012" ? "stays under the Leader" : "taken (control)"}`);
  }

  // 15 (BT22-113): a second <Son Goku> is not placed under it; a card of
  // another name is (control).
  {
    let s = game3(me);
    const host = stage(s, me, "BT22_113", "battle");
    const g1 = stage(s, me, "GOKU_A", "hand");
    const g2 = stage(s, me, "GOKU_A", "hand");
    const other = stage(s, me, "PLAIN", "hand");
    s = roundtrip(s);
    const place = (t: VmState, id: string) => roundtrip(settle(take(t, RULES.legalActions(ctx, t).find((l) => l.action.type === "activate" && l.action.card === host)!.action), [id], 0));
    s = place(s, g1);
    assert.ok(s.cards[host].under.includes(g1), `${me}: the first <Son Goku> goes under`);
    s = roundtrip(endTurn(endTurn(s)));
    s = place(s, g2);
    assert.ok(!s.cards[host].under.includes(g2), `${me}: BT22-113 — a second <Son Goku> does not`);
    s = roundtrip(endTurn(endTurn(s)));
    s = place(s, other);
    assert.ok(s.cards[host].under.includes(other), `${me}: another name does (control)`);
  }

  // 16 (P-017): with my Leader an ≪Android≫, the opponent's [Awaken] flips
  // their Leader and draws nothing; without P-017 it draws (control).
  for (const ruled of [true, false]) {
    let s = game3(you);
    s.cards[leaderOf(s, me)].cardId = "LANDROID";
    const theirs = leaderOf(s, you);
    s.cards[theirs].cardId = "L-RED";
    if (ruled) stage(s, me, "P017", "battle");
    empty(s, you, "life", 4);
    s = roundtrip(s);
    const hand = s.sides[you].zones.hand.length;
    const [awaken] = RULES.legalActions(ctx, s).filter((l) => l.action.type === "activate" && l.action.card === theirs);
    assert.ok(awaken, `${me}: the opponent's [Awaken] is offered`);
    s = roundtrip(settle(take(s, awaken.action), [], 0));
    assert.equal(s.cards[theirs].flipped, true, `${me}: P-017 — they still awaken`);
    assert.equal(s.sides[you].zones.hand.length, ruled ? hand : hand + 1, `${me}: P-017 — ${ruled ? "and draw nothing" : "and draw (control)"}`);
  }

  // 17 (P-485): for the turn, only a mono-blue <Zamasu> is played (a Blue/Green
  // one is not), and a skill puts no card in the Energy Area; before the rule
  // the other card is played (control).
  {
    let s = game3(me);
    const p485 = stage(s, me, "P485", "hand");
    const plain = stage(s, me, "PLAIN", "hand");
    const zamasu = stage(s, me, "ZAMASU", "hand");
    const dual = stage(s, me, "ZAMASU_RG", "hand");
    const charger = stage(s, me, "CHARGER", "battle");
    s = roundtrip(s);
    const plays = (t: VmState, id: string) => RULES.legalActions(ctx, t).some((l) => l.action.type === "play" && (l.action as { card: string }).card === id);
    assert.ok(plays(s, plain), `${me}: before the rule, any card is played (control)`);
    s = roundtrip(settle(take(s, RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === p485)!.action)));
    assert.equal(zoneOf(s, p485), "energy", `${me}: P-485 itself goes to the energy first`);
    assert.ok(!plays(s, plain), `${me}: P-485 — not a red card`);
    assert.ok(!plays(s, dual), `${me}: …nor a Blue/Green <Zamasu>`);
    assert.ok(plays(s, zamasu), `${me}: a mono-blue <Zamasu> is`);
    const energy = s.sides[me].zones.energy.length;
    s = roundtrip(settle(take(s, RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === charger)!.action)));
    assert.equal(s.sides[me].zones.energy.length, energy, `${me}: no card is added to the energy by a skill`);
  }

  // 18 (P-496): no card is played from my deck for the rest of the game; from
  // the hand it is (control).
  {
    let s = game3(me);
    const lock = stage(s, me, "NO_DECK_PLAY", "battle");
    const player = stage(s, me, "DECK_PLAYER", "battle");
    const fromHand = stage(s, me, "PLAIN", "hand");
    s = roundtrip(s);
    s = roundtrip(settle(take(s, RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === lock)!.action)));
    s = roundtrip(endTurn(endTurn(s)));
    for (const id of s.sides[me].zones.deck.slice(0, 5)) s.cards[id].cardId = "PLAIN";
    s = roundtrip(s);
    const battle = s.sides[me].zones.battle.length;
    s = roundtrip(settle(take(s, RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === player)!.action), s.sides[me].zones.deck.slice(0, 5), 0));
    assert.equal(s.sides[me].zones.battle.length, battle, `${me}: P-496 — nothing played from the deck, a turn later too`);
    assert.ok(RULES.legalActions(ctx, s).some((l) => l.action.type === "play" && (l.action as { card: string }).card === fromHand), `${me}: a card in hand is still played (control)`);
    let c = game3(me);
    const free = stage(c, me, "DECK_PLAYER", "battle");
    for (const id of c.sides[me].zones.deck.slice(0, 5)) c.cards[id].cardId = "PLAIN";
    c = roundtrip(c);
    const before = c.sides[me].zones.battle.length;
    c = roundtrip(settle(take(c, RULES.legalActions(ctx, c).find((l) => l.action.type === "activate" && l.action.card === free)!.action), c.sides[me].zones.deck.slice(0, 5), 0));
    assert.equal(c.sides[me].zones.battle.length, before + 1, `${me}: without the rule the deck's card is played (control)`);
  }

  // 19 (BT23-005): "you can't play any cards other than red <Trunks: Future>
  // cards" lets those through and stops every other — not the reverse.
  {
    let s = game3(me);
    const lock = stage(s, me, "ONLY_TRUNKS", "battle");
    const plain = stage(s, me, "PLAIN", "hand");
    const trunks = stage(s, me, "TRUNKS_F", "hand");
    s = roundtrip(s);
    s = roundtrip(settle(take(s, RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === lock)!.action)));
    const plays = (t: VmState, id: string) => RULES.legalActions(ctx, t).some((l) => l.action.type === "play" && (l.action as { card: string }).card === id);
    assert.ok(plays(s, trunks), `${me}: BT23-005 — a red <Trunks: Future> is played`);
    assert.ok(!plays(s, plain), `${me}: another card is not`);
  }

  // 20 (BT12-086): a red skill turns no Life card face up, a mono-yellow one
  // does (control); a face-up Life card is not added to the hand, a face-down
  // one is (control).
  {
    let s = game3(me);
    stage(s, me, "LIFELOCK", "battle");
    const red = stage(s, me, "RFLIP", "battle");
    const yellow = stage(s, me, "YFLIP", "battle");
    const pick = stage(s, me, "LIFEPICK", "battle");
    s = roundtrip(s);
    const [first, second] = s.sides[me].zones.life;
    const use = (t: VmState, id: string, cards: string[]) => roundtrip(settle(take(t, RULES.legalActions(ctx, t).find((l) => l.action.type === "activate" && l.action.card === id)!.action), cards, 0));
    s = use(s, red, [first]);
    assert.equal(s.cards[first].faceUp, false, `${me}: BT12-086 — a red card's skill turns no Life card face up`);
    s = use(s, yellow, [first]);
    assert.equal(s.cards[first].faceUp, true, `${me}: a mono-yellow card's skill does (control)`);
    s = use(s, pick, [first]);
    assert.equal(zoneOf(s, first), "life", `${me}: BT12-086 — the face-up Life card is not added to the hand`);
    s = roundtrip(endTurn(endTurn(s)));
    s = use(s, pick, [second]);
    assert.equal(zoneOf(s, second), "hand", `${me}: a face-down one is (control)`);
  }

  // 21 (P-668): neither the opponent's skill nor their [Permanent] reduces my
  // Battle Card's power; my own skill does (control); without P-668 theirs does.
  for (const ruled of [true, false]) {
    let s = game3(you);
    if (ruled) stage(s, me, "P668", "battle");
    const mine = stage(s, me, "PLAIN", "battle");
    const shrink = stage(s, you, "SHRINK_THEIRS", "battle");
    stage(s, you, "AURA_DOWN", "battle");
    s = roundtrip(s);
    const before = 30000;
    assert.equal(power(s, mine), ruled ? before : before - 3000, `${me}: P-668 — the opponent's [Permanent] ${ruled ? "does not reduce it" : "reduces it (control)"}`);
    s = roundtrip(settle(take(s, RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === shrink)!.action), [mine], 0));
    assert.equal(power(s, mine), ruled ? before : before - 8000, `${me}: P-668 — the opponent's skill ${ruled ? "does not reduce it" : "reduces it (control)"}`);
    if (!ruled) continue;
    s = roundtrip(endTurn(s));
    const own = stage(s, me, "SHRINK_MINE", "battle");
    s = roundtrip(s);
    s = roundtrip(settle(take(s, RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === own)!.action), [mine], 0));
    assert.equal(power(s, mine), before - 5000, `${me}: my own skill reduces it (control)`);
  }

  // 22 (BT22-081): an originally skill-less Battle Card gains neither a granted
  // [Blocker] nor a [Permanent]'s [Double Strike]; a card with skills does (control).
  {
    let s = game3(me);
    const lock = stage(s, me, "NO_GAIN", "battle");
    const giver = stage(s, me, "GIVER", "battle");
    const bare = stage(s, me, "PLAIN", "battle");
    const skilled = stage(s, me, "CHARGER", "battle");
    stage(s, me, "AURA_DS", "battle");
    s = roundtrip(s);
    s = roundtrip(settle(take(s, RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === lock)!.action)));
    s = roundtrip(settle(take(s, RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === giver)!.action), [bare], 0));
    assert.ok(!hasKeyword(ctx, game, s, bare, "Blocker"), `${me}: BT22-081 — no granted [Blocker]`);
    assert.ok(!hasKeyword(ctx, game, s, bare, "Strike"), `${me}: …nor the [Permanent]'s [Double Strike]`);
    assert.ok(hasKeyword(ctx, game, s, skilled, "Strike"), `${me}: a card with skills gains it (control)`);
  }

  // (Put in force on the opponent's own turn by an [Activate: Main] of theirs
  // naming "your opponent" — here, me — so the attacker is the activating seat's opponent.)
  {
    let s = game3(you);
    const tax = stage(s, you, "BT20_145", "battle");
    const attacker = stage(s, me, "PLAIN", "battle");
    s = roundtrip(s);
    s = roundtrip(settle(take(s, RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === tax)!.action)));
    s = roundtrip(endTurn(s));
    // The rule is for the turn it was made in; asked again on my turn it is gone.
    const canAttackNow = (t: VmState, id: string) => RULES.legalActions(ctx, t).some((l) => l.action.type === "attack" && (l.action as { attacker: string }).attacker === id);
    assert.ok(canAttackNow(s, attacker), `${me}: BT20-145 — the rule ends with the turn it was made in`);
    // On the turn it holds: with no Z-Energy, a Battle Card can't attack; the Leader can.
    let t = game3(me);
    const tax2 = stage(t, you, "BT20_145", "battle");
    const mine = stage(t, me, "PLAIN", "battle");
    t = roundtrip(t);
    const forced = roundtrip(t);
    forced.effects.push({ id: 9999, master: you, source: tax2, target: "", kind: "forbid", value: 0, until: "turn", forbid: { what: "attack", player: me, filter: { ...parseFilter(""), notType: "LEADER" }, pay: (forbids(ops("[Activate: Main] Your opponent can't attack with non-Leaders for the turn unless they place 1 card each from their hand and Z-Energy in their owners' Drops each time."))[0].unlessPay ?? []) as Op[] } } as never);
    empty(forced, me, "zEnergy");
    const f1 = roundtrip(forced);
    assert.ok(!canAttackNow(f1, mine), `${me}: with no Z-Energy to pay, the Battle Card can't attack`);
    assert.ok(canAttackNow(f1, leaderOf(f1, me)), `${me}: the Leader can (control)`);
    stage(forced, me, "V1", "zEnergy");
    const f2 = roundtrip(forced);
    assert.ok(canAttackNow(f2, mine), `${me}: with a hand card and a Z-Energy, it can`);
    const hand = f2.sides[me].zones.hand.length;
    const after = roundtrip(settle(take(f2, RULES.legalActions(ctx, f2).find((l) => l.action.type === "attack" && (l.action as { attacker: string }).attacker === mine)!.action)));
    assert.deepEqual([after.sides[me].zones.hand.length, after.sides[me].zones.zEnergy.length], [hand - 1, 0], `${me}: one hand card and the Z-Energy paid`);
  }
}
console.log("prohibition catalog 6: owner ruling (a keyword play's tax judged after its own hand costs — [Revive]'s colours, [Union-Fusion]'s materials) — enforced from both seats");
