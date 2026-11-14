/**
 * The pure parts of the Pokémon deck screens (docs/pokemon/design.md §6): what the panel says about
 * the size, how a handful of legality issues becomes a few short lines, which cards are missing and
 * the sentence for the one refusal (marking a deck built that would over-reserve).
 *
 * No database, no React: the deck page, the actions and `scripts/verify/pokemon-decks.mts` share it.
 * The legality texts are already German (`pokemonLegality.ts`); this only shortens and orders them.
 */
import type { DeckIssue, IssueSeverity } from "@/lib/decks/legality";
import { PK } from "./copy";

export const DECK_SIZE = 60;

// ── Size ─────────────────────────────────────────────────────────────────────

export interface DeckProgress {
  /** 0 to 100, for the bar. */
  pct: number;
  state: "short" | "exact" | "over";
  /** "Noch 13 Karten bis 60", "Genau 60 Karten", "3 Karten zu viel". */
  text: string;
}

export function deckProgress(count: number): DeckProgress {
  const n = Math.max(0, Math.floor(count));
  if (n < DECK_SIZE) return { pct: Math.round((n / DECK_SIZE) * 100), state: "short", text: PK.decks.progressShort(DECK_SIZE - n) };
  if (n === DECK_SIZE) return { pct: 100, state: "exact", text: PK.decks.progressExact };
  return { pct: 100, state: "over", text: PK.decks.progressOver(n - DECK_SIZE) };
}

// ── Issues ───────────────────────────────────────────────────────────────────

export interface IssueLine {
  severity: IssueSeverity;
  text: string;
}

export interface IssueSummary {
  /** At most `max` lines, the worst first. */
  lines: IssueLine[];
  /** How many more there are ("und 2 weitere"). */
  more: number;
}

/** The size lines of `pokemonLegality` ("Noch 13 Karten bis 60", "3 Karten zu viel (höchstens 60)"): the progress bar says them. */
const SIZE_ISSUE = /^(Noch \d+ Karten? bis \d+|\d+ Karten? zu viel \(höchstens \d+\))$/;
/** "Glurak ist im Standard-Format nicht mehr erlaubt": one line per card, the same rule for all of them. */
const FORMAT_ISSUE = /^.+ ist im (.+)-Format nicht mehr erlaubt$/;
/** "Für 3 Karten ist die Legalität im Standard-Format unbekannt: A, B, C" (or "Für eine Karte ..."). */
const UNKNOWN_ISSUE = /^Für (eine|\d+) Karten? ist die Legalität im (.+)-Format unbekannt: .+$/;

const RANK: Record<IssueSeverity, number> = { illegal: 0, incomplete: 1, warning: 2 };

/**
 * The deck's issues as a few short lines. Many cards that fail the same format rule become one line
 * ("11 Karten sind im Standard-Format nicht mehr erlaubt (unten markiert)": the rows carry the flags);
 * a single card keeps its own sentence. The size is left out (the bar shows it). Worst first, then at
 * most `max` lines and a count of the rest.
 */
export function summariseIssues(issues: readonly DeckIssue[], max = 4): IssueSummary {
  const kept = issues.filter((i) => !SIZE_ISSUE.test(i.message));

  // Group the format issues by format; one card keeps its sentence, several become one line.
  const byFormat = new Map<string, DeckIssue[]>();
  for (const i of kept) {
    const m = FORMAT_ISSUE.exec(i.message);
    if (m) byFormat.set(m[1], [...(byFormat.get(m[1]) ?? []), i]);
  }

  const out: IssueLine[] = [];
  const done = new Set<string>();
  for (const i of kept) {
    const f = FORMAT_ISSUE.exec(i.message);
    if (f) {
      const group = byFormat.get(f[1])!;
      const cardsFailing = new Set(group.map((g) => g.cardId ?? g.message)).size;
      if (cardsFailing < 2) out.push({ severity: i.severity, text: i.message });
      else if (!done.has(f[1])) {
        done.add(f[1]);
        out.push({ severity: "illegal", text: PK.decks.formatCollapsed(cardsFailing, f[1]) });
      }
      continue;
    }
    const u = UNKNOWN_ISSUE.exec(i.message);
    if (u) {
      // The card names are on the rows; the line only counts them.
      const n = u[1] === "eine" ? 1 : Number(u[1]);
      out.push({ severity: i.severity, text: n === 1 ? i.message.replace(/: .+$/, " (unten markiert)") : PK.decks.unknownCollapsed(n, u[2]) });
      continue;
    }
    out.push({ severity: i.severity, text: i.message });
  }

  const ordered = out.map((l, i) => ({ l, i })).sort((a, b) => RANK[a.l.severity] - RANK[b.l.severity] || a.i - b.i).map((x) => x.l);
  return { lines: ordered.slice(0, max), more: Math.max(0, ordered.length - max) };
}

// ── Missing copies ───────────────────────────────────────────────────────────

