/**
 * #644's permutation-invariance harness, shared (#646): an equivalent information set for one
 * seat — every card it cannot see swapped for another of the same owner, the fully hidden areas
 * reordered and those cards' instance ids permuted throughout the state and the beat history.
 * `arena-policy-contract.mts` proves the observation and decisions are unchanged by it;
 * `arena-policy-main.mts` proves the Main-Phase policy's answers are.
 */
import type { PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { PinnedMatch } from "../../src/lib/arena/browser";
import { nextInt, policyRng } from "../../src/lib/arena/policy/rng";

const SEATS: PlayerId[] = ["p1", "p2"];
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The test's own list of what `seat` may not read: the other hand, every deck and life and the other Z-Deck, face down — less the cards the seat's own question shows it. */
export function hiddenFrom(state: VmState, seat: PlayerId): Set<string> {
  const out = new Set<string>();
  for (const p of SEATS) {
    const zones = state.sides[p].zones as Record<string, string[]>;
    const ids = [...(zones.deck ?? []), ...(zones.life ?? []), ...(p === seat ? [] : [...(zones.hand ?? []), ...(zones.zDeck ?? [])])];
    for (const id of ids) if (!state.cards[id]?.faceUp) out.add(id);
    for (const z of Object.values(zones)) for (const id of z ?? []) if (state.cards[id]?.hidden) out.add(id);
  }
  const pr = state.prompt;
  if (pr.kind === "chooseCards" && pr.player === seat) for (const id of pr.choice.candidates) out.delete(id);
  return out;
}

/** Every string value and object key in `value`. */
export function strings(value: unknown, out: { values: Set<string>; keys: Set<string> } = { values: new Set(), keys: new Set() }) {
  if (typeof value === "string") out.values.add(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { out.keys.add(k); strings(v, out); }
  return out;
}

/** A small deterministic RNG for the test's own permutations. */
export function testRandom(seed: number) {
  let r = policyRng(seed);
  return (bound: number) => { const n = nextInt(r, bound); r = n.rng; return n.value; };
}

export function shuffled<T>(list: T[], rand: (n: number) => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { const j = rand(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

/** Rename instance ids everywhere — object keys and string values — by exact match. */
export function renamed<T>(value: T, sigma: Map<string, string>): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return sigma.get(v) ?? v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [sigma.get(k) ?? k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

/**
 * An equivalent information set for `seat`: the cards it cannot see get each other's identities
 * (within an owner), the fully hidden areas are reordered, and those cards' instance ids are
 * permuted throughout the state and the beat history.
 */
export function permutedFor(match: PinnedMatch, seat: PlayerId, salt: number): PinnedMatch {
  const rand = testRandom(salt);
  const state = clone(match.state);
  const hidden = hiddenFrom(state, seat);
  // Ids the engine is holding onto outside the zones (a skill in flight) keep their identity.
  const held = strings({ ...state, cards: null, sides: null }).values;
  for (const p of SEATS) {
    const mine = [...hidden].filter((id) => state.cards[id].owner === p && !held.has(id) && !state.cards[id].hidden && ["deck", "hand", "life"].some((z) => (state.sides[p].zones as Record<string, string[]>)[z]?.includes(id)));
    const ids = shuffled(mine.map((id) => state.cards[id].cardId), rand);
    mine.forEach((id, i) => (state.cards[id].cardId = ids[i]));
    const zones = state.sides[p].zones as Record<string, string[]>;
    for (const z of Object.keys(zones)) if (zones[z]?.length && zones[z].every((id) => hidden.has(id))) zones[z] = shuffled(zones[z], rand);
  }
  const pool = SEATS.map((p) => [...hidden].filter((id) => state.cards[id].owner === p).sort());
  const sigma = new Map<string, string>();
  for (const ids of pool) { const to = shuffled(ids, rand); ids.forEach((id, i) => sigma.set(id, to[i])); }
  return { ...match, state: renamed(state, sigma), beats: renamed(clone(match.beats), sigma) };
}
