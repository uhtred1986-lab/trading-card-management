/**
 * What a policy may know (#644, plan O2-01): one seat's restricted
 * observation of a position.
 *
 * It is a principled restriction of what the online Claude opponent is
 * already given (`ai/view.ts`: its own hand and decklist, everything public
 * about both boards, counts for the rest) — taken not from the engine's state
 * but from the seat's own masked board, the `Snapshot` the client contract
 * draws (`snapshot-core.ts`, projected by `browser.ts`'s `projectSnapshot`).
 * On top of that board's masking it removes what a board needs and a policy
 * does not (art, spend, taps, the game's row id and revision) and two
 * channels the board leaves open:
 *
 *  - **Instance ids of cards the seat cannot see.** An id (`p2#17`) is a
 *    function of the decklist position (`vm/index.ts`'s `createGame`), so a
 *    hidden card's id can name it as surely as its face. Every id the seat may
 *    not read is replaced by a positional alias (`?p2:hand:3`, `?p1:deck:0`)
 *    in the board and the decisions, and by `?` in the beat history, whose
 *    order would otherwise let a policy follow a hidden card across zones. A
 *    beat about a move the seat could not watch (a draw, a deck-to-hand
 *    search, a life card taken into the other hand) loses its card even when
 *    that card is public by now (`historicalMask`).
 *  - **The other seat's prompt.** Only its kind and actor; the words, the
 *    candidates and the payments belong to the seat being asked.
 *
 * Nothing here reads engine state, a seed or an RNG: the builder is handed the
 * masked board, the seat's own decklist counts and the alias table
 * (`policy/boundary.ts` makes all three from a pinned match).
 *
 * Policy layer: value imports only from `src/lib/arena/policy/` (checked by
 * `scripts/verify/arena-policy-contract.mts`).
 */
import type { PlayerId } from "../types";
import type { Snapshot } from "../snapshot-core";
import type { BattleView, CardView, PromptView, SideView } from "../view";
import type { NumberedBeat } from "../beats";
import type { EffectView } from "../effects";
import type { Game } from "@/lib/catalog/games";

export const OBSERVATION_VERSION = 1;

/** A card's public (or own) facts. `id` is an instance id the seat may read, or a positional alias. */
export interface CardFacts {
  id: string;
  cardId: string;
  name: string;
  power: number | null;
  /** The printed power, when an effect changed the figure shown. */
  basePower?: number;
  colors: string[];
  mode: "active" | "rest";
  hidden: boolean;
  flipped: boolean;
  markers: number;
  underCount: number;
  isToken: boolean;
  energyCost: number | null;
  comboCost: number | null;
  comboPower: number | null;
  keywords: string[];
  text: string | null;
  /** The rules in force on the card ("+5000 power" until the end of the turn). */
  effects?: EffectFacts[];
}

export interface EffectFacts {
  kind: string;
  label: string;
  until: string;
  by: PlayerId | null;
  /** The card whose skill made it — aliased when the seat cannot see it, and then unnamed. */
  source: string | null;
  sourceName: string | null;
  keyword?: string;
}

export interface SideFacts {
  player: PlayerId;
  leader: CardFacts | null;
  unison: CardFacts | null;
  battle: CardFacts[];
  combo: CardFacts[];
  energy: CardFacts[];
  energyColors: { card: string; colors: string[]; paymentColors: string[] }[];
  /** Null for the other seat: only its size is public (3-3-3). */
  hand: CardFacts[] | null;
  handCount: number;
  life: number;
  lifeFaceUp: CardFacts[];
  zDeckFaceUp: CardFacts[];
  deck: number;
  drop: number;
  /** The readable Drop, top first. */
  dropCards: CardFacts[];
  warp: number;
  warpCards: CardFacts[];
  zDeck: number;
  zEnergy: number;
  zEnergyCards: CardFacts[];
  energyMarkers: number;
  activeEnergy: number;
  rules: EffectFacts[];
}

export interface BattleFacts {
  attacker: string;
  guard: string;
  step: string;
  attackPower: number;
  guardPower: number;
  stakes?: BattleView["stakes"];
  contributions?: Record<string, number>;
  counters?: { card: CardFacts; by: PlayerId; after: number }[];
}

/**
 * The open question. The seat being asked (`mine`) gets the engine's words and
 * constraints; the other seat learns only that someone is deciding what.
 */
export type PromptFacts =
  | {
      mine: true;
      kind: string;
      actor: PlayerId;
      question: string;
      hint: string | null;
      min?: number;
      max?: number;
      cost?: string;
      passConsequence?: string;
      step?: PromptView["step"];
      payments?: { option: number; energyRest: string[]; markers: number }[];
      /** Cards the prompt names that the board does not draw (a deck search, face-down life). */
      choices: CardFacts[];
    }
  | { mine: false; kind: string; actor: PlayerId | null };

