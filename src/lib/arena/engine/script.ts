/**
 * The effect language and its interpreter.
 *
 * A card's skill text is turned into a small program of `Op`s — by the
 * deterministic compiler in `compile.ts`, or, when that fails, by Claude at
 * runtime (the referee, which answers in this same language). The interpreter
 * executes a program step by step inside the engine's flow, so an effect that
 * needs a choice can stop, ask, and resume.
 *
 * Nothing here reads card text. Section numbers refer to the Rule Manual.
 */
import type { CardFilter } from "./filters";
import {
  addEffect,
  amount,
  condHolds,
  resolveRef,
  resolveSelector,
  sideOf,
  areaOf,
  draw as drawCards,
  face,
  forbids,
  has,
  move,
  note,
  placeUnder,
  schedule,
  setMode,
  tokenCardId,
  type GameContext,
} from "./state";
import { koCard, pendTriggers } from "./triggers";
import type { Color, DelayScope, DelayTiming, FlowStep, ForbiddenAction, GameEvent, GameState, KeywordSkill, PlayerId, Trigger } from "./types";

// ── the language ───────────────────────────────────────────────────────────

/** Areas a selector can read. "under" is the cards beneath the source card (23-2). */
export type ScriptArea = "hand" | "deck" | "drop" | "life" | "battle" | "combo" | "energy" | "unison" | "leader" | "warp" | "zDeck" | "zEnergy" | "under" | "play" | "removed";

export type Side = "you" | "opponent" | "both";

export type Duration = "battle" | "turn" | "opponentTurn" | "nextTurn" | "game";

/** Cards the source skill can point at without choosing: itself, the battle roles, the trigger's subject. */
export type SpecialTarget = "self" | "attacker" | "guard" | "subject" | "leader" | "opponentLeader";

export interface Selector {
  side?: Side;
  area?: ScriptArea;
  filter?: CardFilter;
  special?: SpecialTarget;
  /** Only cards in this mode (1-10). */
  mode?: "active" | "rest";
  /** Draw the candidates from a bound variable instead of an area. */
  fromVar?: string;
  /** How many to take. `upTo` allows zero (5-2-4). */
  count?: number;
  upTo?: boolean;
  /** Card text may say "ignoring [Barrier]", which lifts 22-16 for this choice. */
  ignoreBarrier?: boolean;
}

export type Amount = number | { var: string } | { count: Selector };

export type Ref = { var: string } | { sel: Selector };

export type Cond =
  | { kind: "count"; sel: Selector; atLeast?: number; atMost?: number }
  | { kind: "life"; side: Side; atLeast?: number; atMost?: number }
  /** "When your life is less than or equal to your opponent's life" — the two counts against each other. */
  | { kind: "lifeVsOpponent"; atMost?: boolean; atLeast?: boolean }
  | { kind: "leaderColor"; color: Color }
  /** "If your Leader is a <Baby> card" — colour, character name and traits alike. */
  | { kind: "leaderMatches"; filter: CardFilter; side?: Side }
  | { kind: "chose"; var: string }
  /** Whose turn it is (7-1). "opponent" is "during your opponent's turn". */
  | { kind: "isTurnPlayer"; who?: "you" | "opponent" };

