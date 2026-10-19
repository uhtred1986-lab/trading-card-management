/** Default is a read-only preview. --apply requires the exact reviewed digest. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { sql, inArray } from "drizzle-orm";
import { protectedMetadataPlan, applyProtectedMetadata, PROTECTED_KEYS } from "./lib/protected-metadata-907";
import { cardDefFrom } from "../src/lib/arena/load";
import { hashOf } from "./arena-corpus-provenance.mts";
import { rows } from "../src/db/rows";
const args = process.argv.slice(2), value = (flag: string) => { const i=args.indexOf(flag); return i<0?undefined:args[i+1]; };
const offline = value("--stored-rules"), apply = args.includes("--apply"), approved = value("--approved-digest");
assert.ok(!apply || !offline && approved && /^[a-f0-9]{64}$/.test(approved), "apply requires live readback and --approved-digest");
let before: Record<string, unknown>[];
let liveDb: Awaited<typeof import("../src/db")>["db"] | undefined;
if (offline) before=JSON.parse(readFileSync(offline,"utf8")).filter((r:Record<string,unknown>)=>PROTECTED_KEYS.includes(`${r.card_id}/${r.side}/${r.skill_index}`));
else {
  assert.ok(process.env.DATABASE_URL, "use this app's privately verified pooled database URL");
  const host=new URL(process.env.DATABASE_URL).hostname;
  assert.ok(host.includes("pooler")&&host.includes("eu-central-1")&&host.endsWith(".neon.tech"),"expected app pooled region");
  const { db }=await import("../src/db"); liveDb=db;
  const identity=rows<{rules:string;metadata:boolean}>(await db.execute(sql`select to_regclass('public.card_rules')::text rules, (select count(*)=2 from information_schema.columns where table_schema='public' and table_name='card_rules' and column_name in ('usage','validity')) metadata`))[0];
  assert.ok(identity?.rules&&identity.metadata,"deployed app rules table and metadata columns required");
  const { cards }=await import("../src/db/schema");
  const ids=[...new Set(PROTECTED_KEYS.map(k=>k.split('/')[0]))];
  const actual=await db.select().from(cards).where(inArray(cards.id,ids));
  const frozen=JSON.parse(readFileSync("docs/arena-backlog/evidence/897/selected-pair-inputs-2026-10-19/catalog.json","utf8")).cards;
  assert.equal(actual.length,ids.length);
  for(const c of actual) assert.equal(hashOf(cardDefFrom(c)),hashOf(cardDefFrom(frozen.find((f:{id:string})=>f.id===c.id))),"catalog engine source changed; review current source");
  before=rows<{record:Record<string,unknown>}>(await db.execute(sql`select to_jsonb(r) record from card_rules r where r.card_id in (${sql.join(ids.map(id=>sql`${id}`),sql`, `)})`)).map(r=>r.record).filter(r=>PROTECTED_KEYS.includes(`${r.card_id}/${r.side}/${r.skill_index}`));
}
const plan=protectedMetadataPlan(before);
const receipt={digest:plan.digest,...plan.preview,mode:apply?"apply":"dry-run",pending:plan.rules.length};
if(value("--out"))writeFileSync(value("--out")!,JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
if(apply){assert.ok(liveDb&&approved);const written=await applyProtectedMetadata(liveDb,before,approved);console.log(JSON.stringify({written,programsReplaced:0,statusesChanged:0,humanConfirmationsAdded:0}));}
process.exit(0);
