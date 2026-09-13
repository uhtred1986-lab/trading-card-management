/**
 * The board, drawn from the declarations.
 *
 * `BoardView` is the client contract (`docs/arena-client-contract.md`): one
 * side's view of the table with what that viewer may not see hidden (3-1-3).
 * Its shape is the *contract's*, not an engine's — a field per area, because a
 * board draws a hand and a Drop and a Battle Area and always will — so this
 * module's job is the crossing between a `Record<zoneName, cardId[]>` and
 * those fields, and `VIEW_ZONES` below is where that crossing is written down
 * once.
 *
 * Everything on a card here is read through the **declared attributes**
 * (`./cards.ts`): a name, a power, a cost, the colours. What is not here is
 * everything that comes from a card's *skills* — the keywords in force, the
 * engine's reading of its text, whether the referee will be asked, the rules a
 * [Permanent] emits. Those are effects and triggers, which are #141's and
 * #142's; each is filled with what a card with no rules in force has, and the
 * board draws a card that simply does nothing yet rather than a wrong claim
 * about what it does.
 *
 * Pure and client-safe: no database, no network.
 */
import type { EngineContext } from "../engine";
import type { CardDef, PlayerId } from "../engine/types";
import type { BoardView, CardArt, CardView, PromptView, SideView } from "../view";
import { attrsOf, type Attrs } from "./cards";
import type { GameDefinition } from "../rulesets";
import type { VmState } from "./state";

/**
 * Which declared zone each field of a `SideView` is drawn from.
 *
 * The second and last place the interpreter knows a zone by name, and for a
 * different reason from `SETUP_ZONES`: this one is not a gap waiting on a
 * grammar, it is the **client contract** naming the areas a board has. A game
 * with other areas needs a contract that can say so, which is Stage 8's
 * question (words and prompts from the definition) and not a missing `DO`
 * program. Written as one table so that question has one place to be answered.
 */
const VIEW_ZONES = {
  leader: "leader",
  unison: "unison",
  battle: "battle",
  combo: "combo",
  energy: "energy",
  hand: "hand",
  life: "life",
  deck: "deck",
  drop: "drop",
  warp: "warp",
  zDeck: "zDeck",
  zEnergy: "zEnergy",
} as const;

/** The words the prompt bar says. `view.ts`'s own, sentence for sentence, until Stage 8 reads them from the definition. */
const QUESTIONS: Record<string, { question: string; hint: string | null }> = {
  chooseFirst: { question: "You won the flip. Who goes first?", hint: "The second player starts with one energy marker." },
  mulligan: { question: "Keep this hand?", hint: "You may redraw six cards once (6-2-1-9)." },
  charge: { question: "Charge one card as energy?", hint: "Tap a card in hand, or skip." },
  main: { question: "Your Main Phase.", hint: "Play cards, attack, or end the turn." },
  gameOver: { question: "The game is over.", hint: null },
};

export function vmBoardView(ctx: EngineContext, game: GameDefinition, state: VmState, viewer: PlayerId, images: Record<string, CardArt>): BoardView {
  const them: PlayerId = viewer === "p1" ? "p2" : "p1";
  return {
    you: sideView(ctx, game, state, viewer, true, images),
    them: sideView(ctx, game, state, them, false, images),
    turn: state.turn,
    phase: state.phase,
    turnPlayer: state.turnPlayer,
    // A battle is Stage 6; until then there is never one in progress, which is
    // a true statement about this engine rather than a placeholder.
    battle: null,
    prompt: promptView(state),
    over: state.overReason !== null ? { winner: state.winner, reason: state.overReason } : null,
  };
}

function promptView(state: VmState): PromptView {
  const pr = state.prompt;
  const words = QUESTIONS[pr.kind] ?? { question: "…", hint: null };
  return { kind: pr.kind, player: "player" in pr ? pr.player : null, question: words.question, hint: words.hint };
}