export type Op =
  | { op: "draw"; n: Amount; side?: Side }
  | { op: "discard"; n: Amount; side?: Side }
  | { op: "damage"; n: Amount; side?: Side }
  | { op: "mill"; n: Amount; side?: Side }
  | { op: "addLife"; n: Amount; side?: Side }
  /** "Add cards from your life to your hand until you have N life" (21-3-2 wording, without damage). */
  | { op: "lifeDownTo"; n: number; side?: Side }
  | { op: "shuffle"; side?: Side }
  | { op: "energyMarker"; n: Amount; side?: Side }
  | { op: "choose"; sel: Selector; as: string; reason?: string }
  | { op: "look"; n: Amount; as: string; side?: Side }
  | { op: "ko"; target: Ref }
  /** `to: "under"` puts the card under `under`, or under the source card (23-2). */
  | { op: "moveTo"; target: Ref; to: ScriptArea; position?: "top" | "bottom"; mode?: "active" | "rest"; reveal?: boolean; under?: Ref }
  | { op: "play"; target: Ref; mode?: "active" | "rest" }
  | { op: "switchMode"; target: Ref; mode: "active" | "rest" }
  | { op: "power"; target: Ref; amount: Amount; until: Duration }
  | { op: "comboPower"; target: Ref; amount: Amount; until: Duration }
  | { op: "grant"; target: Ref; keyword: KeywordSkill; until: Duration }
  | { op: "negateSkills"; target: Ref; until: Duration }
  | { op: "addMarker"; target: Ref; n: Amount }
  | { op: "removeMarker"; target: Ref; n: Amount }
  | { op: "token"; name: string; power: number; comboCost: number | null; comboPower: number | null; colors: Color[]; n: Amount; side?: Side }
  /** A [Permanent] cost reducer, applied while the card sits where the skill says (9-1-3-3). */
  | { op: "costReduction"; target: Ref; amount: number }
  /**
   * Another way to pay for this card's own [Counter] skill (5-3): for nothing,
   * or by adding cards from your life to your hand. Read from the hand, like
   * a cost reducer, because that is where the skill says it applies.
   */
  | { op: "altCost"; pay: "none" | "life"; n?: number }
  | { op: "negateAttack" }
  /** Kept for programs written before `forbid` existed; the same thing. */
  | { op: "cannotAttack"; target: Ref; until: Duration }
  /**
   * Forbid an action (20-14). Name a `target` for a rule about particular
   * cards, or a `side` for one about a player ("your opponent can't attack
   * with Battle Cards"), optionally narrowed by a filter.
   */
  | { op: "forbid"; what: ForbiddenAction; until: Duration; target?: Ref; side?: Side; filter?: CardFilter; sameNameAsSelf?: boolean }
  | { op: "if"; cond: Cond; then: Op[]; else?: Op[] }
  /** "Choose one— ・A ・B" (20-2): the master picks one printed option. */
  | { op: "chooseMode"; modes: { label: string; ops: Op[] }[]; reason?: string }
  /**
   * Write an effect down now and carry it out later (1-7-2-1-1): "at the end
   * of the turn, KO it". The inner program keeps this frame's variables, so it
   * still knows which card "it" was.
   */
  | { op: "delay"; at: DelayTiming; scope?: DelayScope; ops: Op[]; label?: string }
  | { op: "note"; text: string };

export interface Script {
  ops: Op[];
  /** Clauses the compiler could not read; non-empty means the referee handles the skill. */
  unsupported: string[];
}

/** One running program. Stored in the flow, so a game can be saved mid-effect. */
export interface ScriptFrame {
  ops: Op[];
  ip: number;
  vars: Record<string, string[]>;
  card: string;
  master: PlayerId;
  trigger?: Trigger;
  subject?: string;
  /** Set while a `choose` is waiting for an answer. */
  awaiting?: string;
}

/** How each timing reads in the log when the card text does not say it better. */
export const DELAY_LABELS: Record<DelayTiming, string> = {
  turnStart: "at the start of the turn",
  mainStart: "at the start of the Main Phase",
  turnEnd: "at the end of the turn",
  turnCleanup: "as the turn ends",
  battleEnd: "at the end of the battle",
};

// ── the interpreter ────────────────────────────────────────────────────────

export { resolveSelector };

/**
 * Run a program until it finishes or needs a decision. Returns "wait" with a
 * prompt set and the frame pushed back onto the flow; "done" when the program
 * ended or a sub-flow (playing a card) took over.
 */
