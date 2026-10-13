/**
 * #730 (21-11, 22-39-4): two or more cards with [Unique] and the same name in
 * one Battle Area — the master chooses the one that stays, the rest go to the
 * Drop Area, as interruptive rule processing (21-11-1, 21-1-2-1).
 *
 * Independent expectations, never derived from the legacy oracle; the rules
 * engine only (the legacy engine keeps the newest copy without asking — its
 * stated boundary, asserted at the end). SD15-02, SD15-03 and SD15-05 are the
 * catalog's own text (the #649 audit snapshot,
 * `docs/arena-backlog/evidence/649/catalog-subset-2026-10-13.json`); SD15-02's
 * specified cost is the owner's ruling of 13 Oct 2026 (`{r}{r}`, migration
 * 0049). The `*730` cards are synthetic and say what they are for.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CTX, DEFS, card, fifty } from "./harness";
import { engineFor } from "../../src/lib/arena/engines";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { cardDefFrom } from "../../src/lib/arena/load";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { parseSpecifiedCost } from "../../src/lib/arena/specified-cost";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { UNIQUE_CONTINUATION } from "../../src/lib/arena/vm/unique";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { PinnedMatch } from "../../src/lib/arena/browser";
import { localStep, policyTurn } from "../../src/lib/arena/policy/boundary";
import { choiceDecision } from "../../src/lib/arena/policy/choices";
import { localPolicy } from "../../src/lib/arena/policy/combat";
import { localMemory } from "../../src/lib/arena/policy/main";
import { policyRng } from "../../src/lib/arena/policy/rng";
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
  // The opponent's "place it in its owner's Drop Area" skill the #728 scenario uses.
  REMOVER730: card("REMOVER730", { colors: ["Blue"], energyCost: 0, skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and place it in its owner's Drop Area." }),
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

/**
 * p1's Main Phase with `battle` cards in p1's Battle Area, `hand` in p1's
 * hand and PLAYER730 ready; p1 activates PLAYER730 and picks `play` from the
 * hand. Returns the state at the first question PLAYER730 does not ask.
 */
function playBeside(battle: string[], hand: string, opts: { seed?: number } = {}) {
  let s = mainPhase(opts.seed);
  const inBattle = battle.map((id) => stage(s, "p1", id, "battle"));
  const inHand = stage(s, "p1", hand, "hand");
  const player = stage(s, "p1", "PLAYER730", "battle");
  const act = legal(s).find(({ action }) => action.type === "activate" && action.card === player);
  assert.ok(act, "PLAYER730's [Activate: Main] is offered");
  s = apply(s, act.action).state;
  assert.ok(s.prompt.kind === "chooseCards" && s.prompt.choice.candidates.includes(inHand), "PLAYER730 asks for the card to play");
  const r = apply(s, { type: "choose", player: "p1", cards: [inHand] });
  return { s: r.state, events: r.events, inBattle, inHand, player };
}