export interface MissingInput {
  cardId: string;
  quantity: number;
  /** The deck owner's copies of this card (`alloc.owned`, every print and language). */
  owned: number;
}

export interface MissingLine {
  cardId: string;
  /** Copies the deck holds, over every zone. */
  needed: number;
  owned: number;
  missing: number;
}

/**
 * Which cards the owner has too few of for this deck. A card counts once however many rows hold it;
 * what is reserved by other built decks does not matter here (a virtual deck may use any card; the one
 * refusal, `builtRefusal`, is about built decks).
 */
export function missingCopies(rows: readonly MissingInput[]): { lines: MissingLine[]; total: number } {
  const byCard = new Map<string, MissingLine>();
  for (const r of rows) {
    const e = byCard.get(r.cardId) ?? { cardId: r.cardId, needed: 0, owned: r.owned, missing: 0 };
    e.needed += Math.max(0, r.quantity);
    byCard.set(r.cardId, e);
  }
  const lines = [...byCard.values()].map((e) => ({ ...e, missing: Math.max(0, e.needed - e.owned) })).filter((e) => e.missing > 0);
  return { lines, total: lines.reduce((n, e) => n + e.missing, 0) };
}

/** What to wish for so that the wish covers what is missing, given what is wished already (never lowers a wish). */
export function wishesToAdd(missing: readonly MissingLine[], wished: Readonly<Record<string, number>>): { cardId: string; add: number }[] {
  return missing.map((m) => ({ cardId: m.cardId, add: Math.max(0, m.missing - (wished[m.cardId] ?? 0)) })).filter((x) => x.add > 0);
}

// ── Why a card is wished (design §8) ─────────────────────────────────────────

export interface DeckNeed {
  deckId: number;
  deckName: string;
  cardId: string;
  /** Copies the deck holds (one row per zone adds up). */
  quantity: number;
}

/**
 * For each card, the decks that hold more copies of it than the owner has, in the order the decks come
 * (oldest first). This is what "fehlt im Deck …" on the wishes screen says. It is derived from the decks
 * as they are now, not read from `want_list.deck_id`, which keeps only the deck of the first wish and
 * goes stale when the deck changes.
 */
export function wishReasons(needs: readonly DeckNeed[], ownedByCard: Readonly<Record<string, number>>): Map<string, string[]> {
  const perDeck = new Map<string, { deckId: number; deckName: string; cardId: string; quantity: number }>();
  for (const n of needs) {
    const key = `${n.deckId}\u0000${n.cardId}`;
    const e = perDeck.get(key) ?? { deckId: n.deckId, deckName: n.deckName, cardId: n.cardId, quantity: 0 };
    e.quantity += Math.max(0, n.quantity);
    perDeck.set(key, e);
  }
  const out = new Map<string, string[]>();
  for (const e of [...perDeck.values()].sort((a, b) => a.deckId - b.deckId)) {
    if (e.quantity <= (ownedByCard[e.cardId] ?? 0)) continue;
    out.set(e.cardId, [...(out.get(e.cardId) ?? []), e.deckName]);
  }
  return out;
}

/** "fehlt im Deck „A“", or "fehlt im Deck „A“ und 2 weitere" (the first deck, then how many more). */
export function reasonLine(deckNames: readonly string[]): string | null {
  if (deckNames.length === 0) return null;
  return deckNames.length === 1 ? PK.wishes.missingIn(deckNames[0]) : PK.wishes.missingInMore(deckNames[0], deckNames.length - 1);
}

// ── The one refusal ──────────────────────────────────────────────────────────

export interface RefusalConflict {
  name: string;
  short: number;
  reservedElsewhere: number;
}

/** "Das Deck kann nicht als gebaut gelten. Dir fehlen: 2 × Glutexo, 1 × Glumanda." */
export function builtRefusal(conflicts: readonly RefusalConflict[], show = 5): string {
  if (conflicts.length === 0) return "";
  const named = conflicts.slice(0, show).map((c) => `${c.short} × ${c.name}`);
  const rest = conflicts.length - named.length;
  const list = rest > 0 ? `${named.join(", ")} und ${rest} weitere ${rest === 1 ? "Karte" : "Karten"}` : named.join(", ");
  const elsewhere = conflicts.some((c) => c.reservedElsewhere > 0) ? " Manche Karten stecken schon in einem anderen gebauten Deck." : "";
  return `Das Deck kann noch nicht als gebaut gelten. Dir fehlen: ${list}.${elsewhere}`;
}

// ── Labels ───────────────────────────────────────────────────────────────────

export type DeckStatusKey = "legal" | "incomplete" | "illegal";

export const statusLabel = (status: DeckStatusKey): string => PK.decks.status[status];

/** A card's group heading key for the deck list; a card type outside the three goes to "Andere". */
export function groupKeyOf(cardType: string, groups: readonly string[]): string {
  return groups.includes(cardType) ? cardType : "OTHER";
}
