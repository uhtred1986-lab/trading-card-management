/** Owner-authorized, bounded refresh from PR #823. Default is read-only planning.
 * Usage: --plan /private/plan.json, then --apply /private/plan.json.
 * CLI catalog writes have the normal 24-hour cache TTL (cache/tags.ts).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../src/db/index.ts";
import { cards } from "../src/db/schema.ts";
import { rows } from "../src/db/rows.ts";
import { cardDefFrom } from "../src/lib/arena/load.ts";
import { canonical, skillRecords } from "../src/lib/arena/draft.ts";
import { correctSkillText } from "../src/lib/catalog/errata.ts";
import { applyReviewedRefresh, type ReviewedRefresh } from "./lib/reviewed-rule-refresh.ts";

const [mode, file, ...extra] = process.argv.slice(2);
assert((mode === "--plan" || mode === "--apply") && file && !extra.length,
  "Usage: arena-reviewed-refresh.mts --plan FILE | --apply FILE");
assert(process.env.DATABASE_URL, "Explicit app DATABASE_URL required");
assert.equal(rows<{name:string}>(await db.execute(sql`select to_regclass('public.card_rules')::text as name`))[0]?.name, "card_rules");
const audit = JSON.parse(fs.readFileSync("docs/arena-backlog/evidence/819-820/live-rule-audit.json", "utf8"));
const approved = audit.results.filter((r: {disposition:string}) => r.disposition === "approved" || r.disposition === "separate");
assert.equal(approved.length, 26);
const ids: string[] = [...new Set<string>(audit.results.map((r: {card:string}) => r.card))];
const catalog = await db.select().from(cards).where(inArray(cards.id, ids));
const old = rows<{record:Record<string,unknown>}>(await db.execute(sql`select to_jsonb(r) as record from card_rules r where card_id in (${sql.join(ids.map(id=>sql`${id}`),sql`,`)})`)).map(r=>r.record);
const world = catalog.find(c=>c.id === "BT5-119")!;
const corrected = correctSkillText(world.id, world.skill)!;
const plan: ReviewedRefresh = { catalog: {id:world.id,before:world.skill,after:corrected}, rules: [] };
for (const a of approved) {
  const before = old.find(r=>r.card_id===a.card && r.side===a.side && r.skill_index===a.skill);
  assert(before, `Missing ${a.card}/${a.side}/${a.skill}`);
  assert.equal(before.source,"compiler"); assert.equal(before.status,"draft");
  assert.equal(before.version,a.version,`Version changed: ${a.card}`);
  assert.equal(before.reads,a.storedReading,`Reading changed: ${a.card}`);
  const card = catalog.find(c=>c.id===a.card)!;
  assert.equal(card.game,"dbs");
  const fresh = skillRecords(cardDefFrom({...card,skill:card.id===world.id?corrected:card.skill}))
    .find(r=>r.side===a.side && r.skillIndex===a.skill)!;
  assert(fresh); assert.deepEqual(fresh.unread,[]);
  assert.equal(fresh.reads,a.freshReading,`Compiler changed: ${a.card}`);
  if(a.card!==world.id) assert.equal(fresh.printed,before.printed);
  plan.rules.push({before,fresh});
}
if(mode==="--plan") {
  fs.writeFileSync(file,JSON.stringify(plan,null,2),{mode:0o600});
  console.log(JSON.stringify({planned:plan.rules.length,catalogErrata:plan.catalog.id,held:3,write:false}));
} else {
  const saved: ReviewedRefresh=JSON.parse(fs.readFileSync(file,"utf8"));
  assert.deepEqual(canonical(saved),canonical(plan),"Database or compiler changed since saved plan");
  const written=await applyReviewedRefresh(db,saved);
  const after = rows<{record:Record<string,unknown>}>(await db.execute(sql`select to_jsonb(r) as record from card_rules r where card_id in (${sql.join(ids.map(id=>sql`${id}`),sql`,`)})`)).map(r=>r.record);
  for(const r of old.filter(r=>!written.includes(Number(r.id))))
    assert.deepEqual(after.find(a=>a.id===r.id),r,"Untargeted rule changed");
  assert.equal((await db.select().from(cards).where(eq(cards.id,world.id)))[0].skill,corrected);
  console.log(JSON.stringify({written:written.length,ids:written,catalogErrata:world.id,untargetedRulesUnchanged:old.length-written.length}));
}
process.exit(0);
