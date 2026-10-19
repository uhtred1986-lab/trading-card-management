/**
 * The keyword rules a card review shows (`src/lib/arena/keyword-rules.generated.ts`) are the glossary's and
 * the Rule Manual's current text, and every keyword the card reader draws finds its rule. Part of `npm test`;
 * run from `scripts/verify-arena.ts`. Regenerate with `npx tsx scripts/emit-keyword-rules.ts`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { KEYWORD_RULES_FILE, keywordRulesSource } from "../emit-keyword-rules";
import { keywordRule } from "../../src/components/arena/card-reader-model";
import { KEYWORD_RULES } from "../../src/lib/arena/keyword-rules.generated";

assert.equal(readFileSync(KEYWORD_RULES_FILE, "utf8"), keywordRulesSource(), "keyword-rules.generated.ts is stale: run npx tsx scripts/emit-keyword-rules.ts");

for (const [tag, name] of [
  ["Double Strike", "Strike"], ["Triple Strike", "Strike"], ["Dual Attack", "Attack"], ["Triple Attack", "Attack"],
  ["Evolve", "Evolve"], ["Xeno-Evolve", "Evolve"], ["EX-Evolve", "Evolve"], ["Union-Potara", "Union"],
  ["Over Realm 7", "Over Realm"], ["Dark Over Realm 6", "Over Realm"], ["Awaken", "Awaken"], ["Awaken: Surge", "Awaken"],
  ["Awaken:Surge", "Awaken"], ["Z-Awaken", "Z-Awaken"], ["Blocker", "Blocker"], ["Victory Strike", "Victory Strike"],
  ["Empower Blue 2", "Empower"], ["Spirit Boost 2", "Spirit Boost"], ["Arrival", "Arrival"], ["Energy-Exhaust", "Energy-Exhaust"],
  ["Warrior of Universe 7", "Warrior of Universe 7"], ["Z-Stack 3", "Z-Stack"],
] as const) assert.equal(keywordRule(tag)?.name, name, `${tag} → ${name}`);
for (const tag of ["Auto", "Permanent", "Activate:Main", "Once per turn", "Card text"]) assert.equal(keywordRule(tag), null, `${tag} is not a keyword`);
for (const r of KEYWORD_RULES) assert.ok(r.manual.length > 0, `${r.name}: no Rule Manual text`);

console.log("Keyword rules: generated copy current, every spelling found.");
