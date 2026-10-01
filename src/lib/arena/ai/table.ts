/**
 * The table as Claude reads it, off whichever engine dealt the game (#457).
 *
 * `ai/view.ts` turns a position into the text Claude is sent, and
 * `ai/opponent.ts` works out the combo question from the same numbers. Both
 * used to read the legacy `GameState` field by field, so a rules-engine game
 * could not be put to Claude at all. They now read this instead: one small set
 * of questions about the table — what is in an area, what a card is called and
 * how strong it is right now, which keywords it has — answered by each engine
 * from its own state, so the same position renders the same text on both.
 *
 * Every answer is the engine's *own* reading, never a second computation of
 * it: the legacy engine's `powerOf`/`comboPowerOf`/`keywordsInForce`, and the
 * rules engine's `attrsNow`/`keywordsInForce` (`vm/program.ts`), the same
 * calls its battle and its board read. Where the two engines read a card
 * differently, Claude is told what the engine it is playing on will do.
 *
 * Pure and client-safe: no database, no network.
 */
import { areaOf, comboPowerOf, face, keywordsInForce, powerOf } from "../engine";
import { def } from "../engine/state";
import type { EngineState } from "../engines";
import { energyMarkersOf, leaderOf, nameOf, unisonOf, zoneOf, type ZoneArea } from "../engine-state";
import { rulesetFor, type GameDefinition } from "../rulesets";
import type { BattleStep, CardDef, EngineContext, PlayerId } from "../types";
import { withTokens } from "../vm/cards";
import { attrsNow, keywordsInForce as vmKeywordsInForce, zoneOf as vmZoneOf } from "../vm/program";
import { isVmState, type VmState } from "../vm/state";

/** One card's face as it shows now: hidden, or a name, a power and a skill text. */
export interface ShownFace {
  name: string;
  power: number | null;
  skill: string | null;
}

/** The questions `ai/view.ts` and `ai/opponent.ts` ask of a position. */
export interface Table {
  turn: number;
  turnPlayer: PlayerId;
  /**
   * The turn's phase. A battle is fought inside the Main Phase (8-1): the
   * legacy engine keeps `main` through it, and the rules engine's `battle`
   * phase frame sits on top of the Main Phase's, so this reports the phase
   * beneath it — the battle itself is described separately (`battle`).
   */
  phase: string;
  battle: { attacker: string; guard: string; step: BattleStep } | null;
  name(p: PlayerId): string;
  zone(p: PlayerId, area: ZoneArea): string[];
  leader(p: PlayerId): string | null;
  unison(p: PlayerId): string | null;
  energyMarkers(p: PlayerId): number;
  /** The catalog definition (a token's own decoded one). */
  def(id: string): CardDef;
  /** The face showing (1-9, 10-1-3), or null in Hidden Mode (23-5-2). */
  face(id: string): ShownFace | null;
  /** The area the card stands in, by the shared area name, or null. */
  area(id: string): string | null;
  /** Power as the engine computes it right now (9-9). */
  power(id: string): number;
  /** Combo power as the engine computes it right now. */
  comboPower(id: string): number;
  /** The keyword skills in force on the card, by name, in the engine's own order. */
  keywords(id: string): string[];
  mode(id: string): string | null;
  markers(id: string): number;
  hidden(id: string): boolean;
  faceUp(id: string): boolean;
}

/** The engine-neutral reading of `s`, for `ai/view.ts` and `ai/opponent.ts`. */
export function tableOf(ctx: EngineContext, s: EngineState): Table {
  return isVmState(s) ? rulesTable(ctx, s) : legacyTable(ctx, s);
}

function shared(s: EngineState) {
  return {
    turn: s.turn,
    turnPlayer: s.turnPlayer,
    battle: s.battle ? { attacker: s.battle.attacker, guard: s.battle.guard, step: s.battle.step } : null,
    name: (p: PlayerId) => nameOf(s, p),
    zone: (p: PlayerId, area: ZoneArea) => zoneOf(s, p, area),
    leader: (p: PlayerId) => leaderOf(s, p) ?? null,
    unison: (p: PlayerId) => unisonOf(s, p),
    energyMarkers: (p: PlayerId) => energyMarkersOf(s, p),
    markers: (id: string) => s.cards[id].markers,
    hidden: (id: string) => s.cards[id].hidden,
    faceUp: (id: string) => !!s.cards[id].faceUp,
  };
}

function legacyTable(ctx: EngineContext, s: Exclude<EngineState, VmState>): Table {
  return {
    ...shared(s),
    phase: s.phase,
    def: (id) => def(ctx, s, id),
    face: (id) => (s.cards[id].hidden ? null : face(ctx, s, id)),
    area: (id) => areaOf(s, id),
    power: (id) => powerOf(ctx, s, id),
    comboPower: (id) => comboPowerOf(ctx, s, id),
    keywords: (id) => keywordsInForce(ctx, s, id).map((k) => k.name),
    mode: (id) => s.cards[id].mode,
  };
}

/** The battle phase is not a phase of the turn (`battle.rules`): report the turn phase it was entered from. */
function turnPhase(s: VmState): string {
  if (s.phase !== "battle") return s.phase;
  for (let i = s.flow.length - 1; i >= 0; i--) if (s.flow[i].phase !== "battle") return s.flow[i].phase;
  return "main";
}

function definitionOf(s: VmState): GameDefinition {
  const loaded = rulesetFor(s.game);
  if (!loaded.ok) throw new Error(`the ${s.game} ruleset does not load, so the table cannot be read: ${JSON.stringify(loaded.errors[0])}`);
  return loaded.definition;
}

function rulesTable(raw: EngineContext, s: VmState): Table {
  // The engine's own entry points read a token's row through `withTokens`
  // (`vm/index.ts`'s `RULES`); this reads the same rows the same way.
  const ctx = withTokens(raw);
  const game = definitionOf(s);
  const defOf = (id: string): CardDef => {
    const d = ctx.defs[s.cards[id].cardId];
    if (!d) throw new Error(`no definition for ${s.cards[id].cardId}`);
    return d;
  };
  return {
    ...shared(s),
    phase: turnPhase(s),
    def: defOf,
    // The legacy `face()` reading exactly, and `vm/program.ts`'s `faceOf`:
    // a flipped card shows its back's name, power and text when it has one.
    face: (id) => {
      const card = s.cards[id];
      if (card.hidden) return null;
      const d = defOf(id);
      return card.flipped && d.back ? { name: d.back.name, power: d.back.power, skill: d.back.skill } : { name: d.name, power: d.power, skill: d.skill };
    },
    area: (id) => vmZoneOf(s, id),
    power: (id) => Number(attrsNow(ctx, game, s, id).power ?? 0),
    comboPower: (id) => Number(attrsNow(ctx, game, s, id).comboPower ?? 0),
    keywords: (id) => vmKeywordsInForce(ctx, game, s, id).map((k) => k.name),
    mode: (id) => s.cards[id].mode,
  };
}
