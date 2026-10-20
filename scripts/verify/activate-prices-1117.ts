/**
 * #1117 (owner ruling 20 Oct 2026, 4-3-3): KO, reveal, shuffle and "use in a combo" are payable [Activate] prices.
 *
 *  - KO: offered only with a card the price's filter matches that can really be KO'd; the payer picks it, it goes to the
 *    Drop as a KO (a "when KO'd" Auto fires). If anything stops the KO the price is unpaid and the effect does not happen.
 *  - Reveal: offered only with a matching card in hand; the payer picks it, the opponent is shown it, it stays in hand.
 *  - Shuffle: the rest of the price first, then the shuffle; not offered if the rest cannot be paid.
 *  - comboFrom: a real combo, offered in a battle the player is in; the card goes to the Combo Area, adds its combo power
 *    and combo-triggered Autos fire.
 *
 * The lines are compiled from the catalog's printed texts (EB1-10 #10, BT24-034 #10, DB2-021 #0, BT28-066 #10, the last with
 * the catalog's "Mulit" typo). The second mode of DB2-021 is reconstructed. Rules engine only; nothing reads the database.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, IMPL, card, compileCostProgram, compileSkill, fifty, findG, leaderOf, parseSkills, playG, rejectedActionsG, zoneOf } from "./harness";
import type { Action, EngineState, PlayerId, VmState } from "./harness";
import type { GameEvent } from "../../src/lib/arena/types";
import { activationPriceProblem } from "../../src/lib/arena/vm/activation-price-support";
import { tokenCardId } from "../../src/lib/arena/vm/common";
import type { Op } from "../../src/lib/arena/vm/script";

const EB1_10 = "[Activate: Battle] Choose one of your <Saibaiman> cards and KO it: Draw 1 card, then choose up to 1 of your opponent's Battle Cards and it gets -10000 power for the turn.";
const BT24_034 = "[activate: main][limit 1]{u}, reveal 1 blue <Trunks: Youth> card from your hand: Play this card from your hand.";
const DB2_021 = "[Activate: Main][Once per turn] Choose 1 Battle Card with an energy cost of 1 from your deck, place it in your Drop Area, then shuffle your deck: Choose one- ・Choose up to 1 of your Battle Cards and it gets +5000 power for the turn. ・Choose up to 1 of your opponent's Battle Cards and it gets -5000 power for the turn.";
const BT28_066 = "[Activate: Battle][Limit 1]{g}, choose 1 of your Mulit-Form Tokens and use it in a combo: Draw 1 card and play this card from your hand.";

// ── the printed prices compile, and the static planner accepts them ──
for (const [id, text] of [["EB1-10", EB1_10], ["BT24-034", BT24_034], ["DB2-021", DB2_021], ["BT28-066", BT28_066]] as const) {
  const skill = parseSkills(text)[0]!;
  assert.deepEqual(compileSkill(skill).unsupported, [], `${id}: the line reads`);
  const price = compileCostProgram(skill)!;
  assert.deepEqual(price.unsupported, [], `${id}: the price reads`);
  assert.equal(activationPriceProblem(price.ops), null, `${id}: the static planner accepts the price`);
}
{
  // "Choose one of your <Saibaiman> cards" is one card, not "all of them".
  const choose = compileCostProgram(parseSkills(EB1_10)[0]!)!.ops[0] as Extract<Op, { op: "choose" }>;
  assert.equal(choose.sel.count, 1, "a word-spelled one is one card");
}

// ── the static half: what stays refused ──
{
  const choose = (as: string): Op => ({ op: "choose", sel: { side: "you", area: "battle", count: 1 }, as }) as Op;
  assert.equal(activationPriceProblem([choose("c0"), { op: "ko", target: { var: "c0" } } as Op]), null);
  assert.equal(activationPriceProblem([{ op: "ko", target: { sel: { special: "self" } } } as Op]), null, "KO this card");
  assert.match(activationPriceProblem([{ op: "ko", target: { sel: { side: "you", area: "battle" } } } as Op]) ?? "", /ko a card the price did not choose/, "a KO of whatever a selector finds");
  assert.match(activationPriceProblem([{ op: "comboFrom", target: { var: "c9" } } as unknown as Op]) ?? "", /comboFrom a card the price did not choose/);
  assert.match(activationPriceProblem([{ op: "shuffle" } as Op]) ?? "", /shuffle that is the whole price/);
  assert.match(activationPriceProblem([choose("c0"), { op: "shuffle" } as Op, { op: "ko", target: { var: "c0" } } as Op]) ?? "", /step after the shuffle/);
  assert.match(activationPriceProblem([{ op: "reveal", sel: { fromVar: "nope" }, as: "r" } as unknown as Op]) ?? "", /reveal of cards the price did not choose/);
  for (const name of ["chooseMode", "negateSkills", "control", "if", "lifeDownTo"]) assert.match(activationPriceProblem([{ op: name } as unknown as Op]) ?? "", new RegExp(`does not support ${name} as a cost`), `${name} stays refused`);
}

// ── fixtures ──
DEFS["P1-SAI"] = card("P1-SAI", { energyCost: 1, characters: ["Saibaiman"], skill: "[Auto] When this card is KO'd, draw 1 card." });
DEFS["P1-SAI-BARRIER"] = card("P1-SAI-BARRIER", { energyCost: 1, characters: ["Saibaiman"], skill: "[Barrier]" });
DEFS["P1-SAI-NOKO"] = card("P1-SAI-NOKO", { energyCost: 1, characters: ["Saibaiman"], skill: "[Permanent] This card can't be KO'd." });
DEFS["P1-SAI-SWAP"] = card("P1-SAI-SWAP", { energyCost: 1, characters: ["Saibaiman"], skill: "[Permanent] If this card would be KO'd, you may discard 1 card from your hand instead." });
DEFS["P1-OTHER"] = card("P1-OTHER", { energyCost: 1, characters: ["Vegeta"], skill: null });
DEFS["P1-EB1"] = card("P1-EB1", { type: "EXTRA", colors: ["Red"], energyCost: 0, power: null, comboCost: null, comboPower: null, characters: ["Saibaiman Sacrifice"], skill: EB1_10 });
DEFS["P1-BT24"] = card("P1-BT24", { colors: ["Blue"], energyCost: 1, characters: ["Future Trunks"], skill: BT24_034 });
DEFS["P1-TY-A"] = card("P1-TY-A", { colors: ["Blue"], characters: ["Trunks: Youth"], skill: null });
DEFS["P1-TY-B"] = card("P1-TY-B", { colors: ["Blue"], characters: ["Trunks: Youth"], skill: null });
DEFS["P1-TY-RED"] = card("P1-TY-RED", { colors: ["Red"], characters: ["Trunks: Youth"], skill: null });
DEFS["P1-DB2"] = card("P1-DB2", { colors: ["Red"], energyCost: 2, characters: ["Shuffler"], skill: DB2_021 });
DEFS["P1-DECK1"] = card("P1-DECK1", { energyCost: 1, characters: ["One"], skill: null });
DEFS["P1-DECK2"] = card("P1-DECK2", { energyCost: 2, characters: ["Two"], skill: null });
DEFS["P1-BT28"] = card("P1-BT28", { colors: ["Green"], energyCost: 1, characters: ["Multi Host"], skill: BT28_066 });
DEFS["P1-GREEN"] = card("P1-GREEN", { colors: ["Green"], skill: null });
DEFS["P1-BLUE"] = card("P1-BLUE", { colors: ["Blue"], skill: null });
const MULTI = tokenCardId("Mulit-Form", 5000, 0, 7000, ["Green"]);

/** p1's second-turn Main Phase with the named cards staged in the areas (hand, battle and energy start empty). */
function game(o: { hand?: string[]; battle?: string[]; energy?: string[]; deck?: string[] }): VmState {
  let r = IMPL.createGame(CTX, { seed: 7, p1: { name: "You", leader: "L-RED", main: fifty("V1"), z: [] }, p2: { name: "Claude", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  const chooser = (r.prompt as { player: PlayerId }).player;
  r = IMPL.apply(CTX, r, { type: "chooseFirst", player: chooser, first: "p1" }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "mulligan", player: "p1", redraw: false }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "mulligan", player: "p2", redraw: false }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "charge", player: "p1", card: null }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "endMain", player: "p1" }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "charge", player: "p2", card: null }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "endMain", player: "p2" }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "charge", player: "p1", card: null }).state as VmState;
  assert.equal(r.prompt.kind, "main");
  for (const area of ["hand", "battle", "energy"] as const) {
    r.sides.p1.zones.deck.push(...r.sides.p1.zones[area]);
    r.sides.p1.zones[area] = [];
  }
  const stage = (cardId: string, area: "hand" | "battle" | "energy") => {
    const id = r.sides.p1.zones.deck.find((x) => r.cards[x].cardId === "V1");
    assert.ok(id, "the deck has a filler card to relabel");
    r.sides.p1.zones.deck = r.sides.p1.zones.deck.filter((x) => x !== id);
    r.cards[id!].cardId = cardId;
    r.sides.p1.zones[area] = [...r.sides.p1.zones[area], id!];
    if (area !== "hand") r.cards[id!].mode = "active";
  };
  for (const id of o.hand ?? []) stage(id, "hand");
  for (const id of o.battle ?? []) stage(id, "battle");
  for (const id of o.energy ?? []) stage(id, "energy");
  // The deck: every filler becomes a cost-2 card unless the scenario names a deck, so "a cost-1 Battle Card in the deck" is its own doing.
  if (o.deck) {
    for (const id of r.sides.p1.zones.deck) r.cards[id].cardId = "P1-DECK2";
    o.deck.forEach((cardId, i) => { r.cards[r.sides.p1.zones.deck[i + 3]!].cardId = cardId; });
  }
  return r;
}

