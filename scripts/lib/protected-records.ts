/** Records-only refresh for rules the owner approved or corrected (npm run arena:protected-records).
 *
 * Generalises the #907 BT6 migration (protected-metadata-907.ts): it writes ONLY the typed records a row
 * lacks (skill usage v1, Sparking validity v1, payment version/readable) and never the program, status,
 * source, confirmation or review flag. Planning is pure; the write is one locked compare-and-set statement.
 * A row it cannot prove safe is refused with a reason and left alone; refusing one never blocks the others. */
import { sql } from "drizzle-orm";
import type { Db } from "../../src/db";
import { rows } from "../../src/db/rows";
import { textArray } from "../../src/db/sqlx";
import { hashOf } from "../arena-corpus-provenance.mts";
import { parseIdList, type IdSpec } from "./refresh-ids";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { compileUsage, usageProblem } from "../../src/lib/arena/vm/usage";
import { compileValidity, validityProblem } from "../../src/lib/arena/vm/validity";
import { costRecordProblem, zeroCostRecord } from "../../src/lib/arena/vm/skill-payment";
import { recordContractGaps } from "../../src/lib/arena/rules-store";
import { validateRule } from "../../src/lib/arena/lang";
import type { Rule } from "../../src/lib/arena/lang";

type Row = Record<string, unknown>;
/** Hard exclusion, whatever its row looks like (#907: its total-across-kinds clause stays unread by design). */
export const EXCLUDED_CARDS: Record<string, string> = { "P-616": "P-616 is always excluded (#907)" };
export const keyOf = (r: Row) => `${r.card_id}/${r.side}/${r.skill_index}`;
/** Approved (confirmed/corrected) or authored by the owner or Claude: never a compiler-owned draft. */
export const isProtected = (r: Row) => ["confirmed", "corrected"].includes(String(r.status)) || ["user", "claude"].includes(String(r.source));

const costBody = (cost: unknown) => {
  const { version: _version, readable: _readable, ...body } = (cost ?? zeroCostRecord()) as Record<string, unknown>;
  void _version; void _readable; return body;
};
/** Everything that decides behaviour; the typed records usage/validity and the payment's version/readable marker are not in it. */
const program = (r: Row) => Object.fromEntries(["printed", "kind", "trigger", "combo", "cond", "ops", "unread", "reads", "pattern", "source", "status"].map(k => [k, r[k] ?? null]).concat([["cost", costBody(r.cost)]]));

export interface Selection { ids?: string[]; decks?: string | null }
export interface PlannedRow { before: Row; cost: unknown; usage: unknown; validity: unknown }

/** Plans one protected row with gaps. Returns the write, or the reason it needs the owner. */
function planRow(before: Row): { ok: PlannedRow & { target: Row } } | { refuse: string } {
  const key = keyOf(before);
  if (EXCLUDED_CARDS[String(before.card_id)]) return { refuse: EXCLUDED_CARDS[String(before.card_id)] };
  if (before.review_flag != null) return { refuse: `review flag is set (${String(before.review_flag)}); needs a new review` };
  if (Array.isArray(before.unread) && before.unread.length) return { refuse: "unread clauses present; behaviour is not fully read" };
  const parsed = parseSkills(String(before.printed));
  if (parsed.length !== 1) return { refuse: `printed text parses to ${parsed.length} skills, not exactly one` };
  if (parsed[0].kind !== before.kind) return { refuse: `printed kind ${parsed[0].kind} does not match stored kind ${String(before.kind)}` };
  const usage = compileUsage(parsed[0]), validity = compileValidity(parsed[0]);
  const up = usageProblem(usage) ?? validityProblem(validity);
  if (up) return { refuse: `printed skill gives no valid typed record: ${up}` };
  if (before.usage != null && hashOf(before.usage) !== hashOf(usage)) return { refuse: "an existing authored usage differs from the printed skill; never overwritten" };
  if (before.validity != null && hashOf(before.validity) !== hashOf(validity)) return { refuse: "an existing authored validity differs from the printed skill; never overwritten" };
  const stored = before.cost as { version?: number; readable?: boolean } | null;
  if (stored && stored.readable === false) return { refuse: "stored payment is unreadable; needs a new review" };
  const cost = stored == null ? zeroCostRecord() : { version: 1, readable: true, ...stored };
  const cp = costRecordProblem(cost);
  if (cp) return { refuse: `payment body is not a valid record: ${cp}` };
  if (hashOf(costBody(cost)) !== hashOf(costBody(before.cost))) return { refuse: "payment body would change" };
  const candidate = { ...before, cost, usage, validity };
  // Combo-qualification, Fusion/Union material and any other contract gap change behaviour: not ours to write.
  const rest = recordContractGaps(candidate as never);
  if (rest.length) return { refuse: `contract gaps remain that need the owner: ${rest.join("; ")}` };
  if (hashOf(program(candidate)) !== hashOf(program(before))) return { refuse: "program hash would change" };
  const invalid = validateRule({ kind: before.kind, trigger: before.trigger, cost, cond: before.cond, ops: before.ops, usage, validity } as Rule, String(before.kind));
  if (invalid) return { refuse: `validateRule: ${String(invalid)}` };
  if (hashOf(before.usage ?? null) === hashOf(usage) && hashOf(before.validity ?? null) === hashOf(validity) && hashOf(before.cost) === hashOf(cost)) return { refuse: `no record to write (${key})` };
  const target = { key, id: before.id, version: before.version, status: before.status, source: before.source, programHash: hashOf(program(before)),
    before: { usage: before.usage ?? null, validity: before.validity ?? null, costVersion: stored?.version ?? null, costReadable: stored?.readable ?? null },
    after: { usage, validity, costVersion: 1, costReadable: true } };
  return { ok: { before, cost, usage, validity, target } };
}

