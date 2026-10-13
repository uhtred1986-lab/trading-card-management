/**
 * The online opponent's side of the free-choice shortcuts (#645, plan O2-02).
 *
 * The rules are pure functions in `policy/shortcuts.ts` — over what a local
 * policy may know and nothing else. This file is the adapter that lets the
 * online opponent call them: it reads the engine's state, on either engine,
 * through the same seam the opponent always used (`zoneOf`, `leaderOf`,
 * `catalogDefOf`, `engine-state.ts`), puts it in the shortcuts' input, and maps
 * the decision they name back to an index in the engine's menu. It decides
 * nothing itself, and it needs no provider, key or database — `chooseMove`
 * (`opponent.ts`) calls `freeChoice` first and only asks a model when it
 * returns null, exactly as before.
 *
 * The input is built from the menu the caller passes, never from a second read
 * of the engine, so a caller that narrows or replaces the menu (a test, a
 * recovered checkpoint) is answered for that menu.
 */
import type { EngineContext, LegalAction, PlayerId } from "../types";
import type { EngineState } from "../engines";
import { catalogDefOf, leaderOf, zoneOf } from "../engine-state";
import { mayShortcut, shortcutChoice, type ShortcutCard, type ShortcutInput } from "../policy/shortcuts";

/** The shortcuts' input for `p` at this position, from the engine's own state and its menu. */
export function shortcutInputFromEngine(ctx: EngineContext, s: EngineState, legal: LegalAction[], p: PlayerId): ShortcutInput {
  const window = s.prompt.kind;
  const card = (id: string): ShortcutCard => {
    const d = catalogDefOf(ctx, s, id);
    return { id, energyCost: typeof d.energyCost === "number" ? d.energyCost : null, colors: d.colors };
  };
  const reads = window === "mulligan" || window === "charge";
  const leader = window === "charge" ? leaderOf(s, p) : null;
  return {
    seat: p,
    window,
    // The decision id is the move's place in the menu; the engine's menu order is the tie order.
    decisions: legal.map((l, i) => {
      const { player: _player, ...action } = l.action as typeof l.action & Record<string, unknown>;
      void _player;
      return { id: String(i), type: l.action.type, action };
    }),
    hand: reads ? zoneOf(s, p, "hand").map(card) : [],
    leaderColors: leader ? catalogDefOf(ctx, s, leader).colors : [],
    carryMax: s.prompt.kind === "empowerCarry" ? s.prompt.max : null,
  };
}

/** Decisions taken without spending anything. Returns the chosen index, or null to ask. */
export function freeChoice(ctx: EngineContext, s: EngineState, legal: LegalAction[], p: PlayerId): { index: number; how: string } | null {
  if (!mayShortcut(s.prompt.kind, legal.length)) return null;
  const hit = shortcutChoice(shortcutInputFromEngine(ctx, s, legal, p));
  return hit ? { index: Number(hit.id), how: hit.how } : null;
}
