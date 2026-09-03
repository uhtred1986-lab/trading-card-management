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
import { matches, type CardFilter } from "./filters";
import {
  addEffect,
  areaOf,
  cardsInPlay,
  def,
  draw as drawCards,
  face,
  has,
  move,
  note,
  setMode,
  tokenCardId,
  type GameContext,
} from "./state";
import { koCard, pendTriggers } from "./triggers";
import type { Color, FlowStep, GameEvent, GameState, KeywordSkill, PlayerId, Trigger } from "./types";
import { other } from "./types";

// ── the language ───────────────────────────────────────────────────────────

/** Areas a selector can read. "under" is the cards beneath the source card (23-2). */
export type ScriptArea = "hand" | "deck" | "drop" | "life" | "battle" | "combo" | "energy" | "unison" | "leader" | "warp" | "zDeck" | "zEnergy" | "under" | "play" | "removed";

export type Side = "you" | "opponent" | "both";

export type Duration = "battle" | "turn" | "opponentTurn" | "game";

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
  | { kind: "leaderColor"; color: Color }
  /** "If your Leader is a <Baby> card" — colour, character name and traits alike. */
  | { kind: "leaderMatches"; filter: CardFilter }
  | { kind: "chose"; var: string }
  | { kind: "isTurnPlayer" };

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
  | { op: "moveTo"; target: Ref; to: ScriptArea; position?: "top" | "bottom"; mode?: "active" | "rest"; reveal?: boolean }
  | { op: "play"; target: Ref; mode?: "active" | "rest" }
  | { op: "switchMode"; target: Ref; mode: "active" | "rest" }
  | { op: "power"; target: Ref; amount: Amount; until: Duration }
  | { op: "comboPower"; target: Ref; amount: Amount; until: Duration }
  | { op: "grant"; target: Ref; keyword: KeywordSkill; until: Duration }
  | { op: "negateSkills"; target: Ref; until: Duration }
  | { op: "addMarker"; target: Ref; n: Amount }
  | { op: "removeMarker"; target: Ref; n: Amount }
  | { op: "token"; name: string; power: number; comboCost: number | null; comboPower: number | null; colors: Color[]; n: Amount; side?: Side }
  | { op: "negateAttack" }
  | { op: "cannotAttack"; target: Ref; until: Duration }
  | { op: "if"; cond: Cond; then: Op[]; else?: Op[] }
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

// ── selectors ──────────────────────────────────────────────────────────────

function sideOf(master: PlayerId, side: Side | undefined): PlayerId[] {
  if (side === "opponent") return [other(master)];
  if (side === "both") return [master, other(master)];
  return [master];
}

function areaCards(s: GameState, p: PlayerId, area: ScriptArea, frame: ScriptFrame): string[] {
  const ps = s.players[p];
  switch (area) {
    case "leader":
      return ps.leader ? [ps.leader] : [];
    case "unison":
      return ps.unison ? [ps.unison] : [];
    case "play":
      return cardsInPlay(s, p);
    case "under":
      return s.cards[frame.card]?.under.slice() ?? [];
    default:
      return ps[area].slice();
  }
}

/**
 * Cards a selector can pick. 22-16 [Barrier] removes a card from the choices
 * of a skill mastered by its opponent; 20-4 does the same for "unaffected by
 * skills", which the compiler never emits.
 */
export function resolveSelector(ctx: GameContext, s: GameState, frame: ScriptFrame, sel: Selector): string[] {
  let out: string[] = [];
  if (sel.special) {
    const b = s.battle;
    const pick =
      sel.special === "self"
        ? frame.card
        : sel.special === "attacker"
          ? b?.attacker
          : sel.special === "guard"
            ? b?.guard
            : sel.special === "subject"
              ? frame.subject
              : sel.special === "leader"
                ? s.players[frame.master].leader
                : s.players[other(frame.master)].leader;
    out = pick && s.cards[pick] ? [pick] : [];
  } else if (sel.fromVar) {
    out = (frame.vars[sel.fromVar] ?? []).filter((id) => s.cards[id]);
  } else {
    const area = sel.area ?? "battle";
    for (const p of sideOf(frame.master, sel.side)) out.push(...areaCards(s, p, area, frame));
  }
  return out.filter((id) => {
    const inst = s.cards[id];
    if (!inst) return false;
    if (sel.mode && inst.mode !== sel.mode) return false;
    // 23-5-2: a Hidden Mode card has none of its front-side information.
    if (sel.filter && (inst.hidden || !matches(def(ctx, s, id), sel.filter))) return false;
    if (!sel.special && !sel.ignoreBarrier && sel.side !== "you" && has(ctx, s, id, "Barrier") && s.cards[id].owner !== frame.master && areaOf(s, id) !== "hand") return false;
    return true;
  });
}

function resolveRef(ctx: GameContext, s: GameState, frame: ScriptFrame, ref: Ref): string[] {
  if ("var" in ref) return (frame.vars[ref.var] ?? []).filter((id) => s.cards[id]);
  return resolveSelector(ctx, s, frame, ref.sel);
}

function amount(ctx: GameContext, s: GameState, frame: ScriptFrame, a: Amount): number {
  if (typeof a === "number") return a;
  if ("var" in a) return (frame.vars[a.var] ?? []).length;
  return resolveSelector(ctx, s, frame, a.count).length;
}

