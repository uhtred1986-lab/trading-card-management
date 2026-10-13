/**
 * #748 (9-1-3-2, 9-6-3-1-1): an [Auto] whose effect is "play this card from
 * your hand" works from the hand: the copies in the hand hear its moment, the
 * copy in play does not. SD15-02/03/05 are the catalog's own text (the #649
 * audit snapshot); the `*748` cards are synthetic and say what they are for.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CTX, DEFS, card, fifty } from "./harness";
import { engineFor } from "../../src/lib/arena/engines";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { cardDefFrom } from "../../src/lib/arena/load";
import { parseSpecifiedCost } from "../../src/lib/arena/specified-cost";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { UNIQUE_CONTINUATION } from "../../src/lib/arena/vm/unique";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";

const rules = engineFor("rules");
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;

const snapshot = JSON.parse(readFileSync("docs/arena-backlog/evidence/649/catalog-subset-2026-10-13.json", "utf8")) as { cards: { id: string }[] };
const printed = (id: string, extra: Partial<CardDef> = {}): CardDef => {
  const row = snapshot.cards.find((c) => c.id === id);
  assert.ok(row, `${id} is in the audit snapshot`);
  return { ...cardDefFrom(row as Parameters<typeof cardDefFrom>[0]), ...extra };
};

const defs: Record<string, CardDef> = {
  ...DEFS,
  "SD15-02": printed("SD15-02", { specifiedCost: parseSpecifiedCost("{r}{r}")! }),
  "SD15-03": printed("SD15-03"),
  "SD15-05": printed("SD15-05"),
  REMOVER730: card("REMOVER730", { colors: ["Blue"], energyCost: 0, skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and place it in its owner's Drop Area." }),
  // The opponent's "place it in its owner's Drop Area" skill the #728 scenario uses.
  // A free play by skill, then a draw — the draw shows whether 21-11 ran before the next instruction.
  PLAYER730: card("PLAYER730", { colors: ["Red"], energyCost: 0, skill: "[Activate: Main] Choose up to 1 Battle Card from your hand and play it, then draw 1 card." }),
  // [Unique] with a "when placed in your Drop Area" Auto (22-39 and 9-6-9 together).
  UDROP730: card("UDROP730", { name: "Unique Drop Watcher", colors: ["Red"], energyCost: 1, skill: "[Unique]<br>[Auto] When this card is placed in your Drop Area from your Battle Area, draw 1 card." }),
  // A [Permanent] 9-10 redirect for a card leaving the Battle Area.
  UWARP730: card("UWARP730", { name: "Unique Warp", colors: ["Red"], energyCost: 1, skill: "[Unique]<br>[Permanent] When this card would leave your Battle Area, remove it from the game instead." }),
  // Same name, no [Unique]: 21-11 does not apply (22-39-4 counts cards with [Unique]).
  PLAIN730: card("PLAIN730", { name: "Plain Twin", colors: ["Red"], energyCost: 1, skill: null }),
  // The keyword-less neighbour 21-11-2 also names; its play half is a prohibition, the rule processing is not built.
  ONECOPY730: card("ONECOPY730", { name: "One Copy", colors: ["Red"], energyCost: 1, skill: "[Permanent] You can't play another copy of this card while this card is in your Battle Area." }),
};
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromCompiler(defs) };
const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
const apply = (s: VmState, action: Action) => rules.apply(ctx, reload(s), action) as { state: VmState; events: GameEvent[] };
const legal = (s: VmState) => rules.legalActions(ctx, s);
const isUniqueQuestion = (s: VmState) => s.prompt.kind === "chooseCards" && s.prompt.choice.continuation === UNIQUE_CONTINUATION;

/** p1's (or after `endMain`, p2's) Main Phase with the hands and energy emptied. */
function mainPhase(seed = 730): VmState {
  let s = rules.createGame(ctx, { seed, p1: { name: "P1", leader: "L-RED", main: fifty("V1") }, p2: { name: "P2", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  s = apply(s, { type: "chooseFirst", player: (s.prompt as { player: PlayerId }).player, first: "p1" }).state;
  s = apply(s, { type: "mulligan", player: "p1", redraw: false }).state;
  s = apply(s, { type: "mulligan", player: "p2", redraw: false }).state;
  s = apply(s, { type: "charge", player: "p1", card: null }).state;
  assert.equal(s.prompt.kind, "main");
  for (const p of ["p1", "p2"] as const) for (const id of s.sides[p].zones.hand.slice()) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  return s;
}
function stage(s: VmState, p: PlayerId, cardId: string, area: "battle" | "unison" | "hand" | "energy" | "drop"): string {
  const id = s.sides[p].zones.deck[0];
  assert.ok(id);
  s.cards[id].cardId = cardId;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok, `could not stage ${cardId}`);
  s.pending = [];
  return id;
}
/** Answer everything that is not the 21-11 question with the first legal answer of whoever is asked, until `stop` holds. */
function until(s: VmState, stop: (s: VmState) => boolean, pick?: (s: VmState) => Action | undefined): VmState {
  for (let i = 0; i < 40 && !stop(s); i++) {
    const chosen = pick?.(s);
    const options = legal(s).filter(({ action }) => action.type !== "concede");
    const action = chosen ?? options.find(({ action }) => action.type === "chooseMode" && action.index === 0)?.action ?? options[0]?.action;
    assert.ok(action, `stopped at ${s.prompt.kind} with nothing to answer`);
    if (process.env.DEBUG730) console.log(JSON.stringify(s.prompt).slice(0, 300), "->", JSON.stringify(action));
    const r = apply(s, action);
    if (process.env.DEBUG730) for (const e of r.events) console.log("   ", JSON.stringify(e).slice(0, 200));
    s = r.state;
  }
  assert.ok(stop(s), `never reached the expected state (at ${s.prompt.kind})`);
  return s;
}

const zone = (s: VmState, p: PlayerId, z: string) => (s.sides[p].zones as Record<string, string[]>)[z] ?? [];
const throwsIllegal = (f: () => unknown, what: string) => assert.throws(f, (e: Error) => e.name === "IllegalAction" || /IllegalAction/.test(e.constructor.name), what);

function p2Main(seed: number): VmState {
  let s = mainPhase(seed);
  s = apply(s, { type: "endMain", player: "p1" }).state;
  s = apply(s, { type: "charge", player: "p2", card: null }).state;
  assert.equal(s.prompt.kind, "main");
  for (const p of ["p1", "p2"] as const) for (const id of s.sides[p].zones.hand.slice()) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  return s;
}
/** SD15-02 with two markers, SD15-03 and `battle` copies of SD15-05 in play, `hand` in hand; p2 holds the remover and `energy` energy. */
function board(seed: number, opts: { battle: number; hand: number; energy: number }) {
  const s = p2Main(seed);
  const cabba = stage(s, "p1", "SD15-02", "unison");
  s.cards[cabba].markers = 2;
  const goku = stage(s, "p1", "SD15-03", "battle");
  const inBattle = Array.from({ length: opts.battle }, () => stage(s, "p1", "SD15-05", "battle"));
  const inHand = Array.from({ length: opts.hand }, () => stage(s, "p1", "SD15-05", "hand"));
  for (let i = 0; i < opts.energy; i++) stage(s, "p2", "V1", "energy");
  const remover = stage(s, "p2", "REMOVER730", "battle");
  return { s, cabba, goku, inBattle, inHand, remover };
}
const DEBUG = !!process.env.DEBUG748;
/** p2 sends SD15-03 to the Drop; answer until `stop`, logging every step under DEBUG748. */
function sendGoku(b: ReturnType<typeof board>, stop: (s: VmState) => boolean, pick?: (s: VmState) => Action | undefined): VmState {
  const act = legal(b.s).find(({ action }) => action.type === "activate" && action.card === b.remover);
  assert.ok(act, "the remover is offered");
  let s = apply(b.s, act.action).state;
  for (let i = 0; i < 30 && !stop(s); i++) {
    const chosen = pick?.(s);
    const options = legal(s).filter(({ action }) => action.type !== "concede");
    const action = chosen ?? options.find(({ action }) => action.type === "choose" && action.cards.includes(b.goku))?.action ?? options.find(({ action }) => action.type === "chooseMode" && action.index === 0)?.action ?? options.find(({ action }) => action.type === "optionalCost")?.action ?? options[0]?.action;
    assert.ok(action, `stopped at ${s.prompt.kind}`);
    if (DEBUG) console.log(s.prompt.kind, JSON.stringify(s.prompt).slice(0, 260), "->", JSON.stringify(action));
    s = apply(s, action.type === "optionalCost" ? { ...action, pay: true } : action).state;
  }
  assert.ok(stop(s), `never reached the expected state (at ${s.prompt.kind})`);
  return s;
}

const isPlayQuestion = (s: VmState) => s.prompt.kind === "chooseMode" && s.prompt.reason === "play this card from your hand";
const atPlayQuestion = (s: VmState) => isPlayQuestion(s) || isUniqueQuestion(s);
const backToP2 = (s: VmState) => s.prompt.kind === "main" && s.turnPlayer === "p2";
const sd1505 = (s: VmState, z: string) => zone(s, "p1", z).filter((id) => s.cards[id].cardId === "SD15-05");

async function main(): Promise<void> {
  // ── 1. The acceptance chain: one in the Battle Area, one in hand ────────
  {
    const b = board(7480, { battle: 1, hand: 1, energy: 2 });
    const [inPlay] = b.inBattle;
    const [inHand] = b.inHand;
    const s = sendGoku(b, atPlayQuestion);
    assert.ok(isPlayQuestion(s), "the hand copy's Auto asks whether to play it");
    assert.equal(s.prompt.kind === "chooseMode" && s.prompt.player, "p1");
    // Only the hand copy's Auto is pending: the frame belongs to it, the in-play copy pended nothing.
    const frames = JSON.stringify(s.programs);
    assert.ok(frames.includes(inHand), "the running skill is the hand copy's");
    assert.ok(!frames.includes(inPlay), "the in-play copy pends nothing");
    assert.equal(s.pending.length, 0, "no second pending Auto from the in-play copy");
    assert.equal(s.cards[b.cabba].markers, 1, "[Spirit Boost 1] took one marker off SD15-02");
    // 9-6-3-1-1-style refusals: a wrong seat and an index out of range change nothing.
    const before = JSON.stringify(s);
    throwsIllegal(() => apply(s, { type: "chooseMode", player: "p2", index: 0 }), "p2 cannot answer p1's question");
    throwsIllegal(() => apply(s, { type: "chooseMode", player: "p1", index: 5 }), "an option that is not offered is refused");
    assert.equal(JSON.stringify(s), before, "refusals change nothing");
    // Decline: nothing is played, both copies stay where they are.
    const declined = until(apply(s, { type: "chooseMode", player: "p1", index: 1 }).state, backToP2);
    assert.deepEqual(sd1505(declined, "battle"), [inPlay], "declined: the in-play copy is alone");
    assert.deepEqual(sd1505(declined, "hand"), [inHand], "declined: the hand copy stays in hand");
    // Accept, and the answer from a JSON reload is the same state.
    const accepted = apply(s, { type: "chooseMode", player: "p1", index: 0 });
    const reloaded = apply(JSON.parse(before) as VmState, { type: "chooseMode", player: "p1", index: 0 });
    assert.equal(JSON.stringify(reloaded.state), JSON.stringify(accepted.state), "a reload mid-question resolves identically");
    // #730: playing the hand copy beside the first one asks the [Unique] question.
    assert.ok(isUniqueQuestion(accepted.state), "the [Unique] (21-11) question follows");
    assert.deepEqual(accepted.state.prompt.kind === "chooseCards" ? [...accepted.state.prompt.choice.candidates].sort() : [], [inPlay, inHand].sort());
    const kept = until(apply(accepted.state, { type: "choose", player: "p1", cards: [inHand] }).state, backToP2);
    assert.deepEqual(sd1505(kept, "battle"), [inHand], "the played copy stayed");
    assert.ok(zone(kept, "p1", "drop").includes(inPlay), "the older copy went to the Drop Area");
  }

  // ── 2. Only a hand copy: played, no [Unique] question ───────────────────
  {
    const b = board(7481, { battle: 0, hand: 1, energy: 2 });
    const s = sendGoku(b, backToP2, (st) => (isPlayQuestion(st) ? { type: "chooseMode", player: "p1", index: 0 } : undefined));
    assert.deepEqual(sd1505(s, "battle"), b.inHand, "the hand copy was played");
    assert.deepEqual(sd1505(s, "hand"), []);
  }

  // ── 3. Only an in-play copy: nothing to ask ─────────────────────────────
  {
    const b = board(7482, { battle: 1, hand: 0, energy: 2 });
    let asked = false;
    const s = sendGoku(b, backToP2, (st) => {
      if (isPlayQuestion(st)) asked = true;
      return undefined;
    });
    assert.ok(!asked, "an in-play copy has nothing to play from the hand");
    assert.deepEqual(sd1505(s, "battle"), b.inBattle, "it is still alone in the Battle Area");
    assert.equal(s.cards[b.cabba].markers, 1, "the marker was still removed");
  }

  // ── 4. Two hand copies: each hears it ───────────────────────────────────
  {
    const b = board(7483, { battle: 1, hand: 2, energy: 2 });
    const s = sendGoku(b, (st) => st.prompt.kind === "orderPending" || isPlayQuestion(st));
    const seen = s.prompt.kind === "orderPending" ? s.prompt.candidates.length : 1 + s.pending.length;
    assert.equal(seen, 2, "both hand copies have the Auto pending");
    assert.ok(!JSON.stringify([s.prompt, s.pending, s.programs]).includes(b.inBattle[0]), "the in-play copy is not among them");
  }

  // ── 5. The condition: the opponent needs 2 or more energy ──────────────
  {
    const b = board(7484, { battle: 0, hand: 1, energy: 1 });
    let asked = false;
    const s = sendGoku(b, backToP2, (st) => {
      if (isPlayQuestion(st)) asked = true;
      return undefined;
    });
    assert.ok(!asked, "with 1 energy the opponent does not satisfy the Auto's condition");
    assert.deepEqual(sd1505(s, "hand"), b.inHand);
  }

  // ── 6. A stale answer: the copy left the hand while the question waited ─
  {
    const b = board(7485, { battle: 0, hand: 1, energy: 2 });
    const s = sendGoku(b, isPlayQuestion);
    const stale = JSON.parse(JSON.stringify(s)) as VmState;
    assert.ok(moveCard(stale, game, b.inHand[0], "drop", { owner: "p1" }).ok);
    let t: VmState | null = null;
    try {
      t = apply(stale, { type: "chooseMode", player: "p1", index: 0 }).state;
    } catch (e) {
      assert.ok(/IllegalAction/.test((e as Error).constructor.name + (e as Error).name), "a stale answer is refused, not misapplied");
    }
    if (t) assert.ok(!zone(t, "p1", "battle").includes(b.inHand[0]), "a copy that left the hand was not played");
  }

  // ── 7. Neighbours: in-play watchers still hear, other copies do not ────
  {
    // A Battle Card watching the same moment for an ordinary effect keeps hearing it in play,
    // and does not hear it from the hand (it has no play-from-hand effect).
    const watch: CardDef = card("WATCH748", { colors: ["Red"], energyCost: 1, skill: "[Auto] When you remove a marker from one of your red Unison Cards using a [Spirit Boost] skill, draw 1 card." });
    defs.WATCH748 = watch;
    const c2: EngineContext = { ...ctx, defs, scripts: rulesFromCompiler(defs) };
    const run = (area: "battle" | "hand") => {
      const b = board(7486, { battle: 0, hand: 0, energy: 2 });
      stage(b.s, "p1", "WATCH748", area);
      const act = rules.legalActions(c2, b.s).find(({ action }) => action.type === "activate" && action.card === b.remover);
      assert.ok(act);
      let s = rules.apply(c2, reload(b.s), act.action).state as VmState;
      const handBefore = zone(s, "p1", "hand").length;
      for (let i = 0; i < 30 && !(s.prompt.kind === "main" && s.turnPlayer === "p2"); i++) {
        const options = rules.legalActions(c2, s).filter(({ action }) => action.type !== "concede");
        const action = options.find(({ action }) => action.type === "choose" && action.cards.includes(b.goku))?.action ?? options.find(({ action }) => action.type === "chooseMode" && action.index === 0)?.action ?? options.find(({ action }) => action.type === "optionalCost")?.action ?? options[0].action;
        s = rules.apply(c2, reload(s), action.type === "optionalCost" ? { ...action, pay: true } : action).state as VmState;
      }
      return { drawn: zone(s, "p1", "hand").length - handBefore, goku: b.goku, s };
    };
    assert.equal(run("battle").drawn >= 1, true, "the in-play watcher still draws");
    const inHandRun = run("hand");
    assert.equal(inHandRun.drawn, 0, "the same card in the hand hears nothing (9-1-3-1)");
    // SD15-03: "play this card from your Drop Area" is still heard from the Drop (section 1's chain already returns it).
    const g = board(7487, { battle: 0, hand: 0, energy: 2 });
    const s = sendGoku(g, backToP2);
    assert.ok(zone(s, "p1", "battle").includes(g.goku), "SD15-03 still plays itself back from the Drop Area");
  }

  console.log("  #748: a 'play this card from your hand' Auto is heard by the hand copies only — SD15-05 chain, [Unique] follow-up, refusal, reload, stale answer and neighbours passed");
}

export default main();
