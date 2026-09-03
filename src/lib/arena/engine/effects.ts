/**
 * Effect resolution. Phase 1 handles a handful of effects natively by reading
 * their fixed phrasing (draw N, ±power for the battle/turn, negate the
 * attack, the standard [Counter: Play] wording). Everything else is left for
 * the compiled-script layer (proposal §6) or the referee; until then the
 * engine logs a note so the log says exactly which skill did nothing.
 *
 * Keyword skills are resolved in `engine.ts` — they are rules, not text.
 */
import { addEffect, draw, note, type GameContext } from "./state";
import type { GameEvent, GameState, PlayerId, Skill, Trigger } from "./types";

export interface CompiledScript {
  /** Reserved for phase 3: the JSON effect program. */
  version: 1;
  steps: unknown[];
}

export interface ResolveArgs {
  card: string;
  skill: Skill;
  master: PlayerId;
  trigger?: Trigger;
}

/**
 * Resolve one skill's effect text. Returns "done" when finished, "wait" when
 * a prompt was set and the flow must resume later (scripts with choices).
 */
export function resolveEffect(ctx: GameContext & { scripts?: Record<string, CompiledScript> }, s: GameState, ev: GameEvent[], a: ResolveArgs): "done" | "wait" {
  const text = a.skill.effect.trim();
  if (!text) return "done";
  const script = ctx.scripts?.[s.cards[a.card].cardId];
  if (script) {
    // Phase 3 wires the interpreter here.
    note(ev, `${a.card}: compiled script present but the interpreter is not built yet`);
    return "done";
  }

  let handled = false;
  const lower = text.toLowerCase();
  let m: RegExpExecArray | null;

  // "Draw 1 card." / "You may draw 2 cards" (the "may" is taken: no downside in practice).
  if ((m = /^(?:you may )?draw (\d+) cards?/.exec(lower))) {
    draw(ctx, s, ev, a.master, Number(m[1]));
    handled = true;
  }
  // "This card gets +5000 power for the battle/turn."
  if ((m = /this card gets ([+-]\d+) power for the (battle|turn)/.exec(lower))) {
    addEffect(s, ev, { target: a.card, kind: "power", value: Number(m[1]), until: m[2] as "battle" | "turn" });
    handled = true;
  }
  // "Negate the attack" — the standard [Counter: Attack] wording.
  if (/^negate the attack/.test(lower) && s.battle) {
    s.battle.negated = true;
    ev.push({ type: "attackNegated" });
    handled = true;
  }
  // "The Battle Card your opponent is playing is played in Rest Mode with its skills negated for the duration of the turn"
  if (/the battle card your opponent is playing is played in rest mode/.test(lower) && s.resolving) {
    s.continuations.playRest = s.resolving.card;
    if (/skills negated/.test(lower)) s.continuations.playNegated = s.resolving.card;
    handled = true;
  }

  if (!handled) note(ev, `${s.cards[a.card].cardId} skill ${a.skill.index}: text not interpreted yet — "${text.slice(0, 80)}"`);
  return "done";
}