export function stepScript(ctx: GameContext, s: GameState, ev: GameEvent[], frame: ScriptFrame): "done" | "wait" {
  const master = frame.master;

  for (let guard = 0; guard < 200; guard++) {
    if (frame.ip >= frame.ops.length) return "done";
    const op = frame.ops[frame.ip];

    switch (op.op) {
      case "note":
        note(ev, op.text);
        break;

      case "draw":
        for (const p of sideOf(master, op.side)) drawCards(ctx, s, ev, p, amount(ctx, s, frame, op.n));
        break;

      case "discard": {
        // 20-7: the *owner* of the hand chooses which cards to discard.
        for (const p of sideOf(master, op.side)) {
          const n = amount(ctx, s, frame, op.n);
          const hand = s.players[p].hand;
          for (let i = 0; i < n && hand.length; i++) move(ctx, s, ev, hand[hand.length - 1], "drop", p, { reason: "effect", reveal: true });
        }
        break;
      }

      case "damage": {
        // 5-10 / 21-3: life cards go to the hand; damage from an effect is never Critical.
        for (const p of sideOf(master, op.side ?? "opponent")) {
          const n = amount(ctx, s, frame, op.n);
          const taken: string[] = [];
          for (let i = 0; i < n; i++) {
            const life = s.players[p].life[0];
            if (!life) break;
            move(ctx, s, ev, life, "hand", p, { reason: "damage" });
            taken.push(life);
          }
          if (taken.length) {
            s.players[p].damageTaken += taken.length;
            ev.push({ type: "damage", player: p, amount: taken.length, critical: false, cards: taken });
            pendTriggers(ctx, s, "dealtDamage", frame.card);
          }
        }
        break;
      }

      case "mill":
        for (const p of sideOf(master, op.side)) {
          const n = amount(ctx, s, frame, op.n);
          for (let i = 0; i < n && s.players[p].deck.length; i++) move(ctx, s, ev, s.players[p].deck[0], "drop", p, { reason: "effect", reveal: true });
        }
        break;

      case "addLife":
        for (const p of sideOf(master, op.side)) {
          const n = amount(ctx, s, frame, op.n);
          for (let i = 0; i < n && s.players[p].deck.length; i++) move(ctx, s, ev, s.players[p].deck[0], "life", p, { reason: "effect" });
        }
        break;

      case "lifeDownTo":
        // Losing life this way is not damage (1-13-2), so nothing triggers on it.
        for (const p of sideOf(master, op.side)) {
          while (s.players[p].life.length > op.n) move(ctx, s, ev, s.players[p].life[0], "hand", p, { reason: "effect" });
        }
        break;

      case "shuffle":
        // 5-11: the engine reshuffles at the next draw; record it so the log reads right.
        for (const p of sideOf(master, op.side)) ev.push({ type: "note", text: `${s.players[p].name} shuffles their deck` });
        shuffleDeck(s, sideOf(master, op.side));
        break;

      case "energyMarker":
        for (const p of sideOf(master, op.side)) {
          const n = amount(ctx, s, frame, op.n);
          s.players[p].energyMarkers = Math.max(0, s.players[p].energyMarkers + n);
          ev.push({ type: "energyMarker", player: p, delta: n });
        }
        break;

      case "look": {
        const p = sideOf(master, op.side)[0];
        const n = amount(ctx, s, frame, op.n);
        frame.vars[op.as] = s.players[p].deck.slice(0, n);
        break;
      }

      case "choose": {
        const want = op.sel.count ?? 1;
        /** Cards taken out of a pool ("choose 1 among them") leave the pool. */
        const take = (picked: string[]) => {
          frame.vars[op.as] = picked;
          if (op.sel.fromVar) frame.vars[op.sel.fromVar] = (frame.vars[op.sel.fromVar] ?? []).filter((id) => !picked.includes(id));
        };
        // Cards picked so far, while a multi-card choice is part-answered.
        const sofar = frame.awaiting === op.as ? (frame.vars[op.as] ?? []) : [];
        const cands = resolveSelector(ctx, s, frame, op.sel).filter((id) => !sofar.includes(id));

        if (s.lastChoice && frame.awaiting === op.as) {
          const picked = [...sofar, ...s.lastChoice.filter((id) => cands.includes(id))];
          s.lastChoice = null;
          // A choice is made one card at a time (the board asks by tapping),
          // so a "choose 2" comes back here for the second card. Declining a
          // card ends an "up to" choice early, as 5-2-4 allows.
          const done = picked.length >= want || picked.length === sofar.length || picked.length >= sofar.length + cands.length;
          frame.vars[op.as] = picked;
          if (done) {
            frame.awaiting = undefined;
            take(picked);
            break;
          }
          continue;
        }

        // 5-2-5: take as many as possible when fewer are available than asked for.
        const left = want - sofar.length;
        if (cands.length === 0) {
          frame.awaiting = undefined;
          take(sofar);
          break;
        }
        // Only ask when the answer can differ: a forced pick is taken silently.
        if (!op.sel.upTo && cands.length <= left) {
          frame.awaiting = undefined;
          take([...sofar, ...cands]);
          break;
        }
        frame.awaiting = op.as;
        frame.vars[op.as] = sofar;
        s.flow.unshift({ op: "script.step", frame });
        const asked = left === 1 ? "" : ` (${left} more)`;
        s.prompt = {
          kind: "chooseCards",
          player: master,
          choice: {
            reason: (op.reason ?? `${face(ctx, s, frame.card).name}: choose ${op.sel.upTo ? `up to ${want}` : want}`) + asked,
            candidates: cands,
            // One card per answer, so the menu is one action per card.
            min: op.sel.upTo ? 0 : 1,
            max: 1,
            continuation: op.as,
          },
        };
        return "wait";
      }

      case "ko":
        for (const id of resolveRef(ctx, s, frame, op.target)) {
          // 22-12: [Indestructible] cannot be KO'd by an opponent's skill.
          if (has(ctx, s, id, "Indestructible") && s.cards[id].owner !== master) continue;
          // 20-14: the same thing spelled out on the card rather than keyworded.
          if (forbids(ctx, s, "beKOdBySkill", { player: master, card: id })) continue;
          if (areaOf(s, id) === "battle") koCard(ctx, s, ev, id, frame.card);
        }
        break;

      case "moveTo": {
        // 23-2: under a card is not an area of its own, so it is its own move.
        const host = op.to === "under" ? (op.under ? resolveRef(ctx, s, frame, op.under)[0] : frame.card) : null;
        for (const id of resolveRef(ctx, s, frame, op.target)) {
          // 3-1-2: a Leader Card stays in the Leader Area. Skills may change
          // its power or negate it, but nothing puts it anywhere else — and
          // an empty Leader Area is a state the rest of the engine cannot read.
          if (areaOf(s, id) === "leader") continue;
          if (op.to === "under") {
            if (host) placeUnder(ctx, s, ev, id, host);
            continue;
          }
          const owner = op.to === "battle" || op.to === "unison" ? master : s.cards[id].owner;
          // "play" is not an area of its own either (3-1); it means the Battle Area.
          const dest = op.to === "play" ? "battle" : op.to;
          move(ctx, s, ev, id, dest, owner, { position: op.position, reveal: op.reveal, reason: "effect" });
          if (op.mode) setMode(s, ev, id, op.mode, ctx);
        }
        break;
      }

      case "switchMode":
        for (const id of resolveRef(ctx, s, frame, op.target)) setMode(s, ev, id, op.mode, ctx);
        break;

      case "power":
      case "comboPower": {
        const n = amount(ctx, s, frame, op.amount);
        for (const id of resolveRef(ctx, s, frame, op.target)) addEffect(s, ev, { target: id, kind: op.op === "power" ? "power" : "comboPower", value: n, until: op.until });
        break;
      }

      case "grant":
        for (const id of resolveRef(ctx, s, frame, op.target)) addEffect(s, ev, { target: id, kind: "keyword", value: op.keyword, until: op.until });
        break;

      case "negateSkills":
        for (const id of resolveRef(ctx, s, frame, op.target)) {
          s.cards[id].negated = "all";
          addEffect(s, ev, { target: id, kind: "negateSkills", value: 0, until: op.until });
        }
        break;

      case "cannotAttack":
        for (const id of resolveRef(ctx, s, frame, op.target)) addEffect(s, ev, { target: id, kind: "forbid", value: 0, until: op.until, forbid: { what: "attack" } });
        break;

      case "forbid": {
        // "both" and an absent side alike mean the rule is about neither
        // player in particular, so it holds for both.
        const players = op.side && op.side !== "both" ? sideOf(master, op.side) : [];
        if (op.target) {
          // On a card, the side says *whose* action is forbidden — "can't be
          // KO'd by your opponent's skills" is a rule about the opponent.
          for (const id of resolveRef(ctx, s, frame, op.target)) addEffect(s, ev, { target: id, kind: "forbid", value: 0, until: op.until, forbid: { what: op.what, player: players[0] } });
          break;
        }
        addEffect(s, ev, {
          target: "",
          kind: "forbid",
          value: 0,
          until: op.until,
          forbid: { what: op.what, player: players[0], filter: op.filter, name: op.sameNameAsSelf ? face(ctx, s, frame.card).name : undefined },
        });
        break;
      }

      case "addMarker":
      case "removeMarker": {
        const n = amount(ctx, s, frame, op.n) * (op.op === "addMarker" ? 1 : -1);
        for (const id of resolveRef(ctx, s, frame, op.target)) {
          s.cards[id].markers = Math.max(0, s.cards[id].markers + n);
          ev.push({ type: "markers", card: id, delta: n, total: s.cards[id].markers });
          if (n < 0) pendTriggers(ctx, s, "markerRemoved", id);
        }
        break;
      }

      case "token": {
        const n = amount(ctx, s, frame, op.n);
        const p = sideOf(master, op.side)[0];
        for (let i = 0; i < n; i++) {
          const id = `${p}#token${Object.keys(s.cards).length}`;
          s.cards[id] = {
            id,
            cardId: tokenCardId(op.name, op.power, op.comboCost, op.comboPower, op.colors),
            owner: p,
            mode: "active",
            hidden: false,
            flipped: false,
            markers: 0,
            under: [],
            isToken: true,
            enteredTurn: s.turn,
            extraAttacks: 0,
            usedThisTurn: [],
            usedMarkerSkill: false,
            negated: [],
          };
          s.players[p].battle.push(id);
          ev.push({ type: "token", card: id, owner: p });
          pendTriggers(ctx, s, "played", id);
        }
        break;
      }

      case "costReduction":
      case "altCost":
        // Continuous by nature: read by `playCost` and by the counter window,
        // not applied here.
        break;

      case "negateAttack":
        if (s.battle) {
          s.battle.negated = true;
          ev.push({ type: "attackNegated" });
        }
        break;

      case "play": {
        // 5-5-3: played by a skill, so no energy cost is paid — but a card
        // that may not be played may not be played by a skill either (20-14).
        const targets = resolveRef(ctx, s, frame, op.target).filter((id) => !forbids(ctx, s, "play", { player: master, card: id }));
        if (!targets.length) break;
        const steps: FlowStep[] = [];
        for (const id of targets) steps.push({ op: "play.resolve", card: id, player: master, mode: op.mode });
        frame.ip++;
        steps.push({ op: "script.step", frame });
        s.flow.unshift(...steps);
        return "done";
      }

      case "delay":
        // The variables are copied, not shared: a later `choose` in this same
        // program must not change what the delayed part points at.
        schedule(s, ev, {
          at: op.at,
          scope: op.scope ?? "thisTurn",
          ops: op.ops,
          card: frame.card,
          master,
          vars: { ...frame.vars },
          subject: frame.subject,
          label: op.label ?? DELAY_LABELS[op.at],
        });
        break;

      case "if": {
        const branch = condHolds(ctx, s, frame, op.cond) ? op.then : (op.else ?? []);
        // Splice the branch in place of the `if`, keeping one frame.
        frame.ops = [...frame.ops.slice(0, frame.ip), ...branch, ...frame.ops.slice(frame.ip + 1)];
        continue;
      }

      case "chooseMode": {
        // 20-2: the option is chosen as the skill resolves, and only then does
        // the rest of the program exist — so it is spliced in like an `if`.
        if (s.lastMode != null && frame.awaiting === "mode") {
          const picked = op.modes[s.lastMode] ?? op.modes[0];
          s.lastMode = null;
          frame.awaiting = undefined;
          frame.ops = [...frame.ops.slice(0, frame.ip), ...(picked?.ops ?? []), ...frame.ops.slice(frame.ip + 1)];
          continue;
        }
        // A single option is not a choice, and an empty one is not asked about.
        const usable = op.modes.filter((mode) => mode.ops.length);
        if (usable.length <= 1) {
          frame.ops = [...frame.ops.slice(0, frame.ip), ...(usable[0]?.ops ?? []), ...frame.ops.slice(frame.ip + 1)];
          continue;
        }
        frame.awaiting = "mode";
        s.flow.unshift({ op: "script.step", frame });
        s.prompt = { kind: "chooseMode", player: master, reason: op.reason ?? `${face(ctx, s, frame.card).name}: choose one`, options: op.modes.map((mode) => mode.label) };
        return "wait";
      }
    }
    frame.ip++;
  }
  note(ev, "effect did not finish: too many steps");
  return "done";
}

