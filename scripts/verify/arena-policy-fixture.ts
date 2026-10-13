/**
 * #644: a pinned bundle whose decks reach the questions #641's fixture never
 * asks — a "choose up to 2" from your own hand, from your Drop and from the
 * other Battle Area (5-2), and a printed "choose one—" (20-2) — so the policy
 * contract's compound `pick` and its mode menu are exercised on real engine
 * prompts. Synthetic cards, the compiler's own rules for them, the shipped DBS
 * ruleset, no database: built exactly like `arena-browser-fixture.ts`.
 */
import type { CardDef, DeckInput } from "../../src/lib/arena/types";
import type { CardScripts } from "../../src/lib/arena/vm/script";
import type { CardArt } from "../../src/lib/arena/view";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { DBS_FILES } from "../../src/lib/arena/rulesets/dbs";
import { makeReplayBundle, type ReplayBundleRecord } from "../../src/lib/arena/replay-core";

export const POLICY_FIXTURE_REVISION = "a644000000000000000000000000000000000644";
export const POLICY_FIXTURE_SEED = 644;

const card = (id: string, o: Partial<CardDef>): CardDef => ({
  id,
  name: id,
  type: "BATTLE",
  colors: ["Red", "Blue"],
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
  card("O2-L-RED", { type: "LEADER", colors: ["Red"], energyCost: null, comboCost: null, comboPower: null }),
  card("O2-L-BLUE", { type: "LEADER", colors: ["Blue"], energyCost: null, comboCost: null, comboPower: null }),
  card("O2-V", {}),
  card("O2-KO2", { skill: "[Auto] When you play this card, choose up to 2 of your opponent's Battle Cards and KO them." }),
  card("O2-MODE", { skill: "[Auto] When you play this card, choose one—<br>・Draw 1 card.<br>・Your Leader gets +5000 power for the turn." }),
  card("O2-LOOT", { skill: "[Auto] When you play this card, you may place 2 cards from your hand into the Drop. If you do, draw 3 cards." }),
  card("O2-RAISE", { skill: "[Auto] When you play this card, choose up to 2 cards in your Drop and add them to your hand." }),
  card("O2-BLOCK", { energyCost: 2, skill: "[Blocker]", comboCost: 1, comboPower: 10000 }),
];

const repeat = (counts: Record<string, number>) => Object.entries(counts).flatMap(([id, n]) => Array.from({ length: n }, () => id));

export const POLICY_FIXTURE_DECKS: { p1: DeckInput; p2: DeckInput } = {
  p1: { name: "Red policy seat", leader: "O2-L-RED", main: repeat({ "O2-V": 14, "O2-KO2": 9, "O2-MODE": 9, "O2-LOOT": 9, "O2-RAISE": 9 }) },
  p2: { name: "Blue policy seat", leader: "O2-L-BLUE", main: repeat({ "O2-V": 10, "O2-KO2": 8, "O2-MODE": 8, "O2-LOOT": 8, "O2-RAISE": 8, "O2-BLOCK": 8 }) },
};

export async function policyFixtureBundle(): Promise<ReplayBundleRecord> {
  const defs: Record<string, CardDef> = {};
  for (const c of CARDS) defs[c.id] = c;
  const compiled = rulesFromCompiler(defs);
  const scripts: Record<string, CardScripts> = {};
  for (const c of CARDS) {
    if (!compiled[c.id]?.complete) throw new Error(`policy fixture card ${c.id} did not compile: ${JSON.stringify(compiled[c.id]?.unsupported)}`);
    scripts[c.id] = compiled[c.id];
  }
  const art: Record<string, CardArt> = {};
  for (const c of CARDS) art[c.id] = { front: `/art/${c.id}.png`, back: null };
  const bundle = await makeReplayBundle({ defs, scripts, art, rulesetFiles: DBS_FILES, runtime: POLICY_FIXTURE_REVISION });
  return JSON.parse(JSON.stringify({ ...bundle, decks: POLICY_FIXTURE_DECKS })) as ReplayBundleRecord;
}
