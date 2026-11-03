/**
 * Integration 3 (3 Nov 2026): the owner's answers to the round-2 lanes' open questions that changed the code.
 *
 * R-230. "[Activate: Main]{r}{r}{r}: If your Leader Card is a red <Gogeta: Br> card and you have 4 or more energy: Choose …"
 *        (EX15-01): the "If …:" after the price's colon is the line's activation condition (the record's `cond`), as
 *        "{u}, if …:" printed inside the price is — the skill can't be activated unless it holds.
 * R-270. "You can't activate [Field] cards for the duration of the game" (XD3-01): every activation of a [Field] card,
 *        from any area and by any means — a skill's "activate {X}" from the deck too (22-3-3), not only 12-1-3's
 *        activation from the hand.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
let records = 0;
let cases = 0;

// ── R-230 ────────────────────────────────────────────────────────────────────
{
  const [rec] = skillRecords(card("EX15-01", { skill: "[activate: main]{r}{r}{r}: If your Leader Card is a red <Gogeta: Br> card and you have 4 or more energy: Choose up to 1 mono-red <Gogeta: Br> card with an energy cost of 8 or less from your deck or hand, play it on top of this card, then shuffle your deck if you looked through it. You can't activate the [activate: main] skill on copies of this card for the turn." }));
  assert.deepEqual(rec.unread, [], "R-230: EX15-01 — read");
  const conds = JSON.stringify(rec.cond ?? null);
  assert.ok(/leaderMatches/.test(conds) && /energy/i.test(conds), `R-230: EX15-01 — the Leader and energy conditions are the record's activation condition (${conds.slice(0, 200)})`);
  assert.ok(!JSON.stringify(rec.ops).includes("leaderMatches"), "R-230: EX15-01 — …and not a check inside the effect");
  records++;
}

// ── R-270: the record ────────────────────────────────────────────────────────
{
  const [rec] = skillRecords(card("XD3-01", { type: "LEADER", skill: "[Auto] When this card is placed in your Leader Area, choose up to 1 {Cell Games Arena} from your deck, activate it, and you can't activate [Field] cards for the duration of the game." }));
  const flat = JSON.stringify(rec.ops);
  assert.ok(/"keywordSkill":"Field"/.test(flat) && /"extraCardActivation":true/.test(flat), "R-270: XD3-01 — the hand activation and the [Field] keyword itself are both forbidden");
  records++;
}

// ── R-270: in play ───────────────────────────────────────────────────────────
// A lock on [Field] activation, then a skill that activates a [Field] card from the deck: it stays in the deck.
const vmDefs: Record<string, CardDef> = {
  ...DEFS,
  "I3-FIELD": card("I3-FIELD", { type: "EXTRA", colors: ["Blue"], energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Field]<br>[Permanent] Nothing happens." }),
  "I3-LOCK": card("I3-LOCK", { skill: "[Activate: Main] You can't activate [Field] cards for the duration of the game." }),
  "I3-CALL": card("I3-CALL", { skill: "[Activate: Main] Activate up to 1 {I3-FIELD} from your deck, then shuffle your deck." }),
};
const vmRows = Object.values(vmDefs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow));
for (const name of ["I3-LOCK", "I3-CALL"]) assert.ok(skillRecords(vmDefs[name]).every((r) => !r.unread.length), `${name}: read`);
const ctx: EngineContext = { ...CTX, defs: vmDefs, scripts: rulesFromRows(roundtrip(vmRows), vmDefs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
const take = (s: VmState, action: Action): VmState => roundtrip(RULES.apply(ctx, roundtrip(s), action).state as VmState);
function fresh(seed: number): VmState {
  let s = RULES.createGame(ctx, { seed, p1: { name: "First", leader: "L-BLUE", main: fifty("V1") }, p2: { name: "Second", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: s.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false },
    { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null },
  ] as Action[])
    s = take(s, action);
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string): string {
  // A card left in the deck is taken from its other end, so the next card staged is a different one.
  const id = area === "deck" ? s.sides[p].zones.deck[0] : s.sides[p].zones.deck.at(-1)!;
  s.cards[id].cardId = def;
  if (area !== "deck") assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle") s.cards[id].mode = "active";
  s.pending = [];
  return id;
}
function activate(s0: VmState, c: string): VmState {
  const offer = RULES.legalActions(ctx, s0).find((l) => (l.action as { card?: string }).card === c && l.action.type === "activate");
  assert.ok(offer, `${s0.cards[c].cardId}: offered`);
  let s = take(s0, offer.action);
  for (let i = 0; i < 40 && s.prompt.kind !== "main"; i++) {
    const q = s.prompt as { kind: string; player: PlayerId; choice?: { candidates: string[]; min: number } };
    if (q.kind === "chooseCards") s = take(s, { type: "choose", player: q.player, cards: q.choice!.candidates.slice(0, Math.max(1, q.choice!.min)) } as Action);
    else if (q.kind === "payCost") s = take(s, { type: "payCost", player: q.player, option: 0 } as Action);
    else if (q.kind === "counter") s = take(s, { type: "counter", player: q.player, card: null } as Action);
    else s = take(s, { type: "pass", player: q.player } as Action);
  }
  assert.equal(s.prompt.kind, "main", "settled");
  return s;
}
for (const locked of [false, true]) {
  let s = fresh(73040 + Number(locked));
  const field = stage(s, "p1", "I3-FIELD", "deck");
  const lock = stage(s, "p1", "I3-LOCK", "battle");
  const call = stage(s, "p1", "I3-CALL", "battle");
  if (locked) s = activate(s, lock);
  s = activate(s, call);
  const at = Object.entries(s.sides.p1.zones).find(([, ids]) => ids.includes(field))?.[0];
  if (locked) assert.equal(at, "deck", "R-270: under the lock, a skill's 'activate {X}' leaves the [Field] card in the deck");
  else assert.notEqual(at, "deck", "R-270: without the lock, the same skill activates it");
  cases++;
}

console.log(`integration-3: ${records} records, ${cases} VM cases`);
