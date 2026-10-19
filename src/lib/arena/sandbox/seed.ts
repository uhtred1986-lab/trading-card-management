/**
 * The play-test sandbox's seed (Rules PR 5): a Try it board, staged by the
 * probe (`stagePosition`) with the rule under test installed as the card's
 * script. Pure — no database; the server action reads the card and its art
 * and hands them here.
 */
import { familyOf, scenarioFromKey, scenariosFor, stagePosition, type ProbeRule, type ProbeScenario } from "../probe";
import type { CardArt } from "../view";
import type { SandboxSeed } from "./session";

export function boardFor(rule: ProbeRule, boardKey: string | null | undefined): ProbeScenario | null {
  const scenario = (boardKey ? scenarioFromKey(rule, boardKey) : null) ?? scenariosFor(rule)[0] ?? null;
  return scenario && scenario.family !== "none" ? scenario : null;
}

/** The seed for `rule` on the board `boardKey` names (else its default board), or the reason there is none. */
export function sandboxSeed(rule: ProbeRule, boardKey: string | null | undefined, art: Record<string, CardArt> = {}): { error: string | null; seed: SandboxSeed | null } {
  const scenario = boardFor(rule, boardKey);
  if (!scenario) return { error: "This skill names a moment the engine does not know, so there is no board to play it on.", seed: null };
  try {
    const staged = stagePosition(rule, scenario);
    return {
      error: null,
      seed: {
        ctx: staged.ctx,
        state: staged.state as SandboxSeed["state"],
        art,
        input: staged.input,
        waitsFor: staged.waitsFor,
        card: staged.card,
        boards: scenariosFor(rule).map((s) => ({ key: s.key, title: s.title })),
        boardKey: scenario.key,
        title: `${scenario.title}${familyOf(rule) !== scenario.family ? " (kept board)" : ""}`,
      },
    };
  } catch (error) {
    return { error: `The board could not be staged: ${error instanceof Error ? error.message : String(error)}`, seed: null };
  }
}