async function main(): Promise<void> {
  // ── 1. A skill plays a second SD15-05 beside the first ──────────────────
  {
    // 22-39-3's play half stays as it was: the declared play of the second copy is refused (#157).
    {
      const s = mainPhase();
      stage(s, "p1", "SD15-05", "battle");
      const second = stage(s, "p1", "SD15-05", "hand");
      for (let i = 0; i < 6; i++) stage(s, "p1", "V1", "energy");
      assert.ok(!legal(s).some(({ action }) => action.type === "play" && action.card === second), "SD15-05 cannot be declared from the hand while one is in play");
    }
    const { s, events, inBattle: [vegetaA], inHand: vegetaB } = playBeside(["SD15-05"], "SD15-05");
    // 21-11-1: interruptive — the master is asked now, before PLAYER730's "then draw 1 card".
    assert.ok(isUniqueQuestion(s), `the master is asked which copy stays (at ${s.prompt.kind})`);
    assert.equal(s.prompt.kind === "chooseCards" && s.prompt.player, "p1", "the master (p1) is asked");
    assert.deepEqual(s.prompt.kind === "chooseCards" ? [...s.prompt.choice.candidates].sort() : [], [vegetaA, vegetaB].sort(), "both copies are candidates");
    assert.deepEqual(s.prompt.kind === "chooseCards" ? [s.prompt.choice.min, s.prompt.choice.max] : [], [1, 1], "exactly one is kept");
    assert.ok(zone(s, "p1", "battle").includes(vegetaA) && zone(s, "p1", "battle").includes(vegetaB), "both are in the Battle Area at the question");
    assert.equal(zone(s, "p1", "hand").length, 0, "PLAYER730's draw has not happened yet: 21-11 interrupts the effect");
    assert.ok(!events.some((e) => e.type === "draw"), "no draw before the question");
    // Both viewer projections: the master is offered one answer per copy, the other seat none.
    const v1 = buildSnapshot({ id: 730, revision: 1, mode: "versus", engine: "rules", status: "playing", p1Name: "Player 1", p2Name: "Player 2", ctx, state: s, legal: legal(s), log: [], beats: null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer: "p1", images: {} });
    const v2 = buildSnapshot({ id: 730, revision: 1, mode: "versus", engine: "rules", status: "playing", p1Name: "Player 1", p2Name: "Player 2", ctx, state: s, legal: legal(s), log: [], beats: null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer: "p2", images: {} });
    assert.equal(v1.view.prompt?.kind, "chooseCards");
    assert.equal(v1.waiting, "you", "p1's view: p1 is being asked");
    assert.equal(v2.waiting, "opponent", "p2's view: waiting on the opponent");
    assert.match(JSON.stringify(v1.view.prompt), /\[Unique\] \(21-11\)/, "the question names the rule");
    const chooses = (v: typeof v1) => (v.legal as { action: Action }[]).filter((l) => l.action.type === "choose").map((l) => (l.action as { cards: string[] }).cards[0]).sort();
    assert.deepEqual(chooses(v1), [vegetaA, vegetaB].sort(), "p1's projection offers both copies");
    assert.deepEqual(chooses(v2), [], "p2's projection offers nothing");
    // Wrong actor, a card that is not a candidate, two cards, none: refused, the state unchanged.
    const before = JSON.stringify(s);
    throwsIllegal(() => apply(s, { type: "choose", player: "p2", cards: [vegetaA] }), "p2 cannot answer p1's question");
    throwsIllegal(() => apply(s, { type: "choose", player: "p1", cards: [zone(s, "p1", "battle").find((id) => s.cards[id].cardId === "PLAYER730")!] }), "a card that is not a copy is refused");
    throwsIllegal(() => apply(s, { type: "choose", player: "p1", cards: [vegetaA, vegetaB] }), "keeping both is refused");
    throwsIllegal(() => apply(s, { type: "choose", player: "p1", cards: [] }), "keeping none is refused");
    assert.equal(JSON.stringify(s), before, "refusals change nothing");
    // The older copy can be kept: a choice, not keep-newest. The answer from a JSON reload is the same.
    const keepA = apply(s, { type: "choose", player: "p1", cards: [vegetaA] });
    const keepAReloaded = apply(JSON.parse(before) as VmState, { type: "choose", player: "p1", cards: [vegetaA] });
    assert.equal(JSON.stringify(keepAReloaded.state), JSON.stringify(keepA.state), "a reload mid-question resolves identically");
    assert.ok(zone(keepA.state, "p1", "battle").includes(vegetaA) && !zone(keepA.state, "p1", "battle").includes(vegetaB), "the older copy stays");
    assert.ok(zone(keepA.state, "p1", "drop").includes(vegetaB), "the newer copy is in the Drop Area");
    assert.equal(zone(keepA.state, "p1", "hand").length, 1, "then PLAYER730's draw happens");
    const dropAt = keepA.events.findIndex((e) => e.type === "move" && e.card === vegetaB && e.from === "battle" && e.to === "drop");
    const drawAt = keepA.events.findIndex((e) => e.type === "draw");
    assert.ok(dropAt >= 0 && drawAt > dropAt, "the copy goes to the Drop before the effect's draw");
    assert.equal(keepA.state.prompt.kind, "main", "back to the Main Phase");
    assert.ok(!keepA.state.programs.length && !keepA.state.programs.some((f) => f.uniqueKeep), "no 21-11 frame left behind");
    // …or the newer one.
    const keepB = apply(s, { type: "choose", player: "p1", cards: [vegetaB] }).state;
    assert.ok(zone(keepB, "p1", "battle").includes(vegetaB) && zone(keepB, "p1", "drop").includes(vegetaA), "the newer copy stays, the older goes");
  }

  // ── 2. Three copies: one stays, two go; a stale answer is refused ──────
  {
    let s = mainPhase(7302);
    const [a, b, c] = [0, 1, 2].map(() => stage(s, "p1", "SD15-05", "battle"));
    const player = stage(s, "p1", "PLAYER730", "battle");
    // Any action reaches the runner, whose own look processes the violation
    // before anything else — here, before PLAYER730 asks its question.
    s = apply(s, legal(s).find(({ action }) => action.type === "activate" && action.card === player)!.action).state;
    assert.ok(isUniqueQuestion(s), "the runner's look asks first");
    assert.deepEqual(s.prompt.kind === "chooseCards" ? [...s.prompt.choice.candidates].sort() : [], [a, b, c].sort(), "all three copies are candidates");
    // A stale answer: the copy left the Battle Area while the question waited.
    const stale = JSON.parse(JSON.stringify(s)) as VmState;
    assert.ok(moveCard(stale, game, c, "hand", { owner: "p1" }).ok);
    const staleBefore = JSON.stringify(stale);
    throwsIllegal(() => apply(stale, { type: "choose", player: "p1", cards: [c] }), "a copy no longer in play cannot be kept");
    assert.equal(JSON.stringify(stale), staleBefore, "the stale answer changes nothing");
    const t = until(apply(s, { type: "choose", player: "p1", cards: [b] }).state, (st) => st.prompt.kind === "main");
    const copies = (st: VmState, z: string) => zone(st, "p1", z).filter((id) => st.cards[id].cardId === "SD15-05");
    assert.deepEqual(copies(t, "battle"), [b], "exactly one copy stays: the chosen one");
    assert.deepEqual(copies(t, "drop").sort(), [a, c].sort(), "the other two are in the Drop Area");
  }

  // ── 3. The opponent's copies: their master is asked, on the turn player's action ──
  {
    let s = mainPhase(7303);
    const [x, y] = [0, 1].map(() => stage(s, "p2", "SD15-05", "battle"));
    const player = stage(s, "p1", "PLAYER730", "battle");
    s = apply(s, legal(s).find(({ action }) => action.type === "activate" && action.card === player)!.action).state;
    assert.ok(isUniqueQuestion(s), "the violation is processed during p1's action");
    assert.equal(s.prompt.kind === "chooseCards" && s.prompt.player, "p2", "p2, the copies' master, chooses (21-11-3)");
    throwsIllegal(() => apply(s, { type: "choose", player: "p1", cards: [x] }), "the turn player cannot choose for the master");
    const t = until(apply(s, { type: "choose", player: "p2", cards: [y] }).state, (st) => st.prompt.kind === "main");
    assert.deepEqual(zone(t, "p2", "battle").filter((id) => t.cards[id].cardId === "SD15-05"), [y]);
    assert.ok(zone(t, "p2", "drop").includes(x), "p2's other copy goes to p2's Drop Area");
  }

  // ── 4. The local policy answers the question ───────────────────────────
  {
    const { s, inBattle: [a], inHand: b } = playBeside(["SD15-05"], "SD15-05", { seed: 7304 });
    assert.ok(isUniqueQuestion(s));
    const match: PinnedMatch = { ctx: { ...ctx, rulesetDefinition: game }, state: s, beats: null, art: {}, names: { p1: "P1", p2: "P2" } };
    const turn = policyTurn(match, "p1", 1);
    assert.equal(turn.input.decisions.window, "chooseCards");
    const decided = choiceDecision(turn.input);
    assert.ok(decided?.cards?.length === 1, `the choices layer keeps one copy (${JSON.stringify(decided)})`);
    assert.match(decided!.how, /\[Unique\] \(21-11\)/, "by the 21-11 rule");
    const step = localStep(match, "p1", 1, localMemory(policyRng(730)), localPolicy());
    assert.ok(step.ok, `the local policy's answer plays (${JSON.stringify(step).slice(0, 300)})`);
    const after = step.match.state;
    const kept = [a, b].filter((id) => zone(after, "p1", "battle").includes(id));
    assert.equal(kept.length, 1, "one copy stays");
    assert.ok([a, b].filter((id) => !kept.includes(id)).every((id) => zone(after, "p1", "drop").includes(id)), "the other is in the Drop Area");
    // Deterministic: the same answer from a JSON copy.
    const again = localStep(JSON.parse(JSON.stringify(match)) as PinnedMatch, "p1", 1, localMemory(policyRng(730)), localPolicy());
    assert.ok(again.ok && JSON.stringify(again.match.state) === JSON.stringify(after), "the same answer from a JSON copy");
  }

  // ── 5. "When placed in your Drop Area" Autos answer the rule's move ────
  {
    const { s, inBattle: [a], inHand: b } = playBeside(["UDROP730"], "UDROP730", { seed: 7305 });
    assert.ok(isUniqueQuestion(s));
    const t = until(apply(s, { type: "choose", player: "p1", cards: [b] }).state, (st) => st.prompt.kind === "main");
    assert.ok(zone(t, "p1", "drop").includes(a) && zone(t, "p1", "battle").includes(b));
    // PLAYER730's draw and the dropped copy's own Auto: two cards.
    assert.equal(zone(t, "p1", "hand").length, 2, "the dropped copy's Drop Auto drew 1 beside PLAYER730's draw");
  }

  // ── 6. 9-10 replacements on the rule's move ────────────────────────────
  {
    // A mandatory redirect is applied as on every rule move; an optional one is asked.
    const withReplacement = (optional: boolean): EngineContext => {
      const compiled = ctx.scripts!.UWARP730;
      const replaced = { ...compiled, complete: true, unsupported: [], bySkill: { ...compiled.bySkill, 10: { unsupported: [], ops: [{ op: "replaceLeave", to: "warp", ...(optional ? { optional: true } : {}) }] } } };
      return { ...ctx, scripts: new Proxy(ctx.scripts!, { get: (target, key: string) => (key === "UWARP730" ? replaced : Reflect.get(target, key)) }) } as EngineContext;
    };
    for (const optional of [false, true]) {
      const c2 = withReplacement(optional);
      let s = mainPhase(7306);
      const a = stage(s, "p1", "UWARP730", "battle");
      const b = stage(s, "p1", "UWARP730", "hand");
      const player = stage(s, "p1", "PLAYER730", "battle");
      const run = (st: VmState, action: Action) => rules.apply(c2, reload(st), action) as { state: VmState; events: GameEvent[] };
      s = run(s, rules.legalActions(c2, s).find(({ action }) => action.type === "activate" && action.card === player)!.action).state;
      s = run(s, { type: "choose", player: "p1", cards: [b] }).state;
      assert.ok(isUniqueQuestion(s), `${optional ? "optional" : "mandatory"}: the 21-11 question comes first`);
      s = run(s, { type: "choose", player: "p1", cards: [b] }).state;
      if (optional) {
        assert.equal(s.prompt.kind, "replaceMove", "an optional replacement is put to the departing card's master");
        assert.equal(s.prompt.kind === "replaceMove" && s.prompt.player, "p1");
        assert.equal(s.prompt.kind === "replaceMove" && s.prompt.card, a);
        throwsIllegal(() => run(s, { type: "chooseMode", player: "p2", index: 0 }), "the other seat cannot answer it");
        const options = s.prompt.kind === "replaceMove" ? s.prompt.options : [];
        const toWarp = options.findIndex((o) => /warp/i.test(o));
        assert.ok(toWarp >= 0, `the Warp is offered (${options.join(" | ")})`);
        // Reload mid-question.
        s = run(JSON.parse(JSON.stringify(s)) as VmState, { type: "chooseMode", player: "p1", index: toWarp }).state;
      }
      assert.ok(zone(s, "p1", "warp").includes(a), `${optional ? "optional, taken" : "mandatory"}: the replaced copy goes to the Warp, not the Drop`);
      assert.ok(!zone(s, "p1", "drop").includes(a) && zone(s, "p1", "battle").includes(b));
      assert.equal(s.prompt.kind, "main");
    }
  }

  // ── 7. Neighbours: nothing to process ──────────────────────────────────
  {
    // Same name, no [Unique] (22-39-4 counts cards with [Unique]).
    const plain = playBeside(["PLAIN730"], "PLAIN730", { seed: 7307 });
    assert.equal(plain.s.prompt.kind, "main", "two same-named cards without [Unique] stay");
    assert.equal(zone(plain.s, "p1", "battle").filter((id) => plain.s.cards[id].cardId === "PLAIN730").length, 2);
    // The keyword-less "only 1 copy" wording 21-11-2 also names is not processed (its play prohibition is unchanged).
    const s = mainPhase(7308);
    stage(s, "p1", "ONECOPY730", "battle");
    stage(s, "p1", "ONECOPY730", "battle");
    const t = apply(s, { type: "endMain", player: "p1" }).state;
    assert.ok(!isUniqueQuestion(t), "no [Unique] question for the keyword-less wording");
    assert.equal(zone(t, "p1", "battle").filter((id) => t.cards[id].cardId === "ONECOPY730").length, 2);
    // Two different [Unique] names side by side: nothing.
    const mixed = playBeside(["SD15-05"], "UDROP730", { seed: 7309 });
    assert.equal(mixed.s.prompt.kind, "main", "different [Unique] names do not violate 22-39-4");
    // A Hidden Mode copy shows no name or skills (23-5): not counted.
    const h = mainPhase(7310);
    const hidden = stage(h, "p1", "SD15-05", "battle");
    h.cards[hidden].hidden = true;
    stage(h, "p1", "SD15-05", "battle");
    const ht = apply(h, { type: "endMain", player: "p1" }).state;
    assert.ok(!isUniqueQuestion(ht), "a Hidden Mode copy is not counted");
  }

  console.log("  #730: [Unique] 21-11 master's choice — interruptive timing, projections, refusals, reload, policy, Drop Autos, replacements and neighbours passed");
}

export default main();
