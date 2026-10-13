/**
 * Hidden instance ids never reach a board (`src/lib/arena/conceal.ts`), proved on the rules engine
 * and for both seats, without a database.
 *
 * An instance id is a decklist position (`${p}#${n}`, made before the shuffle), so a hidden
 * card's id names it as surely as its face. #644 proved the policy observation free of them;
 * this proves the online `Snapshot` — what the web board and the Android app are sent — is too.
 *
 *   1. Positions. Games on the rules engine (through the server's own `buildSnapshot`)
 *      and #641's fixed-seed game and every #642 scenario (through
 *      `projectSnapshot`, the same core), drawn for p1 and for p2 in a 1 v 1 and for the human
 *      against Claude:
 *        - no hidden id: no instance id the viewer may not read (the test's own list: the other
 *          hand and Z-Deck, both decks, face-down life, Hidden Mode) appears anywhere in the
 *          snapshot, as a value or as a key;
 *        - permutation invariance: swapping the identities, order and instance ids of every card
 *          the viewer cannot see leaves the snapshot byte-identical;
 *        - negative control: the same twin *is* told apart on a board left unconcealed, for each seat — the check is not vacuous;
 *        - round trip: every move in the asked seat's `legal` resolves (`resolveAliased`) to
 *          exactly the engine's move at that index;
 *        - refusals: an alias this seat was not given (another seat's, or a position that no
 *          longer exists) is refused, and so is a raw id of a card the seat may not read.
 *
 * Run from the repo root:  npx tsx scripts/verify/arena-snapshot-conceal.mts   (part of `npm test`)
 */
import assert from "node:assert/strict";
import { CTX } from "./harness.ts";
import { fixtureBundle, FIXTURE_REVISION, FIXTURE_SEED } from "./arena-browser-fixture.ts";
import { pick } from "./arena-browser-scenario.ts";
import { renamed, shuffled, strings, testRandom } from "./arena-policy-permute.ts";
import { runScenario, scenarioIds } from "./arena-scenarios.ts";
import type { EngineState } from "../../src/lib/arena/engines.ts";
import type { EngineId } from "../../src/lib/arena/engine-ids.ts";
import { RULES } from "../../src/lib/arena/vm/index.ts";
import { appendBeats } from "../../src/lib/arena/beats-core.ts";
import { buildSnapshot, buildUnconcealedSnapshotForProof, type Snapshot, type SnapshotInput } from "../../src/lib/arena/snapshot.ts";
import { applyMove, createPinnedMatch, legalMoves, projectSnapshot, type PinnedMatch } from "../../src/lib/arena/browser.ts";
import { ALIAS_PATTERN, hiddenAliases, resolveAliased } from "../../src/lib/arena/conceal.ts";
import { canonicalJson } from "../../src/lib/arena/replay-core.ts";
import type { Beats } from "../../src/lib/arena/beats";
import type { LegalAction, PlayerId } from "../../src/lib/arena/types";

const SEATS: PlayerId[] = ["p1", "p2"];
const started = Date.now();
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const tally = { positions: 0, boards: 0, permutations: 0, nontrivial: 0, controls: new Set<string>(), roundTrips: 0, foreign: 0, stale: 0, raw: 0 };

// ---------------------------------------------------------------------------------------------
// The test's own reading of the engine's state — not `conceal.ts`'s.

type Zones = Record<string, string[]>;
type AnyCard = { cardId: string; owner: PlayerId; hidden?: boolean; faceUp?: boolean };

function zonesOf(state: EngineState, p: PlayerId): Zones {
  return state.sides[p].zones as Zones;
}

/** What `seat` may not read: the other hand and Z-Deck, both decks and lives, face down; Hidden Mode anywhere; less what its own question shows it. */
function hiddenFrom(state: EngineState, seat: PlayerId): Set<string> {
  const cards = state.cards as Record<string, AnyCard>;
  const out = new Set<string>();
  for (const p of SEATS) {
    const z = zonesOf(state, p);
    for (const id of [...(z.deck ?? []), ...(z.life ?? []), ...(p === seat ? [] : [...(z.hand ?? []), ...(z.zDeck ?? [])])]) if (!cards[id]?.faceUp) out.add(id);
    for (const ids of Object.values(z)) for (const id of ids ?? []) if (cards[id]?.hidden) out.add(id);
  }
  const pr = state.prompt as { kind: string; player?: PlayerId; choice?: { candidates: string[] } };
  if (pr.kind === "chooseCards" && pr.player === seat) for (const id of pr.choice?.candidates ?? []) out.delete(id);
  return out;
}

