/**
 * #650: a pinned bundle for the constrained-choice policy's named scenarios — synthetic cards whose
 * printed lines open each constrained question on the rules engine: an optional and a required
 * multi-card KO, a hand discard, a life-to-hand "may", a priced Auto (pay or decline), a "choose one"
 * of two printed modes, [Offering] (asked of the opponent), two simultaneous Autos (order), a
 * life-card replacement (to the hand instead of the Drop), a KO replacement with a substitute
 * ("discard instead"), and two Unisons for [Empower] — plus the main fixture's `stage` to lay them
 * out. Synthetic cards (not catalog cards), the compiler's own rules, the shipped DBS ruleset, no
 * database: built like `arena-policy-main-fixture.ts`.
 */
import type { CardDef, DeckInput } from "../../src/lib/arena/types";
import type { CardScripts } from "../../src/lib/arena/vm/script";
import type { CardArt } from "../../src/lib/arena/view";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { DBS_FILES } from "../../src/lib/arena/rulesets/dbs";
import { makeReplayBundle, type ReplayBundleRecord } from "../../src/lib/arena/replay-core";
import type { PinnedMatch } from "../../src/lib/arena/browser";
import { mainPhaseMatch } from "./arena-policy-main-fixture";

export const CHOICES_FIXTURE_REVISION = "a650000000000000000000000000000000000650";
export const CHOICES_FIXTURE_SEED = 650;

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

export const CHOICE_CARDS: CardDef[] = [
  card("Q-L", { type: "LEADER", energyCost: null, comboCost: null, comboPower: null }),
  card("Q-V", { energyCost: 1, power: 10000 }),
  card("Q-V2", { energyCost: 2, power: 15000 }),
  card("Q-B", { colors: ["Blue"], energyCost: 1, power: 10000 }),
  card("Q-SMALL", { energyCost: 1, power: 5000 }),
  card("Q-BIG", { energyCost: 3, power: 25000 }),
  card("Q-BLOCK", { energyCost: 2, power: 15000, skill: "[Blocker]" }),
  card("Q-CRIT", { energyCost: 3, power: 15000, skill: "[Critical]" }),
  /** An optional single target: "choose up to 1" (an empty pick declines). */
  card("Q-KILL1", { energyCost: 1, skill: "[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards and KO it." }),
  /** A required multi-selection: exactly two. */
  card("Q-KILL2", { energyCost: 1, skill: "[Auto] When you play this card, choose 2 of your opponent's Battle Cards and KO them." }),
  /** A required pick from the seat's own cards that costs it. */
  card("Q-DISCARD", { energyCost: 1, skill: "[Auto] When you play this card, draw 2 cards. Then, choose 2 cards from your hand and place them in your Drop Area." }),
  /** "You may" a Life card to the hand. */
  card("Q-LIFE", { energyCost: 1, skill: "[Auto] When you play this card, you may choose 1 card in your life and add it to your hand." }),
  /** An Auto with a hand-card price: pay or decline. */
  card("Q-PRICED", { energyCost: 1, skill: "[Auto] Choose 1 card in your hand and place it in your Drop Area : When you play this card, draw 2 cards." }),
  /** Two printed modes. */
  card("Q-MODES", { energyCost: 1, skill: "[Auto] When you play this card, choose one—<br>・Draw 1 card.<br>・Choose up to 1 of your opponent's Battle Cards and KO it." }),
  card("Q-OFFER", { energyCost: 2, power: 15000, skill: "[Offering]" }),
  /** Two Autos at one moment: the order question. */
  card("Q-DRAW", { energyCost: 1, skill: "[Auto] When you play this card, draw 1 card." }),
  card("Q-WATCH", { energyCost: 1, skill: "[Auto] When you play a Battle Card, draw 1 card." }),
  /** 9-10 life replacement (BT10-031's shape): asked of the affected player. */
  card("Q-REVEAL", { energyCost: 1, skill: "[Permanent] During your opponent's turn, if you would add a card from your life to your hand or place it in your Drop Area, you may reveal it and add it to your hand instead." }),
  /** A KO replacement with a substitute ("discard instead"). */
  card("Q-PILEOFF", { energyCost: 2, power: 5000, skill: "[Permanent] If this card would be removed from your Battle Area by an opponent's skill or KO'd, you may choose 1 card in your hand and discard it instead." }),
  card("Q-UNI", { type: "UNISON", energyCost: "X", power: 5000, comboCost: null, comboPower: null }),
  card("Q-EMP", { type: "UNISON", energyCost: "X", power: 10000, comboCost: null, comboPower: null, skill: "[Empower Red 2]" }),
];

const repeat = (counts: Record<string, number>) => Object.entries(counts).flatMap(([id, n]) => Array.from({ length: n }, () => id));

export const CHOICES_FIXTURE_DECKS: { p1: DeckInput; p2: DeckInput } = {
  p1: { name: "Chooser", leader: "Q-L", main: repeat({ "Q-V": 6, "Q-V2": 2, "Q-B": 2, "Q-SMALL": 6, "Q-BIG": 4, "Q-KILL1": 4, "Q-KILL2": 2, "Q-DISCARD": 2, "Q-LIFE": 2, "Q-PRICED": 2, "Q-MODES": 4, "Q-OFFER": 4, "Q-DRAW": 2, "Q-WATCH": 2, "Q-CRIT": 2, "Q-UNI": 2, "Q-EMP": 2 }) },
  p2: { name: "Answerer", leader: "Q-L", main: repeat({ "Q-V": 6, "Q-SMALL": 6, "Q-BIG": 2, "Q-BLOCK": 4, "Q-KILL1": 4, "Q-REVEAL": 4, "Q-PILEOFF": 4, "Q-OFFER": 4, "Q-MODES": 4, "Q-PRICED": 4, "Q-CRIT": 4, "Q-LIFE": 2, "Q-DISCARD": 2 }) },
};

export async function choicesFixtureBundle(): Promise<ReplayBundleRecord> {
  const defs: Record<string, CardDef> = {};
  for (const c of CHOICE_CARDS) defs[c.id] = c;
  const compiled = rulesFromCompiler(defs);
  const scripts: Record<string, CardScripts> = {};
  for (const c of CHOICE_CARDS) {
    if (!compiled[c.id]?.complete) throw new Error(`choices fixture card ${c.id} did not compile: ${JSON.stringify(compiled[c.id]?.unsupported)}`);
    scripts[c.id] = compiled[c.id];
  }
  const art: Record<string, CardArt> = {};
  for (const c of CHOICE_CARDS) art[c.id] = { front: `/art/${c.id}.png`, back: null };
  const bundle = await makeReplayBundle({ defs, scripts, art, rulesetFiles: DBS_FILES, runtime: CHOICES_FIXTURE_REVISION });
  return JSON.parse(JSON.stringify({ ...bundle, decks: CHOICES_FIXTURE_DECKS })) as ReplayBundleRecord;
}

/** p1's turn-3 Main Phase of the choices fixture game. */
export function choicesMainPhase(bundle: ReplayBundleRecord): Promise<PinnedMatch> {
  return mainPhaseMatch(bundle, CHOICES_FIXTURE_SEED, CHOICES_FIXTURE_REVISION);
}
