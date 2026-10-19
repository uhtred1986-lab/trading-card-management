/**
 * #929: [Union-Fusion] / [Union-Potara] / [Union-Absorb] and the opponent's
 * [Counter: Play] — the windows, and what a card that fails to enter play does.
 *
 * Sources. rulemanual 22-13-4-5-1 / 22-13-5-4-2 / 22-13-6-3-2 (a card that
 * activated the skill — for Absorb, the chosen Battle Card — that fails to enter
 * play is placed in its owner's Drop Area) and their exception 22-13-x-x-1
 * ("returned to its owner's hand instead of being played" is not dropped);
 * 22-10-3-1 (a [Counter: Play] is pending when the opponent activates or
 * resolves a skill that plays); 22-20 ([Deflect]); the official card FAQ
 * (BT1-107 Q4 Potara, Q5 Fusion, Q6 Absorb: a [Counter: Play] may be used "before
 * … or after"; BT1-110 Q3/Q4/Q5: after the costs are paid and the skill
 * activated, before the cards are placed / sent to the Drop). Labelled best
 * guesses (owner's guidance of 18 Oct 2026; nothing in the manual or FAQ says
 * otherwise): a counter that moved the card somewhere else (neither "returned
 * to hand" nor still in hand) leaves it there; for Absorb the chosen card goes
 * to the Drop from whatever area it was chosen from (deck, hand), the host
 * having left being a failure to enter play; the second window offers the
 * counter with no card "being played" for it to act on (BT1-110: it cannot
 * undo the play).
 *
 * Every case runs on both seats, and every answer goes through a JSON round
 * trip, so a window that is open when the game is saved resumes the same.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";

const engine = RULES;
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok);
const game = loaded.definition;

const AUTO = "\n[auto] When this card is played, draw 1 card.";
const c = (id: string, o: Partial<CardDef>): CardDef => card(id, { colors: ["Red"], power: 10000, energyCost: 2, skill: null, ...o });
const counter = (id: string, skill: string): CardDef => card(id, { type: "EXTRA", energyCost: 0, comboCost: null, comboPower: null, skill });
const defs: Record<string, CardDef> = { ...DEFS,
  FUS: c("FUS", { characters: ["Gogeta"], energyCost: 3, power: 20000, skill: `[union-fusion]{1}: <Son Goku> and <Vegeta>${AUTO}` }),
  FUSD: c("FUSD", { characters: ["Gogeta"], energyCost: 3, power: 20000, skill: `[deflect]\n[union-fusion]{1}: <Son Goku> and <Vegeta>${AUTO}` }),
  POT: c("POT", { characters: ["Vegito"], energyCost: 3, power: 20000, skill: `[union-potara]{1}: <Son Goku> and <Vegeta>${AUTO}` }),
  POTD: c("POTD", { characters: ["Vegito"], energyCost: 3, power: 20000, skill: `[deflect]\n[union-potara]{1}: <Son Goku> and <Vegeta>${AUTO}` }),
  ABS: c("ABS", { characters: ["Small"], energyCost: 2, power: 10000, skill: "[union absorb]{1}: Play up to 1 <Big> card from your deck or hand on top of this card." }),
  BIG: c("BIG", { characters: ["Big"], energyCost: 5, power: 25000, skill: AUTO.trim() }),
  BIGD: c("BIGD", { characters: ["Big"], energyCost: 5, power: 25000, skill: `[deflect]${AUTO}` }),
  G0: c("G0", { characters: ["Son Goku"] }), V0: c("V0", { characters: ["Vegeta"] }),
  ER: c("ER", { colors: ["Red"] }),
  CDRAW: counter("CDRAW", "[Counter: Play] Draw 1 card."),
  CRET: counter("CRET", "[Counter: Play] The Battle Card being played is returned to its owner's hand instead of being played."),
  CDROP: counter("CDROP", "[Counter: Play] The Battle Card being played is placed in its owner's Drop Area instead of being played."),
};
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromCompiler(defs) };

const events: GameEvent[] = [];
const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
const apply = (s: VmState, a: Action): VmState => { const out = engine.apply(ctx, reload(s), a); events.push(...out.events); return out.state as VmState; };
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");
const zone = (s: VmState, p: PlayerId, area: string) => s.sides[p].zones[area];
type Area = "hand" | "battle" | "energy" | "warp" | "drop" | "deck";
function stage(s: VmState, p: PlayerId, id: string, area: Area): string {
  const physical = s.sides[p].zones.deck[0]; assert.ok(physical);
  s.cards[physical].cardId = id;
  assert.ok(moveCard(s, game, physical, area, { owner: p }).ok);
  return physical;
}
function board(seed: number, seat: PlayerId): VmState {
  let s = engine.createGame(ctx, { seed, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Other", leader: "L-RED", main: fifty("V1") } }).state as VmState;
  s = apply(s, { type: "chooseFirst", player: s.chooser, first: "p1" });
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) s = apply(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player });
  if (seat === "p2") { s = apply(s, { type: "endMain", player: "p1" }); s = apply(s, { type: "charge", player: "p2", card: null }); }
  assert.equal(s.turnPlayer, seat); assert.equal(s.prompt.kind, "main");
  for (const p of ["p1", "p2"] as const) for (const area of ["hand", "energy"] as const) for (const id of s.sides[p].zones[area].slice()) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  return s;
}
const invariant = (s: VmState): void => {
  const seen = new Map<string, number>();
  for (const side of Object.values(s.sides)) for (const ids of Object.values(side.zones)) for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1);
  for (const k of Object.values(s.cards)) for (const id of k.under) seen.set(id, (seen.get(id) ?? 0) + 1);
  for (const id of Object.keys(s.cards)) assert.equal(seen.get(id), 1, `${id} is in exactly one area or pile`);
};

type Variant = "fusion" | "potara" | "absorb";
interface Setup { s: VmState; seat: PlayerId; foe: PlayerId; union: string; played: string; mats: string[]; energy: string; big?: string }
/** The active seat's board for a variant, the responder holding `counters`. */
function setup(variant: Variant, seat: PlayerId, seed: number, counters: string[] = [], deflect = false): Setup {
  const s = board(seed, seat); const foe = other(seat);
  const energy = stage(s, seat, "ER", "energy");
  let union: string, played: string; let mats: string[] = []; let big: string | undefined;
  if (variant === "fusion") { union = played = stage(s, seat, deflect ? "FUSD" : "FUS", "hand"); mats = [stage(s, seat, "G0", "hand"), stage(s, seat, "V0", "hand")]; }
  else if (variant === "potara") { union = played = stage(s, seat, deflect ? "POTD" : "POT", "hand"); mats = [stage(s, seat, "G0", "battle"), stage(s, seat, "V0", "battle")]; }
  else { union = stage(s, seat, "ABS", "battle"); big = played = stage(s, seat, deflect ? "BIGD" : "BIG", "hand"); }
  for (const id of counters) stage(s, foe, id, "hand");
  return { s, seat, foe, union, played, mats, energy, big };
}
type Policy = (s: VmState, landed: boolean) => string | null;
interface Run { s: VmState; windows: { player: PlayerId; landed: boolean }[] }
/** Drive the active seat's activation to the end, asking `policy` at every counter window. */
function drive(t: Setup, policy: Policy = () => null, mid?: (s: VmState) => void, startFrom?: VmState): Run {
  let s = startFrom ?? t.s;
  if (!startFrom) {
    const act = engine.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === t.union);
    assert.ok(act, "the Union activation is offered");
    s = apply(s, act.action);
  }
  const windows: Run["windows"] = [];
  for (let i = 0; i < 40 && s.prompt.kind !== "main"; i++) {
    const p = s.prompt;
    if (p.kind === "chooseMode") s = apply(s, { type: "chooseMode", player: p.player, index: 0 });
    else if (p.kind === "payCost") s = apply(s, { type: "payCost", player: p.player, option: 0 });
    else if (p.kind === "chooseCards") s = apply(s, { type: "choose", player: p.player, cards: p.choice.candidates.slice(0, Math.max(1, p.choice.min)) });
    else if (p.kind === "orderPending") s = apply(s, { type: "orderPending", player: p.player, index: 0 });
    else if (p.kind === "counter") {
      assert.equal(p.player, t.foe, "the opponent is asked");
      const landed = s.resolving?.landed === true;
      windows.push({ player: p.player, landed });
      if (!landed && mid) { mid(s); mid = undefined; }
      s = apply(s, { type: "counter", player: p.player, card: policy(s, landed) });
    } else throw new Error(`unexpected prompt ${p.kind}`);
  }
  assert.equal(s.prompt.kind, "main"); assert.equal(s.resolving ?? null, null, "no play is left resolving");
  invariant(s);
  return { s, windows };
}
const handSize = (s: VmState, p: PlayerId) => zone(s, p, "hand").length;
const restCount = (s: VmState, p: PlayerId) => zone(s, p, "energy").filter((id) => s.cards[id].mode === "rest").length;
const arrivals = (card: string, since: number) => events.slice(since).filter((e) => e.type === "move" && e.card === card && e.to === "battle").length;