/**
 * An equivalent information set for `seat`, on either engine: the cards it cannot see swap
 * identities within an owner, the fully hidden areas are reordered, and their instance ids are
 * permuted throughout the state and the beats.
 */
function permuted<S extends EngineState>(state0: S, beats0: Beats | null, seat: PlayerId, salt: number): { state: S; beats: Beats | null } {
  const rand = testRandom(salt);
  const state = clone(state0);
  const cards = state.cards as Record<string, AnyCard>;
  const hidden = hiddenFrom(state, seat);
  const held = strings({ ...state, cards: null, sides: null, players: null }).values;
  for (const p of SEATS) {
    const z = zonesOf(state, p);
    const mine = [...hidden].filter((id) => cards[id].owner === p && !held.has(id) && !cards[id].hidden && ["deck", "hand", "life"].some((k) => z[k]?.includes(id)));
    const ids = shuffled(mine.map((id) => cards[id].cardId), rand);
    mine.forEach((id, i) => (cards[id].cardId = ids[i]));
    for (const k of Object.keys(z)) {
      const list = z[k];
      if (list?.length && list.every((id) => hidden.has(id))) { const order = shuffled(list, rand); list.splice(0, list.length, ...order); }
    }
  }
  const sigma = new Map<string, string>();
  for (const p of SEATS) {
    const ids = [...hidden].filter((id) => cards[id].owner === p).sort();
    const to = shuffled(ids, rand);
    ids.forEach((id, i) => sigma.set(id, to[i]));
  }
  return { state: renamed(state, sigma), beats: renamed(clone(beats0), sigma) };
}

function leaks(snapshot: Snapshot, hidden: Set<string>): string[] {
  const seen = strings(snapshot);
  return [...hidden].filter((id) => seen.values.has(id) || seen.keys.has(id));
}

function firstDifference(a: string, b: string): string {
  let i = 0;
  while (a[i] === b[i]) i++;
  return `…${a.slice(Math.max(0, i - 140), i + 60)}… vs …${b.slice(Math.max(0, i - 140), i + 60)}…`;
}

// ---------------------------------------------------------------------------------------------
// The checks for one board.

interface Board {
  where: string;
  engine: EngineId;
  seat: PlayerId;
  state: EngineState;
  /** The engine's own moves, in order — what the snapshot's `legal` was built from. */
  legal: LegalAction[];
  build: (state: EngineState, beats: Beats | null, unconcealed?: boolean) => Snapshot;
  beats: Beats | null;
  /** Aliases the other seat's board was given at this position. */
  otherAliases: Set<string>;
  salt: number;
  control: boolean;
}

function aliasesIn(snapshot: Snapshot): Set<string> {
  const s = strings(snapshot);
  return new Set([...s.values, ...s.keys].filter((x) => ALIAS_PATTERN.test(x)));
}

