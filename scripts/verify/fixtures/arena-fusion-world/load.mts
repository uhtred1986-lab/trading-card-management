/**
 * The four Fusion World launch starters (FS01–FS04) as a game context and as decks, with no database:
 * `cards.json` is the 64 card definitions, `decks.json` the four lists (see the `notes` in each for where
 * every number came from). Shared by the `arena-fusion-world` suite and `scripts/arena-fuzz.mts --game fusion`.
 */
import { readFileSync } from "node:fs";
import { compileCardCached } from "../../../../src/lib/arena/compile";
import type { CardDef, DeckInput, EngineContext } from "../../../../src/lib/arena/types";
import type { CardScripts } from "../../../../src/lib/arena/vm/script";

const read = (file: string) => JSON.parse(readFileSync(new URL(`./${file}`, import.meta.url), "utf8"));

export const STARTERS = ["FS01", "FS02", "FS03", "FS04"] as const;
export type Starter = (typeof STARTERS)[number];

export const FW_DEFS: Record<string, CardDef> = Object.fromEntries((read("cards.json").cards as CardDef[]).map((c) => [c.id, c]));

const lists = read("decks.json").decks as Record<Starter, { leader: string; main: Record<string, number> }>;

/** A starter as the engine takes it: the leader and the 50 main-deck cards. */
export function starterDeck(code: Starter, name = code): DeckInput {
  const { leader, main } = lists[code];
  return { name, leader, main: Object.entries(main).flatMap(([id, n]) => Array<string>(n).fill(id)) };
}

/** The compiled programs of every starter card (the leaders' back faces under `<id>#back`). */
export function fusionContext(): EngineContext {
  const scripts: Record<string, CardScripts> = {};
  for (const def of Object.values(FW_DEFS)) {
    scripts[def.id] = compileCardCached(def, "front");
    if (def.back) scripts[`${def.id}#back`] = compileCardCached(def, "back");
  }
  return { defs: FW_DEFS, scripts };
}