function sideView(ctx: EngineContext, game: GameDefinition, state: VmState, p: PlayerId, mine: boolean, images: Record<string, CardArt>): SideView {
  const zones = state.sides[p].zones;
  const at = (zone: string): string[] => zones[zone] ?? [];
  const cards = (zone: string): CardView[] => at(zone).map((id) => cardView(ctx, game, state, id, images));
  const one = (zone: string): CardView | null => (at(zone)[0] ? cardView(ctx, game, state, at(zone)[0], images) : null);
  const faceUp = (zone: string): CardView[] => at(zone).filter((id) => state.cards[id].faceUp).map((id) => cardView(ctx, game, state, id, images));
  const energy = at(VIEW_ZONES.energy);
  return {
    player: p,
    name: state.sides[p].name,
    leader: one(VIEW_ZONES.leader),
    unison: one(VIEW_ZONES.unison),
    battle: cards(VIEW_ZONES.battle),
    combo: cards(VIEW_ZONES.combo),
    energy: cards(VIEW_ZONES.energy),
    // 3-3-3: only the size of an opponent's hand is public.
    hand: mine ? cards(VIEW_ZONES.hand) : null,
    handCount: at(VIEW_ZONES.hand).length,
    life: at(VIEW_ZONES.life).length,
    lifeFaceUp: faceUp(VIEW_ZONES.life),
    zDeckFaceUp: faceUp(VIEW_ZONES.zDeck),
    deck: at(VIEW_ZONES.deck).length,
    drop: at(VIEW_ZONES.drop).length,
    warp: at(VIEW_ZONES.warp).length,
    zDeck: at(VIEW_ZONES.zDeck).length,
    zEnergy: at(VIEW_ZONES.zEnergy).length,
    energyMarkers: Number(state.sides[p].attrs.energyMarkers ?? 0),
    activeEnergy: energy.filter((id) => state.cards[id].mode === "active").length,
    dropTop: one(VIEW_ZONES.drop),
  };
}

/**
 * One card, as a client draws it.
 *
 * Every measure is read by **declared name** off the attributes, never off a
 * `CardDef` field: `vm/cards.ts` is the one adapter between the catalog and
 * the game's own words, and a board that reached round it would be a second
 * one.
 */
function cardView(ctx: EngineContext, game: GameDefinition, state: VmState, id: string, images: Record<string, CardArt>): CardView {
  const inst = state.cards[id];
  const def: CardDef | undefined = ctx.defs[inst.cardId];
  const attrs: Attrs = def ? attrsOf(def, game).attrs : {};
  const text = str(attrs.skill);
  // 23-5-2: a card in Hidden Mode has none of its front-side information, for
  // either player. Everything readable is withheld here rather than at each
  // caller, the same cut the legacy view makes.
  const hidden = inst.hidden;
  return {
    id,
    cardId: inst.cardId,
    name: hidden ? "Face-down card" : (str(attrs.name) ?? inst.cardId),
    power: hidden ? null : num(attrs.power),
    colors: hidden ? [] : strings(attrs.colors),
    imageUrl: hidden ? null : (images[inst.cardId]?.front ?? null),
    // The contract's `mode` is one of two words; a card in a zone that
    // declares no mode is drawn the way an unrested card is.
    mode: inst.mode === "rest" ? "rest" : "active",
    hidden,
    flipped: inst.flipped,
    markers: inst.markers,
    underCount: inst.under.length,
    // Tokens are the `token` op's, which is Stage 5: nothing in a game on this
    // engine has been made out of nothing yet.
    isToken: false,
    // An X cost has no `energyCost` attribute at all — 1-2-2-2 says it counts
    // as 0 except while it is being paid, and the value being paid is named at
    // the moment of payment (#139's reading, and #146's payment). So a card
    // whose cost is X shows none here rather than a number nobody chose.
    cost: hidden || num(attrs.energyCost) === null ? null : String(num(attrs.energyCost)),
    comboCost: hidden ? null : num(attrs.comboCost),
    comboPower: hidden ? null : num(attrs.comboPower),
    // Skills are read by the compiler into `card_rules`, and playing one is
    // #141 and #142. A card on this engine has no rule in force, and these
    // four say exactly that rather than guessing.
    keywords: [],
    text: hidden ? null : (text ?? null),
    reading: "",
    referee: false,
  };
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
