/**
 * Synthetic cards for the sandbox's development preview and its verify case:
 * no catalog, no database. The rule is written as the builder's source text
 * and read with `parseRule`, which is what fills in the typed `usage` and
 * `validity` records the engine insists on (#907).
 */
import { parseRule, type Rule } from "../lang";
import type { CardDef } from "../types";
import type { SetupCardHit } from "./setup";
import { unlimitedUsage } from "../vm/usage";
import { noSparking } from "../vm/validity";

const base: Omit<CardDef, "id" | "name" | "skill" | "characters"> = {
  type: "BATTLE",
  colors: ["Blue"],
  energyCost: 2,
  zEnergyCost: null,
  power: 15000,
  comboCost: 1,
  comboPower: 5000,
  traits: [],
};

const CARDS: Record<string, CardDef> = {
  draw: { ...base, id: "SANDBOX-001", name: "Tidecaller Oracle", skill: "[Auto] When this card attacks, draw 1 card.", characters: ["Tidecaller Oracle"] },
  ko: { ...base, id: "SANDBOX-002", name: "Frost Sigil", skill: "[Activate: Main] Choose 1 of your opponent's Battle Cards and KO it.", characters: ["Frost Sigil"] },
};

/** The saved rule of each fixture card, as the builder's text. */
export const FIXTURE_SOURCE: Record<string, string> = {
  draw: "WHEN [auto] attacks\nTHEN\n  draw(n: 1)",
  ko: 'WHEN [activate:main]\nTHEN\n  choose(sel: 1 "battle card" IN opponent.battle, as: "t")\n  ko(target: $t)',
};

export const FIXTURES = Object.keys(CARDS);
export const fixtureCard = (name: string): CardDef => structuredClone(CARDS[name] ?? CARDS.draw);
/** A rule from the builder's text, with the typed records a saved row always carries. */
export function ruleFromSource(source: string): Rule {
  const parsed = parseRule(source);
  if (!parsed.ok) throw new Error(`${parsed.error.message}\n${source}`);
  return { ...parsed.value, usage: unlimitedUsage(), validity: noSparking() };
}
export const fixtureRule = (name: string): Rule => ruleFromSource(FIXTURE_SOURCE[name] ?? FIXTURE_SOURCE.draw);

// ── the cards "Set up the board" can offer in the development preview (no catalog, no database) ──

const SETUP_CARDS: Record<string, CardDef> = {
  "FIX-LEADER-GREEN": { ...base, id: "FIX-LEADER-GREEN", name: "Frieza, Green Tyrant", type: "LEADER", colors: ["Green"], energyCost: null, comboCost: null, comboPower: null, power: 20000, skill: null, characters: ["Frieza"], traits: ["Frieza's Army"] },
  "FIX-LEADER-RED": { ...base, id: "FIX-LEADER-RED", name: "Son Goku, Red Hero", type: "LEADER", colors: ["Red"], energyCost: null, comboCost: null, comboPower: null, power: 20000, skill: null, characters: ["Son Goku"], traits: ["Saiyan"] },
  "FIX-BROLY-6": { ...base, id: "FIX-BROLY-6", name: "Broly, Green Fury", colors: ["Green"], energyCost: 6, power: 30000, skill: null, characters: ["Broly: Br"], traits: [] },
  "FIX-BATTLE-2": { ...base, id: "FIX-BATTLE-2", name: "Plain Fighter", colors: ["Green"], energyCost: 2, power: 15000, skill: null, characters: ["Plain Fighter"], traits: [] },
};
export const fixtureSetupDefs = (): Record<string, CardDef> => structuredClone(SETUP_CARDS);
export function searchFixtureCards(query: string, leadersOnly: boolean): SetupCardHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return Object.values(SETUP_CARDS)
    .filter((c) => (!leadersOnly || c.type === "LEADER") && (c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)))
    .map((c) => ({ id: c.id, name: c.name, type: c.type, colors: c.colors, cost: c.energyCost == null ? null : String(c.energyCost) }));
}
