/**
 * One plausible world for a seat (the lookahead's "determinization").
 *
 * The lookahead plays candidate moves forward in the real rules engine. The
 * engine needs a whole game, but the seat may not know the cards it cannot see
 * (the other hand, both decks' order, both Life areas, the other Z-Deck). So
 * every such card is given a sampled identity, and the result is a complete,
 * ordinary `PinnedMatch` the engine plays like any other.
 *
 * What a world may depend on — and nothing else:
 *  - what the seat sees (its restricted view: `aliasTable` names every card it
 *    may not read, by where it lies);
 *  - the seat's own decklist (it built the deck);
 *  - with `knowledge: "deck"` (the Hard difficulty) the other seat's decklist
 *    too — the counts, never the order, the hand or the Life;
 *  - the seed the policy hands in (its own randomness, never the game's).
 *
 * Every card the seat may not read loses everything that could tell it apart:
 * its identity is resampled slot by slot, its per-turn history is cleared, and
 * its instance id (a decklist position) is renamed to a canonical one by slot.
 * The game's RNG state and seed are replaced from the policy seed, and the beat
 * history is the seat's own masked one. So two matches the seat cannot tell
 * apart give the very same world for the same seed (proved by
 * `scripts/verify/arena-lookahead.mts` on hidden-state twins).
 *
 * Without the other decklist (`knowledge: "none"`, the Normal difficulty) the
 * other seat's unseen cards are drawn from a prior: half the time a copy of a
 * card that seat has shown (any of its cards the seat can read now), half the
 * time a card of the seat's own deck as a stand-in for "a typical card". This
 * is an assumption, not knowledge, and it is labelled so.
 *
 * Browser-safe: it sits on `browser.ts`, `policy/boundary.ts` and plain data.
 */
import type { PlayerId } from "../types";
import type { PinnedMatch } from "../browser";
import type { VmState } from "../vm/state";
import { aliasTable, ownDeck, secretAreas } from "../policy/boundary";
import { aliasIds } from "../policy/observation";
import { concealBeats } from "../conceal";
import { rulesetFor } from "../rulesets";
import type { GameDefinition } from "../rulesets/types";
import { nextInt, policyRng, type PolicyRng } from "../policy/rng";

export type Knowledge = "deck" | "none";

const SEATS: PlayerId[] = ["p1", "p2"];

/** A slot the seat cannot read: whose it is, the area and the position there (parsed from its alias). */
interface Slot {
  id: string;
  owner: PlayerId;
  zone: string;
  index: number;
}

function definitionOf(match: PinnedMatch): GameDefinition {
  const pinned = match.ctx.rulesetDefinition;
  if (pinned?.id === match.state.game) return pinned;
  const loaded = rulesetFor(match.state.game);
  if (!loaded.ok) throw new Error(`the ${match.state.game} ruleset does not load`);
  return loaded.definition;
}

/** `?p2:hand:3` -> owner p2, zone hand, index 3. */
function parseAlias(id: string, alias: string, owner: PlayerId): Slot {
  const m = /^\?(p[12]):([A-Za-z]+):(\d+)$/.exec(alias);
  return m ? { id, owner, zone: m[2], index: Number(m[3]) } : { id, owner, zone: "elsewhere", index: 0 };
}

const bySlot = (a: Slot, b: Slot) => (a.zone < b.zone ? -1 : a.zone > b.zone ? 1 : a.index - b.index);

