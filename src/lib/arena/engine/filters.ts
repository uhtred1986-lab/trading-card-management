/**
 * Card-description text → predicate. Keyword conditions on cards name their
 * targets in a fixed grammar ("Blue <Baby> with an energy cost of 4",
 * "yellow non-≪Great Ape≫ <Son Goku: Childhood> card with an energy cost of 3
 * or less", "1 {Four-Star Ball, Parasitic Darkness}"). Reading that grammar
 * lets the engine offer the right candidates for Evolve, Union, Z-Stack,
 * Z-Awaken and Swap without a compiled script.
 */
import { baseType, hasCharacter, hasTrait } from "./cards";
import type { CardDef, Color } from "./types";

export interface CardFilter {
  colors: Color[];
  monoColor: boolean;
  /** "Multicolor <Pan> cards": two colours or more, which is not the opposite of mono-colour on a colourless card. */
  multiColor: boolean;
  characters: string[];
  notCharacters: string[];
  traits: string[];
  notTraits: string[];
  names: string[];
  type: "LEADER" | "BATTLE" | "EXTRA" | "UNISON" | null;
  /** "Non-Leader card under this card" — the type it must *not* be. */
  notType: "LEADER" | "BATTLE" | "EXTRA" | "UNISON" | null;
  /** Energy cost bounds, inclusive. */
  costMin: number | null;
  costMax: number | null;
  powerMin: number | null;
  powerMax: number | null;
  /**
   * "with power less than or equal to this card's power" — a bound read off
   * the card whose skill this is, so it is applied where the skill runs
   * (`resolveSelector`), not here.
   */
  powerRel: { of: "self"; cmp: "<=" | "<" | ">=" | ">" } | null;
  z: boolean | null;
}

const COLOR_WORDS: Record<string, Color> = { red: "Red", blue: "Blue", green: "Green", yellow: "Yellow", black: "Black" };

