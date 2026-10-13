/**
 * Fixed catalog-filter outcomes for #459. The corpus order freezes the exact
 * 98 printed fixture rows: changing a row or adding a new one requires review.
 * Each field below names the complete matching set (`only`) or its complete
 * complement (`except`); omitted rows are thereby asserted too. These sets
 * were reviewed against the card declarations in verify/harness.ts, the eight
 * extra printed rows in vm.ts, and each FILTER_SAMPLES phrase there.
 */
import type { CardFilter } from "../../src/lib/arena/text/filters";

export const FILTER_CORPUS_459 = `
  L-RED L-BLUE V1 V-BLUE BLOCKER BERGAMO CRIT DOUBLE DUAL INDESTRUCT
  REVENGE BIG UNIQ E-NEGATE E-DRAW U1 ZB ZCHEAP EVO SWAPPER
  COST3 DRAWER KILLER PUMP SPAWN MYSTERY FLIPPER LIFEWATCH BLUEWATCH LIFEGIVER
  FORCEKILL AUTOCOST UNI2 XBAT AURA CHEAP ODDAURA DELAYKO DELAYDRAW DELAYOPP
  LOCKDOWN RESTLOCK NOCOPIES TOUGH STACKER MILLGATE BUUHOST BUUEAT TWOKILL GRABBER
  ONCEONLY STEALER PERMTOUGH PERMLOCK SELFMUTE BECOMES RECOLOR RECOLORED SAIYANKILL RENAMED
  CHEAPCOMBO BLUECOMBO CHEAPENER ONLYONE RESTCOND FREEPLAY EXILE MAYWARP EARTHWARP WARPER
  E-STOP E-LIFE MODAL SEARCH ONCE LIMITED2 PUMPCRIT INERTPERM WALL E-CC
  MUTEAUTO E-MYSTERY XDRAW XMARKERS XENERGY ATK-LEADER CHARGELOCK STANDALL COMBOBACK ATK-BATTLE
  TRAITED RENAMED+alsoNames TOK ZED RAINBOW MUTE COMBO10K NOCOMBO
`.trim().split(/\s+/);