for (const seat of ["p1", "p2"] as const) for (const variant of ["fusion", "potara", "absorb"] as const) {
  const tag = `${variant}/${seat}`; const foe = other(seat);
  const landedOk = (t: Setup, r: Run) => {
    assert.ok(zone(r.s, seat, "battle").includes(t.played), `${tag}: the card is in play`);
    if (variant === "fusion") assert.ok(t.mats.every((m) => zone(r.s, seat, "drop").includes(m)), `${tag}: materials in the Drop`);
    if (variant === "potara") assert.deepEqual([...r.s.cards[t.played].under].sort(), [...t.mats].sort(), `${tag}: both materials under it`);
    if (variant === "absorb") assert.ok(r.s.cards[t.played].under.includes(t.union), `${tag}: played on top of the host`);
  };

  // 1. no counter in the opponent's hand: no window at all, the play lands.
  {
    const t = setup(variant, seat, 9290); const h0 = handSize(t.s, seat); const since = events.length;
    const r = drive(t);
    assert.deepEqual(r.windows, [], `${tag}: nothing to answer with, nothing is asked`);
    landedOk(t, r); assert.equal(arrivals(t.played, since), 1, `${tag}: exactly one arrival`);
    assert.equal(handSize(r.s, seat) - h0, variant === "fusion" ? -3 + 1 : 0, `${tag}: the card leaves the hand and the played-Auto draws once`);
  }
  // 2. with a counter that can be declined: asked before the card lands and again after (FAQ BT1-107/110).
  {
    const t = setup(variant, seat, 9291, ["CDRAW"]);
    const r = drive(t);
    assert.deepEqual(r.windows, [{ player: foe, landed: false }, { player: foe, landed: true }], `${tag}: one window before the card is placed and one after`);
    landedOk(t, r); assert.equal(handSize(r.s, foe), handSize(t.s, foe), `${tag}: declining spends nothing`);
    // saved and reloaded at every answer: the same game.
    const again = drive(setup(variant, seat, 9291, ["CDRAW"]));
    assert.equal(JSON.stringify(again.s), JSON.stringify(r.s), `${tag}: deterministic across reloads`);
  }
  // 3. a counter used before the card lands resolves first; the second window still follows.
  {
    const t = setup(variant, seat, 9292, ["CDRAW", "CDRAW"]); const f0 = handSize(t.s, foe);
    const first = zone(t.s, foe, "hand")[0];
    const r = drive(t, (_s, landed) => (landed ? null : first));
    assert.ok(r.windows.some((w) => !w.landed) && r.windows.some((w) => w.landed), `${tag}: windows on both sides of the landing`);
    landedOk(t, r); assert.equal(handSize(r.s, foe), f0 - 1 + 1, `${tag}: the counter resolved (one card spent, one drawn)`);
  }
  // 4. the second window: a counter used after the landing finds nothing being played and the play stays.
  {
    const t = setup(variant, seat, 9293, ["CRET"]);
    const r = drive(t, (s, landed) => (landed ? zone(s, foe, "hand")[0] : null));
    landedOk(t, r); assert.deepEqual(r.windows.map((w) => w.landed), [false, true], `${tag}: an after-landing counter ends it`);
    assert.ok(zone(r.s, foe, "drop").length >= 1, `${tag}: the counter was spent`);
    assert.ok(!zone(r.s, seat, "hand").includes(t.played), `${tag}: "returned instead of being played" cannot undo a play that happened (BT1-110)`);
  }
  // 5. replaced before it lands: back to the hand (the explicit exception) / into the Drop.
  for (const [counterId, where] of [["CRET", "hand"], ["CDROP", "drop"]] as const) {
    const t = setup(variant, seat, 9294, [counterId]); const rest0 = restCount(t.s, seat); const since = events.length;
    const r = drive(t, (s, landed) => (landed ? null : zone(s, foe, "hand")[0]));
    assert.deepEqual(r.windows, [{ player: foe, landed: false }], `${tag}/${counterId}: no second window for a play that did not happen`);
    assert.ok(zone(r.s, seat, where).includes(t.played), `${tag}/${counterId}: ${t.played} in the ${where}`);
    assert.ok(!zone(r.s, seat, "battle").includes(t.played) && arrivals(t.played, since) === 0, `${tag}/${counterId}: it never arrived`);
    assert.equal(r.s.cards[t.played].under.length, 0, `${tag}/${counterId}: nothing under it`);
    assert.equal(handSize(r.s, seat) - handSize(t.s, seat), (variant === "fusion" ? -2 : 0) + (where === "hand" ? 0 : -1), `${tag}/${counterId}: no played-Auto draw, hand as expected`);
    assert.equal(restCount(r.s, seat) - rest0, 1, `${tag}/${counterId}: the energy price stays paid`);
    if (variant === "fusion") assert.ok(t.mats.every((m) => zone(r.s, seat, "drop").includes(m)), `${tag}/${counterId}: the materials stay in the Drop (cost)`);
    if (variant === "potara") assert.ok(t.mats.every((m) => zone(r.s, seat, "battle").includes(m) && r.s.cards[m].under.length === 0), `${tag}/${counterId}: the chosen cards stay as they were`);
    if (variant === "absorb") assert.ok(zone(r.s, seat, "battle").includes(t.union) && r.s.cards[t.union].under.length === 0, `${tag}/${counterId}: the host is untouched`);
  }
  // 6. [Deflect] on the card being played closes both windows (22-20) — an Absorb's chosen card carries it.
  {
    const t = setup(variant, seat, 9295, ["CDRAW"], true);
    const r = drive(t);
    assert.deepEqual(r.windows, [], `${tag}: a card with [Deflect] is not affected by [Counter: Play]`);
    assert.ok(zone(r.s, seat, "battle").includes(t.played));
  }
  // 7. the window leaves the board changed: the play does not happen and nothing else moves.
  if (variant === "fusion") {
    const t = setup(variant, seat, 9296, ["CDRAW"]);
    const r = drive(t, () => null, (s) => { assert.ok(moveCard(s, game, t.played, "energy", { owner: seat }).ok); });
    assert.ok(zone(r.s, seat, "energy").includes(t.played) && !zone(r.s, seat, "battle").includes(t.played) && !zone(r.s, seat, "drop").includes(t.played), "fusion: a card that left the hand is not dropped and not played");
    assert.deepEqual(r.windows.map((w) => w.landed), [false], "fusion: no second window");
  }
  if (variant === "potara") {
    for (const how of ["gone", "bounced"] as const) {
      const t = setup(variant, seat, 9297, ["CDRAW"]);
      const r = drive(t, () => null, (s) => {
        if (how === "gone") assert.ok(moveCard(s, game, t.mats[0], "drop", { owner: seat }).ok);
        else { assert.ok(moveCard(s, game, t.mats[1], "hand", { owner: seat }).ok); assert.ok(moveCard(s, game, t.mats[1], "battle", { owner: seat }).ok); }
      });
      assert.ok(zone(r.s, seat, "drop").includes(t.played) && !zone(r.s, seat, "battle").includes(t.played), `potara/${how}: the card that could not be placed goes to the Drop (22-13-5-4-2)`);
      assert.ok(r.s.cards[t.played].under.length === 0 && r.s.cards[t.mats[0]].under.length === 0 && r.s.cards[t.mats[1]].under.length === 0, `potara/${how}: nothing is left under anything`);
      assert.equal(zone(r.s, seat, "battle").includes(t.mats[1]), true, `potara/${how}: the material that stayed stays`);
      assert.equal(handSize(r.s, seat), handSize(t.s, seat) - 1, `potara/${how}: no played-Auto draw`);
    }
  }
  if (variant === "absorb") {
    const gone = setup(variant, seat, 9298, ["CDRAW"]);
    assert.ok(moveCard(gone.s, game, gone.played, "deck", { owner: seat }).ok); // the chosen card comes from the deck
    const r = drive(gone, () => null, (s) => { assert.ok(moveCard(s, game, gone.union, "drop", { owner: seat }).ok); });
    assert.ok(zone(r.s, seat, "drop").includes(gone.played) && !zone(r.s, seat, "battle").includes(gone.played), "absorb: the host left, so the chosen card fails to enter play and is dropped (22-13-6-3-2)");
    assert.equal(handSize(r.s, seat), handSize(gone.s, seat), "absorb: no played-Auto draw");
    const taken = setup(variant, seat, 9299, ["CDRAW"]);
    const q = drive(taken, () => null, (s) => { assert.ok(moveCard(s, game, taken.played, "energy", { owner: seat }).ok); });
    assert.ok(zone(q.s, seat, "energy").includes(taken.played) && zone(q.s, seat, "battle").includes(taken.union) && q.s.cards[taken.union].under.length === 0, "absorb: a chosen card a counter moved elsewhere stays there; the host is untouched");
  }
}

console.log("union-counter-929: both windows, Deflect, returned/dropped replacement, failed entry and stale materials for all three variants on both seats, reload-stable");
