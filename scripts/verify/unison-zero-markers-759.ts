/**
 * #759 (21-9-2): a Unison Card in a Unison Area with zero or fewer markers is
 * placed in its owner's Drop Area. 21-9-1 / 21-1-2-1: interruptive rule
 * processing — resolved the moment the last marker leaves, even in the middle
 * of another action, not at the next checkpoint.
 *
 * Independent expectations from the Rule Manual (docs/rules/rulemanual.txt
 * 21-9, 3-4-1), rules engine only. SD15-02 and DB3-001 are the catalog's own
 * text (the #649 audit snapshot,
 * docs/arena-backlog/evidence/649/catalog-subset-2026-10-13.json).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CTX, DEFS, card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { cardDefFrom } from "../../src/lib/arena/load";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";

const rules = RULES;
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;

const snapshot = JSON.parse(readFileSync("docs/arena-backlog/evidence/649/catalog-subset-2026-10-13.json", "utf8")) as { cards: { id: string }[] };
const printed = (id: string): CardDef => {
  const row = snapshot.cards.find((c) => c.id === id);
  assert.ok(row, `${id} is in the audit snapshot`);
  return cardDefFrom(row as Parameters<typeof cardDefFrom>[0]);
};

const defs: Record<string, CardDef> = {
  ...DEFS,
  "SD15-02": printed("SD15-02"),
  "DB3-001": printed("DB3-001"),
  // A plain 25000-power Battle Card: the attack that strips a Unison guard's markers.
  ATK759: card("ATK759", { colors: ["Blue"], energyCost: 0, power: 25000, skill: null }),
  // [Double Strike] takes two markers from a Unison guard (13-5-2-2).
  LSAIYAN759: card("LSAIYAN759", { type: "LEADER", name: "Saiyan Leader", traits: ["Saiyan"], characters: ["Saiyan"], energyCost: null, comboCost: null, comboPower: null, skill: null }),
  DS759: card("DS759", { colors: ["Blue"], energyCost: 0, power: 25000, skill: "[Double Strike]" }),
};
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromCompiler(defs) };
const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
const apply = (s: VmState, action: Action) => rules.apply(ctx, reload(s), action) as { state: VmState; events: GameEvent[] };
const legal = (s: VmState) => rules.legalActions(ctx, s);
const zone = (s: VmState, p: PlayerId, z: string) => (s.sides[p].zones as Record<string, string[]>)[z] ?? [];

function mainPhase(seed = 759): VmState {
  let s = rules.createGame(ctx, { seed, p1: { name: "P1", leader: "L-RED", main: fifty("V1") }, p2: { name: "P2", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  s = apply(s, { type: "chooseFirst", player: (s.prompt as { player: PlayerId }).player, first: "p1" }).state;
  s = apply(s, { type: "mulligan", player: "p1", redraw: false }).state;
  s = apply(s, { type: "mulligan", player: "p2", redraw: false }).state;
  s = apply(s, { type: "charge", player: "p1", card: null }).state;
  assert.equal(s.prompt.kind, "main");
  for (const p of ["p1", "p2"] as const) for (const id of s.sides[p].zones.hand.slice()) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  return s;
}
function stage(s: VmState, p: PlayerId, cardId: string, area: "battle" | "unison" | "hand" | "energy" | "drop", markers?: number): string {
  const id = s.sides[p].zones.deck[0];
  assert.ok(id);
  s.cards[id].cardId = cardId;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok, `could not stage ${cardId}`);
  if (markers !== undefined) s.cards[id].markers = markers;
  s.pending = [];
  return id;
}
function until(s: VmState, stop: (s: VmState) => boolean, pick?: (s: VmState) => Action | undefined): VmState {
  for (let i = 0; i < 40 && !stop(s); i++) {
    const options = legal(s).filter(({ action }) => action.type !== "concede");
    const action = pick?.(s) ?? options.find(({ action }) => action.type === "chooseMode" && action.index === 0)?.action ?? options[0]?.action;
    assert.ok(action, `stopped at ${s.prompt.kind} with nothing to answer`);
    if (process.env.DEBUG759) console.log(JSON.stringify(s.prompt).slice(0, 300), "->", JSON.stringify(action));
    s = apply(s, action).state;
  }
  assert.ok(stop(s), `never reached the expected state (at ${s.prompt.kind})`);
  return s;
}

/** p1's Unison `cardId` with `markers`, then p2's turn with `attacker` ready; returns the state at p2's Main Phase. */
function p2Turn(cardId: string, markers: number, attacker: string, opts: { leader?: string; seed?: number } = {}) {
  let s = mainPhase(opts.seed);
  const unison = stage(s, "p1", cardId, "unison", markers);
  if (opts.leader) s.cards[s.sides.p1.zones.leader[0]].cardId = opts.leader;
  s = apply(s, { type: "endMain", player: "p1" }).state;
  s = until(s, (st) => st.prompt.kind === "main" && st.turnPlayer === "p2");
  const atk = stage(s, "p2", attacker, "battle");
  s.cards[atk].mode = "active";
  delete s.cards[atk].placedThisTurn;
  return { s, unison, atk };
}
const moveToDrop = (events: GameEvent[], id: string) => events.findIndex((e) => e.type === "move" && e.card === id && e.from === "unison" && e.to === "drop");
const answerLeader = (st: VmState): Action | undefined => {
  if (st.prompt.kind === "chooseMode") return { type: "chooseMode", player: st.prompt.player, index: 0 };
  if (st.prompt.kind !== "chooseCards") return undefined;
  const leader = st.sides.p1.zones.leader[0];
  return st.prompt.choice.candidates.includes(leader) ? { type: "choose", player: st.prompt.player, cards: [leader] } : undefined;
};
const settled = (st: VmState) => !st.battle && st.prompt.kind === "main";
const view = (s: VmState, viewer: PlayerId) => buildSnapshot({ id: 759, revision: 1, mode: "versus", status: "playing", p1Name: "Player 1", p2Name: "Player 2", ctx, state: s, legal: legal(s), log: [], beats: null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} });

