/**
 * The board as the browser needs it: plain, serialisable data.
 *
 * The engine's state is keyed by instance id and says nothing about images or
 * what a player may tap. This turns one state plus the legal moves into a view
 * for one side of the table, hiding what that player may not see (3-1-3).
 */
import { areaOf, comboPowerOf, describeScript, compileCardCached, face, keywordsInForce, powerOf, skillsOf, staticEffects, type EngineContext, type GameState, type LegalAction, type PlayerId, type RejectedAction, type Requirement } from "./engine";
import { def, emitsStatic, locate, permanentStatics, type StaticEffect } from "./engine/state";
import { describeEffect, describeStatic, type EffectView } from "./effects";

export interface CardView {
  id: string;
  cardId: string;
  name: string;
  power: number | null;
  colors: string[];
  imageUrl: string | null;
  mode: "active" | "rest";
  hidden: boolean;
  flipped: boolean;
  markers: number;
  underCount: number;
  isToken: boolean;
  cost: string | null;
  comboCost: number | null;
  comboPower: number | null;
  keywords: string[];
  /** The printed text, and the engine's own reading of it (proposal §6). */
  text: string | null;
  reading: string;
  /**
   * True when a skill of this card has to be put to the referee when it
   * resolves. Never for a [Permanent]: those never resolve and the referee is
   * never asked about one — an unreadable [Permanent] is in `permanents`.
   */
  referee: boolean;
  /**
   * The printed power, when the number shown is not it: a continuous effect
   * or someone's [Permanent] has changed it. Absent when `power` is the face
   * value, so a client can draw the difference and nothing else.
   */
  basePower?: number;
  /**
   * Every rule in force on this card right now — turn-long effects and the
   * static effects of [Permanent] skills, its own included — so the sheet can
   * say "+5000 power until the end of the turn, from Kaio-ken". Absent when
   * there are none.
   */
  effects?: EffectView[];
  /**
   * This card's own [Permanent] skills and whether each is doing anything at
   * this moment: `on` (emitting a standing effect), `off` (its condition does
   * not hold, or nothing to apply it to), `inert` (compiles, but the static
   * layer has no kind for what it says — it does nothing, and the compile
   * figures cannot show that), `unread` (the compiler cannot read it).
   */
  permanents?: PermanentView[];
}

/** One [Permanent] skill of a card and its state now (review §3.5). */
export interface PermanentView {
  /** Index of the skill in the card's text, the same `skillIndex` the engine uses. */
  index: number;
  /** The printed line, without its tag. */
  text: string;
  state: "on" | "off" | "inert" | "unread";
  /** The engine's reading of the line, when it has one. */
  reading: string;
}

export interface SideView {
  player: PlayerId;
  name: string;
  leader: CardView | null;
  unison: CardView | null;
  battle: CardView[];
  combo: CardView[];
  energy: CardView[];
  /** Null when the hand is the opponent's: only its size is public (3-3-3). */
  hand: CardView[] | null;
  handCount: number;
  life: number;
  /**
   * 3-9-2-1: the life cards a skill turned face up, and the same in the
   * Z-Deck. Both players may see these, on either side of the table, so they
   * are the one part of a closed area this view names.
   */
  lifeFaceUp: CardView[];
  zDeckFaceUp: CardView[];
  deck: number;
  drop: number;
  warp: number;
  zDeck: number;
  zEnergy: number;
  energyMarkers: number;
  activeEnergy: number;
  dropTop: CardView | null;
  /**
   * Cards the current prompt names that live in no drawn zone — the deck, the
   * Drop below its top card, the Warp, face-down life, the Z-Deck, under
   * another card. Absent unless the prompt names them, and only ever built for
   * the player being asked: a search of your deck reveals those cards to you
   * and to nobody else. This is what makes a search renderable at all.
   */
  choices?: CardView[];
  /**
   * Rules in force on this *player* rather than on a card — "can't attack
   * with Battle Cards until the start of your next turn", "can't place cards
   * in the Energy Area" — which no card on the board could carry. Absent when
   * there are none.
   */
  rules?: EffectView[];
}

export interface BoardView {
  you: SideView;
  them: SideView;
  turn: number;
  phase: string;
  turnPlayer: PlayerId;
  battle: { attacker: string; guard: string; step: string; attackPower: number; guardPower: number } | null;
  prompt: PromptView;
  over: { winner: PlayerId | null; reason: string } | null;
}

