/**
 * The SPRT gate's seat players, by name (`scripts/arena-sprt.mts --candidate NAME --baseline NAME`).
 *
 * A player is a `SeatPlayer` (`scripts/lib/arena-seat-duel.ts`): `(match, seat, revision, memory) =>
 * LocalStep`, so a lookahead player can simulate on the pinned match. Its factory is called afresh for
 * every game and seat, so nothing carries from one game to the next; within a game it must decide from
 * its arguments alone (the runner calls it again on a hidden-state twin and requires the same decision
 * id, guard, answer and memory). Return `answer` with the step when you have it: without it the twin
 * check cannot compare the cards of a pick.
 *
 * To add a player: `registerPlayer("lookahead-normal", () => myPlayer, "one line")` at the bottom of this
 * file, or in a module the run names with `--players-module FILE` (the runner imports it in the parent
 * and in every worker process, so both see the same registry). `uniform` and `shortcuts` are frozen: a
 * change to what they play is a new name, never an edit. `heuristic` is `localPolicy()` as it stands at
 * the run's commit (the report's source pin says which); a gate compares a candidate with the
 * heuristic of the same commit.
 */
import { uniformPolicy } from "../../src/lib/arena/policy/contract";
import { shortcutThen } from "../../src/lib/arena/policy/shortcuts";
import { localPolicy, COMBAT_POLICY_VERSION } from "../../src/lib/arena/policy/combat";
import { MAIN_POLICY_VERSION } from "../../src/lib/arena/policy/main";
import { CHOICE_POLICY_VERSION } from "../../src/lib/arena/policy/choices";
import { answeringStep, type SeatPlayer } from "./arena-seat-duel";

export type PlayerFactory = () => SeatPlayer;

interface Entry { factory: PlayerFactory; description: string }
const registry = new Map<string, Entry>();

/** Adds a player under `name`; a name can be registered once. */
export function registerPlayer(name: string, factory: PlayerFactory, description = ""): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`player names are lower-case words joined by "-" (got ${JSON.stringify(name)})`);
  if (registry.has(name)) throw new Error(`a player called ${name} is already registered`);
  registry.set(name, { factory, description });
}

export function playerFactory(name: string): PlayerFactory {
  const entry = registry.get(name);
  if (!entry) throw new Error(`unknown player ${name} (known: ${playerNames().join(", ")}; others come from --players-module)`);
  return entry.factory;
}

export const playerNames = (): string[] => [...registry.keys()].sort();
export const playerDescription = (name: string): string => registry.get(name)?.description ?? "";

/** The frozen ladder, weakest first, for `--ladder`: an at-a-glance rating of a candidate. */
export const LADDER = ["uniform", "shortcuts", "heuristic"] as const;

registerPlayer("uniform", () => answeringStep(uniformPolicy), "a random legal answer in every window, no shortcuts (arena-policy-eval's `uniform` baseline)");
registerPlayer("shortcuts", () => answeringStep(shortcutThen(uniformPolicy)), "the #645 shortcuts, a random legal answer everywhere else (arena-policy-eval's `shortcuts` baseline)");
registerPlayer("heuristic", () => answeringStep(localPolicy()), `today's local opponent, localPolicy() through localStep (main v${MAIN_POLICY_VERSION}, combat v${COMBAT_POLICY_VERSION}, choices v${CHOICE_POLICY_VERSION})`);