async function main(): Promise<void> {
  // ── 1. Battle: the last marker lost to an attack (13-5-2, 8-4-6-3-3) ────
  {
    // Markers left: stays (21-9-2 needs zero or fewer).
    const two = p2Turn("SD15-02", 2, "ATK759");
    let s = until(apply(two.s, { type: "attack", player: "p2", attacker: two.atk, target: two.unison }).state, settled);
    assert.equal(s.cards[two.unison].markers, 1, "a plain attack takes one marker (13-5-2-2)");
    assert.ok(zone(s, "p1", "unison").includes(two.unison), "a Unison with a marker left stays in the Unison Area");
    assert.ok(!zone(s, "p1", "drop").includes(two.unison));

    // Last marker: placed in the Drop Area the moment it goes, and its Auto pends.
    const one = p2Turn("SD15-02", 1, "ATK759", { seed: 7591 });
    const start = apply(one.s, { type: "attack", player: "p2", attacker: one.atk, target: one.unison });
    const ran = { s: start.state, events: start.events };
    s = ran.s;
    assert.ok(!zone(s, "p1", "unison").includes(one.unison), "the Unison left the Unison Area");
    assert.ok(zone(s, "p1", "drop").includes(one.unison), "21-9-2: it is in its owner's Drop Area");
    assert.ok(moveToDrop(ran.events, one.unison) >= 0, "as a Unison Area -> Drop Area move event");
    assert.equal(s.cards[one.unison].markers, 0, "no markers on it");
    // The rest of the Damage Step is not skipped: 21-9 interrupts, it does not end the battle.
    const effectsBefore = s.effects.length;
    const asked = answerLeader(s);
    // The Unison-to-Drop Auto (9-6) asks which Leader (or is already resolving); either way it is not lost.
    assert.ok(asked || s.pending.length || s.programs.length || s.effects.length > 0 || s.prompt.kind !== "main", `SD15-02's Unison-to-Drop Auto pended (prompt ${s.prompt.kind})`);
    for (const viewer of ["p1", "p2"] as const) {
      const v = view(s, viewer);
      assert.equal(v.waiting, s.prompt.kind === "main" ? v.waiting : (s.prompt as { player?: PlayerId }).player === viewer ? "you" : "opponent", `${viewer}'s view agrees on who is asked`);
      assert.ok(JSON.stringify(v.view).includes(one.unison), `${viewer}'s view carries the Unison (public Drop Area card)`);
    }
    if (asked) {
      const a = apply(s, asked);
      const b = apply(JSON.parse(JSON.stringify(s)) as VmState, asked);
      assert.equal(JSON.stringify(a.state), JSON.stringify(b.state), "a reload mid-question resolves identically");
    }
    const done = until(s, settled, answerLeader);
    assert.ok(zone(done, "p1", "drop").includes(one.unison), "still in the Drop Area when the battle is over");
    assert.ok(done.effects.length > effectsBefore, "the Auto resolved: a mono-red Leader got +5000 for the turn");

    // [Double Strike] takes two markers at once: 2 -> 0 drops it too.
    const ds = p2Turn("SD15-02", 2, "DS759", { seed: 7592 });
    s = until(apply(ds.s, { type: "attack", player: "p2", attacker: ds.atk, target: ds.unison }).state, settled, answerLeader);
    assert.ok(zone(s, "p1", "drop").includes(ds.unison), "[Double Strike] taking the last two markers drops the Unison");
  }

  // ── 2. A marker price paid to zero (DB3-001's [-4]) ───────────────────────
  {
    let s = mainPhase(7593);
    const u = stage(s, "p1", "DB3-001", "unison", 5);
    s = apply(s, { type: "activate", player: "p1", card: u, skill: 20 }).state;
    assert.equal(s.cards[u].markers, 1, "5 markers - 4 = 1: the Unison stays");
    assert.ok(zone(s, "p1", "unison").includes(u));

    s = mainPhase(7594);
    const u4 = stage(s, "p1", "DB3-001", "unison", 4);
    const r = apply(s, { type: "activate", player: "p1", card: u4, skill: 20 });
    assert.ok(zone(r.state, "p1", "drop").includes(u4), "paying the last 4 markers puts the Unison in the Drop Area at once (21-9-2, interruptive)");
    assert.ok(!zone(r.state, "p1", "unison").includes(u4));
    assert.ok(moveToDrop(r.events, u4) >= 0, "as a Unison Area -> Drop Area move");
    assert.equal(r.state.prompt.kind, "main", "back to the Main Phase");
  }

  // ── 3. [-6][Auto] paid to zero while the Leader is attacked (SD15-02) ─────
  {
    const t = p2Turn("SD15-02", 6, "ATK759", { leader: "LSAIYAN759", seed: 7595 });
    const leader = t.s.sides.p1.zones.leader[0];
    t.s.cards[leader].mode = "active";
    const lifeBefore = zone(t.s, "p2", "life").length;
    const s = until(apply(t.s, { type: "attack", player: "p2", attacker: t.atk, target: leader }).state, settled, answerLeader);
    assert.ok(zone(s, "p1", "drop").includes(t.unison), "the Unison whose [-6] was paid is in the Drop Area");
    assert.equal(zone(s, "p2", "life").length, lifeBefore - 1, "and its 1 damage was still dealt");
  }

  console.log("  #759: 21-9-2 a Unison with no markers goes to the Drop Area — battle loss, price payment, Auto on the move, reload, both viewers passed");
}

export default main();
