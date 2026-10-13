/**
 * #647: a pinned bundle for the battle policy's named scenarios — combo cards of 5,000 (free) and
 * 10,000 (one energy) power, a [Blocker] that survives a 15,000 attack and one that does not, a
 * [Counter: Attack] that negates the attack, a [Critical] and a [Double Strike] attacker and an
 * [Activate: Battle] that pumps the Leader — and `battleAt`, which stages a position with the
 * main fixture's `stage` and declares an attack on it, so a scenario starts at the battle's first
 * question on a real engine state. Synthetic cards, the compiler's own rules, the shipped DBS
 * ruleset, no database: built like `arena-policy-main-fixture.ts`.
 */
import type { CardDef, DeckInput, PlayerId } from "../../src/lib/arena/types";
import type { CardScripts } from "../../src/lib/arena/vm/script";
import type { CardArt } from "../../src/lib/arena/view";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { DBS_FILES } from "../../src/lib/arena/rulesets/dbs";
import { makeReplayBundle, type ReplayBundleRecord } from "../../src/lib/arena/replay-core";
import { applyMove, legalMoves, type PinnedMatch } from "../../src/lib/arena/browser";
import { mainPhaseMatch, stage, type Layout } from "./arena-policy-main-fixture";

export const COMBAT_FIXTURE_REVISION = "a647000000000000000000000000000000000647";
export const COMBAT_FIXTURE_SEED = 647;

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
  card("C-L-RED", { type: "LEADER", energyCost: null, comboCost: null, comboPower: null }),
  card("C-L-PUMP", { type: "LEADER", energyCost: null, comboCost: null, comboPower: null, skill: "[Activate: Battle] Your Leader gets +5000 power for the turn." }),
  /** A free 5,000 combo. */
  card("C-V5", { energyCost: 1, power: 10000, comboCost: 0, comboPower: 5000 }),
  /** A 10,000 combo for one energy. */
  card("C-V10", { energyCost: 2, power: 15000, comboCost: 1, comboPower: 10000 }),
  card("C-BIG", { energyCost: 3, power: 25000, comboCost: 0, comboPower: 5000 }),
  card("C-BLOCK", { energyCost: 2, power: 20000, comboCost: 0, comboPower: 5000, skill: "[Blocker]" }),
  card("C-CHUMP", { energyCost: 1, power: 5000, comboCost: 0, comboPower: 5000, skill: "[Blocker]" }),
  card("C-CRIT", { energyCost: 2, power: 15000, skill: "[Critical]" }),
  card("C-DS", { energyCost: 2, power: 15000, skill: "[Double Strike]" }),
  card("C-NEG", { type: "EXTRA", energyCost: 1, power: null, comboCost: null, comboPower: null, skill: "[Counter: Attack] Negate the attack." }),
];

const repeat = (counts: Record<string, number>) => Object.entries(counts).flatMap(([id, n]) => Array.from({ length: n }, () => id));

export const COMBAT_FIXTURE_DECKS: { p1: DeckInput; p2: DeckInput } = {
  p1: { name: "Attacker", leader: "C-L-RED", main: repeat({ "C-V5": 8, "C-V10": 10, "C-BIG": 6, "C-CRIT": 8, "C-DS": 8, "C-NEG": 6, "C-BLOCK": 4 }) },
  p2: { name: "Defender", leader: "C-L-PUMP", main: repeat({ "C-V5": 12, "C-V10": 10, "C-BLOCK": 8, "C-CHUMP": 8, "C-NEG": 8, "C-BIG": 4 }) },
};

export async function combatFixtureBundle(): Promise<ReplayBundleRecord> {
  const defs: Record<string, CardDef> = {};
  for (const c of CARDS) defs[c.id] = c;
  const compiled = rulesFromCompiler(defs);
  const scripts: Record<string, CardScripts> = {};
  for (const c of CARDS) {
    if (!compiled[c.id]?.complete) throw new Error(`combat fixture card ${c.id} did not compile: ${JSON.stringify(compiled[c.id]?.unsupported)}`);
    scripts[c.id] = compiled[c.id];
  }
  const art: Record<string, CardArt> = {};
  for (const c of CARDS) art[c.id] = { front: `/art/${c.id}.png`, back: null };
  const bundle = await makeReplayBundle({ defs, scripts, art, rulesetFiles: DBS_FILES, runtime: COMBAT_FIXTURE_REVISION });
  return JSON.parse(JSON.stringify({ ...bundle, decks: COMBAT_FIXTURE_DECKS })) as ReplayBundleRecord;
}

/** p1's turn-3 Main Phase of the combat fixture game. */
export function combatMainPhase(bundle: ReplayBundleRecord): Promise<PinnedMatch> {
  return mainPhaseMatch(bundle, COMBAT_FIXTURE_SEED, COMBAT_FIXTURE_REVISION);
}

/** p2's turn-4 Main Phase: p1's turn-3 Main Phase ended, every later question declined. */
export function p2MainPhase(p1Main: PinnedMatch): PinnedMatch {
  let match = applyMove(p1Main, { type: "endMain", player: "p1" }).match;
  for (let n = 0; n < 50; n++) {
    if (match.state.prompt.kind === "main" && match.state.prompt.player === "p2") return match;
    const legal = legalMoves(match).map((l) => l.action);
    const action = legal.find((a) => a.type === "charge" && a.card !== null) ?? legal.find((a) => a.type === "pass" || a.type === "endMain" || ("card" in a && a.card === null)) ?? legal[0];
    match = applyMove(match, action).match;
  }
  throw new Error("the combat fixture game did not reach p2's Main Phase");
}

/**
 * Lay out both sides on `opening` (a Main Phase: p1's, or p2's from `p2MainPhase`) and declare the
 * turn player's attack: `attacker` is the card id of its attacking Battle Card, or "leader"; the
 * target is the other Leader unless `target` names one of the other side's Battle Cards by card id; `leaders` re-faces a Leader. Returns the match at the battle's first
 * question (whoever is asked).
 */
export function battleAt(opening: PinnedMatch, layouts: Partial<Record<PlayerId, Layout>>, attacker: string, target = "leader", leaders: Partial<Record<PlayerId, string>> = {}): PinnedMatch {
  const m = stage(opening, layouts);
  const atk = (m.state.prompt as { player: PlayerId }).player;
  const def: PlayerId = atk === "p1" ? "p2" : "p1";
  // Re-face a Leader (p2's is "C-L-PUMP", whose battle activation a scenario may not want).
  for (const [p, cardId] of Object.entries(leaders) as [PlayerId, string][]) m.state.cards[(m.state.sides[p].zones as Record<string, string[]>).leader[0]].cardId = cardId;
  const zones = (p: PlayerId) => m.state.sides[p].zones as Record<string, string[]>;
  const attackerId = attacker === "leader" ? zones(atk).leader[0] : zones(atk).battle.find((id) => m.state.cards[id].cardId === attacker);
  const targetId = target === "leader" ? zones(def).leader[0] : zones(def).battle.find((id) => m.state.cards[id].cardId === target);
  const attack = legalMoves(m).find((l) => l.action.type === "attack" && (l.action as { attacker: string }).attacker === attackerId && (l.action as { target: string }).target === targetId);
  if (!attack) throw new Error(`battleAt: no attack ${attacker} -> ${target} is offered (${legalMoves(m).map((l) => l.label).join("; ")})`);
  return applyMove(m, attack.action).match;
}
