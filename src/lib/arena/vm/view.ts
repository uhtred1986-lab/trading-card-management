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
 * Everything on a card here is read through the **printed** declared attributes
 * (`./cards.ts`): a name, a power, a cost, the colours. What is not here is
 * everything that comes from a card's *skills* — the power a continuous effect
 * has changed, the keywords in force, the engine's reading of its text, whether
 * the referee will be asked, the rules a [Permanent] emits. The effects
 * themselves are in force and correct on the state (#142, and #147 puts them
 * there from a skill a player used); what is missing is this module reading
 * them through `attrsNow` the way `vm/costs.ts` reads a price, so a client
 * would draw the printed number. That is parity work and is #149's — until it
 * lands the board draws a card that simply does nothing yet rather than a wrong
 * claim about what it does.
 *
 * Two things on a *side* are read from the board rather than printed, since
 * #152: the cards a search shows the player being asked (`you.choices`), and
 * the rules in force on a player rather than on a card (`rules` — a
 * player-level prohibition, timed or from a [Permanent]). Neither is a card's
 * face, and both are the legacy board's own readings, field for field.
 *
 * Pure and client-safe: no database, no network.
 */
import type { EngineContext } from "../engine";
import type { CardDef, PlayerId, Prohibition } from "../engine/types";
import type { BattleView, BoardView, CardArt, CardView, PromptView, SideView } from "../view";
import { describeEffect, describeStatic, type EffectView } from "../effects";
import { attrsOf, type Attrs } from "./cards";
import { attrsNow, staticsNow } from "./program";
import { masterOf } from "./triggers";
import { findCard, hostOf, isTokenCard } from "./zones";
import type { GameDefinition } from "../rulesets";
import type { VmState } from "./state";
import { fixedPrompt, promptHint } from "../prompt-words";

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


export function vmBoardView(ctx: EngineContext, game: GameDefinition, state: VmState, viewer: PlayerId, images: Record<string, CardArt>): BoardView {
  const them: PlayerId = viewer === "p1" ? "p2" : "p1";
  return {
    you: sideView(ctx, game, state, viewer, viewer, true, images),
    them: sideView(ctx, game, state, them, viewer, false, images),
    turn: state.turn,
    phase: state.phase,
    turnPlayer: state.turnPlayer,
    battle: battleView(ctx, game, state, images),
    prompt: promptView(state),
    over: state.overReason !== null ? { winner: state.winner, reason: state.overReason } : null,
  };
}

/**
 * The open battle (#150), read from `state.battle` — the one record
 * `vm/battle.ts` writes and this reads, computed here and nowhere else so a
 * client never works out `attackPower`/`guardPower` for itself
 * (`docs/arena-battle-staging-spec.md` §3.1, the same promise the legacy
 * `battleView` keeps).
 *
 * Power is read **live** (`attrsNow`, with combo added), unlike the plain
 * `cardView` below, which still draws a card's *printed* face — a fight has
 * to be decided by the number it is actually being fought over, and the
 * `contributions` map is that same arithmetic kept rather than thrown away.
 */
function battleView(ctx: EngineContext, game: GameDefinition, state: VmState, images: Record<string, CardArt>): BattleView | null {
  const b = state.battle;
  if (!b) return null;
  const defender: PlayerId = state.turnPlayer === "p1" ? "p2" : "p1";
  const contributions: Record<string, number> = {};
  const power = (id: string): number => (contributions[id] = Number(attrsNow(ctx, game, state, id).power ?? 0));
  const combo = (p: PlayerId): number =>
    (state.sides[p].zones.combo ?? []).reduce((n, id) => {
      const c = Number(attrsNow(ctx, game, state, id).comboPower ?? 0);
      contributions[id] = c;
      return n + c;
    }, 0);
  const attackPower = power(b.attacker) + combo(state.turnPlayer);
  const guardPower = power(b.guard) + combo(defender);
  // A counter's own contribution is the power it put on the fight through a
  // continuous effect it is the source of — #150 wires the primitive
  // (`vmHost`'s `addEffect`) but no card's program targets the attacker or
  // guard with one yet (`ops.rules` declares neither `power` op call that
  // way from a counter skill), so every entry here reads 0 rather than
  // guessed at; the field is present so a card that does is drawn correctly
  // without a second change here.
  const counters = (b.counters ?? []).filter((c) => state.cards[c.card]);
  for (const c of counters) {
    let n = 0;
    for (const e of state.effects) if (e.kind === "power" && e.source === c.card && (e.target === b.attacker || e.target === b.guard)) n += e.value as number;
    contributions[c.card] = n;
  }
  return {
    attacker: b.attacker,
    guard: b.guard,
    step: b.step,
    attackPower,
    guardPower,
    ...(counters.length ? { counters: counters.map((c) => ({ card: cardView(ctx, game, state, c.card, images), by: c.by, after: c.after })) } : {}),
    contributions,
  };
}

