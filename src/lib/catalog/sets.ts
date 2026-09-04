/**
 * Set metadata keyed by card-number prefix. The catalog source only carries
 * the prefix ("BT18"), so display names live here; release dates are filled in
 * from tcgcsv group data during the price sync when we don't know them.
 *
 * "Masters" is Bandai's current line (BT26 "Ultimate Advent", Oct 2024, onward).
 * Everything before is "legacy". **Fusion World** is a separate game rather
 * than another line of this one, so all of its sets carry the single line
 * "fusion"; what tells the two games apart is `gameOfSetCode`, not the line.
 *
 * No prefix is shared between the games — Fusion World uses FB/FS/FP/SB/ST/E,
 * the original game uses BT/EX/SD/TB/EB/DB/XD/P — so a card number on its own
 * says which game a card belongs to.
 */
import { DEFAULT_GAME, type Game } from "./games";

export type SetLine = "legacy" | "masters" | "fusion";

const MASTERS_FROM_BT = 26;
const MASTERS_FROM_DATE = "2024-10-01";

const BT: Record<number, string> = {
  1: "Galactic Battle",
  2: "Union Force",
  3: "Cross Worlds",
  4: "Colossal Warfare",
  5: "Miraculous Revival",
  6: "Destroyer Kings",
  7: "Assault of the Saiyans",
  8: "Malicious Machinations",
  9: "Universal Onslaught",
  10: "Rise of the Unison Warrior",
  11: "Vermilion Bloodline",
  12: "Vicious Rejuvenation",
  13: "Supreme Rivalry",
  14: "Cross Spirits",
  15: "Saiyan Showdown",
  16: "Realm of the Gods",
  17: "Ultimate Squad",
  18: "Dawn of the Z-Legends",
  19: "Fighter's Ambition",
  20: "Power Absorbed",
  21: "Wild Resurgence",
  22: "Critical Blow",
  23: "Perfect Combination",
  24: "Beyond Generations",
  25: "Legend of the Dragon Balls",
  26: "Ultimate Advent",
  27: "History of Z",
  28: "Prismatic Clash",
  29: "Fearsome Rivals",
  30: "Three Glorious Fighters",
  31: "Impact Beyond Dimensions",
  32: "Chromatic Ascension",
};

const EX: Record<number, string> = {
  1: "Mighty Heroes",
  2: "Dark Demon's Villains",
  3: "Ultimate Box",
  4: "Unity of Saiyans",
  5: "Unity of Destruction",
  6: "Special Anniversary Set",
  7: "Magnificent Collection – Fusion Hero",
  8: "Magnificent Collection – Forsaken Warrior",
  9: "Saiyan Surge",
  10: "Namekian Surge",
  11: "Universe 7 Unison",
  12: "Universe 11 Unison",
  13: "Special Anniversary Set 2020",
  14: "Battle Advanced",
  15: "Battle Enhanced",
  16: "Ultimate Deck",
  17: "Saiyan Boost",
  18: "Namekian Boost",
  19: "Special Anniversary Set 2021",
  20: "Ultimate Deck 2022",
  21: "5th Anniversary Set",
  22: "Ultimate Deck 2023",
  23: "Premium Anniversary Box 2023",
  24: "Premium 7th Anniversary Box 2024",
  25: "Premium Anniversary Box 2025",
};

const SD: Record<number, string> = {
  1: "The Awakening",
  2: "The Extreme Evolution",
  3: "The Dark Invasion",
  4: "The Guardian of Namekians",
  5: "The Crimson Saiyan",
  6: "Resurrected Fusion",
  7: "Shenron's Advent",
  8: "Rising Broly",
  9: "Saiyan Legacy",
  10: "Namekian Surge",
  11: "Instinct Surpassed",
  12: "Spirit of Potara",
  13: "Clan Collusion",
  14: "Saiyan Wonder",
  15: "Pride of the Saiyans",
  16: "Wrath of Beerus",
  17: "Divine Warriors",
  18: "Frieza's Empire",
  19: "The Realm of Gods",
  20: "The Ultimate Deck",
  21: "Rising Fist",
  22: "Universe 7 Champion",
  23: "Grand Final",
};

const FIXED: Record<string, string> = {
  TB1: "Tournament of Power",
  TB2: "World Martial Arts Tournament",
  TB3: "Clash of Fates",
  EB1: "Battle Evolution Booster",
  DB1: "Draft Box 04 – Dragon Brawl",
  DB2: "Draft Box 05 – Divine Multiverse",
  DB3: "Draft Box 06 – Giant Force",
  XD1: "Expert Deck 01",
  XD2: "Expert Deck 02",
  XD3: "Expert Deck 03",
  P: "Promotion Cards",
  TOKEN: "Tokens",
};

// ── Fusion World ───────────────────────────────────────────────────────────