/** The one-line question the prompt bar asks, and what the engine knows about it beyond the words. */
export interface PromptView {
  kind: string;
  player: PlayerId | null;
  question: string;
  hint: string | null;
  /** How many cards a `chooseCards` prompt takes; `min` of 0 is what a "Choose none" button needs. */
  min?: number;
  max?: number;
  /**
   * Where this prompt sits in a skill's resolution chain, from the engine's
   * flow rather than a client counting taps. `count` is 0 when the chain
   * cannot say how long it is; a client then shows "step 2" without a total.
   */
  step?: { index: number; count: number; label: string };
  /** What is being paid for, unflattened, from a `payCost` or `optionalCost` prompt. */
  cost?: string;
}

/** Everything the current prompt will accept, indexed by the card it points at. */
export interface Tappable {
  /** Card instance id → the actions that name it. */
  byCard: Record<string, number[]>;
  /** Actions that name no card: pass, end turn, don't block. */
  bare: number[];
  /** For an attack, the targets each attacker may hit. */
  attackTargets: Record<string, Record<string, number>>;
  /**
   * Why a card the player might tap has no action: the rejections indexed the
   * same way, so a tap on a dead card has an answer. Present only when there
   * are any — they are computed for the asked player and never for Claude.
   */
  whyByCard?: Record<string, Requirement[]>;
}

const cardIdOf = (a: LegalAction["action"]): string | null => {
  const x = a as { card?: string | null; attacker?: string; cards?: string[] };
  if (typeof x.card === "string") return x.card;
  if (typeof x.attacker === "string") return x.attacker;
  if (Array.isArray(x.cards) && x.cards.length === 1) return x.cards[0];
  return null;
};

export function tappable(legal: LegalAction[], rejected: RejectedAction[] = []): Tappable {
  const out: Tappable = { byCard: {}, bare: [], attackTargets: {} };
  if (rejected.length) {
    const why: Record<string, Requirement[]> = {};
    for (const r of rejected) {
      const card = cardIdOf(r.action);
      if (!card) continue;
      const list = (why[card] ??= []);
      // The same requirement can fall out of two moves on one card ("you
      // have already charged" from both a play and a charge); once is enough.
      for (const q of r.why) if (!list.some((x) => JSON.stringify(x) === JSON.stringify(q))) list.push(q);
    }
    out.whyByCard = why;
  }
  legal.forEach((l, i) => {
    if (l.action.type === "attack") {
      const t = (out.attackTargets[l.action.attacker] ??= {});
      t[l.action.target] = i;
      (out.byCard[l.action.attacker] ??= []).push(i);
      return;
    }
    const card = cardIdOf(l.action);
    if (card) (out.byCard[card] ??= []).push(i);
    else out.bare.push(i);
  });
  return out;
}

/**
 * Card art from the catalog, keyed by card number. A leader has two faces, so
 * both are carried: a leader that has awakened must show its back, which is a
 * different image and often a different name (1-9-1).
 */
export interface CardArt {
  front: string | null;
  back: string | null;
}

/** A standing effect as the board lists it, with its source named now, while the card is still on the table. */
function effectView(ctx: EngineContext, s: GameState, d: Pick<EffectView, "kind" | "label" | "keyword">, until: EffectView["until"], source: string | null | undefined, by: PlayerId | null): EffectView {
  const src = source && s.cards[source] ? source : null;
  return { ...d, until, source: src, sourceName: src ? face(ctx, s, src).name : null, by };
}

/** Every rule in force on one card: turn-long effects, then the static effects [Permanent] skills put on it. */
function effectsOn(ctx: EngineContext, s: GameState, id: string, statics: StaticEffect[]): EffectView[] {
  const out: EffectView[] = [];
  for (const e of s.effects) if (e.target === id) out.push(effectView(ctx, s, describeEffect(e), e.until, e.source, e.master));
  for (const e of statics) if (e.target === id) out.push(effectView(ctx, s, describeStatic(e), "permanent", e.source, s.cards[e.source]?.owner ?? null));
  return out;
}