/** `p2#17` -> 17; ids that do not follow the pattern sort after, by text. */
function idNumber(id: string): number {
  const m = /#(\d+)$/.exec(id);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}
const byIdNumber = (a: string, b: string) => idNumber(a) - idNumber(b) || (a < b ? -1 : a > b ? 1 : 0);

/** A multiset of card ids as a sorted list (sorted so a list built from a Map is order-independent). */
function expand(counts: Map<string, number>): string[] {
  const out: string[] = [];
  for (const [cardId, n] of [...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) for (let i = 0; i < n; i++) out.push(cardId);
  return out;
}

class Draw {
  constructor(public rng: PolicyRng) {}
  int(bound: number): number {
    const n = nextInt(this.rng, bound);
    this.rng = n.rng;
    return n.value;
  }
  shuffle<T>(list: T[]): T[] {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
  pick<T>(list: readonly T[]): T {
    return list[this.int(list.length)];
  }
}

/** Fields of a card that say what happened to it, cleared on a card the seat cannot read. */
function forget(card: VmState["cards"][string]): void {
  card.usedThisTurn = [];
  card.usedMarkerSkill = false;
  card.battledThisTurn = false;
  delete card.zoneEpoch;
  delete card.attacksThisTurn;
  delete card.playedUsing;
  delete card.enteredUsing;
  delete card.enteredBy;
  delete card.placedThisTurn;
  delete card.playedThisTurn;
  delete card.playedFrom;
}

export interface World {
  match: PinnedMatch;
  /** Hidden slots given an identity, by owner. */
  sampled: Record<PlayerId, number>;
  /** Slots filled from the prior rather than a known decklist remainder (Normal, or a remainder too small). */
  fromPrior: Record<PlayerId, number>;
}

/**
 * A complete match the engine can play, equal to `match` in everything `seat`
 * can see and sampled in everything it cannot. `seed` is the policy's.
 */
export function determinize(match: PinnedMatch, seat: PlayerId, knowledge: Knowledge, seed: number): World {
  const defs = match.ctx.defs;
  const isZ = (cardId: string) => (defs[cardId]?.type ?? "").startsWith("Z-");
  const isLeader = (cardId: string) => (defs[cardId]?.type ?? "") === "LEADER" || (defs[cardId]?.type ?? "") === "Z-LEADER";
  const isToken = (cardId: string) => (defs[cardId]?.type ?? "") === "TOKEN";
  const aliases = aliasTable(match, seat);
  const state = structuredClone(match.state) as VmState;
  const draw = new Draw(policyRng(seed >>> 0));
  const sampled: Record<PlayerId, number> = { p1: 0, p2: 0 };
  const fromPrior: Record<PlayerId, number> = { p1: 0, p2: 0 };
  const rename = new Map<string, string>();

  // What the seat can read of each side: the identities of every card not aliased.
  const visible: Record<PlayerId, Map<string, number>> = { p1: new Map(), p2: new Map() };
  for (const [id, card] of Object.entries(state.cards)) {
    if (Object.prototype.hasOwnProperty.call(aliases, id) || isToken(card.cardId)) continue;
    visible[card.owner].set(card.cardId, (visible[card.owner].get(card.cardId) ?? 0) + 1);
  }
  const ownList = ownDeck(match, seat);

  for (const p of SEATS) {
    const slots = Object.keys(aliases)
      .filter((id) => state.cards[id]?.owner === p)
      .map((id) => parseAlias(id, aliases[id], p))
      .sort(bySlot);
    if (!slots.length) continue;

    // Canonical ids: the k-th slot (by place) takes the k-th smallest hidden id of this owner.
    const canonical = slots.map((s) => s.id).sort(byIdNumber);
    slots.forEach((s, k) => rename.set(s.id, canonical[k]));

    const zSlots = slots.filter((s) => s.zone === "zDeck");
    const mainSlots = slots.filter((s) => s.zone !== "zDeck");
    const known = p === seat || knowledge === "deck";
    let zPool: string[] = [];
    let mainPool: string[] = [];
    if (known) {
      // The decklist less what the seat can read: exactly the unseen cards, as a multiset.
      const deck = p === seat ? ownList : ownDeck(match, p);
      const rest = new Map<string, number>();
      for (const { cardId, count } of deck) {
        const left = count - (visible[p].get(cardId) ?? 0);
        if (left > 0 && !isLeader(cardId) && !isToken(cardId)) rest.set(cardId, left);
      }
      const all = expand(rest);
      zPool = draw.shuffle(all.filter(isZ));
      mainPool = draw.shuffle(all.filter((c) => !isZ(c)));
    }
    // The prior for anything a known remainder cannot fill (and every slot of an unknown decklist).
    const shown = expand(visible[p]).filter((c) => !isLeader(c) && !isToken(c));
    const stand = expand(new Map(ownList.map((e) => [e.cardId, e.count] as const))).filter((c) => !isLeader(c) && !isToken(c));
    const prior = (wantZ: boolean): string | null => {
      const seen = shown.filter((c) => isZ(c) === wantZ);
      const typical = stand.filter((c) => isZ(c) === wantZ);
      if (seen.length && (!typical.length || draw.int(2) === 0)) return draw.pick(seen);
      if (typical.length) return draw.pick(typical);
      const any = [...shown, ...stand].filter((c) => !isZ(c));
      return any.length ? draw.pick(any) : null;
    };
    const fill = (list: Slot[], pool: string[], wantZ: boolean) => {
      list.forEach((s, k) => {
        let cardId: string | null = k < pool.length ? pool[k] : null;
        if (cardId === null) {
          cardId = prior(wantZ);
          fromPrior[p]++;
        }
        // Never keep the true identity: a world with nothing to sample from is no world.
        if (!cardId) throw new Error(`no identity to sample for ${p}'s ${s.zone} slot`);
        const card = state.cards[s.id];
        card.cardId = cardId;
        forget(card);
        sampled[p]++;
      });
    };
    fill(mainSlots, mainPool, false);
    fill(zSlots, zPool, true);
  }

  // Rename the hidden ids to their canonical ones everywhere (state keys, zone lists, programs, ...).
  const table = Object.fromEntries(rename);
  const renamed = aliasIds(state, table) as VmState;
  // Keep the card table's key order a function of what the seat sees: the places the hidden
  // ids held in it are fixed, and they are refilled with the canonical ids in ascending order.
  const hiddenIds = new Set(rename.values());
  const ascending = [...hiddenIds].sort(byIdNumber);
  let next = 0;
  const cards: VmState["cards"] = {};
  for (const key of Object.keys(renamed.cards)) {
    const k = hiddenIds.has(key) ? ascending[next++] : key;
    cards[k] = renamed.cards[k];
  }
  renamed.cards = cards;
  // A readable card can still point at a hidden one by a field of its own (`enteredBy`: the
  // card whose skill played it, since gone back to a hand or deck). Where that card now lies
  // is not the seat's to know, so the pointer goes to a fixed stand-in: the owner's lowest
  // hidden id. The structural `under` lists are places, already canonical.
  const firstHidden = (owner: string) => ascending.find((id) => id.startsWith(`${owner}#`)) ?? null;
  for (const card of Object.values(cards)) {
    if (hiddenIds.has(card.id)) continue;
    const fields = card as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(fields)) {
      if (key === "id" || key === "under" || typeof value !== "string" || !hiddenIds.has(value)) continue;
      fields[key] = firstHidden(value.split("#")[0]) ?? value;
    }
  }
  // The game's randomness is not the seat's to know: a fresh one, from the policy's seed.
  renamed.rngState = draw.int(0x7fffffff) + 1;
  renamed.seed = 0;
  const beats = concealBeats(match.beats, aliases, secretAreas(definitionOf(match), seat));
  return { match: { ...match, state: renamed, beats }, sampled, fromPrior };
}