type Rows = ReturnType<typeof IMPL.legalActions>;
const rows = (s: EngineState): Rows => IMPL.legalActions(CTX, s);
const activations = (s: EngineState, id: string) => rows(s).map((a) => a.action).filter((a) => a.type === "activate" && a.card === id);
const refusal = (s: EngineState, id: string) => rejectedActionsG(s).find((row) => row.action.type === "activate" && row.action.card === id)?.why;
const names = (s: EngineState, area: "hand" | "battle" | "drop" | "combo" | "deck", p: PlayerId = "p1") => zoneOf(s, p, area).map((id) => s.cards[id].cardId);
const skillBeats = (ev: GameEvent[], id: string) => ev.filter((e) => e.type === "skill" && e.card === id).length;
const draws = (ev: GameEvent[]) => ev.filter((e) => e.type === "draw").length;

/** Answer what the line asks until `stop` says so: the named card when it is on offer, else the first; modes by index 0, replacement questions by `replace`. */
function answer(s: EngineState, ev: GameEvent[], pick: string[], opts: { replace?: number; stop?: (s: EngineState) => boolean } = {}): EngineState {
  for (let i = 0; i < 24 && !opts.stop?.(s); i++) {
    const p = s.prompt as unknown as { kind: string; player: PlayerId; choice?: { candidates: string[] }; options?: unknown[] };
    let action: Action;
    if (p.kind === "chooseCards") {
      const want = p.choice!.candidates.find((c) => pick.includes(c));
      action = { type: "choose", player: p.player, cards: [want ?? p.choice!.candidates[0]!] } as Action;
    } else if (p.kind === "chooseMode") action = { type: "chooseMode", player: p.player, index: 0 } as Action;
    else if (p.kind === "replaceMove") action = { type: "chooseMode", player: p.player, index: opts.replace ?? (p.options!.length - 1) } as Action;
    else break;
    const next = IMPL.apply(CTX, JSON.parse(JSON.stringify(s)) as EngineState, action);
    ev.push(...next.events);
    s = next.state;
  }
  return s;
}