/** The rules in force on a player rather than a card: player-level prohibitions, timed and permanent. */
function rulesOn(ctx: EngineContext, s: GameState, p: PlayerId, statics: StaticEffect[]): EffectView[] {
  const out: EffectView[] = [];
  const about = (player: PlayerId | undefined) => !player || player === p;
  for (const e of s.effects) if (!e.target && e.kind === "forbid" && e.forbid && about(e.forbid.player)) out.push(effectView(ctx, s, describeEffect(e), e.until, e.source, e.master));
  for (const e of statics) if (!e.target && e.kind === "forbid" && about((e.value as { player?: PlayerId }).player)) out.push(effectView(ctx, s, describeStatic(e), "permanent", e.source, s.cards[e.source]?.owner ?? null));
  return out;
}

function cardView(ctx: EngineContext, s: GameState, id: string, images: Record<string, CardArt>, reveal: boolean, statics: StaticEffect[]): CardView {
  const inst = s.cards[id];
  const d = def(ctx, s, id);
  const f = face(ctx, s, id);
  const hidden = inst.hidden || !reveal;
  const side = inst.flipped && d.back ? "back" : "front";
  const scripts = compileCardCached(d, side);
  let reading = "";
  let referee = false;
  const permanents: PermanentView[] = [];
  for (const sk of skillsOf(d, side)) {
    const sc = scripts.bySkill[sk.index];
    if (!sc) continue;
    if (sk.kind === "permanent") {
      // A [Permanent] never resolves, so it is never the referee's; what it
      // is doing *now* is the only honest thing to say about it.
      const state: PermanentView["state"] = sc.unsupported.length ? "unread" : !emitsStatic(sc.ops) ? "inert" : (permanentStatics(ctx, s, id, sk.index)?.length ?? 0) > 0 ? "on" : "off";
      permanents.push({ index: sk.index, text: sk.raw.replace(/^\s*(?:\[[^\]]*\]\s*)+/, "").replace(/\s+/g, " ").trim(), state, reading: sc.unsupported.length ? "" : describeScript(sc.ops, { permanent: true }) });
      if (!sc.unsupported.length && sc.ops.length) reading += (reading ? " · " : "") + describeScript(sc.ops, { permanent: true });
      continue;
    }
    if (sc.unsupported.length) referee = true;
    else if (sc.ops.length) reading += (reading ? " · " : "") + describeScript(sc.ops);
  }
  const inPlayHere = inPlayArea(s, id);
  const power = hidden ? null : inPlayHere ? powerOf(ctx, s, id) : f.power;
  const effects = hidden ? [] : effectsOn(ctx, s, id, statics);
  return {
    id,
    cardId: inst.cardId,
    name: hidden ? "Face-down card" : f.name,
    power,
    colors: hidden ? [] : d.colors,
    // The awakened side has its own art; fall back to the front if the catalog has none.
    imageUrl: hidden ? null : side === "back" ? (images[inst.cardId]?.back ?? images[inst.cardId]?.front ?? null) : (images[inst.cardId]?.front ?? null),
    mode: inst.mode,
    hidden,
    flipped: inst.flipped,
    markers: inst.markers,
    underCount: inst.under.length,
    isToken: inst.isToken,
    cost: hidden ? null : d.energyCost == null ? null : String(d.energyCost),
    comboCost: hidden ? null : d.comboCost,
    comboPower: hidden ? null : inPlayArea(s, id) ? comboPowerOf(ctx, s, id) : d.comboPower,
    keywords: hidden ? [] : keywordsInForce(ctx, s, id).map((k) => k.name),
    text: hidden ? null : f.skill,
    reading,
    referee,
    ...(inPlayHere && power != null && f.power != null && power !== f.power ? { basePower: f.power } : {}),
    ...(effects.length ? { effects } : {}),
    ...(!hidden && permanents.length ? { permanents } : {}),
  };
}

function inPlayArea(s: GameState, id: string): boolean {
  const a = areaOf(s, id);
  return a === "leader" || a === "battle" || a === "unison" || a === "combo";
}