function condHolds(ctx: GameContext, s: GameState, frame: ScriptFrame, c: Cond): boolean {
  switch (c.kind) {
    case "count": {
      const n = resolveSelector(ctx, s, frame, c.sel).length;
      return (c.atLeast == null || n >= c.atLeast) && (c.atMost == null || n <= c.atMost);
    }
    case "life": {
      const n = sideOf(frame.master, c.side).reduce((t, p) => t + s.players[p].life.length, 0);
      return (c.atLeast == null || n >= c.atLeast) && (c.atMost == null || n <= c.atMost);
    }
    case "leaderColor": {
      const l = s.players[frame.master].leader;
      return !!l && def(ctx, s, l).colors.includes(c.color);
    }
    case "leaderMatches": {
      const l = s.players[frame.master].leader;
      return !!l && matches(def(ctx, s, l), c.filter);
    }
    case "chose":
      return (frame.vars[c.var] ?? []).length > 0;
    case "isTurnPlayer":
      return s.turnPlayer === frame.master;
  }
}

// ── the interpreter ────────────────────────────────────────────────────────

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
        const cands = resolveSelector(ctx, s, frame, op.sel);
        const want = op.sel.count ?? 1;
        // 5-2-5: take as many as possible when fewer are available than asked for.
        const max = Math.min(want, cands.length);
        const min = op.sel.upTo ? 0 : max;
        /** Cards taken out of a pool ("choose 1 among them") leave the pool. */
        const take = (picked: string[]) => {
          frame.vars[op.as] = picked;
          if (op.sel.fromVar) frame.vars[op.sel.fromVar] = (frame.vars[op.sel.fromVar] ?? []).filter((id) => !picked.includes(id));
        };
        if (s.lastChoice && frame.awaiting === op.as) {
          take(s.lastChoice.filter((id) => cands.includes(id)));
          s.lastChoice = null;
          frame.awaiting = undefined;
          break;
        }
        if (cands.length === 0) {
          take([]);
          break;
        }
        // Only ask when the answer can differ: a forced pick is taken silently.
        if (min === max && max === cands.length) {
          take(cands.slice(0, max));
          break;
        }
        frame.awaiting = op.as;
        s.flow.unshift({ op: "script.step", frame });
        s.prompt = {
          kind: "chooseCards",
          player: master,
          choice: { reason: op.reason ?? `${face(ctx, s, frame.card).name}: choose ${op.sel.upTo ? `up to ${want}` : want}`, candidates: cands, min, max, continuation: op.as },
        };
        return "wait";
      }

      case "ko":
        for (const id of resolveRef(ctx, s, frame, op.target)) {
          // 22-12: [Indestructible] cannot be KO'd by an opponent's skill.
          if (has(ctx, s, id, "Indestructible") && s.cards[id].owner !== master) continue;
          if (areaOf(s, id) === "battle") koCard(ctx, s, ev, id, frame.card);
        }
        break;

      case "moveTo":
        for (const id of resolveRef(ctx, s, frame, op.target)) {
          const owner = op.to === "battle" || op.to === "unison" ? master : s.cards[id].owner;
          // "play" and "under" are not areas of their own (3-1): both land in the Battle Area / Drop.
          const dest = op.to === "play" ? "battle" : op.to === "under" ? "drop" : op.to;
          move(ctx, s, ev, id, dest, owner, { position: op.position, reveal: op.reveal, reason: "effect" });
          if (op.mode) setMode(s, ev, id, op.mode);
        }
        break;

      case "switchMode":
        for (const id of resolveRef(ctx, s, frame, op.target)) setMode(s, ev, id, op.mode);
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
        for (const id of resolveRef(ctx, s, frame, op.target)) addEffect(s, ev, { target: id, kind: "cannotAttack", value: 0, until: op.until });
        break;

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

      case "negateAttack":
        if (s.battle) {
          s.battle.negated = true;
          ev.push({ type: "attackNegated" });
        }
        break;

      case "play": {
        // 5-5-3: played by a skill, so no energy cost is paid.
        const targets = resolveRef(ctx, s, frame, op.target);
        if (!targets.length) break;
        const steps: FlowStep[] = [];
        for (const id of targets) steps.push({ op: "play.resolve", card: id, player: master, mode: op.mode });
        frame.ip++;
        steps.push({ op: "script.step", frame });
        s.flow.unshift(...steps);
        return "done";
      }

      case "if": {
        const branch = condHolds(ctx, s, frame, op.cond) ? op.then : (op.else ?? []);
        // Splice the branch in place of the `if`, keeping one frame.
        frame.ops = [...frame.ops.slice(0, frame.ip), ...branch, ...frame.ops.slice(frame.ip + 1)];
        continue;
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
  "if",
  "note",
]);

/**
 * Structural check for a program supplied by the referee. It only proves the
 * shape is executable — the engine still enforces every rule while running it,
 * so a bad ruling can be wrong but never illegal.
 */
export function validateProgram(ops: unknown, depth = 0): ops is Op[] {
  if (!Array.isArray(ops) || depth > 4) return false;
  return ops.every((raw) => {
    if (!raw || typeof raw !== "object") return false;
    const o = raw as { op?: unknown; then?: unknown; else?: unknown };
    if (typeof o.op !== "string" || !OP_NAMES.has(o.op as Op["op"])) return false;
    if (o.op === "if") return validateProgram(o.then, depth + 1) && (o.else === undefined || validateProgram(o.else, depth + 1));
    return true;
  });
}
