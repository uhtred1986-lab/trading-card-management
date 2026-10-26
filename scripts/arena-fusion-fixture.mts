/**
 * F1-06: `contract/fixtures/fusion-play.json`, a Fusion World board for `/arena/preview?fixture=fusion-play`.
 * Two synthetic decks (no database, no catalog) are dealt on the shipped Fusion World ruleset, played to
 * p1's Main Phase and laid out with some Battle Cards, so the board the owner screenshots has something on it.
 *
 *   npx tsx scripts/arena-fusion-fixture.mts
 */
import { writeFileSync } from "node:fs";
import type { CardDef, DeckInput } from "../src/lib/arena/types";
import type { CardScripts } from "../src/lib/arena/vm/script";
import type { CardArt } from "../src/lib/arena/view";
import { rulesFromCompiler } from "../src/lib/arena/draft";
import { FUSION_FILES } from "../src/lib/arena/rulesets/fusion";
import { makeReplayBundle, type ReplayBundleRecord } from "../src/lib/arena/replay-core";
import { projectSnapshot } from "../src/lib/arena/browser";
import { mainPhaseMatch, stage } from "./verify/arena-policy-main-fixture";

const REVISION = "f106000000000000000000000000000000000106";
const card = (id: string, o: Partial<CardDef>): CardDef => ({
  id, name: id, type: "BATTLE", colors: ["Red"], energyCost: 1, zEnergyCost: null, power: 10000, comboCost: 0, comboPower: 5000, skill: null, characters: [id], traits: [], ...o,
});
const CARDS: CardDef[] = [
  card("FW-L-RED", { name: "Red Leader", type: "LEADER", energyCost: null, comboCost: null, comboPower: null }),
  card("FW-L-BLUE", { name: "Blue Leader", type: "LEADER", colors: ["Blue"], energyCost: null, comboCost: null, comboPower: null }),
  card("FW-A", { name: "Red Fighter", energyCost: 2, power: 15000 }),
  card("FW-B", { name: "Red Guard", energyCost: 1, power: 10000, skill: "[Blocker]" }),
  card("FW-C", { name: "Blue Fighter", colors: ["Blue"], energyCost: 2, power: 15000 }),
];
const repeat = (counts: Record<string, number>) => Object.entries(counts).flatMap(([id, n]) => Array.from({ length: n }, () => id));
const decks: { p1: DeckInput; p2: DeckInput } = {
  p1: { name: "You", leader: "FW-L-RED", main: repeat({ "FW-A": 25, "FW-B": 25 }) },
  p2: { name: "Opponent", leader: "FW-L-BLUE", main: repeat({ "FW-C": 50 }) },
};

const defs: Record<string, CardDef> = Object.fromEntries(CARDS.map((c) => [c.id, c]));
const compiled = rulesFromCompiler(defs);
const scripts: Record<string, CardScripts> = {};
for (const c of CARDS) {
  if (!compiled[c.id]?.complete) throw new Error(`${c.id} did not compile`);
  scripts[c.id] = compiled[c.id];
}
const art: Record<string, CardArt> = Object.fromEntries(CARDS.map((c) => [c.id, { front: `/art/${c.id}.png`, back: null }]));
const made = await makeReplayBundle({ defs, scripts, art, rulesetFiles: FUSION_FILES, game: "fusion", runtime: REVISION });
const bundle = JSON.parse(JSON.stringify({ ...made, decks })) as ReplayBundleRecord;

const main = await mainPhaseMatch(bundle, 106, REVISION);
const laid = stage(main, {
  p1: { hand: ["FW-A", "FW-B", "FW-A", "FW-B", "FW-A"], energy: ["FW-A", "FW-A", "FW-A", "FW-A", "FW-A"], battle: [{ cardId: "FW-A", mode: "active" }, { cardId: "FW-B", mode: "active" }] },
  p2: { battle: [{ cardId: "FW-C", mode: "active" }, { cardId: "FW-C", mode: "rest" }] },
});
const snapshot = projectSnapshot(laid, "p1", { id: 106001 });
writeFileSync("contract/fixtures/fusion-play.json", JSON.stringify(snapshot, null, 2) + "\n");
console.log(`fusion-play: ${snapshot.game.game}, prompt ${laid.state.prompt.kind}`);
