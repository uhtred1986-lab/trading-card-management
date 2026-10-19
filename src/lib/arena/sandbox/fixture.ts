/**
 * Synthetic cards for the sandbox's development preview and its verify case:
 * no catalog, no database. The rule is written as the builder's source text
 * and read with `parseRule`, which is what fills in the typed `usage` and
 * `validity` records the engine insists on (#907).
 */
import { parseRule, type Rule } from "../lang";
import type { CardDef } from "../types";
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
