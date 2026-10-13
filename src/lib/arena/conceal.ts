/**
 * Hidden instance ids, kept out of every board a viewer is sent.
 *
 * An instance id is a decklist position: both engines create every card
 * before the shuffle as `${player}#${n}`, leader first, then the main deck in
 * list order, then the Z-Deck (`vm/index.ts`, `engine/engine.ts`). Decklists
 * list copies together, so once one copy is seen its neighbours are named, and
 * anyone who knows (or guesses) the other decklist can read any hidden card off
 * its id. Masking the face (`maskBeats`) was not enough.
 *
 * So the online `Snapshot` (`snapshot-core.ts`) names a card the viewer may
 * not read only by where it lies — the same aliases the policy observation
 * uses (#644, `policy/observation.ts`):
 *
 *  - on the board, in `legal`, `taps`, `rejected`, the prompt and everywhere
 *    else, by a positional alias, `?p2:hand:3`, `?p1:energy:0`, `?p1:under:2`.
 *    Positions are public; which card holds one is not, so two boards that
 *    differ only in hidden cards are sent identically. An alias is valid for
 *    one revision of one viewer's board only.
 *  - in the beat history, by `?`, since a beat's position is a past one and
 *    following an alias across beats would follow the card. A beat about a
 *    move the viewer could not watch (an opponent's draw, a deck-to-hand
 *    search, life taken into the other hand) loses its card even when the
 *    card is public by now, as the policy's `historicalMask` has it.
 *  - an `EffectView` whose source is hidden loses its `sourceName` too.
 *
 * The other half is `resolveAliased`: a client that sends a whole `Action`
 * back (the web board's `act`, the gameplan preview) has it translated back
 * to instance ids against the same table, read off the same revision — an
 * alias that is not this viewer's at this revision is refused, and so is a raw
 * id of a card the viewer may not read. The REST client picks a move by its
 * index in `legal` and never sends an id at all.
 *
 * Engine-neutral and browser-safe: the rule is `revealedTo`'s (`view-core.ts`),
 * which reads either engine's state; nothing here imports `./engine`.
 */
import type { PlayerId } from "./types";
import type { EngineState } from "./engines";
import type { Beats, NumberedBeat } from "./beats";
import type { GameDefinition } from "./rulesets/types";
import { isVmState } from "./vm/state";
import { revealedTo } from "./view-core";
import { rulesetFor } from "./rulesets";
import { BEAT_ALIAS, historicalMask, type AliasTable, type SecretAreas } from "./policy/observation";

const SEATS: PlayerId[] = ["p1", "p2"];

/** Every placed zone of one side, by name: the rules engine's declared zones, or the legacy state's fields. */
function zonesOf(state: EngineState, p: PlayerId): Record<string, string[]> {
  if (isVmState(state)) return state.sides[p].zones as Record<string, string[]>;
  const s = state.players[p];
  return {
    battle: s.battle, combo: s.combo, deck: s.deck, drop: s.drop, energy: s.energy, hand: s.hand,
    leader: s.leader ? [s.leader] : [], life: s.life, removed: s.removed ?? [], unison: s.unison ? [s.unison] : [],
    warp: s.warp, zDeck: s.zDeck, zEnergy: s.zEnergy,
  };
}

/**
 * Every card instance `viewer` may not read, aliased by where it lies: its
 * owner, its zone and its index there (`?p2:hand:3`, `?p1:deck:0`). A card in
 * no zone (one under another, when that pile is closed) is `?p2:under:<n>`,
 * numbered in its host's order; a card in neither is `?p2:elsewhere:<n>`.
 * #644's `aliasTable`, read off either engine.
 */
export function hiddenAliases(state: EngineState, viewer: PlayerId, pinned?: GameDefinition): AliasTable {
  const visible = revealedTo(state, viewer, pinned);
  const out: Record<string, string> = {};
  const placed = new Set<string>();
  const cards = state.cards as Record<string, { owner: PlayerId; under?: string[] }>;
  for (const p of SEATS) {
    const zones = zonesOf(state, p);
    for (const zone of Object.keys(zones).sort()) {
      (zones[zone] ?? []).forEach((id, i) => {
        placed.add(id);
        if (!visible.has(id)) out[id] = `?${p}:${zone}:${i}`;
      });
    }
  }
  const under: Record<PlayerId, number> = { p1: 0, p2: 0 };
  for (const p of SEATS) {
    const zones = zonesOf(state, p);
    for (const zone of Object.keys(zones).sort()) {
      for (const host of zones[zone] ?? []) {
        for (const id of cards[host]?.under ?? []) {
          placed.add(id);
          if (!visible.has(id)) out[id] = `?${p}:under:${under[p]++}`;
        }
      }
    }
  }
  // Anything left (a card the engine keeps outside every zone) is hidden unless shown; never named by its id.
  const rest = Object.keys(cards).filter((id) => !placed.has(id) && !visible.has(id)).sort();
  rest.forEach((id, i) => (out[id] = `?${cards[id].owner}:elsewhere:${i}`));
  return out;
}

const LEGACY_SECRET = { none: ["deck", "life"], owner: ["hand", "zDeck"] };

/** The areas of each side `viewer` may not look into, by area name as beats say them (3-1-3). */
export function secretAreasFor(state: EngineState, viewer: PlayerId, pinned?: GameDefinition): SecretAreas {
  if (!isVmState(state)) {
    const of = (p: PlayerId) => [...LEGACY_SECRET.none, ...(p === viewer ? [] : LEGACY_SECRET.owner)].sort();
    return { p1: of("p1"), p2: of("p2") };
  }
  const loaded = pinned?.id === state.game ? null : rulesetFor(state.game);
  const game = pinned?.id === state.game ? pinned : loaded?.ok ? loaded.definition : null;
  if (!game) throw new Error(`the ${state.game} ruleset did not load, so no board can say what is secret`);
  return secretAreasOf(game, viewer);
}

