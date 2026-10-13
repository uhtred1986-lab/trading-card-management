/**
 * #646: a pinned bundle for the Main-Phase policy's named scenarios — two colours of energy, a
 * card for each colour, a dear and a cheap play, an unlimited free [Activate: Main], a
 * [Blocker] and a [Double Strike] — and `stage`, which lays out a position on a real engine
 * state (the cards dealt by the engine, re-faced and moved between zones) so a scenario names
 * exactly the hand, energy and boards it is about. Synthetic cards, the compiler's own rules,
 * the shipped DBS ruleset, no database: built like `arena-browser-fixture.ts`.
 */
import type { CardDef, DeckInput, PlayerId } from "../../src/lib/arena/types";
import type { CardScripts } from "../../src/lib/arena/vm/script";
import type { CardArt } from "../../src/lib/arena/view";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { DBS_FILES } from "../../src/lib/arena/rulesets/dbs";
import { makeReplayBundle, type ReplayBundleRecord } from "../../src/lib/arena/replay-core";
import { applyMove, createPinnedMatch, legalMoves, type PinnedMatch } from "../../src/lib/arena/browser";

export const MAIN_FIXTURE_REVISION = "a646000000000000000000000000000000000646";
export const MAIN_FIXTURE_SEED = 646;

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
  card("M-L-RED", { type: "LEADER", energyCost: null, comboCost: null, comboPower: null }),
  card("M-L-BLUE", { type: "LEADER", colors: ["Blue"], energyCost: null, comboCost: null, comboPower: null }),
  card("M-R1", { energyCost: 1, power: 10000 }),
  card("M-R2", { energyCost: 2, power: 15000 }),
  card("M-BIG", { energyCost: 3, power: 25000 }),
  card("M-B1", { colors: ["Blue"], energyCost: 1, power: 10000 }),
  card("M-WEAK", { energyCost: 1, power: 5000 }),
  card("M-PUMP", { energyCost: 1, skill: "[Activate: Main] This card gets +5000 power for the turn." }),
  card("M-DS", { energyCost: 2, power: 15000, skill: "[Double Strike]" }),
  card("M-BLOCK", { colors: ["Blue"], energyCost: 2, power: 20000, skill: "[Blocker]" }),
];

const repeat = (counts: Record<string, number>) => Object.entries(counts).flatMap(([id, n]) => Array.from({ length: n }, () => id));

export const MAIN_FIXTURE_DECKS: { p1: DeckInput; p2: DeckInput } = {
  p1: { name: "Red-blue seat", leader: "M-L-RED", main: repeat({ "M-R1": 10, "M-R2": 8, "M-BIG": 6, "M-B1": 8, "M-WEAK": 4, "M-PUMP": 6, "M-DS": 8 }) },
  p2: { name: "Blue seat", leader: "M-L-BLUE", main: repeat({ "M-B1": 20, "M-BLOCK": 10, "M-R1": 10, "M-R2": 10 }) },
};

export async function mainFixtureBundle(): Promise<ReplayBundleRecord> {
  const defs: Record<string, CardDef> = {};
  for (const c of CARDS) defs[c.id] = c;
  const compiled = rulesFromCompiler(defs);
  const scripts: Record<string, CardScripts> = {};
  for (const c of CARDS) {
    if (!compiled[c.id]?.complete) throw new Error(`main fixture card ${c.id} did not compile: ${JSON.stringify(compiled[c.id]?.unsupported)}`);
    scripts[c.id] = compiled[c.id];
  }
  const art: Record<string, CardArt> = {};
  for (const c of CARDS) art[c.id] = { front: `/art/${c.id}.png`, back: null };
  const bundle = await makeReplayBundle({ defs, scripts, art, rulesetFiles: DBS_FILES, runtime: MAIN_FIXTURE_REVISION });
  return JSON.parse(JSON.stringify({ ...bundle, decks: MAIN_FIXTURE_DECKS })) as ReplayBundleRecord;
}