/**
 * The one prompt kind reachable on this engine whose text is not fixed: a
 * counter or a combo's own price names what it is paying for
 * (`vm/battle.ts`), the same interpolation `view.ts`'s own `questionFor`
 * does for the legacy engine.
 */
export function promptView(state: VmState): PromptView {
  const pr = state.prompt;
  if (pr.kind === "payCost") return { kind: pr.kind, player: pr.player, question: `Which energy do you rest to ${pr.describe}?`, hint: promptHint("payCost"), cost: pr.describe };
  // The two questions a *program* puts (5-2, 20-2) carry their own words —
  // the legacy `questionFor`'s, field for field — and where the question sits
  // in the skill's chain (`stepFor` below).
  if (pr.kind === "chooseCards") {
    const { min, max, reason } = pr.choice;
    return withStep(state, reason, { kind: pr.kind, player: pr.player, question: reason, hint: `Choose ${min === max ? min : `${min} to ${max}`}.`, min, max });
  }
  if (pr.kind === "chooseMode") return withStep(state, pr.reason, { kind: pr.kind, player: pr.player, question: pr.reason, hint: promptHint("chooseMode") });
  if (pr.kind === "replaceMove") return withStep(state, pr.reason, { kind: pr.kind, player: pr.player, question: pr.reason, hint: promptHint("replaceMove") });
  const words = fixedPrompt(pr.kind) ?? { question: "…", hint: null };
  return { kind: pr.kind, player: "player" in pr ? pr.player : null, question: words.question, hint: words.hint };
}

/**
 * Where a program's question sits in its skill's chain — the legacy `stepFor`,
 * read off the program frame that is waiting rather than off a flow entry: the
 * suspended program is the front of `state.programs` (9-6-3), and it counts its
 * own asking ops the same way, so "step 2 of 3" means the same on both boards.
 * A frame that is not waiting has no chain this module can count, and says
 * "step 1" with no total invented.
 */
function withStep(state: VmState, label: string, view: PromptView): PromptView {
  const frame = state.programs[0];
  if (frame?.awaiting) {
    const asks = frame.ops.map((o, i) => (o.op === "choose" || o.op === "may" || o.op === "chooseMode" ? i : -1)).filter((i) => i >= 0);
    const askedNow = frame.awaiting === "replaceMove" ? 1 : 0;
    const index = Math.max(1, asks.filter((i) => i <= frame.ip).length + askedNow);
    return { ...view, step: { index, count: asks.length + askedNow, label } };
  }
  return { ...view, step: { index: 1, count: 0, label } };
}

/**
 * The cards a `chooseCards` prompt names on this side of the table that the
 * board does not draw — a deck search, the Drop below its top card, face-down
 * life, a pile under another card. The legacy `hiddenChoices`, card for card:
 * only for the player being asked, and only when that player is the viewer,
 * because what a search shows you is yours to see (3-1-3).
 */
function hiddenChoices(state: VmState, p: PlayerId, viewer: PlayerId, mine: boolean): string[] {
  const pr = state.prompt;
  if (pr.kind !== "chooseCards" || pr.player !== viewer) return [];
  const zones = state.sides[p].zones;
  const at = (zone: string): string[] => zones[zone] ?? [];
  const faceUp = (zone: string): string[] => at(zone).filter((id) => state.cards[id]?.faceUp);
  const drawn = new Set<string>([
    ...at(VIEW_ZONES.leader),
    ...at(VIEW_ZONES.unison),
    ...at(VIEW_ZONES.battle),
    ...at(VIEW_ZONES.combo),
    ...at(VIEW_ZONES.energy),
    ...(mine ? at(VIEW_ZONES.hand) : []),
    ...faceUp(VIEW_ZONES.life),
    ...faceUp(VIEW_ZONES.zDeck),
    ...at(VIEW_ZONES.drop).slice(0, 1),
  ]);
  return pr.choice.candidates.filter((id) => {
    if (drawn.has(id) || !state.cards[id]) return false;
    // A card under another belongs to whoever holds the host (23-2).
    const host = findCard(state, id) ? null : hostOf(state, id);
    const at = findCard(state, host ?? id);
    return at ? at.owner === p : state.cards[id].owner === p;
  });
}

