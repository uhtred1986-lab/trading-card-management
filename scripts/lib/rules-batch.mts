/**
 * The selection and the receipt skeleton of a "rules review" batch (`npm run rules:batch`).
 * READ-ONLY: it reads decks, cards and rule rows, and writes nothing to the database.
 *
 * What it reproduces is what every receipt in docs/arena-backlog/evidence/rules-review-2026-10-20/
 * re-derived by hand: the owner's decks plus ownerless ones, game `dbs` (or the one `game` names), not testing; the cards whose
 * health (`cardHealthOf`, rules-store.ts) is `unchecked`; ordered by deck count, then id; minus every
 * card an earlier receipt already lists. Takes a `Db`, so `scripts/verify/rules-batch.mts` runs it on PGlite.
 */
import fs from "node:fs";
import path from "node:path";
import { and, asc, eq, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { Db } from "../../src/db/index.ts";
import { rows as rowsOf } from "../../src/db/rows.ts";
import { cardRules, cards, deckCards, decks } from "../../src/db/schema.ts";
import { REVIEWABLE_CARD, cardHealthOf, ruleHealth } from "../../src/lib/arena/rules-store.ts";
import { confirmBlocker } from "../../src/lib/rules-review/deck-review.ts";
import type { Game } from "../../src/lib/catalog/games.ts";

/** Refuses on any database that is not this app's: the shared cloud `DATABASE_URL` belongs to another app. */
export async function assertThisAppsDb(db: Db): Promise<void> {
  const found = rowsOf<{ t: string | null }>(await db.execute(sql`select to_regclass('public.card_rules')::text as t`));
  if (!found[0]?.t) {
    throw new Error("this database has no public.card_rules: it is not the trading-card-management database. Fetch the right URL with `node scripts/card-db-env.mjs <file>` (docs/agent-brief.md).");
  }
}

const chunks = <T,>(xs: T[], n = 500): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** The owner name to select decks for: the one given, else the only named owner among that game's decks. */
export async function resolveOwner(db: Db, given?: string, game: Game = "dbs"): Promise<string> {
  if (given) return given;
  const all = await db.select({ owner: decks.owner }).from(decks).where(and(eq(decks.game, game), eq(decks.isTesting, false)));
  const names = [...new Set(all.map((d) => d.owner).filter((o): o is string => !!o))];
  if (names.length !== 1) throw new Error(`cannot tell whose decks to use (owners found: ${names.join(", ") || "none"}); pass --owner NAME`);
  return names[0];
}

const ID_RE = /\b[A-Z]{1,4}\d{0,3}-\d{2,4}\b/g;

/** Every card id named in an earlier receipt (any .md under `evidenceDir`), with the file that names it first. */
export function listedIds(evidenceDir: string, ignoreFile?: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md") && (!ignoreFile || path.resolve(p) !== path.resolve(ignoreFile))) {
        for (const id of fs.readFileSync(p, "utf8").match(ID_RE) ?? []) if (!out.has(id)) out.set(id, path.basename(p));
      }
    }
  };
  walk(evidenceDir);
  return out;
}

type RuleRow = typeof cardRules.$inferSelect;
export interface BatchRow {
  cardId: string;
  cardName: string;
  side: string;
  skillIndex: number;
  printed: string;
  /** reviewable: a compiler/draft row to give a verdict; keyword: health done by design; corrected: a person's row; blocked: cannot be confirmed here */
  state: "review" | "keyword" | "done" | "blocked";
  blocker: string | null;
  status: string;
  source: string;
}
export interface BatchSelection {
  owner: string;
  /** the game whose decks and cards were selected (F1-08, #1191: `fusion` reviews the Fusion World starters) */
  game: Game;
  decks: number;
  unchecked: number;
  skippedListed: { id: string; file: string }[];
  skippedByHand: string[];
  cardIds: string[];
  /** every row on the chosen cards, in card, side, index order */
  rows: BatchRow[];
  /** the cards that were `unchecked` and eligible, in order, after skipping (all of them, not only `next`) */
  queue: string[];
}

export interface SelectOptions {
  owner?: string;
  /** the game to select decks and cards of; `dbs` when absent */
  game?: Game;
  next: number;
  skip?: string[];
  /** ids from earlier receipts; empty to disable the skipping */
  listed?: Map<string, string>;
  /** true: ignore `listed` altogether; a set: take only those ids back from it */
  includeListed?: boolean | Set<string>;
}

