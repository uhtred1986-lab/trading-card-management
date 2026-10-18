/**
 * #907, follow-up to #1042: qualified combo-entry moments, played on the rules VM.
 *
 *  - "when this card is **used in a combo from your hand**" (BT22-052, BT24-116, BT24-120, P-578 and 29 more) answers to a
 *    combo from the hand and not to one from the Battle Area;
 *  - "when this card **in your deck or hand** is used in a combo" (EX23-23): either area, not the Battle Area;
 *  - "when you combo with this card **from an Energy Area using {X}'s skill**" (BT7-030): the Energy Area, and only when
 *    the card named made the combo;
 *  - "… from your hand **with an <Android 18> card in battle**" (BT8-030): the company is asked when the Auto resolves;
 *  - a combo a skill makes is a combo (5-7-2): the card's own entry Auto answers to it, unless it was used "with its
 *    skills negated" (9-1-5);
 *  - P-703's "look at up to 5 cards, use up to 1 … card in a combo": the card comes from the five.
 *
 * Wordings are the catalog's text of 18 Oct 2026. Nothing reads the database.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, IMPL, arenaG, card, leaderOf, zoneOf } from "./harness";
import type { Action, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { EngineState } from "../../src/lib/arena/engines";

const FROM_HAND = "[Auto] When this card is used in a combo from your hand, draw 1 card.";
const DECK_OR_HAND = "[Auto] When this card in your deck or hand is used in a combo, draw 1 card.";
const VIA = "[Auto] When you combo with this card from an Energy Area using {MET907}'s skill, draw 1 card.";
const COMPANY = "[Auto] When you combo with this card from your hand with an <A18X> card in battle, draw 1 card.";
const COMBO_FROM_ENERGY = "[Auto] When this card attacks, choose up to 1 red Battle Card in your Energy Area and combo with it.";
const LOOK_AND_USE = "[Auto] When this card attacks, look at up to 5 cards from the top of your deck, use up to 1 red ≪PTEST≫ card in a combo, then shuffle your deck.";
const LOOK_AND_USE_NEGATED = "[Auto] When this card attacks, look at up to 5 cards from the top of your deck, use up to 1 red ≪PTEST≫ card in a combo with its skills negated for the turn, then shuffle your deck.";
DEFS.FH907 = card("FH907", { skill: FROM_HAND, traits: ["PTEST"] });
DEFS.DH907 = card("DH907", { skill: DECK_OR_HAND, traits: ["PTEST"] });
DEFS.VIA907 = card("VIA907", { skill: VIA });
DEFS.CO907 = card("CO907", { skill: COMPANY });
DEFS.MET907 = card("MET907", { power: 20000, skill: COMBO_FROM_ENERGY });
DEFS.OTH907 = card("OTH907", { power: 20000, skill: COMBO_FROM_ENERGY });
DEFS.A18X907 = card("A18X907", { power: 20000, characters: ["A18X"] });
DEFS.LOOK907 = card("LOOK907", { power: 20000, skill: LOOK_AND_USE });
DEFS.LOOKN907 = card("LOOKN907", { power: 20000, skill: LOOK_AND_USE_NEGATED });
DEFS.DROP907 = card("DROP907", { skill: "[Activate: Battle][Limit 1] If your Leader is a red card: Use this card in a combo from your Drop." });
DEFS.P690 = card("P690", { skill: "[blocker] [auto][limit 1] When you use a card in a combo, you may use this card from a Battle Area in a combo. If you do, play this card from its owner's Drop at the end of the battle." });
DEFS.DECOY907 = card("DECOY907", { traits: ["PTEST"] });

const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
function take(state: EngineState, action: Action): { state: EngineState; events: GameEvent[] } {
  assert.ok(IMPL.legalActions(CTX, state).some((row) => JSON.stringify(row.action) === JSON.stringify(action)),
    `expected legal ${JSON.stringify(action)} at ${state.prompt.kind}`);
  const r = IMPL.apply(CTX, roundtrip(state), action); // every step runs on a reloaded copy
  return { state: r.state, events: r.events };
}
function stage(state: EngineState, owner: PlayerId, cardId: string, area: "hand" | "battle" | "energy" | "deck"): string {
  const id = zoneOf(state, owner, "deck").shift();
  assert.ok(id);
  state.cards[id].cardId = cardId;
  if (area === "deck") zoneOf(state, owner, "deck").unshift(id);
  else zoneOf(state, owner, area).push(id);
  if (area === "battle" || area === "energy") state.cards[id].mode = "active";
  return id;
}
const skills = (events: GameEvent[], id: string): GameEvent[] => events.filter((e) => e.type === "skill" && e.card === id);

/** Declare the attack and answer whatever the Autos ask until the combo prompt; the events so far are returned with it. */
function attackFrom(state: EngineState, attacker: string, answer: (s: EngineState) => Action | null = () => null): { state: EngineState; events: GameEvent[] } {
  let r = take(state, { type: "attack", player: "p1", attacker, target: leaderOf(state, "p2")! });
  const events = [...r.events];
  for (let i = 0; i < 20 && r.state.prompt.kind !== "combo"; i++) {
    const q = r.state.prompt;
    const chosen = answer(r.state);
    const action: Action = chosen ?? (q.kind === "chooseCards" ? { type: "choose", player: q.player, cards: q.choice.candidates.slice(0, Math.max(q.choice.min, 1)) }
      : q.kind === "orderPending" ? { type: "orderPending", player: q.player, index: 0 }
      : q.kind === "counter" ? { type: "counter", player: q.player, card: null }
      : q.kind === "blocker" ? { type: "block", player: q.player, card: null }
      : (() => { throw Error(`unexpected ${q.kind}`); })());
    r = take(r.state, action);
    events.push(...r.events);
  }
  assert.equal(r.state.prompt.kind, "combo");
  return { state: r.state, events };
}
function finish(state: EngineState): EngineState {
  for (let i = 0; i < 12 && state.prompt.kind !== "main"; i++) {
    const q = state.prompt;
    const action: Action = q.kind === "combo" ? { type: "pass", player: q.player }
      : q.kind === "zEnergyFromCombo" ? { type: "zEnergyFromCombo", player: q.player, card: null }
      : q.kind === "counter" ? { type: "counter", player: q.player, card: null }
      : q.kind === "blocker" ? { type: "block", player: q.player, card: null }
      : (() => { throw Error(`battle stopped at ${q.kind}`); })();
    state = take(state, action).state;
  }
  assert.equal(state.prompt.kind, "main");
  return state;
}