export function parseFilter(text: string): CardFilter {
  const f: CardFilter = { colors: [], monoColor: false, multiColor: false, characters: [], notCharacters: [], traits: [], notTraits: [], names: [], type: null, notType: null, costMin: null, costMax: null, powerMin: null, powerMax: null, powerRel: null, z: null };
  const t = text.replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  for (const m of t.matchAll(/(non-)?<([^>]+)>/g)) (m[1] ? f.notCharacters : f.characters).push(m[2].trim());
  for (const m of t.matchAll(/(non-)?≪([^≫]+)≫/g)) (m[1] ? f.notTraits : f.traits).push(m[2].trim());
  for (const m of t.matchAll(/\{([^}]+)\}/g)) if (!/^[rugyk]$|^\d+$/i.test(m[1])) f.names.push(m[1].trim());
  const lower = t.toLowerCase();
  if (/\bmono-?colou?r\b|\bmono-(red|blue|green|yellow|black)\b/.test(lower)) f.monoColor = true;
  if (/\bmulti-?colou?r(?:ed)?\b/.test(lower)) f.multiColor = true;
  for (const m of lower.matchAll(/\b(red|blue|green|yellow|black)\b/g)) {
    const c = COLOR_WORDS[m[1]];
    if (!f.colors.includes(c)) f.colors.push(c);
  }
  if (/\bz-(leader|battle|extra|unison)\b|\bz-card\b/.test(lower)) f.z = true;
  // "Non-Leader card" is the type it must not be, and reading it as the type
  // itself inverted the filter — a stack of "non-Leader cards" became Leaders.
  const typeWord = (re: RegExp): "yes" | "no" | null => (new RegExp(`non-${re.source}`).test(lower) ? "no" : re.test(lower) ? "yes" : null);
  for (const [re, type] of [
    [/\bleader( card)?\b/, "LEADER"],
    [/\bunison( card)?\b/, "UNISON"],
    [/\bextra( card)?\b/, "EXTRA"],
    [/\bbattle card\b/, "BATTLE"],
  ] as const) {
    const said = typeWord(re);
    if (said === "no") f.notType ??= type;
    else if (said === "yes" && !f.type) f.type = type;
  }
  let m: RegExpExecArray | null;
  if ((m = /energy cost (?:of )?(\d+) or less/.exec(lower))) f.costMax = Number(m[1]);
  else if ((m = /energy cost (?:of )?(\d+) or more/.exec(lower))) f.costMin = Number(m[1]);
  else if ((m = /energy cost (?:of )?between (\d+) and (\d+)/.exec(lower))) {
    f.costMin = Number(m[1]);
    f.costMax = Number(m[2]);
  } else if ((m = /energy cost (?:of )?(\d+)\b/.exec(lower))) f.costMin = f.costMax = Number(m[1]);
  if ((m = /(\d+) power or less/.exec(lower))) f.powerMax = Number(m[1]);
  else if ((m = /(\d+) power or more/.exec(lower))) f.powerMin = Number(m[1]);
  // An exact power, which searches print alongside the cost: "a yellow
  // <Son Goku> card with an energy cost of 3 and 5000 power". Only after
  // "with"/"and", so that "it gets +5000 power for the turn" is not read as a
  // bound on the target.
  else if ((m = /\b(?:with|and) (\d+) power\b/.exec(lower))) f.powerMin = f.powerMax = Number(m[1]);
  // "with power less than or equal to this card's power", "with power greater
  // than this card's power" — measured against the card the skill is on.
  if ((m = /power (less than or equal to|equal to or less than|no more than|at or below|less than|lower than|greater than or equal to|equal to or greater than|no less than|at or above|greater than|higher than|more than) (?:this card'?s|its) power/.exec(lower))) {
    const w = m[1];
    const cmp = /^(?:less than or equal|equal to or less|no more|at or below)/.test(w) ? "<=" : /^(?:less|lower)/.test(w) ? "<" : /^(?:greater than or equal|equal to or greater|no less|at or above)/.test(w) ? ">=" : ">";
    f.powerRel = { of: "self", cmp };
  }
  return f;
}

/** The relative power bound, given the power of the card the skill is on. */
export function powerRelOk(f: CardFilter, power: number, own: number): boolean {
  if (!f.powerRel) return true;
  switch (f.powerRel.cmp) {
    case "<=":
      return power <= own;
    case "<":
      return power < own;
    case ">=":
      return power >= own;
    case ">":
      return power > own;
  }
}

export function matches(d: CardDef, f: CardFilter): boolean {
  if (f.z != null && d.type.startsWith("Z-") !== f.z) return false;
  if (f.type && baseType(d) !== f.type) return false;
  if (f.notType && baseType(d) === f.notType) return false;
  if (f.colors.length && !f.colors.every((c) => d.colors.includes(c))) return false;
  if (f.monoColor && d.colors.length !== 1) return false;
  if (f.multiColor && d.colors.length < 2) return false;
  if (f.characters.length && !f.characters.some((c) => hasCharacter(d, c))) return false;
  if (f.notCharacters.some((c) => hasCharacter(d, c))) return false;
  if (f.traits.length && !f.traits.some((c) => hasTrait(d, c))) return false;
  if (f.notTraits.some((c) => hasTrait(d, c))) return false;
  if (f.names.length && !f.names.some((n) => n.toLowerCase() === d.name.toLowerCase())) return false;
  const cost = typeof d.energyCost === "number" ? d.energyCost : null;
  if (f.costMin != null && (cost == null || cost < f.costMin)) return false;
  if (f.costMax != null && (cost == null || cost > f.costMax)) return false;
  if (f.powerMin != null && (d.power == null || d.power < f.powerMin)) return false;
  if (f.powerMax != null && (d.power == null || d.power > f.powerMax)) return false;
  return true;
}

/** "When your life is at 4 or less" and friends — the conditions Awaken/Wish print most often. */
export interface SimpleCondition {
  lifeAtMost: number | null;
  opponentLifeAtMost: number | null;
  energyAtLeast: number | null;
  totalEnergyAtLeast: number | null;
  dropAtLeast: number | null;
  /** Parsed something the engine can check; false = leave to a script / the referee. */
  recognised: boolean;
}

export function parseCondition(text: string): SimpleCondition {
  const c: SimpleCondition = { lifeAtMost: null, opponentLifeAtMost: null, energyAtLeast: null, totalEnergyAtLeast: null, dropAtLeast: null, recognised: false };
  const t = text.toLowerCase();
  let m: RegExpExecArray | null;
  if ((m = /your opponent'?s life is (?:at )?(\d+) or less/.exec(t))) {
    c.opponentLifeAtMost = Number(m[1]);
    c.recognised = true;
  }
  if ((m = /(?<!opponent'?s )(?:your )?life is (?:at )?(\d+) or less/.exec(t))) {
    c.lifeAtMost = Number(m[1]);
    c.recognised = true;
  }
  if ((m = /total of (\d+) or more energy between you and your opponent/.exec(t))) {
    c.totalEnergyAtLeast = Number(m[1]);
    c.recognised = true;
  }
  if ((m = /you have (\d+) or more energy/.exec(t))) {
    c.energyAtLeast = Number(m[1]);
    c.recognised = true;
  }
  if ((m = /(\d+) or more cards in your drop/.exec(t))) {
    c.dropAtLeast = Number(m[1]);
    c.recognised = true;
  }
  // Conditions with a further clause ("and you have a Blue/Green card in your energy") are only partly read.
  if (c.recognised && /\band\b|\bwhen you have\b.*\bin your energy\b/.test(t) && !c.totalEnergyAtLeast) c.recognised = false;
  return c;
}
