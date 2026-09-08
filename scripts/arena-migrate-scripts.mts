/**
 * One-off: carry `card_scripts` over into `card_rules`, then draft the whole
 * catalog around the carried rows. Kept in the repo as the record of how the
 * old rows were classified. Safe to re-run; the second run finds nothing to
 * carry.
 *
 *   npm run arena:migrate-scripts
 *
 * Who wrote each old row is inferred from what was stored beside it. The old
 * rules page saved the compiler's own rendering of the program as `meaning`
 * (or "deliberately does nothing"); those are the owner's (`source: user`).
 * `clarify.ts` saved Claude's restatement as `meaning` and stamped the row
 * `user` anyway — those are Claude's (`source: claude`), which is where they
 * show up for review. Anything ambiguous is Claude's too: safer to be asked.
 */
import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const { eq, sql } = await import("drizzle-orm");
const { db } = await import("../src/db/index.ts");
const { cardRules, cards: cardsTable } = await import("../src/db/schema.ts");
const { describeScript, validateProgram } = await import("../src/lib/arena/engine/script.ts");
const { catalogIds, draftCards, skillRecords } = await import("../src/lib/arena/draft.ts");
const { cardDefFrom } = await import("../src/lib/arena/load.ts");
const { rows } = await import("../src/db/rows.ts");
type Op = import("../src/lib/arena/engine/script.ts").Op;

/** `cannotAttack` was the word before `forbid` existed; the same thing. The old rows are read loosely — the op is no longer in the language. */
type Loose = Record<string, unknown> & { op: string };
function modernise(ops: Loose[]): Loose[] {
  return ops.map((o) => {
    if (o.op === "cannotAttack") return { op: "forbid", what: "attack", until: o.until, target: o.target };
    if (o.op === "if") return { ...o, then: modernise(o.then as Loose[]), ...(o.else ? { else: modernise(o.else as Loose[]) } : {}) };
    if (o.op === "may" || o.op === "delay") return { ...o, ops: modernise(o.ops as Loose[]) };
    if (o.op === "chooseMode") return { ...o, modes: (o.modes as { ops: Loose[] }[]).map((m) => ({ ...m, ops: modernise(m.ops) })) };
    if (o.op === "altCost" && o.ops) return { ...o, ops: modernise(o.ops as Loose[]) };
    return o;
  });
}

// Read with raw SQL: the table has no Drizzle definition any more. When
// migration 0028 has already run — a deploy got there first — the table is
// gone and its rows sit in card_rules as Claude's, copied by the migration's
// own INSERT; the second pass below then classifies those from `reads`, which
// holds the old `meaning`, by the same rule.
type OldRow = { cardId: string; skillIndex: number; side: string; ops: Loose[]; source: string; explanation: string | null; meaning: string | null; createdAt: string; updatedAt: string };
const [exists] = rows<{ n: number }>(await db.execute(sql`select count(*)::int as n from information_schema.tables where table_name = 'card_scripts'`));
let old: OldRow[] = [];
if (exists.n) old = rows<OldRow>(await db.execute(sql`select card_id as "cardId", skill_index as "skillIndex", side, ops, source, explanation, meaning, created_at as "createdAt", updated_at as "updatedAt" from card_scripts`));
else {
  const copied = await db.select().from(cardRules).where(sql`${cardRules.source} = 'claude' and ${cardRules.status} = 'corrected' and ${cardRules.version} = 1`);
  old = copied.map((r) => ({ cardId: r.cardId, skillIndex: r.skillIndex, side: r.side, ops: (r.ops as Loose[]) ?? [], source: r.source, explanation: r.explanation, meaning: r.reads || null, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() }));
  console.log(`card_scripts is already dropped; ${copied.length} row${copied.length === 1 ? "" : "s"} the migration copied are classified from what it kept`);
}
console.log(`${old.length} card_scripts row${old.length === 1 ? "" : "s"} to carry over`);
let user = 0;
let claude = 0;
let rewritten = 0;
let invalid = 0;
for (const r of old) {
  const raw = r.ops ?? [];
  if (!validateProgram(raw)) {
    invalid++;
    console.warn(`  ${r.cardId} ${r.side} [${r.skillIndex}]: stored program is not valid in today's language — carried as an open row`);
  }
  const ops = modernise(raw) as unknown as Op[];
  if (JSON.stringify(ops) !== JSON.stringify(raw)) rewritten++;
  const card = await db.query.cards.findFirst({ where: eq(cardsTable.id, r.cardId) });
  const rec = card ? skillRecords(cardDefFrom(card)).find((s) => s.side === r.side && s.skillIndex === r.skillIndex) : undefined;
  const permanent = (rec?.kind ?? "") === "permanent";
  const mechanical = r.meaning === "deliberately does nothing" || (r.meaning != null && validateProgram(raw) && r.meaning === describeScript(raw, { permanent }));
  const source = mechanical ? "user" : "claude";
  if (source === "user") user++;
  else claude++;
  const valid = validateProgram(raw);
  await db
    .insert(cardRules)
    .values({
      cardId: r.cardId,
      side: r.side === "back" ? "back" : "front",
      skillIndex: r.skillIndex,
      printed: rec?.printed ?? r.explanation ?? "",
      kind: rec?.kind ?? "auto",
      trigger: rec?.trigger ?? [],
      cost: rec?.cost ?? null,
      cond: null,
      ops: valid ? ops : [],
      unread: valid ? [] : rec?.unread ?? [],
      status: valid ? "corrected" : "open",
      source,
      explanation: r.explanation,
      reads: valid ? describeScript(ops, { permanent }) : "",
      createdAt: new Date(r.createdAt),
      updatedAt: new Date(r.updatedAt),
    })
    .onConflictDoUpdate({
      target: [cardRules.cardId, cardRules.side, cardRules.skillIndex],
      set: { ops: valid ? ops : [], cond: null, unread: valid ? [] : rec?.unread ?? [], status: valid ? "corrected" : "open", source, explanation: r.explanation, reads: valid ? describeScript(ops, { permanent }) : "", updatedAt: new Date() },
    });
}
console.log(`carried: ${user} as the owner's, ${claude} as Claude's, ${rewritten} rewritten from cannotAttack to forbid, ${invalid} not valid today and left open`);

console.log("Drafting the catalog around them…");
const s = await draftCards(db, await catalogIds(db));
console.log(`${s.cards} cards · ${s.skills} skills · ${s.inserted} inserted · ${s.updated} updated · ${s.diffed} person-owned rows differ from the compiler`);

const [left] = rows<{ n: number }>(await db.execute(sql`select count(*)::int as n from card_rules where ops::text like '%"cannotAttack"%'`));
if (left.n) throw new Error(`${left.n} card_rules row(s) still use cannotAttack — the alias cannot be removed yet`);
console.log("no row uses cannotAttack; the alias can go.");
process.exit(0);