/** Pure plan over rows already read. `candidates` are every row in the selection; only protected rows with a gap are targets. */
export function protectedRecordsPlan(candidates: Row[], selection: Selection = {}) {
  const targets: PlannedRow[] = [], publicTargets: Row[] = [], refused: { key: string; id: unknown; reason: string }[] = [], skipped: { key: string; reason: string }[] = [];
  for (const before of candidates.slice().sort((a, b) => keyOf(a).localeCompare(keyOf(b)))) {
    const key = keyOf(before);
    if (EXCLUDED_CARDS[String(before.card_id)]) { refused.push({ key, id: before.id, reason: EXCLUDED_CARDS[String(before.card_id)] }); continue; }
    if (!isProtected(before)) { skipped.push({ key, reason: `not protected (status ${String(before.status)}, source ${String(before.source)}); the compiler refresh owns it` }); continue; }
    if (!recordContractGaps(before as never).length) { skipped.push({ key, reason: "no record contract gap" }); continue; }
    const p = planRow(before);
    if ("refuse" in p) { refused.push({ key, id: before.id, reason: p.refuse }); continue; }
    const { target, ...write } = p.ok;
    targets.push(write); publicTargets.push(target);
  }
  const preview = { selection: { ids: selection.ids ?? [], decks: selection.decks ?? null }, targets: publicTargets, needsReview: refused, skipped,
    note: "Records-only proposal; no program, status, source, confirmation or review flag is touched" };
  return { digest: hashOf(preview), preview, rules: targets };
}

const sideOf = (s: IdSpec) => s.side;
/** Reads the selection's rows: stored `card_rules` of the named ids and/or of the owner's non-testing dbs deck cards (main, z, leader). */
export async function loadProtectedCandidates(db: Db, sel: Selection): Promise<Row[]> {
  const out = new Map<string, Row>();
  const take = (r: Row) => out.set(String(r.id), r);
  if (sel.ids?.length) {
    const { specs, bad } = parseIdList(sel.ids.join(" "));
    if (bad.length) throw new Error(`unreadable ids: ${bad.join(", ")}`);
    const cardIds = [...new Set(specs.flatMap(s => (s.skill == null && /b$/i.test(s.cardId) ? [s.cardId, s.cardId.slice(0, -1)] : [s.cardId])))];
    const found = rows<{ record: Row }>(await db.execute(sql`select to_jsonb(r) as record from card_rules r where r.card_id = any(${textArray(cardIds)})`)).map(r => r.record);
    for (const s of specs) {
      let cardId = s.cardId, side = sideOf(s);
      if (s.skill == null && !found.some(r => r.card_id === cardId) && /b$/i.test(cardId)) { cardId = cardId.slice(0, -1); side = "back"; }
      for (const r of found) {
        if (r.card_id !== cardId || (side && r.side !== side)) continue;
        if (s.skill != null && Number(r.skill_index) !== s.skill) continue;
        // A skill number without a face means the front, falling back to the back only when the front has none.
        if (s.skill != null && !side && r.side === "back" && found.some(f => f.card_id === cardId && f.side === "front" && Number(f.skill_index) === s.skill)) continue;
        take(r);
      }
    }
  }
  if (sel.decks !== undefined) {
    const ownerWhere = sel.decks === null ? sql`and d.owner is null` : sql`and d.owner = ${sel.decks}`;
    const found = rows<{ record: Row }>(await db.execute(sql`
      select to_jsonb(r) as record from card_rules r where r.card_id in (
        select dc.card_id from decks d join deck_cards dc on dc.deck_id = d.id and dc.zone in ('main', 'z', 'leader')
        where d.game = 'dbs' and d.is_testing = false ${ownerWhere})`)).map(r => r.record);
    for (const r of found) take(r);
  }
  return [...out.values()];
}

/** Atomic compare of the complete raw rows. The caller supplies the reviewed preview digest and re-reads the selection fresh. */
export async function applyProtectedRecords(db: Db, sel: Selection, approvedDigest: string) {
  const plan = protectedRecordsPlan(await loadProtectedCandidates(db, sel), sel);
  if (approvedDigest !== plan.digest) throw new Error("protected records approval is stale or describes different rows; no write");
  return writePlanned(db, plan.rules);
}

/** The write alone: one locked statement that compares each complete raw row with what was read and writes nothing if any moved. */
export async function writePlanned(db: Db, rules: PlannedRow[]) {
  if (!rules.length) return [];
  const payload = JSON.stringify(rules.map(({ before, cost, usage, validity }) => ({ before, cost, usage, validity })));
  const written = rows<{ id: number }>(await db.execute(sql`
    with input as (select value from jsonb_array_elements(${payload}::jsonb)),
    locked as materialized (select r.* from card_rules r join input i on r.id=(i.value->'before'->>'id')::int order by r.id for update of r),
    valid as materialized (select 1 where (select count(*) from locked r join input i on r.id=(i.value->'before'->>'id')::int
      where to_jsonb(r)=i.value->'before' and (r.status in ('confirmed','corrected') or r.source in ('user','claude')) and r.card_id <> 'P-616')=${rules.length})
    update card_rules r set usage=i.value->'usage',validity=i.value->'validity',cost=i.value->'cost',version=r.version+1,updated_at=now()
      from input i where r.id=(i.value->'before'->>'id')::int and exists(select 1 from valid) returning r.id
  `));
  if (written.length !== rules.length) throw new Error("protected records repair refused: reviewed rows changed; no write");
  return written.map(r => r.id).sort((a, b) => a - b);
}