type FixedSet = { only: string[] } | { except: string[] };
export const FILTER_MATCHES_459: Record<keyof CardFilter, FixedSet> = {
  // Printed colours: blue rows and the one red/blue row; RECOLORED is yellow.
  colors: { only: ["L-BLUE", "V-BLUE", "BLUECOMBO", "RAINBOW"] },
  originalColors: { only: ["L-BLUE", "V-BLUE", "BLUECOMBO", "RAINBOW"] },
  notColors: { only: ["L-BLUE", "V-BLUE", "RECOLORED", "BLUECOMBO"] },
  monoColor: { except: ["RAINBOW"] },
  multiColor: { only: ["RAINBOW"] },
  // Printed character/trait/name strings, including the second RENAMED row.
  characters: { only: ["V1"] },
  notCharacters: { except: ["V1"] },
  charactersIncluding: { only: ["BLOCKER"] },
  notCharactersIncluding: { except: ["BLOCKER"] },
  traits: { only: ["TRAITED"] },
  notTraits: { except: ["TRAITED"] },
  characterOrTrait: { only: ["V1", "TRAITED"] },
  anyOf: { only: ["V1", "V-BLUE"] },
  onlyCharacters: { only: ["V1"] },
  names: { only: ["BIG"] },
  notNames: { except: ["BIG"] },
  namesIncluding: { only: ["CRIT", "PUMPCRIT"] },
  notNamesIncluding: { except: ["CRIT", "PUMPCRIT"] },
  // BLOCKER is the sampled keyword; noKeywords excludes every printed tag.
  keywords: { only: ["BLOCKER", "BERGAMO", "U1", "SELFMUTE"] },
  notKeywords: { except: ["BLOCKER", "BERGAMO", "U1", "SELFMUTE"] },
  // BATTLE includes Z-BATTLE and TOKEN here; LEADER, EXTRA and UNISON are
  // excluded by the sampled type. The activate kind follows printed lines.
  type: { except: ["L-RED", "L-BLUE", "E-NEGATE", "E-DRAW", "U1", "UNI2", "E-STOP", "E-LIFE", "E-CC", "E-MYSTERY"] },
  notType: { except: ["L-RED", "L-BLUE"] },
  skillKind: { only: ["E-DRAW", "PUMP", "UNI2", "ONCE", "LIMITED2", "PUMPCRIT", "E-MYSTERY", "XDRAW"] },
  unreadable: { except: [] },
  noKeywords: { except: ["L-RED", "BLOCKER", "BERGAMO", "CRIT", "DOUBLE", "DUAL", "INDESTRUCT", "REVENGE", "UNIQ", "U1", "ZB", "EVO", "SWAPPER", "SELFMUTE", "WALL"] },
  // Three flags are deferred on catalog rows, so the sampled predicates accept
  // each row; board-level selector behavior has its own checks in vm.ts.
  faceUp: { except: [] },
  token: { only: ["TOK"] },
  notToken: { except: ["TOK"] },
  // Numeric bounds are the printed energy/power/combo numbers. Null and X
  // never satisfy a bound. The two original-power lists equal printed power
  // on this unflipped, effect-free corpus; §26 covers their board divergence.
  costMin: { only: ["BLOCKER", "BERGAMO", "CRIT", "DOUBLE", "DUAL", "INDESTRUCT", "REVENGE", "BIG", "ZB", "ZCHEAP", "EVO", "SWAPPER", "COST3", "CHEAP", "TOUGH", "PERMTOUGH", "PERMLOCK", "SELFMUTE", "BECOMES", "RECOLOR", "RENAMED", "CHEAPCOMBO", "BLUECOMBO", "FREEPLAY", "EXILE", "MAYWARP", "EARTHWARP", "WARPER", "E-LIFE", "COMBOBACK", "RAINBOW"] },
  costMax: { except: ["L-RED", "L-BLUE", "CRIT", "DOUBLE", "DUAL", "BIG", "U1", "EVO", "COST3", "UNI2", "XBAT", "CHEAP", "CHEAPCOMBO", "BLUECOMBO", "E-LIFE", "COMBOBACK", "RAINBOW"] },
  powerMin: { only: ["BERGAMO", "CRIT", "DOUBLE", "DUAL", "BIG", "ZB", "ZCHEAP", "EVO", "SWAPPER", "COST3", "RAINBOW"] },
  powerMax: { except: ["BERGAMO", "CRIT", "DOUBLE", "DUAL", "BIG", "E-NEGATE", "E-DRAW", "ZB", "ZCHEAP", "EVO", "SWAPPER", "COST3", "E-STOP", "E-LIFE", "E-CC", "E-MYSTERY", "RAINBOW"] },
  originalPowerMin: { only: ["BERGAMO", "CRIT", "DOUBLE", "DUAL", "BIG", "ZB", "ZCHEAP", "EVO", "SWAPPER", "COST3", "RAINBOW"] },
  originalPowerMax: { except: ["BERGAMO", "CRIT", "DOUBLE", "DUAL", "BIG", "E-NEGATE", "E-DRAW", "ZB", "ZCHEAP", "EVO", "SWAPPER", "COST3", "E-STOP", "E-LIFE", "E-CC", "E-MYSTERY", "RAINBOW"] },
  comboPowerMin: { except: ["L-RED", "L-BLUE", "E-NEGATE", "E-DRAW", "U1", "ZB", "ZCHEAP", "UNI2", "E-STOP", "E-LIFE", "E-CC", "E-MYSTERY", "NOCOMBO"] },
  comboPowerMax: { except: ["L-RED", "L-BLUE", "BLOCKER", "E-NEGATE", "E-DRAW", "U1", "ZB", "ZCHEAP", "UNI2", "E-STOP", "E-LIFE", "E-CC", "E-MYSTERY", "COMBO10K", "NOCOMBO"] },
  // Markers (13-2, #721) sit on a copy in play; the sampled definitions carry none, so a floor of
  // one matches nothing and a ceiling matches every card. The board-level checks are in readings.ts.
  markersMin: { only: [] },
  markersMax: { except: [] },
  originallySkillLess: { only: ["L-BLUE", "V1", "V-BLUE", "BIG", "COST3", "XBAT", "BUUHOST", "RECOLORED", "BLUECOMBO", "TRAITED", "RENAMED+alsoNames", "TOK", "ZED", "RAINBOW", "MUTE", "COMBO10K", "NOCOMBO"] },
  skillLess: { only: ["L-BLUE", "V1", "V-BLUE", "BIG", "COST3", "XBAT", "BUUHOST", "RECOLORED", "BLUECOMBO", "TRAITED", "RENAMED+alsoNames", "TOK", "ZED", "RAINBOW", "MUTE", "COMBO10K", "NOCOMBO"] },
  powerRel: { except: [] },
  z: { only: ["ZB", "ZCHEAP", "ZED"] },
};

export function fixedFilterMatch459(field: keyof CardFilter, card: string): boolean {
  const expected = FILTER_MATCHES_459[field];
  return "only" in expected ? expected.only.includes(card) : !expected.except.includes(card);
}