function shuffleDeck(s: GameState, players: PlayerId[]): void {
  // Uses the game's RNG so a replay reproduces the order exactly.
  for (const p of players) {
    const deck = s.players[p].deck;
    let state = s.rngState;
    for (let i = deck.length - 1; i > 0; i--) {
      const t = (state + 0x6d2b79f5) | 0;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      state = t;
      const j = Math.floor((((r ^ (r >>> 14)) >>> 0) / 4294967296) * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    s.rngState = state;
  }
}

// ── validation, for programs that did not come from the compiler ───────────

const OP_NAMES = new Set<Op["op"]>([
  "draw",
  "discard",
  "damage",
  "mill",
  "addLife",
  "lifeDownTo",
  "shuffle",
  "energyMarker",
  "choose",
  "look",
  "ko",
  "moveTo",
  "play",
  "switchMode",
  "power",
  "comboPower",
  "grant",
  "negateSkills",
  "addMarker",
  "removeMarker",
  "token",
  "negateAttack",
  "cannotAttack",
  "forbid",
  "costReduction",
  "altCost",
  "if",
  "chooseMode",
  "delay",
  "note",
]);

const DELAY_TIMINGS = new Set<DelayTiming>(["turnStart", "mainStart", "turnEnd", "turnCleanup", "battleEnd"]);
const DELAY_SCOPES = new Set<DelayScope>(["thisTurn", "nextTurn", "yourNextTurn", "opponentNextTurn"]);

/**
 * Structural check for a program supplied by the referee. It only proves the
 * shape is executable — the engine still enforces every rule while running it,
 * so a bad ruling can be wrong but never illegal.
 */
export function validateProgram(ops: unknown, depth = 0): ops is Op[] {
  if (!Array.isArray(ops) || depth > 4) return false;
  return ops.every((raw) => {
    if (!raw || typeof raw !== "object") return false;
    const o = raw as { op?: unknown; then?: unknown; else?: unknown; ops?: unknown; at?: unknown; scope?: unknown; modes?: unknown[] };
    if (typeof o.op !== "string" || !OP_NAMES.has(o.op as Op["op"])) return false;
    if (o.op === "if") return validateProgram(o.then, depth + 1) && (o.else === undefined || validateProgram(o.else, depth + 1));
    if (o.op === "chooseMode") return Array.isArray(o.modes) && o.modes.length > 0 && o.modes.every((mode) => validateProgram((mode as { ops?: unknown }).ops, depth + 1));
    // A delay with a timing the engine never drains would sit in the state for
    // the rest of the game, so the timing is checked as well as the shape.
    if (o.op === "delay") {
      if (!DELAY_TIMINGS.has(o.at as DelayTiming)) return false;
      if (o.scope !== undefined && !DELAY_SCOPES.has(o.scope as DelayScope)) return false;
      return validateProgram(o.ops, depth + 1);
    }
    return true;
  });
}
