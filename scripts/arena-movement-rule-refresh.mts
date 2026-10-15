/** Reviewed #825 movement/cleanup rules. Read-only unless --apply is explicitly authorized. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { inArray, sql } from "drizzle-orm";
import { db } from "../src/db/index.ts";
import { cards, cardRules } from "../src/db/schema.ts";
import { rows } from "../src/db/rows.ts";
import { cardDefFrom } from "../src/lib/arena/load.ts";
import { canonical, skillRecords } from "../src/lib/arena/draft.ts";
import { runtimeSupportOfRow } from "../src/lib/arena/rules-store.ts";
import { applyReviewedRefresh, type ReviewedRefresh } from "./lib/reviewed-rule-refresh.ts";

// P-035 remains unread; never include it in this refresh.
const TARGETS = [
  ["BT29-029", "back", 0], ["BT3-112", "front", 10],
  ["BT3-096", "front", 10], ["BT3-098", "front", 10],
  ["BT3-090", "front", 0], ["BT7-040", "front", 10],
  ["BT7-083", "front", 10], ["BT7-086", "front", 10],
] as const;
const [mode, file, ...extra] = process.argv.slice(2);
assert((mode === "--plan" || mode === "--apply") && file && !extra.length, "Usage: --plan FILE | --apply FILE");
assert(process.env.DATABASE_URL, "Explicit app DATABASE_URL required");
assert.equal(rows<{ name: string }>(await db.execute(sql`select to_regclass('public.card_rules')::text as name`))[0]?.name, "card_rules");
const ids = TARGETS.map(([id]) => id);
const catalog = await db.select().from(cards).where(inArray(cards.id, ids));
const stored = await db.select().from(cardRules).where(inArray(cardRules.cardId, ids));
const raw = rows<{ record: Record<string, unknown> }>(await db.execute(sql`select to_jsonb(r) as record from card_rules r where card_id in (${sql.join(ids.map(id => sql`${id}`), sql`,`)})`)).map(row => row.record);
const plan: ReviewedRefresh = { rules: [] };
for (const [cardId, side, skillIndex] of TARGETS) {
  const card = catalog.find(row => row.id === cardId);
  assert(card); assert.equal(card.game, "dbs");
  const old = stored.find(row => row.cardId === cardId && row.side === side && row.skillIndex === skillIndex);
  assert(old, `Missing stored rule ${cardId}/${side}/${skillIndex}`);
  assert.equal(old.source, "compiler", `Preserve owner rule ${cardId}`);
  assert(["open", "draft"].includes(old.status), `Preserve reviewed rule ${cardId}`);
  const fresh = skillRecords(cardDefFrom(card)).find(row => row.side === side && row.skillIndex === skillIndex);
  assert(fresh); assert.equal(fresh.printed, old.printed);
  assert.deepEqual(fresh.unread, []); assert.deepEqual(runtimeSupportOfRow(fresh).unsupported, []);
  plan.rules.push({ before: raw.find(row => row.id === old.id)!, fresh });
}
if (mode === "--plan") {
  fs.writeFileSync(file, JSON.stringify(plan, null, 2), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  console.log(JSON.stringify({ write: false, held: "P-035/front/20 remains unread", rules: plan.rules.map(({ before, fresh }) => ({ id: before.id, card: fresh.cardId, side: fresh.side, skill: fresh.skillIndex, reading: fresh.reads })) }, null, 2));
} else {
  assert.deepEqual(canonical(JSON.parse(fs.readFileSync(file, "utf8"))), canonical(plan), "Review changed; regenerate and review before applying");
  console.log(JSON.stringify({ written: await applyReviewedRefresh(db, plan) }));
}
process.exit(0);