function checkBoard(b: Board): Snapshot {
  tally.boards++;
  const snapshot = b.build(b.state, b.beats);
  assert.equal(snapshot.game.you, b.seat, `${b.where}: drawn for ${b.seat}`);
  const hidden = hiddenFrom(b.state, b.seat);
  assert.deepEqual(leaks(snapshot, hidden), [], `${b.where}: the board names cards ${b.seat} may not read`);
  assert.deepEqual(clone(snapshot), snapshot, `${b.where}: the board is plain JSON`);

  // Permutation invariance.
  const twin = permuted(b.state, b.beats, b.seat, b.salt);
  if (hidden.size > 1 && canonicalJson(twin.state) !== canonicalJson(b.state)) tally.nontrivial++;
  const twinSnap = b.build(twin.state, twin.beats);
  const a = canonicalJson(snapshot);
  const z = canonicalJson(twinSnap);
  if (a !== z) assert.fail(`${b.where}: a permuted hidden state changes ${b.seat}'s board near ${firstDifference(a, z)}`);
  tally.permutations++;
  if (b.control && !tally.controls.has(`${b.engine}:${b.seat}`)) {
    const raw = canonicalJson(b.build(b.state, b.beats, true));
    const rawTwin = canonicalJson(b.build(twin.state, twin.beats, true));
    if (raw !== rawTwin) tally.controls.add(`${b.engine}:${b.seat}`);
  }

  // Round trip and refusals, for the seat being asked.
  if (snapshot.legal.length) {
    assert.equal(snapshot.legal.length, b.legal.length, `${b.where}: the asked seat is sent every move`);
    snapshot.legal.forEach((l, i) => {
      const r = resolveAliased(l.action, b.state, b.seat);
      assert.ok(r.ok, `${b.where}: move ${i} resolves (${!r.ok ? r.reason : ""})`);
      assert.deepEqual(r.value, b.legal[i].action, `${b.where}: move ${i} (${l.label}) resolves to the engine's own move`);
      tally.roundTrips++;
    });
    // Another seat's alias: one its board was given, else one its table holds (a board shows
    // few — hidden cards are mostly counts), that this seat's table does not.
    const mine = new Set(Object.values(hiddenAliases(b.state, b.seat)));
    const theirs = [...b.otherAliases, ...Object.values(hiddenAliases(b.state, b.seat === "p1" ? "p2" : "p1"))];
    const foreign = theirs.find((x) => !mine.has(x));
    const template = snapshot.legal.find((l) => typeof (l.action as { card?: unknown }).card === "string");
    if (template) {
      const withCard = (card: string) => ({ ...template.action, card });
      if (foreign) {
        const r = resolveAliased(withCard(foreign), b.state, b.seat);
        assert.ok(!r.ok, `${b.where}: an alias from the other seat's board (${foreign}) is refused`);
        tally.foreign++;
      }
      const stale = resolveAliased(withCard(`?${b.seat === "p1" ? "p2" : "p1"}:deck:999`), b.state, b.seat);
      assert.ok(!stale.ok, `${b.where}: an alias of a position that does not exist is refused`);
      tally.stale++;
      const rawHidden = [...hidden][0];
      if (rawHidden) {
        const r = resolveAliased(withCard(rawHidden), b.state, b.seat);
        assert.ok(!r.ok, `${b.where}: a raw id of a hidden card is refused`);
        tally.raw++;
      }
    }
  }
  return snapshot;
}

// ---------------------------------------------------------------------------------------------
// 1. The rules engine, through the server's `buildSnapshot`.

const MIX = (v: string) => ["DRAWER", "PUMP", "BLOCKER", "CRIT", "KILLER", "BIG", "E-DRAW", "FLIPPER", "LIFEGIVER", v].flatMap((id) => Array.from({ length: 5 }, () => id));

