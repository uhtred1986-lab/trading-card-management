/**
 * How a battle is staged (`docs/arena-battle-staging-spec.md`).
 *
 * A DBS attack is an attacker, a guard and a chain of combo and counter cards
 * added in order, some of which fire skills of their own, before two numbers
 * are compared. There are three ways to draw that, and they are a preference
 * rather than a redesign:
 *
 *   - `inplace` — the original lunge and beam, drawn where the cards sit. The
 *     fallback and the control: it must keep working exactly as it did.
 *   - `band` — a strip across the middle of the board holding both chains and
 *     both totals, with the board dimmed behind it. The one that keeps the
 *     position being fought over on screen while the fight resolves, and what
 *     the takeover falls back to when the prompt asks for a card on the field.
 *   - `takeover` — the same data given the battle field (`docs/arena-redesign/`
 *     frames 07–08): Claude's card on top, yours below, huge figures and a VS
 *     between. The default since the redesign (1 Oct 2026). It covers the
 *     field only — the hand and the prompt stay usable under it — which is what
 *     answered the band's reason for being the default.
 *
 * All three render from the same `view.battle`, and a staging that needs its
 * own data is not a staging (decision 1). A cookie rather than
 * `localStorage`, like the skin beside it: read on the server so a reload
 * cannot flash the wrong one.
 */
export const ARENA_STAGINGS = ["inplace", "band", "takeover"] as const;
export type ArenaStaging = (typeof ARENA_STAGINGS)[number];

export const STAGING_COOKIE = "arenaStaging";

export const DEFAULT_STAGING: ArenaStaging = "takeover";

/** A cookie or query value, or anything else, read as a staging. */
export function stagingFrom(value: string | undefined | null): ArenaStaging {
  return (ARENA_STAGINGS as readonly string[]).includes(value ?? "") ? (value as ArenaStaging) : DEFAULT_STAGING;
}

/** What the control calls each one. */
export const STAGING_LABEL: Record<ArenaStaging, string> = {
  inplace: "in place",
  band: "duel band",
  takeover: "takeover",
};