/** Attack p2's Leader with p1's and pass the defender's steps until p1's combo prompt. */
function toCombo(s: EngineState): EngineState {
  const leader = leaderOf(s, "p1");
  s = playG(s, { type: "attack", player: "p1", attacker: leader, target: leaderOf(s, "p2") } as Action);
  for (let i = 0; i < 12; i++) {
    const p = s.prompt as { kind: string; player?: PlayerId };
    if (p.kind === "combo" && p.player === "p1") return s;
    const pass = rows(s).find((r) => "player" in r.action && r.action.player === "p2" && (r.action.type === "pass" || (r.action.type === "block" && r.action.card === null)));
    assert.ok(pass, `the battle stopped at ${p.kind} (${p.player}) with no pass for p2`);
    s = IMPL.apply(CTX, s, pass.action).state;
  }
  throw new Error("never reached p1's combo prompt");
}
const saibaiman = (s: EngineState) => zoneOf(s, "p1", "battle").filter((id) => DEFS[s.cards[id].cardId]?.characters.includes("Saibaiman"));

// ── KO: EB1-10 ──
{
  const s = toCombo(game({ hand: ["P1-EB1"], battle: ["P1-SAI", "P1-OTHER"] }));
  const host = findG(s, "p1", "hand", "P1-EB1");
  const acts = activations(s, host);
  assert.equal(acts.length, 1, `offered with a <Saibaiman> in play (refusal: ${JSON.stringify(refusal(s, host))})`);
  const sai = saibaiman(s)[0]!;
  const before = draws([]);
  void before;
  const ev: GameEvent[] = [];
  const first = IMPL.apply(CTX, s, acts[0]!);
  ev.push(...first.events);
  const t = answer(first.state, ev, [sai], { stop: (x) => x.prompt.kind === "combo" });
  assert.ok(names(t, "drop").includes("P1-SAI"), "paying KO'd the <Saibaiman> into the Drop");
  assert.ok(!names(t, "battle").includes("P1-SAI") && names(t, "battle").includes("P1-OTHER"), "and only it");
  assert.equal(draws(ev), 2, "the Auto's draw (a price KO is a KO) and the effect's draw");
  assert.equal(skillBeats(ev, host), 1, "the line was announced once, after the price");
}
{
  // Not offered without a <Saibaiman>.
  const s = toCombo(game({ hand: ["P1-EB1"], battle: ["P1-OTHER"] }));
  const host = findG(s, "p1", "hand", "P1-EB1");
  assert.equal(activations(s, host).length, 0, "no <Saibaiman>: not offered");
  assert.match(String((refusal(s, host)?.[0] as { detail?: string } | undefined)?.detail), /cannot pay/);
}
{
  // Where the KO is stopped before it is asked, the line is not offered: the payer cannot stop halfway.
  const s = toCombo(game({ hand: ["P1-EB1"], battle: ["P1-SAI-NOKO"] }));
  assert.equal(activations(s, findG(s, "p1", "hand", "P1-EB1")).length, 0, "a card that can't be KO'd is no price");
}
{
  // [Barrier] says an opponent's skill cannot choose the card; the payer's own price still can, and the KO is paid.
  const s = toCombo(game({ hand: ["P1-EB1"], battle: ["P1-SAI-BARRIER"] }));
  const host = findG(s, "p1", "hand", "P1-EB1");
  assert.equal(activations(s, host).length, 1, "[Barrier] does not stand in the way of your own KO");
  const ev: GameEvent[] = [];
  const t = answer(IMPL.apply(CTX, s, activations(s, host)[0]!).state, ev, [], { stop: (x) => x.prompt.kind === "combo" });
  assert.ok(names(t, "drop").includes("P1-SAI-BARRIER"));
}
{
  // The KO is stopped after the offer: the card's own optional replacement is taken instead. Nothing was paid, so the
  // effect does not happen — no draw, no -10000, no announcement.
  const s = toCombo(game({ hand: ["P1-EB1", "P1-OTHER"], battle: ["P1-SAI-SWAP"] }));
  const host = findG(s, "p1", "hand", "P1-EB1");
  const acts = activations(s, host);
  assert.equal(acts.length, 1, "the replacement is the payer's option, so the line is offered");
  const ev: GameEvent[] = [];
  const first = IMPL.apply(CTX, s, acts[0]!);
  ev.push(...first.events);
  const t = answer(first.state, ev, [], { replace: 0, stop: (x) => x.prompt.kind === "combo" });
  assert.equal(t.prompt.kind, "combo", "back at the combo prompt");
  assert.ok(names(t, "battle").includes("P1-SAI-SWAP"), "the card was not KO'd");
  assert.ok(!names(t, "drop").includes("P1-SAI-SWAP"));
  assert.equal(draws(ev), 0, "the effect's draw did not happen");
  assert.equal(skillBeats(ev, host), 0, "the line was never announced: its price was not paid");
  assert.ok(ev.some((e) => e.type === "note" && /price was not paid/.test(String((e as { text?: string }).text))), "and the log says why");
  // Declining the replacement is paying.
  const ev2: GameEvent[] = [];
  const again = answer(IMPL.apply(CTX, s, acts[0]!).state, ev2, [], { stop: (x) => x.prompt.kind === "combo" });
  assert.ok(names(again, "drop").includes("P1-SAI-SWAP"), "declined: KO'd");
  assert.equal(skillBeats(ev2, host), 1);
}

