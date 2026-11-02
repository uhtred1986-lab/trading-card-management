/**
 * `npm run arena:snapshot -- <out.json>` — one read of the `dbs` catalog and its `card_rules`
 * rows into a JSON file, so audits, intent briefs and the errata check run offline afterwards.
 * The owner's (or an authorised session's) job: it reads the shared database once. The file
 * holds catalog text and stored rules, nothing private; keep it out of the repo (it is large
 * and goes stale with every sync).
 *
 *   { taken, sets: [{code,name,line,releasedOn,sortKey}],
 *     cards: [{id,set,type,colors,cost,specified,z,power,name,characters,traits,eras,keywords,skill,backName,backSkill,hasErrata}],
 *     rules: [{cardId,side,skillIndex,kind,status,source,printed,reads,unread,trigger,reviewFlag}] }
 */
import fs from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { cardRules, cardSets, cards } from "../src/db/schema";

const out = process.argv[2];
if (!out) throw new Error("usage: arena:snapshot -- <out.json>");

const sets = (await db.select().from(cardSets).where(eq(cardSets.game, "dbs"))).map((s) => ({
  code: s.code, name: s.name, line: s.line, releasedOn: s.releasedOn, sortKey: s.sortKey,
}));
const cardRows = (await db.select().from(cards).where(eq(cards.game, "dbs"))).map((c) => ({
  id: c.id, set: c.setCode, type: c.cardType, colors: c.colors, cost: c.energyCost, specified: c.specifiedCost, z: c.zEnergyCost,
  power: c.power, name: c.name, characters: c.characters, traits: c.traits, eras: c.eras, keywords: c.keywords, skill: c.skill,
  backName: c.backName, backSkill: c.backSkill, hasErrata: c.hasErrata,
}));
const ids = new Set(cardRows.map((c) => c.id));
const rules = (await db.select().from(cardRules)).filter((r) => ids.has(r.cardId)).map((r) => ({
  cardId: r.cardId, side: r.side, skillIndex: r.skillIndex, kind: r.kind, status: r.status, source: r.source,
  printed: r.printed, reads: r.reads, unread: r.unread, trigger: r.trigger, reviewFlag: r.reviewFlag,
}));
fs.writeFileSync(out, JSON.stringify({ taken: new Date().toISOString(), sets, cards: cardRows, rules }));
console.log(`arena:snapshot: ${sets.length} sets, ${cardRows.length} cards, ${rules.length} rules → ${out}`);
process.exit(0);