// 1+2. The origin: a combo declared from the hand answers, one declared from the Battle Area does not.
for (const [cardId, area, fires] of [
  ["FH907", "hand", 1], ["FH907", "battle", 0],
  ["DH907", "hand", 1], ["DH907", "battle", 0],
] as const) {
  const s = arenaG();
  const combo = stage(s, "p1", cardId, area);
  const att = attackFrom(s, leaderOf(s, "p1")!);
  const joined = take(att.state, { type: "combo", player: "p1", card: combo });
  assert.equal(skills(joined.events, combo).length, fires, `${cardId} used from the ${area}`);
  finish(joined.state);
}

// 3. A combo a skill makes from the deck is a combo from the deck: "in your deck or hand" answers, "from your hand" does not.
for (const [cardId, fires] of [["DH907", 1], ["FH907", 0]] as const) {
  const s = arenaG();
  const att0 = stage(s, "p1", "LOOK907", "battle");
  const decoy = stage(s, "p1", "DECOY907", "hand"); // a red ≪PTEST≫ card in the hand is not one of the five
  const battleDecoy = stage(s, "p1", "DECOY907", "battle");
  const used = stage(s, "p1", cardId, "deck");
  const seen: string[][] = [];
  const att = attackFrom(s, att0, (st) => {
    if (st.prompt.kind === "chooseCards") { seen.push([...st.prompt.choice.candidates]); return null; }
    return null;
  });
  assert.ok(seen.length, "the Auto asked which card to use");
  assert.ok(seen[0].includes(used), "a card among the five looked at is a candidate");
  assert.ok(!seen[0].includes(decoy) && !seen[0].includes(battleDecoy), "and a card of the same kind in the hand or the Battle Area is not (P-703 uses a card from the five)");
  assert.ok(zoneOf(att.state, "p1", "combo").includes(used), "the chosen card went from the deck to the Combo Area");
  assert.equal(skills(att.events, used).length, fires, `${cardId} used from the deck by a skill`);
  finish(att.state);
}