// ── reveal: BT24-034 ──
{
  const s = game({ hand: ["P1-BT24", "P1-TY-A"], energy: ["P1-BLUE"] });
  const host = findG(s, "p1", "hand", "P1-BT24");
  const acts = activations(s, host);
  assert.equal(acts.length, 1, `offered with a blue <Trunks: Youth> in hand (refusal: ${JSON.stringify(refusal(s, host))})`);
  const ev: GameEvent[] = [];
  const first = IMPL.apply(CTX, s, acts[0]!);
  ev.push(...first.events);
  const t = answer(first.state, ev, []);
  assert.equal(t.prompt.kind, "main");
  assert.ok(names(t, "hand").includes("P1-TY-A"), "after paying, the revealed card is still in the hand");
  assert.ok(names(t, "battle").includes("P1-BT24"), "and the line played this card");
  assert.ok(ev.some((e) => e.type === "note" && /revealed P1-TY-A/.test(String((e as { text?: string }).text))), "the opponent was shown it (the log)");
}
{
  // Two matches: the payer picks, only the pick is shown. A red one and a non-Youth card are no match.
  const s = game({ hand: ["P1-BT24", "P1-TY-A", "P1-TY-B", "P1-TY-RED"], energy: ["P1-BLUE"] });
  const host = findG(s, "p1", "hand", "P1-BT24");
  const first = IMPL.apply(CTX, s, activations(s, host)[0]!);
  const asked = first.state.prompt as unknown as { kind: string; choice: { candidates: string[] } };
  assert.equal(asked.kind, "chooseCards", "the payer is asked which to show");
  assert.deepEqual(asked.choice.candidates.map((id) => first.state.cards[id].cardId).sort(), ["P1-TY-A", "P1-TY-B"], "the blue <Trunks: Youth> cards only");
  const pickB = findG(first.state, "p1", "hand", "P1-TY-B");
  const ev: GameEvent[] = [...first.events];
  const t = answer(first.state, ev, [pickB]);
  const shown = ev.filter((e) => e.type === "note" && /revealed/.test(String((e as { text?: string }).text))).map((e) => String((e as { text?: string }).text));
  assert.deepEqual(shown, ["revealed P1-TY-B"], "the opponent saw the pick and nothing else");
  assert.equal(names(t, "hand").filter((n) => n.startsWith("P1-TY")).length, 3, "all three stayed in the hand");
}
{
  // Not offered with no matching card — the host itself is not a <Trunks: Youth>; a red one does not match either.
  const none = game({ hand: ["P1-BT24", "P1-TY-RED"], energy: ["P1-BLUE"] });
  assert.equal(activations(none, findG(none, "p1", "hand", "P1-BT24")).length, 0, "no blue <Trunks: Youth>");
  // Nor without the {u}: the rest of the price is not paid.
  const dry = game({ hand: ["P1-BT24", "P1-TY-A"] });
  assert.equal(activations(dry, findG(dry, "p1", "hand", "P1-BT24")).length, 0, "no energy for the rest of the price");
}

