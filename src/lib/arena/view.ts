/**
 * The board as the browser needs it: plain, serialisable data.
 *
 * The engine's state is keyed by instance id and says nothing about images or
 * what a player may tap. This turns one state plus the legal moves into a view
 * for one side of the table, hiding what that player may not see (3-1-3).
 */
import { areaOf, comboPowerOf, describeScript, compileCardCached, face, keywordsInForce, powerOf, skillsOf, type EngineContext, type GameState, type LegalAction, type PlayerId } from "./engine";
import { def } from "./engine/state";

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
  /** True when a skill of this card has to be put to the referee. */
  referee: boolean;
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
}

export interface BoardView {
  you: SideView;
  them: SideView;
  turn: number;
  phase: string;
  turnPlayer: PlayerId;
  battle: { attacker: string; guard: string; step: string; attackPower: number; guardPower: number } | null;
  prompt: { kind: string; player: PlayerId | null; question: string; hint: string | null };
  over: { winner: PlayerId | null; reason: string } | null;
}

/** Everything the current prompt will accept, indexed by the card it points at. */
export interface Tappable {
  /** Card instance id → the actions that name it. */
  byCard: Record<string, number[]>;
  /** Actions that name no card: pass, end turn, don't block. */
  bare: number[];
  /** For an attack, the targets each attacker may hit. */
  attackTargets: Record<string, Record<string, number>>;
}

const cardIdOf = (a: LegalAction["action"]): string | null => {
  const x = a as { card?: string | null; attacker?: string; cards?: string[] };
  if (typeof x.card === "string") return x.card;
  if (typeof x.attacker === "string") return x.attacker;
  if (Array.isArray(x.cards) && x.cards.length === 1) return x.cards[0];
  return null;
};

export function tappable(legal: LegalAction[]): Tappable {
  const out: Tappable = { byCard: {}, bare: [], attackTargets: {} };
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

function cardView(ctx: EngineContext, s: GameState, id: string, images: Record<string, CardArt>, reveal: boolean): CardView {
  const inst = s.cards[id];
  const d = def(ctx, s, id);
  const f = face(ctx, s, id);
  const hidden = inst.hidden || !reveal;
  const side = inst.flipped && d.back ? "back" : "front";
  const scripts = compileCardCached(d, side);
  let reading = "";
  let referee = false;
  for (const sk of skillsOf(d, side)) {
    const sc = scripts.bySkill[sk.index];
    if (!sc) continue;
    if (sc.unsupported.length) referee = true;
    else if (sc.ops.length) reading += (reading ? " · " : "") + describeScript(sc.ops);
  }
  return {
    id,
    cardId: inst.cardId,
    name: hidden ? "Face-down card" : f.name,
    power: hidden ? null : (inPlayArea(s, id) ? powerOf(ctx, s, id) : f.power),
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
  };
}

function inPlayArea(s: GameState, id: string): boolean {
  const a = areaOf(s, id);
  return a === "leader" || a === "battle" || a === "unison" || a === "combo";
}

function sideView(ctx: EngineContext, s: GameState, p: PlayerId, images: Record<string, CardArt>, ownHand: boolean): SideView {
  const ps = s.players[p];
  const v = (id: string, reveal = true) => cardView(ctx, s, id, images, reveal);
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
  };
}

/** The one-line question the prompt bar asks, and the hint under it. */
function questionFor(ctx: EngineContext, s: GameState): { kind: string; player: PlayerId | null; question: string; hint: string | null } {
  const pr = s.prompt;
  const nameOf = (id: string) => face(ctx, s, id).name;
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
      return { kind: pr.kind, player: pr.player, question: pr.choice.reason, hint: `Choose ${pr.choice.min === pr.choice.max ? pr.choice.min : `${pr.choice.min} to ${pr.choice.max}`}.` };
    case "chooseMode":
      return { kind: pr.kind, player: pr.player, question: pr.reason, hint: "The card offers these; exactly one happens (20-2)." };
    case "zEnergyFromCombo":
      return { kind: pr.kind, player: pr.player, question: "Send one combo card to Z-Energy?", hint: "At the end of a battle, one card may go there instead of the Drop." };
    case "offering":
      return { kind: pr.kind, player: pr.player, question: "[Offering]: drop one life, or let them draw two?", hint: null };
    case "optionalCost":
      return { kind: pr.kind, player: pr.player, question: `Pay ${pr.describe} for ${nameOf(pr.card)}?`, hint: "An [Auto] skill's cost may be declined; then it does not resolve." };
    case "payCost":
      return { kind: pr.kind, player: pr.player, question: `Which energy do you rest to ${pr.describe}?`, hint: "The colours you keep active decide what you can still do this turn." };
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
  return {
    you: sideView(ctx, s, viewer, images, true),
    them: sideView(ctx, s, them, images, false),
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