// 3b. "… with its skills negated for the turn": the combo is made, the card's own Auto is not heard (9-1-5).
{
  const s = arenaG();
  const att0 = stage(s, "p1", "LOOKN907", "battle");
  const used = stage(s, "p1", "DH907", "deck");
  const att = attackFrom(s, att0);
  assert.ok(zoneOf(att.state, "p1", "combo").includes(used));
  assert.equal(skills(att.events, used).length, 0, "negated skills answer to nothing");
  finish(att.state);
}

// 4. "From an Energy Area using {MET907}'s skill": the card named made the combo, from the Energy Area.
for (const [by, fires] of [["MET907", 1], ["OTH907", 0]] as const) {
  const s = arenaG();
  const att0 = stage(s, "p1", by, "battle");
  const energy = stage(s, "p1", "VIA907", "energy");
  const att = attackFrom(s, att0);
  assert.ok(zoneOf(att.state, "p1", "combo").includes(energy), `${by}'s skill combos the card from the Energy Area`);
  assert.equal(skills(att.events, energy).length, fires, `combo made by ${by}'s skill`);
  finish(att.state);
}

// 5. "With an <A18X> card in battle": asked when the Auto resolves, of the cards in the battle.
for (const [attacker, fires] of [["A18X907", 1], ["leader", 0]] as const) {
  const s = arenaG();
  const att0 = attacker === "leader" ? leaderOf(s, "p1")! : stage(s, "p1", attacker, "battle");
  const combo = stage(s, "p1", "CO907", "hand");
  const att = attackFrom(s, att0);
  const before = zoneOf(att.state, "p1", "hand").length;
  const joined = take(att.state, { type: "combo", player: "p1", card: combo });
  // The Auto resolves either way (its condition is part of the program), so what it did is what shows: the draw.
  assert.equal(zoneOf(joined.state, "p1", "hand").length, before - 1 + fires, `attacking with ${attacker}`);
  finish(joined.state);
}

// 6. "Use this card in a combo from your Drop" names the area the line is used from (9-1-3-2): it is offered from the Drop
// (BT18-082 and its family; it read as "this card" with no area and was offered nowhere a card in the Drop can be).
{
  const s = arenaG();
  const id = stage(s, "p1", "DROP907", "hand");
  zoneOf(s, "p1", "hand").splice(zoneOf(s, "p1", "hand").indexOf(id), 1);
  zoneOf(s, "p1", "drop").push(id);
  const att = attackFrom(s, leaderOf(s, "p1")!);
  const offered = IMPL.legalActions(CTX, att.state).some((l) => l.action.type === "activate" && l.action.card === id);
  assert.ok(offered, "the line is offered from the Drop at the combo step");
  const used = take(att.state, { type: "activate", player: "p1", card: id, skill: 0 });
  assert.ok(zoneOf(used.state, "p1", "combo").includes(id), "and uses the card from the Drop in a combo");
  finish(used.state);
}

// 7. P-690 already had its moment ("when you use a card in a combo" is `youCombo`, which a declared combo wakes); played here so the
// delayed half is seen to run: it uses itself in the combo, and is played from the Drop again once the battle is over.
{
  const s = arenaG();
  const p690 = stage(s, "p1", "P690", "battle");
  const other = stage(s, "p1", "V1", "hand");
  const att = attackFrom(s, leaderOf(s, "p1")!);
  let r = take(att.state, { type: "combo", player: "p1", card: other });
  for (let i = 0; i < 6 && r.state.prompt.kind !== "combo"; i++) {
    const q = r.state.prompt;
    const legal = IMPL.legalActions(CTX, r.state).map((l) => l.action);
    const yes = legal.find((a) => JSON.stringify(a).includes("true")) ?? legal[0];
    r = take(r.state, q.kind === "orderPending" ? { type: "orderPending", player: q.player, index: 0 } : yes);
  }
  assert.ok(zoneOf(r.state, "p1", "combo").includes(p690), "P-690 used itself in the combo");
  const end = finish(r.state);
  assert.ok(zoneOf(end, "p1", "battle").includes(p690), "and was played from the Drop at the end of the battle");
}

console.log("#907 qualified combo entry: origin, deck-or-hand, Energy Area + skill, company, skill combos and P-703's five passed");