/** The areas of each side `seat` may not read, by the ruleset's own visibility declarations (3-1-3). */
export function secretAreasOf(game: GameDefinition, seat: PlayerId): SecretAreas {
  const of = (p: PlayerId) => Object.entries(game.zones)
    .filter(([, z]) => { const v = z.visibility ?? "none"; return !(v === "all" || (v === "owner" && p === seat) || (v === "opponent" && p !== seat)); })
    .map(([name]) => name)
    .sort();
  return { p1: of("p1"), p2: of("p2") };
}

const has = (aliases: AliasTable, s: unknown): s is string => typeof s === "string" && Object.prototype.hasOwnProperty.call(aliases, s);

/**
 * Replace every string (and object key) that is a hidden instance id, by
 * exact match. Structure is shared wherever nothing changed, so a part of the
 * board with nothing hidden in it is the very object it was. An object naming
 * a hidden `source` loses its `sourceName` (an `EffectView`): the name says
 * which card it is as surely as the id.
 */
export function conceal<T>(value: T, aliases: AliasTable, as?: string): T {
  const name = (id: string) => as ?? aliases[id];
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return has(aliases, v) ? name(v) : v;
    if (Array.isArray(v)) {
      let changed = false;
      const out = v.map((x) => { const y = walk(x); if (y !== x) changed = true; return y; });
      return changed ? out : v;
    }
    if (v && typeof v === "object") {
      let changed = false;
      const out: Record<string, unknown> = {};
      const o = v as Record<string, unknown>;
      for (const [k, x] of Object.entries(o)) {
        const key = has(aliases, k) ? name(k) : k;
        const y = walk(x);
        if (key !== k || y !== x) changed = true;
        out[key] = y;
      }
      if (has(aliases, o.source) && typeof o.sourceName === "string") { out.sourceName = null; changed = true; }
      return changed ? out : v;
    }
    return v;
  };
  return walk(value) as T;
}

/**
 * The beat history for one viewer: unwatchable moves lose their card, and every hidden id is `?`.
 *
 * One exception keeps its face: a secret [Auto] declared from a hidden area (#549) is shown to
 * both players while its card stays where it is, so `maskBeats` leaves its art and its words in.
 * Such a declaration names its card `?shown:<k>`, numbered by first appearance — its face, never
 * its id, which would still name its hidden decklist neighbours and follow it on through the
 * hidden areas. Any other beat about that card (an older declaration `maskBeats` blanked, a draw)
 * stays `?`, so nothing links them.
 */
export function concealBeats(beats: Beats | null, aliases: AliasTable, secret: SecretAreas): Beats | null {
  if (!beats) return null;
  const masked = beats.list.map((b) => historicalMask(b, secret));
  const shownIds = new Set(Object.keys(beats.art).filter((id) => has(aliases, id)));
  const shownAs = new Map<string, string>();
  const shows = (b: NumberedBeat): boolean => (b.t === "autoDeclared" || (b.t === "skill" && !!b.reveal)) && shownIds.has(b.card) && (b.text !== "" || b.label !== "Skill");
  const list = masked.map((b) => {
    if (!shows(b)) return conceal(b, aliases, BEAT_ALIAS);
    const card = (b as { card: string }).card;
    if (!shownAs.has(card)) shownAs.set(card, `?shown:${shownAs.size}`);
    return conceal(b, Object.fromEntries(Object.keys(aliases).map((id) => [id, id === card ? shownAs.get(card)! : BEAT_ALIAS])));
  });
  const art = shownIds.size ? Object.fromEntries(Object.entries(beats.art).flatMap(([id, a]) => (!has(aliases, id) ? [[id, a]] : shownAs.has(id) ? [[shownAs.get(id)!, a]] : []))) : beats.art;
  const same = list.length === beats.list.length && list.every((b, i) => b === beats.list[i]);
  return same && art === beats.art ? beats : { ...beats, list, art };
}

export type Resolved<T> = { ok: true; value: T } | { ok: false; reason: string };

/** An alias as `hiddenAliases` writes one. */
export const ALIAS_PATTERN = /^\?p[12]:[A-Za-z]+:\d+$/;

/**
 * Translate what a client sent back (an `Action`, a list of them) from the
 * viewer's aliases to instance ids, against the table of the state the client
 * was shown. Refused: an alias this viewer was not given at this position
 * (another seat's, or an earlier revision's that no longer points anywhere),
 * and a raw id of a card the viewer may not read — a client that has one did
 * not get it from its board.
 */
export function resolveAliased<T>(value: T, state: EngineState, viewer: PlayerId, pinned?: GameDefinition): Resolved<T> {
  const aliases = hiddenAliases(state, viewer, pinned);
  const back = new Map(Object.entries(aliases).map(([id, alias]) => [alias, id]));
  let refused: string | null = null;
  const swap = (s: string): string => {
    // Any `?`-name: a board alias, a beat's `?` or `?shown:<k>`. No real id or action field starts so.
    if (s.startsWith("?")) {
      const id = back.get(s);
      if (id === undefined) refused ??= `${s} is not a card on your board now — read the board again`;
      return id ?? s;
    }
    if (has(aliases, s)) refused ??= "that names a card you cannot see";
    return s;
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return swap(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [swap(k), walk(x)]));
    return v;
  };
  const out = walk(value) as T;
  return refused ? { ok: false, reason: refused } : { ok: true, value: out };
}