// ── shuffle: DB2-021 ──
{
  const s = game({ battle: ["P1-DB2"], deck: ["P1-DECK1"] });
  const host = findG(s, "p1", "battle", "P1-DB2");
  const acts = activations(s, host);
  assert.equal(acts.length, 1, `offered with a cost-1 Battle Card in the deck (refusal: ${JSON.stringify(refusal(s, host))})`);
  const deckBefore = zoneOf(s, "p1", "deck").filter((id) => s.cards[id].cardId !== "P1-DECK1");
  const ev: GameEvent[] = [];
  const first = IMPL.apply(CTX, s, acts[0]!);
  ev.push(...first.events);
  const t = answer(first.state, ev, []);
  assert.equal(t.prompt.kind, "main");
  assert.deepEqual(names(t, "drop").filter((n) => n === "P1-DECK1"), ["P1-DECK1"], "the cost-1 card went to the Drop");
  assert.ok(!names(t, "deck").includes("P1-DECK1"));
  const deckAfter = zoneOf(t, "p1", "deck");
  assert.equal(deckAfter.length, deckBefore.length, "nothing else left the deck");
  assert.notDeepEqual(deckAfter, deckBefore, "the deck was shuffled after the move");
  const moveAt = ev.findIndex((e) => e.type === "move" && (e as { card?: string }).card !== undefined && first.state.cards[(e as { card: string }).card]?.cardId === "P1-DECK1");
  const shuffleAt = ev.findIndex((e) => e.type === "note" && /shuffles their deck/.test(String((e as { text?: string }).text)));
  assert.ok(shuffleAt >= 0 && (moveAt < 0 || moveAt < shuffleAt), "the shuffle is logged, after the move");
  assert.equal(skillBeats(ev, host), 1);
  // Once per turn: the price was paid, the use is spent.
  assert.equal(activations(t, host).length, 0, "[Once per turn]");
}
{
  // The rest of the price cannot be paid: no cost-1 Battle Card in the deck, so the shuffle is not on offer.
  const s = game({ battle: ["P1-DB2"], deck: [] });
  assert.equal(activations(s, findG(s, "p1", "battle", "P1-DB2")).length, 0, "no cost-1 card in the deck: the line is not offered");
}