function sideView(ctx: EngineContext, s: GameState, p: PlayerId, images: Record<string, CardArt>, ownHand: boolean, viewer: PlayerId, statics: StaticEffect[]): SideView {
  const ps = s.players[p];
  const v = (id: string, reveal = true) => cardView(ctx, s, id, images, reveal, statics);
  const choices = hiddenChoices(ctx, s, p, viewer, ownHand);
  const rules = rulesOn(ctx, s, p, statics);
  return {
    player: p,
    name: ps.name,
    leader: ps.leader ? v(ps.leader) : null,
    unison: ps.unison ? v(ps.unison) : null,
    battle: ps.battle.map((id) => v(id)),
    combo: ps.combo.map((id) => v(id)),
    energy: ps.energy.map((id) => v(id)),
    hand: ownHand ? ps.hand.map((id) => v(id)) : null,
    handCount: ps.hand.length,
    life: ps.life.length,
    lifeFaceUp: ps.life.filter((id) => s.cards[id].faceUp).map((id) => v(id)),
    zDeckFaceUp: ps.zDeck.filter((id) => s.cards[id].faceUp).map((id) => v(id)),
    deck: ps.deck.length,
    drop: ps.drop.length,
    warp: ps.warp.length,
    zDeck: ps.zDeck.length,
    zEnergy: ps.zEnergy.length,
    energyMarkers: ps.energyMarkers,
    activeEnergy: ps.energy.filter((id) => s.cards[id].mode === "active").length,
    dropTop: ps.drop[0] ? v(ps.drop[0]) : null,
    ...(choices.length ? { choices: choices.map((id) => v(id)) } : {}),
    ...(rules.length ? { rules } : {}),
  };
}

/**
 * The cards a `chooseCards` prompt names on this side of the table that the
 * board does not draw. Only for the player being asked, and only when that
 * player is the viewer: what a search shows you is yours to see (3-1-3), so
 * the opponent's view of the same moment carries nothing.
 */
function hiddenChoices(ctx: EngineContext, s: GameState, p: PlayerId, viewer: PlayerId, ownHand: boolean): string[] {
  const pr = s.prompt;
  if (pr.kind !== "chooseCards" || pr.player !== viewer) return [];
  const ps = s.players[p];
  const drawn = new Set<string>([
    ...(ps.leader ? [ps.leader] : []),
    ...(ps.unison ? [ps.unison] : []),
    ...ps.battle,
    ...ps.combo,
    ...ps.energy,
    ...(ownHand ? ps.hand : []),
    ...ps.life.filter((id) => s.cards[id].faceUp),
    ...ps.zDeck.filter((id) => s.cards[id].faceUp),
    ...(ps.drop[0] ? [ps.drop[0]] : []),
  ]);
  return pr.choice.candidates.filter((id) => {
    if (drawn.has(id) || !s.cards[id]) return false;
    // A card under another belongs to whoever holds the host; `locate` finds
    // the host's owner for it.
    const at = locate(s, id);
    return at ? at.owner === p : s.cards[id].owner === p;
  });
}

/**
 * Where a prompt sits in a skill's chain, read from the engine's flow: a
 * script mid-execution counts its `choose` ops, and the one waiting is this
 * prompt. The other chains (an evolution, a union, [Aegis]) are prompts the
 * engine queued one at a time, so their length is not cheaply known and the
 * count is 0 — "step 1", with no total invented.
 */
function stepFor(s: GameState): PromptView["step"] {
  const pr = s.prompt;
  if (pr.kind !== "chooseCards" && pr.kind !== "chooseMode" && pr.kind !== "optionalCost" && pr.kind !== "payCost") return undefined;
  const label = pr.kind === "chooseCards" ? pr.choice.reason : pr.kind === "chooseMode" ? pr.reason : pr.describe;
  const head = s.flow[0];
  if (head && head.op === "script.step" && head.frame.awaiting) {
    // Every op that asks the player something, not only `choose`: a "you
    // may" and a "choose one" are steps too, and an answered one splices its
    // program in at the same level, so the count stays honest as it grows.
    const frame = head.frame;
    const asks = frame.ops.map((o, i) => (o.op === "choose" || o.op === "may" || o.op === "chooseMode" ? i : -1)).filter((i) => i >= 0);
    const index = Math.max(1, asks.filter((i) => i <= frame.ip).length);
    return { index, count: asks.length, label };
  }
  if (pr.kind === "chooseCards" || pr.kind === "chooseMode") return { index: 1, count: 0, label };
  return undefined;
}

