/**
 * #641: the pinned bundle the browser-safe engine scenario plays — built in
 * Node, the way a server would hand one to a browser worker: synthetic card
 * rows, the compiler's own rules for them (`rulesFromCompiler`, the stand-in
 * for `card_rules` that `harness.ts` uses), the shipped DBS ruleset files and
 * two fixed decks. Nothing here touches a database.
 */
import type { CardDef, DeckInput } from "../../src/lib/arena/types";
import type { CardScripts } from "../../src/lib/arena/vm/script";
import type { CardArt } from "../../src/lib/arena/view";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { DBS_FILES } from "../../src/lib/arena/rulesets/dbs";
import { makeReplayBundle, type ReplayBundleRecord } from "../../src/lib/arena/replay-core";

/** The interpreter revision the fixture bundle is pinned to (any 7–40 hex digits). */
export const FIXTURE_REVISION = "a641000000000000000000000000000000000641";
export const FIXTURE_SEED = 641;

const card = (id: string, o: Partial<CardDef>): CardDef => ({
  id,
  name: id,
  type: "BATTLE",
  colors: ["Red"],
  energyCost: 1,
  zEnergyCost: null,
  power: 10000,
  comboCost: 0,
  comboPower: 5000,
  skill: null,
  characters: [id],
  traits: [],
  ...o,
});

const CARDS: CardDef[] = [
  card("O1-L-RED", {
    type: "LEADER", energyCost: null, comboCost: null, comboPower: null,
    skill: "[Awaken] When your life is at 4 or less: Draw 1 card and flip this card over.",
    back: { name: "O1-L-RED awakened", power: 15000, skill: null },
  }),
  card("O1-L-BLUE", { type: "LEADER", colors: ["Blue"], energyCost: null, comboCost: null, comboPower: null }),
  card("O1-V", {}),
  card("O1-DRAW", { energyCost: 1, skill: "[Auto] When you play this card, draw 1 card." }),
  card("O1-CRIT", { energyCost: 2, power: 15000, skill: "[Critical]" }),
  card("O1-PUMP", { energyCost: 1, skill: "[Activate: Main] This card gets +5000 power for the turn." }),
  card("O1-VB", { colors: ["Blue"] }),
  card("O1-BLOCK", { colors: ["Blue"], energyCost: 2, skill: "[Blocker]", comboCost: 1, comboPower: 10000 }),
];

const repeat = (counts: Record<string, number>) => Object.entries(counts).flatMap(([id, n]) => Array.from({ length: n }, () => id));

export const FIXTURE_DECKS: { p1: DeckInput; p2: DeckInput } = {
  p1: { name: "Red seat", leader: "O1-L-RED", main: repeat({ "O1-V": 20, "O1-DRAW": 10, "O1-CRIT": 10, "O1-PUMP": 10 }) },
  p2: { name: "Blue seat", leader: "O1-L-BLUE", main: repeat({ "O1-VB": 30, "O1-BLOCK": 20 }) },
};

/** A content-addressed, revision-pinned bundle with its decks, as a replay export carries it. */
export async function fixtureBundle(): Promise<ReplayBundleRecord> {
  const defs: Record<string, CardDef> = {};
  for (const c of CARDS) defs[c.id] = c;
  const compiled = rulesFromCompiler(defs);
  const scripts: Record<string, CardScripts> = {};
  for (const c of CARDS) {
    scripts[c.id] = compiled[c.id];
    if (c.back) scripts[`${c.id}#back`] = compiled[`${c.id}#back`];
  }
  const art: Record<string, CardArt> = {};
  for (const c of CARDS) art[c.id] = { front: `/art/${c.id}.png`, back: c.back ? `/art/${c.id}-back.png` : null };
  const bundle = await makeReplayBundle({ defs, scripts, art, rulesetFiles: DBS_FILES, runtime: FIXTURE_REVISION });
  // A plain JSON round trip: exactly what a worker receives in a message.
  return JSON.parse(JSON.stringify({ ...bundle, decks: FIXTURE_DECKS })) as ReplayBundleRecord;
}