export async function selectBatch(db: Db, opts: SelectOptions): Promise<BatchSelection> {
  const game: Game = opts.game ?? "dbs";
  const owner = await resolveOwner(db, opts.owner, game);
  const all = await db.select({ id: decks.id, owner: decks.owner }).from(decks).where(and(eq(decks.game, game), eq(decks.isTesting, false)));
  const deckIds = all.filter((d) => d.owner === owner || d.owner === null).map((d) => d.id);
  const decksOfCard = new Map<string, Set<number>>();
  for (const part of chunks(deckIds)) {
    for (const r of await db.select({ deckId: deckCards.deckId, cardId: deckCards.cardId }).from(deckCards).where(inArray(deckCards.deckId, part))) {
      (decksOfCard.get(r.cardId) ?? decksOfCard.set(r.cardId, new Set()).get(r.cardId)!).add(r.deckId);
    }
  }
  const cardList: { id: string; name: string; skill: string | null; backSkill: string | null }[] = [];
  const rules: RuleRow[] = [];
  for (const part of chunks([...decksOfCard.keys()])) {
    cardList.push(...(await db.select({ id: cards.id, name: cards.name, skill: cards.skill, backSkill: cards.backSkill }).from(cards).where(and(inArray(cards.id, part), eq(cards.game, game), REVIEWABLE_CARD))));
    rules.push(...(await db.select().from(cardRules).where(inArray(cardRules.cardId, part)).orderBy(asc(cardRules.cardId), asc(cardRules.side), asc(cardRules.skillIndex))));
  }
  const rulesOf = new Map<string, RuleRow[]>();
  for (const r of rules) (rulesOf.get(r.cardId) ?? rulesOf.set(r.cardId, []).get(r.cardId)!).push(r);

  const unchecked = cardList.filter((c) => cardHealthOf(c, rulesOf.get(c.id) ?? []).health === "unchecked");
  unchecked.sort((a, b) => (decksOfCard.get(b.id)?.size ?? 0) - (decksOfCard.get(a.id)?.size ?? 0) || a.id.localeCompare(b.id));

  const byHand = new Set((opts.skip ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean));
  const skippedListed: { id: string; file: string }[] = [];
  const skippedByHand: string[] = [];
  const queue: typeof unchecked = [];
  for (const c of unchecked) {
    const file = opts.listed?.get(c.id);
    const takenBack = opts.includeListed === true || (opts.includeListed instanceof Set && opts.includeListed.has(c.id));
    if (byHand.has(c.id)) skippedByHand.push(c.id);
    else if (file && !takenBack) skippedListed.push({ id: c.id, file });
    else queue.push(c);
  }
  const chosen = queue.slice(0, Math.max(0, opts.next));
  const rows: BatchRow[] = [];
  for (const c of chosen) {
    for (const r of rulesOf.get(c.id) ?? []) {
      const blocker = confirmBlocker(
        { ...r, confirmedAt: r.confirmedAt, confirmedBy: r.confirmedBy, confirmNote: r.confirmNote, reviewFlag: r.reviewFlag } as Parameters<typeof confirmBlocker>[0],
        { id: c.id, name: c.name, backName: null, skill: c.skill, backSkill: c.backSkill },
      );
      const health = ruleHealth(r).health;
      const state: BatchRow["state"] = r.status === "confirmed" || r.status === "corrected" ? "done" : health === "done" ? "keyword" : blocker ? "blocked" : "review";
      rows.push({ cardId: c.id, cardName: c.name, side: r.side, skillIndex: r.skillIndex, printed: r.printed, state, blocker, status: r.status, source: r.source });
    }
  }
  return { owner, game, decks: deckIds.length, unchecked: unchecked.length, skippedListed, skippedByHand, cardIds: chosen.map((c) => c.id), rows, queue: queue.map((c) => c.id) };
}

const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const cell = (s: string) => flat(s).replace(/\|/g, "\\|");
export const skillLabel = (side: string, index: number) => `${side === "back" ? "b" : "f"}${index}`;