/** The one-line question the prompt bar asks, and the hint under it. */
function questionFor(ctx: EngineContext, s: GameState): PromptView {
  const pr = s.prompt;
  const nameOf = (id: string) => face(ctx, s, id).name;
  const step = stepFor(s);
  const withStep = (v: PromptView): PromptView => (step ? { ...v, step } : v);
  switch (pr.kind) {
    case "chooseFirst":
      return { kind: pr.kind, player: pr.player, question: "You won the flip. Who goes first?", hint: "The second player starts with one energy marker." };
    case "mulligan":
      return { kind: pr.kind, player: pr.player, question: "Keep this hand?", hint: "You may redraw six cards once (6-2-1-9)." };
    case "charge":
      return { kind: pr.kind, player: pr.player, question: "Charge one card as energy?", hint: "Tap a card in hand, or skip." };
    case "main":
      return { kind: pr.kind, player: pr.player, question: "Your Main Phase.", hint: "Play cards, attack, or end the turn." };
    case "combo":
      return { kind: pr.kind, player: pr.player, question: "Combo? Tap a glowing card.", hint: "Each adds its combo power and costs its combo cost." };
    case "blocker":
      return { kind: pr.kind, player: pr.player, question: "Block with one of these?", hint: "[Blocker] rests the card and makes it the guard instead." };
    case "counter":
      return { kind: pr.kind, player: pr.player, question: "Play a counter?", hint: "Counter cards are activated from hand and go to the Drop." };
    case "chooseCards":
      return withStep({ kind: pr.kind, player: pr.player, question: pr.choice.reason, hint: `Choose ${pr.choice.min === pr.choice.max ? pr.choice.min : `${pr.choice.min} to ${pr.choice.max}`}.`, min: pr.choice.min, max: pr.choice.max });
    case "chooseMode":
      return withStep({ kind: pr.kind, player: pr.player, question: pr.reason, hint: "The card offers these; exactly one happens (20-2)." });
    case "zEnergyFromCombo":
      return { kind: pr.kind, player: pr.player, question: "Send one combo card to Z-Energy?", hint: "At the end of a battle, one card may go there instead of the Drop." };
    case "offering":
      return { kind: pr.kind, player: pr.player, question: "[Offering]: drop one life, or let them draw two?", hint: null };
    case "optionalCost":
      return withStep({ kind: pr.kind, player: pr.player, question: `Pay ${pr.describe} for ${nameOf(pr.card)}?`, hint: "An [Auto] skill's cost may be declined; then it does not resolve.", cost: pr.describe });
    case "payCost":
      return withStep({ kind: pr.kind, player: pr.player, question: `Which energy do you rest to ${pr.describe}?`, hint: "The colours you keep active decide what you can still do this turn.", cost: pr.describe });
    case "referee":
      return { kind: pr.kind, player: pr.player, question: `Claude is ruling on ${pr.request.cardName}…`, hint: pr.request.unsupported.join(" · ") };
    case "orderPending":
      return { kind: pr.kind, player: pr.player, question: "Which skill resolves first?", hint: "Several of your skills triggered at once." };
    case "gameOver":
      return { kind: pr.kind, player: null, question: "The game is over.", hint: null };
  }
}

export function boardView(ctx: EngineContext, s: GameState, viewer: PlayerId, images: Record<string, CardArt>): BoardView {
  const them = viewer === "p1" ? "p2" : "p1";
  // Read once for the whole board: every card asks which statics are on it.
  const statics = staticEffects(ctx, s);
  return {
    you: sideView(ctx, s, viewer, images, true, viewer, statics),
    them: sideView(ctx, s, them, images, false, viewer, statics),
    turn: s.turn,
    phase: s.phase,
    turnPlayer: s.turnPlayer,
    battle: s.battle
      ? {
          attacker: s.battle.attacker,
          guard: s.battle.guard,
          step: s.battle.step,
          attackPower: powerOf(ctx, s, s.battle.attacker) + s.players[s.turnPlayer].combo.reduce((n, id) => n + comboPowerOf(ctx, s, id), 0),
          guardPower: powerOf(ctx, s, s.battle.guard) + s.players[s.turnPlayer === "p1" ? "p2" : "p1"].combo.reduce((n, id) => n + comboPowerOf(ctx, s, id), 0),
        }
      : null,
    prompt: questionFor(ctx, s),
    over: s.phase === "over" ? { winner: s.winner, reason: s.overReason ?? "" } : null,
  };
}

/** Whose turn it is to answer — the board is drawn from this player's side. */
export function viewerOf(s: GameState): PlayerId {
  const pr = s.prompt;
  return "player" in pr && pr.player ? pr.player : s.turnPlayer;
}