// ── comboFrom: BT28-066 ──
{
  const main = game({ hand: ["P1-BT28"], battle: [MULTI], energy: ["P1-GREEN"] });
  assert.equal(activations(main, findG(main, "p1", "hand", "P1-BT28")).length, 0, "[Activate: Battle] is not a Main Phase line");
  const s = toCombo(main);
  const host = findG(s, "p1", "hand", "P1-BT28");
  const acts = activations(s, host);
  assert.equal(acts.length, 1, `offered in a battle with a Multi-Form Token (refusal: ${JSON.stringify(refusal(s, host))})`);
  const token = zoneOf(s, "p1", "battle").find((id) => s.cards[id].cardId === MULTI)!;
  const ev: GameEvent[] = [];
  const first = IMPL.apply(CTX, s, acts[0]!);
  ev.push(...first.events);
  let t = answer(first.state, ev, [token], { stop: (x) => x.prompt.kind === "combo" });
  assert.equal(t.prompt.kind, "combo", "back at the combo prompt");
  assert.ok(zoneOf(t, "p1", "combo").includes(token), "the token stands in the Combo Area");
  assert.ok(!zoneOf(t, "p1", "battle").includes(token));
  assert.equal(skillBeats(ev, host), 1, "the line was announced once the price was paid");
  assert.equal(draws(ev), 1, "the line drew (the token has no Auto of its own)");
  assert.ok(names(t, "battle").includes("P1-BT28"), "and this card was played");
  // Its combo power is added: pass the rest of the battle and read the comparison.
  for (let i = 0; i < 20 && !ev.some((e) => e.type === "powerCompare"); i++) {
    const p = t.prompt as { player?: PlayerId };
    const pass = rows(t).find((r) => "player" in r.action && r.action.player === p.player && (r.action.type === "pass" || (r.action.type === "block" && r.action.card === null)));
    if (!pass) break;
    const next = IMPL.apply(CTX, t, pass.action);
    ev.push(...next.events);
    t = next.state;
  }
  const compare = ev.find((e) => e.type === "powerCompare") as { attackPower: number } | undefined;
  assert.ok(compare, "the battle reached the power comparison");
  const leaderPower = Number(DEFS["L-RED"]!.power ?? 0);
  assert.equal(compare!.attackPower, leaderPower + 7000, "the token's 7000 combo power is in the attack");
}
{
  // No token: not offered. A token while the Main Phase has no battle: the line is not a Main line, so not offered either.
  const s = toCombo(game({ hand: ["P1-BT28"], battle: ["P1-OTHER"], energy: ["P1-GREEN"] }));
  assert.equal(activations(s, findG(s, "p1", "hand", "P1-BT28")).length, 0, "no Multi-Form Token: not offered");
  // A token with no combo power cannot be used in a combo (5-7-2): no price to pay.
  const dud = toCombo(game({ hand: ["P1-BT28"], battle: [tokenCardId("Mulit-Form", 5000, null, null, ["Green"])], energy: ["P1-GREEN"] }));
  assert.equal(activations(dud, findG(dud, "p1", "hand", "P1-BT28")).length, 0, "a token that cannot combo is no price");
}
{
  // The card's own "when you combo with this card" Auto fires too (a variant of the line naming a card with skills; the token has none).
  DEFS["P1-PAL"] = card("P1-PAL", { energyCost: 1, characters: ["Combo Pal"], skill: "[Auto] When you combo with this card, draw 1 card." });
  DEFS["P1-PALHOST"] = card("P1-PALHOST", { colors: ["Green"], energyCost: 1, characters: ["Pal Host"], skill: "[Activate: Battle][Limit 1]{g}, choose 1 of your <Combo Pal> cards and use it in a combo: Draw 1 card." });
  const s = toCombo(game({ battle: ["P1-PALHOST", "P1-PAL"], energy: ["P1-GREEN"] }));
  const host = findG(s, "p1", "battle", "P1-PALHOST");
  assert.equal(activations(s, host).length, 1, `offered (refusal: ${JSON.stringify(refusal(s, host))})`);
  const ev: GameEvent[] = [];
  const first = IMPL.apply(CTX, s, activations(s, host)[0]!);
  ev.push(...first.events);
  const t = answer(first.state, ev, [], { stop: (x) => x.prompt.kind === "combo" });
  assert.ok(names(t, "combo").includes("P1-PAL"), "the card stands in the Combo Area");
  assert.equal(draws(ev), 2, "its own combo-entry Auto fired, and the line drew");
}