export interface DeckEntry {
  cardId: string;
  count: number;
}

export interface PolicyObservation {
  v: typeof OBSERVATION_VERSION;
  seat: PlayerId;
  game: Game;
  turn: number;
  phase: string;
  turnPlayer: PlayerId;
  over: { winner: PlayerId | null; reason: string } | null;
  battle: BattleFacts | null;
  you: SideFacts;
  them: SideFacts;
  prompt: PromptFacts;
  /** The seat's own decklist as counts (no order): what `ai/view.ts`'s `decklistText` gives Claude. */
  ownDeck: DeckEntry[];
  /** The public history the board animates, ids the seat may not read replaced by `?`. */
  beats: { seq: number; list: NumberedBeat[]; art: Record<string, { cardId: string; name: string }> };
}

/** Hidden instance id → its positional alias, for the seat the observation is built for. */
export type AliasTable = Readonly<Record<string, string>>;

/** The alias written into the beat history for any card the seat may not read. */
export const BEAT_ALIAS = "?";

/** Replace every string (and object key) that is a hidden instance id. Pure; returns a copy. */
export function aliasIds<T>(value: T, aliases: AliasTable, as?: string): T {
  const swap = (s: string) => (Object.prototype.hasOwnProperty.call(aliases, s) ? (as ?? aliases[s]) : s);
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return swap(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[swap(k)] = walk(x);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

const hiddenId = (aliases: AliasTable, id: string | null | undefined) => !!id && Object.prototype.hasOwnProperty.call(aliases, id);

function effectFacts(e: EffectView, aliases: AliasTable): EffectFacts {
  const masked = hiddenId(aliases, e.source);
  return {
    kind: e.kind,
    label: e.label,
    until: String(e.until),
    by: e.by,
    source: e.source && masked ? aliases[e.source] : e.source,
    sourceName: masked ? null : e.sourceName,
    ...(e.keyword ? { keyword: e.keyword } : {}),
  };
}

function cardFacts(c: CardView, aliases: AliasTable): CardFacts {
  const cost = c.cost === null ? null : Number(c.cost);
  return {
    id: hiddenId(aliases, c.id) ? aliases[c.id] : c.id,
    cardId: c.cardId,
    name: c.name,
    power: c.power,
    ...(c.basePower !== undefined ? { basePower: c.basePower } : {}),
    colors: [...c.colors],
    mode: c.mode,
    hidden: c.hidden,
    flipped: c.flipped,
    markers: c.markers,
    underCount: c.underCount,
    isToken: c.isToken,
    energyCost: cost !== null && Number.isFinite(cost) ? cost : null,
    comboCost: c.comboCost,
    comboPower: c.comboPower,
    keywords: [...c.keywords],
    text: c.text,
    ...(c.effects?.length ? { effects: c.effects.map((e) => effectFacts(e, aliases)) } : {}),
  };
}

function sideFacts(s: SideView, own: boolean, aliases: AliasTable): SideFacts {
  const cards = (list: CardView[] | undefined) => (list ?? []).map((c) => cardFacts(c, aliases));
  const one = (c: CardView | null) => (c ? cardFacts(c, aliases) : null);
  return {
    player: s.player,
    leader: one(s.leader),
    unison: one(s.unison),
    battle: cards(s.battle),
    combo: cards(s.combo),
    energy: cards(s.energy),
    energyColors: aliasIds((s.energyColors ?? []).map((e) => ({ card: e.card, colors: [...e.colors], paymentColors: [...e.paymentColors] })), aliases),
    // 3-3-3: the board already withholds the other hand; this never reads it even if a board did not.
    hand: own && s.hand ? cards(s.hand) : null,
    handCount: s.handCount,
    life: s.life,
    lifeFaceUp: cards(s.lifeFaceUp),
    zDeckFaceUp: cards(s.zDeckFaceUp),
    deck: s.deck,
    drop: s.drop,
    dropCards: cards(s.inspectableZones?.drop ?? (s.dropTop ? [s.dropTop] : [])),
    warp: s.warp,
    warpCards: cards(s.inspectableZones?.warp),
    zDeck: s.zDeck,
    zEnergy: s.zEnergy,
    zEnergyCards: cards(s.inspectableZones?.zEnergy),
    energyMarkers: s.energyMarkers,
    activeEnergy: s.activeEnergy,
    rules: (s.rules ?? []).map((e) => effectFacts(e, aliases)),
  };
}

function battleFacts(b: BattleView, aliases: AliasTable): BattleFacts {
  return {
    attacker: aliasIds(b.attacker, aliases),
    guard: aliasIds(b.guard, aliases),
    step: b.step,
    attackPower: b.attackPower,
    guardPower: b.guardPower,
    ...(b.stakes ? { stakes: { ...b.stakes } } : {}),
    ...(b.contributions ? { contributions: aliasIds(b.contributions, aliases) } : {}),
    ...(b.counters?.length ? { counters: b.counters.map((c) => ({ card: cardFacts(c.card, aliases), by: c.by, after: c.after })) } : {}),
  };
}

function promptFacts(snapshot: Snapshot, seat: PlayerId, aliases: AliasTable): PromptFacts {
  const p = snapshot.view.prompt;
  if (p.player !== seat || snapshot.over) return { mine: false, kind: p.kind, actor: p.player };
  const choices = [...(snapshot.view.you.choices ?? []), ...(snapshot.view.them.choices ?? [])].map((c) => cardFacts(c, aliases));
  return {
    mine: true,
    kind: p.kind,
    actor: seat,
    question: p.question,
    hint: p.hint,
    ...(p.min !== undefined ? { min: p.min } : {}),
    ...(p.max !== undefined ? { max: p.max } : {}),
    ...(p.cost !== undefined ? { cost: p.cost } : {}),
    ...(p.passConsequence !== undefined ? { passConsequence: p.passConsequence } : {}),
    ...(p.step ? { step: { ...p.step } } : {}),
    ...(p.payments ? { payments: aliasIds(p.payments, aliases) } : {}),
    choices,
  };
}

/**
 * Which areas of each side the seat cannot look into (its own deck and life,
 * the other seat's hand, deck and life…), by area name as beats say them.
 */
export type SecretAreas = Readonly<Record<PlayerId, readonly string[]>>;

/**
 * A beat may name a card the seat can see *now* at a moment it could not: a
 * draw, a deck-to-hand search, a life card taken into the other hand. Such a
 * beat keeps the moment and loses the card, or a policy could follow a card
 * into a hand and out of it again — which no player at the table can.
 */
function historicalMask(b: NumberedBeat, secret: SecretAreas): NumberedBeat {
  const isSecret = (p: PlayerId | null | undefined, area: string) => !!p && secret[p].includes(area);
  if (b.t === "draw" && b.card && isSecret(b.player, "hand")) return { ...b, card: BEAT_ALIAS };
  if (b.t === "move" && !b.reveal && isSecret(b.owner, b.from) && isSecret(b.owner, b.to)) return { ...b, card: BEAT_ALIAS };
  if (b.t === "damage" && isSecret(b.player, "hand")) return { ...b, cards: b.cards.map(() => BEAT_ALIAS) };
  return b;
}

function beatFacts(snapshot: Snapshot, aliases: AliasTable, secret: SecretAreas): PolicyObservation["beats"] {
  const beats = snapshot.beats;
  if (!beats) return { seq: 0, list: [], art: {} };
  const art: PolicyObservation["beats"]["art"] = {};
  for (const [id, a] of Object.entries(beats.art)) if (!hiddenId(aliases, id)) art[id] = { cardId: a.cardId, name: a.name };
  return { seq: beats.seq, list: aliasIds(beats.list.map((b) => historicalMask(b, secret)), aliases, BEAT_ALIAS), art };
}

/**
 * The seat's observation, from the seat's own masked board. `snapshot` must
 * have been projected for `seat` (its `game.you`); anything else is refused
 * rather than silently re-read from another chair.
 */
export function buildObservation(snapshot: Snapshot, seat: PlayerId, ownDeck: DeckEntry[], aliases: AliasTable, secret: SecretAreas): PolicyObservation {
  if (snapshot.game.you !== seat) throw new Error(`the board was drawn for ${snapshot.game.you}, not ${seat}`);
  const v = snapshot.view;
  return {
    v: OBSERVATION_VERSION,
    seat,
    game: snapshot.game.game,
    turn: v.turn,
    phase: v.phase,
    turnPlayer: v.turnPlayer,
    over: v.over ? { winner: v.over.winner, reason: v.over.reason } : null,
    battle: v.battle ? battleFacts(v.battle, aliases) : null,
    you: sideFacts(v.you, true, aliases),
    them: sideFacts(v.them, false, aliases),
    prompt: promptFacts(snapshot, seat, aliases),
    ownDeck: [...ownDeck].sort((a, b) => (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0)).map((e) => ({ cardId: e.cardId, count: e.count })),
    beats: beatFacts(snapshot, aliases, secret),
  };
}