/** One rule in force as the board draws it: its words, how long for, and whose card it came from. */
function effectView(ctx: EngineContext, state: VmState) {
  return (d: Pick<EffectView, "kind" | "label" | "keyword">, until: EffectView["until"], source: string | null | undefined, by: PlayerId | null): EffectView => {
    const src = source && state.cards[source] ? source : null;
    const name = src ? (ctx.defs[state.cards[src].cardId]?.name ?? null) : null;
    return { ...d, until, source: src, sourceName: name, by };
  };
}

/**
 * The timed effects on one card — the legacy `effectsOn`'s first half, worded
 * by the same `describeEffect`, so "controlled by its owner's opponent" (20-9)
 * or "+5000 power" reads the same on both boards (#439). The [Permanent]
 * half is not drawn per card on this engine yet.
 */
function effectsOn(ctx: EngineContext, state: VmState, id: string): EffectView[] {
  const view = effectView(ctx, state);
  return state.effects.filter((e) => e.target === id).map((e) => view(describeEffect(e), e.until, e.source, e.master ?? null));
}

/**
 * The rules in force on this *player* rather than on a card — a player-level
 * prohibition, timed or standing (20-14). The legacy `rulesOn`, rule for rule:
 * the timed effects first, then the [Permanent]s, each worded by the same
 * `describeEffect`/`describeStatic` the legacy board uses so the label is the
 * same sentence on both.
 */
function rulesOn(ctx: EngineContext, game: GameDefinition, state: VmState, p: PlayerId): EffectView[] {
  const out: EffectView[] = [];
  const about = (player: PlayerId | undefined) => !player || player === p;
  const view = effectView(ctx, state);
  for (const e of state.effects) if (!e.target && e.kind === "forbid" && e.forbid && about(e.forbid.player)) out.push(view(describeEffect(e), e.until, e.source, e.master ?? null));
  for (const e of staticsNow(ctx, game, state)) {
    if (e.target || e.kind !== "forbid" || !about((e.value as Prohibition).player)) continue;
    const by = state.cards[e.source] ? masterOf(game, state, e.source) : null;
    out.push(view(describeStatic({ source: e.source, kind: "forbid", target: e.target, value: e.value as Prohibition }, by), "permanent", e.source, by));
  }
  return out;
}

function sideView(ctx: EngineContext, game: GameDefinition, state: VmState, p: PlayerId, viewer: PlayerId, mine: boolean, images: Record<string, CardArt>): SideView {
  const zones = state.sides[p].zones;
  const at = (zone: string): string[] => zones[zone] ?? [];
  const cards = (zone: string): CardView[] => at(zone).map((id) => cardView(ctx, game, state, id, images));
  const one = (zone: string): CardView | null => (at(zone)[0] ? cardView(ctx, game, state, at(zone)[0], images) : null);
  const faceUp = (zone: string): CardView[] => at(zone).filter((id) => state.cards[id].faceUp).map((id) => cardView(ctx, game, state, id, images));
  const energy = at(VIEW_ZONES.energy);
  const choices = hiddenChoices(state, p, viewer, mine);
  const rules = rulesOn(ctx, game, state, p);
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
    ...(choices.length ? { choices: choices.map((id) => cardView(ctx, game, state, id, images)) } : {}),
    ...(rules.length ? { rules } : {}),
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
  const effects = hidden ? [] : effectsOn(ctx, state, id);
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
    // 19-1: a token is the `token` op's (#146), told apart by the id its
    // definition is encoded in (`isTokenCard`, `./zones.ts`).
    isToken: isTokenCard(inst.cardId),
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
    ...(effects.length ? { effects } : {}),
  };
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