for (const engineId of ["rules"] as EngineId[]) {
  const engine = RULES;
  for (const seed of [3, 17]) {
    const created = engine.createGame(CTX, { seed, p1: { name: "Red", leader: "L-RED", main: MIX("V1") }, p2: { name: "Blue", leader: "L-BLUE", main: MIX("V-BLUE") } });
    let state = created.state;
    let beats: Beats | null = appendBeats(null, engine.toBeats(CTX, state, created.events, 0));
    for (let n = 0; n <= 120 && state.phase !== "over"; n++) {
      tally.positions++;
      const legal = engine.legalActions(CTX, state);
      const input = (mode: "versus" | "sparring", viewer: PlayerId | null) => (s: EngineState, q: Beats | null): SnapshotInput => ({
        id: 1, revision: n, mode, status: "playing", p1Name: "Red", p2Name: "Blue", ctx: CTX, state: s,
        legal: engine.legalActions(CTX, s), log: [], beats: q, spotlight: null,
        spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: mode === "sparring" ? "p2" : null, viewer, images: {},
      });
      const boards: Record<string, Snapshot> = {};
      // A 1 v 1, each seat; then against Claude, whose human is p1 whoever is asked.
      for (const [mode, seat, viewer] of [["versus", "p1", "p1"], ["versus", "p2", "p2"], ["sparring", "p1", null]] as const) {
        const make = input(mode, viewer);
        const other = mode === "versus" ? boards[`versus:${seat === "p1" ? "p2" : "p1"}`] : undefined;
        boards[`${mode}:${seat}`] = checkBoard({
          where: `${engineId} seed ${seed} move ${n} ${mode} ${seat}`,
          engine: engineId, seat, state, legal, beats, salt: seed * 1000 + n * 3 + (seat === "p1" ? 1 : 2),
          otherAliases: other ? aliasesIn(other) : new Set(),
          control: n >= 10,
          build: (s, q, unconcealed) => (unconcealed ? buildUnconcealedSnapshotForProof(make(s, q)) : buildSnapshot(make(s, q))),
        });
      }
      // The 1 v 1 seats, the other way round, so p1 is also offered p2's aliases.
      if (boards["versus:p1"].legal.length) {
        checkBoard({
          where: `${engineId} seed ${seed} move ${n} versus p1 (foreign)`, engine: engineId, seat: "p1", state, legal, beats, salt: seed * 1000 + n * 3,
          otherAliases: aliasesIn(boards["versus:p2"]), control: false,
          build: (s, q) => buildSnapshot(input("versus", "p1")(s, q)),
        });
      }
      const action = pick(n + seed, legal);
      if (!action) break;
      const next = engine.apply(CTX, state, action);
      beats = appendBeats(beats, engine.toBeats(CTX, next.state, next.events, beats?.seq ?? 0));
      state = next.state;
    }
  }
  for (const seat of SEATS) assert.ok(tally.controls.has(`${engineId}:${seat}`), `${engineId}: an unconcealed board does tell a permuted twin apart for ${seat} (the check is not vacuous)`);
}

// ---------------------------------------------------------------------------------------------
// 2. The rules engine's pinned fixtures (#641's game, #642's scenarios), through `projectSnapshot`.

const bundle = await fixtureBundle();
const pinnedBoards = (label: string, match: PinnedMatch, revision: number) => {
  tally.positions++;
  const legal = match.state.phase === "over" ? [] : legalMoves(match);
  const made: Partial<Record<PlayerId, Snapshot>> = {};
  for (const seat of SEATS) {
    made[seat] = checkBoard({
      where: `${label} r${revision} ${seat}`, engine: "rules", seat, state: match.state, legal, beats: match.beats,
      salt: revision * 7 + (seat === "p1" ? 1 : 2), otherAliases: made.p1 ? aliasesIn(made.p1) : new Set(), control: false,
      build: (s, q, unconcealed) => projectSnapshot({ ...match, state: s as PinnedMatch["state"], beats: q }, seat, { revision, ...(unconcealed ? { unconcealedForProof: true as const } : {}) }),
    });
  }
};
{
  let { match } = await createPinnedMatch({ bundle, seed: FIXTURE_SEED, interpreterRevision: FIXTURE_REVISION });
  pinnedBoards("641", match, 0);
  for (let n = 1; n <= 120 && match.state.phase !== "over"; n++) {
    const action = pick(n, legalMoves(match));
    if (!action) break;
    match = applyMove(match, action).match;
    pinnedBoards("641", match, n);
  }
}
for (const id of scenarioIds()) {
  let revision = 0;
  const evidence = await runScenario(id, { bundle, interpreterRevision: FIXTURE_REVISION, observe: (match) => pinnedBoards(`642:${id}`, match, revision++) });
  assert.ok(evidence.pass, `scenario ${id} still passes with the observer attached`);
}

// `buildSnapshot` is the one door: the browser entry and the server entry conceal alike.
assert.ok(tally.foreign > 0 && tally.stale > 0 && tally.raw > 0, "every refusal was exercised");
assert.ok(tally.nontrivial > tally.permutations / 2, `most permuted states really differ (${tally.nontrivial} of ${tally.permutations})`);

console.log(`arena-snapshot-conceal: ${tally.positions} positions, ${tally.boards} boards on the rules engine; ${tally.permutations} permuted hidden states (${tally.nontrivial} differing) drawn byte-identically`);
console.log(`  negative control caught on ${[...tally.controls].sort().join(", ")}; ${tally.roundTrips} legal moves resolved to the engine's own; refusals: ${tally.foreign} foreign, ${tally.stale} stale, ${tally.raw} raw hidden ids; ${((Date.now() - started) / 1000).toFixed(1)} s`);