/**
 * The fixture game (this bundle or another built the same way, #647) played on to p1's Main Phase
 * on turn 3 (its second turn) by plain moves: p1 goes first, both keep, every charge charges, every play is declined, every turn ends.
 */
export async function mainPhaseMatch(bundle: ReplayBundleRecord, seed = MAIN_FIXTURE_SEED, interpreterRevision = MAIN_FIXTURE_REVISION): Promise<PinnedMatch> {
  let { match } = await createPinnedMatch({ bundle, seed, interpreterRevision });
  for (let n = 0; n < 200; n++) {
    const s = match.state;
    if (s.turn >= 3 && s.prompt.kind === "main" && s.prompt.player === "p1") return match;
    const legal = legalMoves(match).map((l) => l.action);
    const want = [
      (a: (typeof legal)[number]) => a.type === "chooseFirst" && a.first === "p1",
      (a: (typeof legal)[number]) => a.type === "mulligan" && !a.redraw,
      (a: (typeof legal)[number]) => a.type === "charge" && a.card !== null,
      (a: (typeof legal)[number]) => a.type === "endMain" || a.type === "pass",
    ];
    const action = want.map((w) => legal.find(w)).find((a) => a) ?? legal[0];
    match = applyMove(match, action).match;
  }
  throw new Error("the fixture game did not reach p1's turn-3 Main Phase");
}

export interface Layout {
  hand?: string[];
  /** Energy cards, all active unless `restedEnergy` says how many of them (from the end) are rested. */
  energy?: string[];
  restedEnergy?: number;
  battle?: { cardId: string; mode: "active" | "rest" }[];
  life?: number;
  leaderMode?: "active" | "rest";
  energyMarkers?: number;
}

/**
 * Lay out `layout` for `p` on a copy of `match`: each named zone takes exactly the cards named,
 * re-facing instances already there and drawing more instances from the top of the deck (or
 * putting spares back on it). Instances are the engine's own, so every id stays one the state
 * knows; the prompt and the turn are left as they are.
 */
export function stage(match: PinnedMatch, layouts: Partial<Record<PlayerId, Layout>>): PinnedMatch {
  const state = JSON.parse(JSON.stringify(match.state)) as PinnedMatch["state"];
  for (const [p, layout] of Object.entries(layouts) as [PlayerId, Layout][]) {
    const zones = state.sides[p].zones as Record<string, string[]>;
    const fill = (zone: string, cardIds: string[], mode: (i: number) => "active" | "rest" | null) => {
      const ids = zones[zone] ?? (zones[zone] = []);
      while (ids.length > cardIds.length) zones.deck.push(ids.pop()!);
      while (ids.length < cardIds.length) {
        const id = zones.deck.shift();
        if (!id) throw new Error(`stage: ${p}'s deck ran out filling ${zone}`);
        ids.push(id);
      }
      ids.forEach((id, i) => {
        const c = state.cards[id];
        c.cardId = cardIds[i];
        c.mode = mode(i);
        c.faceUp = false;
        c.hidden = false;
        c.markers = 0;
        c.under = [];
        c.usedThisTurn = [];
        c.usedMarkerSkill = false;
        c.battledThisTurn = false;
        delete c.attacksThisTurn;
        delete c.placedThisTurn;
      });
    };
    if (layout.hand) fill("hand", layout.hand, () => null);
    if (layout.energy) {
      const rested = layout.restedEnergy ?? 0;
      fill("energy", layout.energy, (i) => (i >= layout.energy!.length - rested ? "rest" : "active"));
    }
    if (layout.battle) fill("battle", layout.battle.map((b) => b.cardId), (i) => layout.battle![i].mode);
    if (layout.life !== undefined) {
      const life = zones.life;
      while (life.length > layout.life) zones.deck.push(life.pop()!);
    }
    if (layout.leaderMode) state.cards[zones.leader[0]].mode = layout.leaderMode;
    if (layout.energyMarkers !== undefined) (state.sides[p].attrs as Record<string, unknown>).energyMarkers = layout.energyMarkers;
  }
  return { ...match, state };
}
