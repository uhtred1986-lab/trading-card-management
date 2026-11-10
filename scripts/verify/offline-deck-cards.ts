/**
 * The cards that kept the owner's decks off the device (offline deck check, 10 Nov 2026), proved on
 * their printed text compiled by the repo's compiler and played on the rules VM.
 *
 * - BT1-081 Broly's Ring: "[Permanent] Your hand is not affected by your <Broly> Leader Card's skill."
 *   With the Ring in play, BT1-057 Broly's "both players choose 1 card from their hand and place it in
 *   the Drop Area" leaves its controller's hand alone and still takes the opponent's card. Without the
 *   Ring, both players lose a card. The immunity is the 9-1-4 one ("isn't affected by"), on every card
 *   in your hand and only against your own <Broly> Leader.
 * - BT29-029 Cooler's [Awaken] prints "at5": its price reads (`during-that-turn-907` holds the reading).
 *
 * Run from `scripts/verify-arena.ts`.
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

/** BT1-057 Broly's front, as printed. */
const BROLY = "[Permanent] This card cannot attack Battle Cards.<br>[Auto] When this card attacks, both players choose 1 card from their hand and place it in the Drop Area.<br>[Awaken] When your life is at 4 or less: You may draw 2 cards and flip this card over.";
/** BT1-081 Broly's Ring, as the catalog carries it. */
const RING = "[Field] (Place and activate this card in the Battle Area. It remains in the Battle Area until you activate another [Field]. When you do, place this card in the Drop Area)<br>[Permanent] Your hand is not affected by your &lt;Broly&gt; Leader Card's skill.";

const defs: Record<string, CardDef> = {
  ...DEFS,
  L_BROLY: card("L_BROLY", { type: "LEADER", name: "Broly", characters: ["Broly"], colors: ["Yellow"], energyCost: null, comboCost: null, comboPower: null, skill: BROLY, back: { name: "Broly, the Legendary Super Saiyan", power: 15000, skill: null } }),
  RING_OFFLINE: card("RING_OFFLINE", { type: "EXTRA", name: "Broly's Ring", characters: [], colors: ["Yellow"], energyCost: 1, power: null, comboCost: null, comboPower: null, skill: RING }),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;

// ── the reading ──────────────────────────────────────────────────────────────
{
  const ring = skillRecords(defs.RING_OFFLINE).find((r) => r.kind === "permanent");
  assert.ok(ring, "the Ring's [Permanent] has a record");
  assert.deepEqual(ring.unread, [], "the Ring's [Permanent] reads whole");
  const op = ring.ops[0] as unknown as { op: string; from?: string; target?: { sel?: { side: string; area: string } }; fromFilter?: { type?: string; characters?: string[] } };
  assert.equal(op.op, "immune");
  assert.deepEqual([op.target?.sel?.side, op.target?.sel?.area], ["you", "hand"], "every card in your hand");
  assert.equal(op.from, "you", "against your own skills");
  assert.equal(op.fromFilter?.type, "LEADER", "only your Leader's");
  assert.deepEqual(op.fromFilter?.characters, ["broly"], "only a <Broly> Leader's");
  // The other immunity wordings read as before.
  const opp = skillRecords(card("IMM_OFFLINE", { skill: "[Permanent] This card isn't affected by your opponent's skills." }))[0];
  assert.equal((opp.ops[0] as unknown as { from?: string }).from, "opponent");
}

// ── the VM ───────────────────────────────────────────────────────────────────
function fresh(): VmState {
  let s = RULES.createGame(ctx, { seed: 1081, p1: { name: "Broly", leader: "L_BROLY", main: fifty("V1") }, p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: s.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false },
    { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null },
    { type: "endMain", player: "p1" },
    { type: "charge", player: "p2", card: null },
    { type: "endMain", player: "p2" },
    { type: "charge", player: "p1", card: null },
  ] as Action[]) s = RULES.apply(ctx, s, action).state as VmState;
  assert.equal(s.prompt.kind, "main");
  return s;
}
function stageRing(s: VmState): string {
  const id = s.sides.p1.zones.deck[0];
  s.cards[id].cardId = "RING_OFFLINE";
  assert.ok(moveCard(s, game, id, "battle", { owner: "p1" }).ok);
  s.cards[id].mode = "active";
  return id;
}
/** The Leader attacks the other Leader; every prompt is answered with the first legal answer, to the end of the battle. */
function attackWithLeader(s: VmState): VmState {
  const attacker = s.sides.p1.zones.leader[0];
  const target = s.sides.p2.zones.leader[0];
  const atk = RULES.legalActions(ctx, s).find((l) => l.action.type === "attack" && l.action.attacker === attacker && l.action.target === target);
  assert.ok(atk, "the Leader's attack is offered");
  s = RULES.apply(ctx, s, atk.action).state as VmState;
  for (let i = 0; i < 40 && (s.battle || s.prompt.kind !== "main"); i++) {
    const q = s.prompt;
    if (q.kind === "counter") s = RULES.apply(ctx, s, { type: "counter", player: q.player, card: null }).state as VmState;
    else if (q.kind === "blocker" || q.kind === "combo") s = RULES.apply(ctx, s, { type: "pass", player: q.player } as Action).state as VmState;
    else if (q.kind === "chooseCards") s = RULES.apply(ctx, s, { type: "choose", player: q.player, cards: q.choice.candidates.slice(0, Math.max(q.choice.min, 1)) }).state as VmState;
    else if (q.kind === "orderPending") s = RULES.apply(ctx, s, { type: "orderPending", player: q.player, index: 0 }).state as VmState;
    else if (q.kind === "main") break;
    else throw new Error(`unexpected prompt ${q.kind}`);
  }
  assert.equal(s.prompt.kind, "main", "back at the Main Phase after the battle");
  return s;
}
// The Drop Area, not the hand: the attack's damage puts a life card into the opponent's hand.
const dropOf = (s: VmState, p: PlayerId) => s.sides[p].zones.drop.length;

// Without the Ring: both players place a card from their hand in the Drop Area.
{
  const s = fresh();
  const [mine, theirs] = [dropOf(s, "p1"), dropOf(s, "p2")];
  const r = attackWithLeader(s);
  assert.equal(dropOf(r, "p1"), mine + 1, "without the Ring, Broly places a card from its own hand in the Drop Area");
  assert.equal(dropOf(r, "p2"), theirs + 1, "and so does the opponent");
}

// With the Ring in the Battle Area: Broly's hand is not affected; the opponent's still is.
{
  const s = fresh();
  stageRing(s);
  const [mine, theirs, hand] = [dropOf(s, "p1"), dropOf(s, "p2"), s.sides.p1.zones.hand.length];
  const r = attackWithLeader(s);
  assert.equal(dropOf(r, "p1"), mine, "with Broly's Ring, its controller's hand is not affected by the Broly Leader's skill");
  assert.equal(r.sides.p1.zones.hand.length, hand, "Broly keeps every card in hand");
  assert.equal(dropOf(r, "p2"), theirs + 1, "the opponent still places a card from their hand in the Drop Area");
}