/** The receipt, ready to be filled in: header and totals with placeholders, the Selection paragraph written, one table row per row to review. */
export function renderReceipt(sel: BatchSelection, opts: { date: string; batch: string; next: number }): string {
  const review = sel.rows.filter((r) => r.state === "review" || r.state === "blocked");
  const keyword = sel.rows.filter((r) => r.state === "keyword");
  const done = sel.rows.filter((r) => r.state === "done");
  const listedLine = sel.skippedListed.length
    ? `Skipped as already listed in the receipts: ${sel.skippedListed.map((s) => `${s.id} (${s.file})`).join(", ")}. `
    : "";
  const handLine = sel.skippedByHand.length ? `Skipped by hand: ${sel.skippedByHand.join(", ")}. ` : "";
  const out: string[] = [];
  out.push(`# Rules review, ${opts.date}, ${opts.batch}: next ${opts.next} deck cards`, "");
  out.push(
    "Authorization: <the owner's words and dates, verbatim, from the chat; never second-hand from a handover>. Writes went only through the repo's guarded paths:",
    "`confirmRule` / `flagRule` (`src/lib/rules-review/deck-review.ts`, attribution `claude-review`) and <`saveRule` (`src/lib/arena/rules-store.ts`) for N draft fixes / no saveRule>.",
    "No ad hoc SQL, no owner-confirmed or owner-corrected row touched, no P-616, no errata edit. The database was proven to be this app's first (`to_regclass('public.card_rules')` = `<result>`).",
    "Lessons applied: each `saveRule` passed the row's existing `cond`, `combo`, `cost`, `trigger`, `usage` and `validity` explicitly, and the row was re-read and compared with a snapshot taken before (`npm run rules:snapshot`; <only ... differ>).",
    "",
  );
  out.push("## Selection", "");
  out.push(
    `Owner \`${sel.owner}\` plus ownerless decks, game \`${sel.game}\`, not testing (${sel.decks} decks); cards whose health (\`ruleHealth\`, \`src/lib/arena/rules-store.ts\`) is \`unchecked\`: ${sel.unchecked}, ordered by deck count then id. ${listedLine}${handLine}` +
      `The first ${sel.cardIds.length} of the remaining ${sel.queue.length}:`,
  );
  out.push(sel.cardIds.join(", ") + ".");
  out.push(
    `Rows on these cards: ${sel.rows.length}; to review ${review.length}${review.some((r) => r.state === "blocked") ? ` (${review.filter((r) => r.state === "blocked").length} cannot be confirmed here, see the table)` : ""}; keyword lines left alone ${keyword.length}; already confirmed or corrected, left alone ${done.length}.`,
    "",
  );
  out.push(
    "Basis order: official Q&A (`src/lib/rules-review/faq.generated.json`, then the live `card_faq.php`); official errata (`errata-cards.php`; `errata.ts`); Rule Manual / glossary (`src/lib/arena/glossary.ts`) and the repo's engine proofs;",
    "Try it boards (`tryRule(probeRuleOf(...))`); throwaway engine proofs on the **stored rows** (`rulesFromRows`, staged boards, every prompt answered in the orders that matter).",
    "",
  );
  out.push("## Totals", "", `**${review.length} rows on ${sel.cardIds.length} cards: <N> confirmed, <N> flagged, <N> skipped.** <draft fixes>.`, "");
  out.push(`## Per row (${review.length} rows)`, "", "| Card | Skill | Printed (short) | Verdict | Basis |", "|---|---|---|---|---|");
  for (const r of review) {
    const label = `${skillLabel(r.side, r.skillIndex)}${r.blocker ? ` [${cell(r.blocker).slice(0, 80)}]` : ""}`;
    out.push(`| ${r.cardId} ${cell(r.cardName)} | ${label} | ${cell(r.printed).slice(0, 100)} |  |  |`);
  }
  out.push("");
  if (keyword.length || done.length) {
    out.push("## Left alone", "");
    for (const r of [...keyword, ...done]) out.push(`- ${r.cardId} ${skillLabel(r.side, r.skillIndex)}: ${r.state === "keyword" ? "keyword line (health done)" : `${r.status}/${r.source}`}`);
    out.push("");
  }
  out.push("## Not done / caveats", "", "- <what the probe could not reach, what stayed unverified>", "");
  return out.join("\n");
}
