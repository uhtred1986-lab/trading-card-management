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
const { cardRules, cardScripts, cards: cardsTable } = await import("../src/db/schema.ts");
const { describeScript, validateProgram } = await import("../src/lib/arena/engine/script.ts");
const { catalogIds, draftCards, skillRecords } = await import("../src/lib/arena/draft.ts");
const { cardDefFrom } = await import("../src/lib/arena/load.ts");
const { rows } = await import("../src/db/rows.ts");
type Op = import("../src/lib/arena/engine/script.ts").Op;

/** `cannotAttack` was the word before `forbid` existed; the same thing. */
function modernise(ops: Op[]): Op[] {
  return ops.map((o) => {
    if (o.op === "cannotAttack") return { op: "forbid", what: "attack", until: o.until, target: o.target };
    if (o.op === "if") return { ...o, then: modernise(o.then), ...(o.else ? { else: modernise(o.else) } : {}) };
    if (o.op === "may" || o.op === "delay") return { ...o, ops: modernise(o.ops) };
    if (o.op === "chooseMode") return { ...o, modes: o.modes.map((m) => ({ ...m, ops: modernise(m.ops) })) };
    if (o.op === "altCost" && o.ops) return { ...o, ops: modernise(o.ops) };
    return o;
  });
}

const old = await db.select().from(cardScripts);
console.log(`${old.length} card_scripts row${old.length === 1 ? "" : "s"} to carry over`);
let user = 0;
let claude = 0;
let rewritten = 0;
let invalid = 0;
for (const r of old) {
  const raw = (r.ops as Op[]) ?? [];
  if (!validateProgram(raw)) {
    invalid++;
    console.warn(`  ${r.cardId} ${r.side} [${r.skillIndex}]: stored program is not valid in today's language — carried as an open row`);
  }
  const ops = modernise(raw);
  if (JSON.stringify(ops) !== JSON.stringify(raw)) rewritten++;
  const card = await db.query.cards.findFirst({ where: eq(cardsTable.id, r.cardId) });
  const rec = card ? skillRecords(cardDefFrom(card)).find((s) => s.side === r.side && s.skillIndex === r.skillIndex) : undefined;
  const permanent = (rec?.kind ?? "") === "permanent";
  const mechanical = r.meaning === "deliberately does nothing" || (r.meaning != null && r.meaning === describeScript(raw, { permanent }));
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
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
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