/** FB = booster. Names as TCGplayer publishes them (category 80 groups). */
const FB: Record<number, string> = {
  1: "Awakened Pulse",
  2: "Blazing Aura",
  3: "Raging Roar",
  4: "Ultra Limit",
  5: "New Adventure",
  6: "Rivals Clash",
  7: "Wish For Shenron",
  8: "Saiyan's Pride",
  9: "Dual Evolution",
  10: "Cross Force",
  11: "Brightness of Hope",
  12: "Reach the God",
};

/** FS = starter deck; FS11 and FS12 are the "Starter Deck EX" pair. */
const FS: Record<number, string> = {
  1: "Son Goku",
  2: "Vegeta",
  3: "Broly",
  4: "Frieza",
  5: "Bardock",
  6: "Son Goku (Mini)",
  7: "Vegeta (Mini)",
  8: "Vegeta (Mini) Super Saiyan 3",
  9: "Shallot",
  10: "Giblet",
  11: "EX: The Phase of Evolution",
  12: "EX: The Beat of Ki",
};

const FIXED_FUSION: Record<string, string> = {
  SB01: "Manga Booster 01",
  SB02: "Manga Booster 02",
  ST01: "Story Booster 01",
  FP: "Promotion Cards",
  // Energy Markers are game pieces rather than deck cards, and Bandai has
  // numbered them four different ways across the sets.
  E: "Energy Markers",
  E01: "Energy Markers 01",
  E02: "Energy Markers 02",
  E03: "Energy Markers 03",
};

const FUSION_FAMILIES = ["FB", "FS", "SB", "ST", "FP", "E"];

/**
 * Which game a set code belongs to. The two games' prefixes are disjoint, so
 * this is a lookup rather than a guess — but "E01" has to be matched whole
 * before it is read as the "E" family plus a number.
 */
export function gameOfSetCode(code: string): Game {
  if (FIXED_FUSION[code]) return "fusion";
  const { family } = splitCode(code);
  return FUSION_FAMILIES.includes(family) ? "fusion" : DEFAULT_GAME;
}

export function gameOfNumber(cardNumber: string): Game {
  return gameOfSetCode(setCodeOfNumber(cardNumber));
}

/**
 * Sort order: series family first, then number. Newest boosters come last.
 *
 * Fusion World's families sit *before* the original game's, so that in the
 * highest-key-first order the set pickers use the original game's sets still
 * come first and Fusion World's follow — the default view is both games at
 * once, and the owner's collection is overwhelmingly the older game.
 */
const FAMILY_ORDER = [...FUSION_FAMILIES, "BT", "TB", "EB", "DB", "XD", "SD", "EX", "P", "TOKEN"];

function splitCode(code: string): { family: string; num: number } {
  const m = /^([A-Z]+)(\d+)?$/.exec(code);
  if (!m) return { family: code, num: 0 };
  return { family: m[1], num: m[2] ? Number(m[2]) : 0 };
}

export function setNameFor(code: string): string {
  if (FIXED[code]) return FIXED[code];
  if (FIXED_FUSION[code]) return FIXED_FUSION[code];
  const { family, num } = splitCode(code);
  if (family === "BT" && BT[num]) return `${BT[num]} (BT${num})`;
  if (family === "EX") return `Expansion Set ${String(num).padStart(2, "0")}${EX[num] ? ` – ${EX[num]}` : ""}`;
  if (family === "SD") return `Starter Deck ${String(num).padStart(2, "0")}${SD[num] ? ` – ${SD[num]}` : ""}`;
  if (family === "FB") return `${FB[num] ?? `Booster ${num}`} (FB${String(num).padStart(2, "0")})`;
  if (family === "FS") return `Starter Deck ${String(num).padStart(2, "0")}${FS[num] ? ` – ${FS[num]}` : ""}`;
  return code;
}

export function setSortKey(code: string): number {
  const { family, num } = splitCode(code);
  const fam = FAMILY_ORDER.indexOf(family);
  return (fam < 0 ? FAMILY_ORDER.length : fam) * 1000 + num;
}

export function setLineFor(code: string, releasedOn: string | null): SetLine {
  // Fusion World has only ever had the one line, so its sets are never split.
  if (gameOfSetCode(code) === "fusion") return "fusion";
  const { family, num } = splitCode(code);
  if (family === "BT") return num >= MASTERS_FROM_BT ? "masters" : "legacy";
  if (releasedOn && releasedOn >= MASTERS_FROM_DATE) return "masters";
  return "legacy";
}

/**
 * The line holding a game's *current* cards — what the AI pools mean by "worth
 * buying today", as opposed to the whole back catalogue.
 */
export function currentLineFor(game: Game): SetLine {
  return game === "fusion" ? "fusion" : "masters";
}

/** "BT18-020" → "BT18"; "T_CLO_01" → "TOKEN"; "P-181" → "P". */
export function setCodeOfNumber(cardNumber: string): string {
  if (cardNumber.startsWith("T_")) return "TOKEN";
  return cardNumber.split("-")[0];
}
