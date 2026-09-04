/**
 * Pure helpers for turning what Claude read off a photo into a catalog match
 * with an honest confidence figure. No I/O — covered by scripts/verify-rules.ts.
 */

export type MatchedBy = "number" | "number-name-differs" | "name" | null;

/**
 * Set codes that carry no number of their own, so every digit after the
 * letters is part of the card number. Without this "P181" splits as "P1-81"
 * and "FP060" as "FP0-60", because the pattern below cannot otherwise tell a
 * set's digits from the card's. Sets whose code *does* end in digits ("E01")
 * still work: they arrive with four digits and fall through to the pattern.
 */
const BARE_SET_CODES = new Set(["P", "FP", "E"]);

/** Canonicalise a printed number: "bt18 020" → "BT18-020", "P 181" → "P-181", "BT18-020 SPR" → "BT18-020_SPR". */
export function normaliseNumber(n: string | null): string | null {
  if (!n) return null;
  const s = n.trim().toUpperCase().replace(/\s+/g, "").replace(/[–—]/g, "-");
  // Common OCR slips: "BT18 020" → "BT18-020", "0" vs "O" after the letter prefix.
  const fixed = s.replace(/O/g, (ch, i) => (i < 2 ? ch : "0"));
  // The print suffix has to start with a letter or "_", so "E0103" is not read
  // as E-010 with a stray "3" — it falls through and comes out as E01-03.
  const bare = /^([A-Z]{1,5})(\d{2,3})(_?[A-Z][A-Z0-9_]*)?$/.exec(fixed);
  if (bare && BARE_SET_CODES.has(bare[1])) {
    return `${bare[1]}-${bare[2]}${bare[3] ? `_${bare[3].replace(/^_/, "")}` : ""}`;
  }
  const m = /^([A-Z]{1,5})(\d{1,2})?-?(\d{2,3})([A-Z0-9_]*)$/.exec(fixed);
  if (!m) return s;
  return `${m[1]}${m[2] ?? ""}-${m[3]}${m[4] ? `_${m[4].replace(/^_/, "")}` : ""}`;
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter(Boolean),
  );
}

/** Dice coefficient over word tokens, 0..1. Tolerates punctuation and word order. */
export function nameSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return (2 * common) / (ta.size + tb.size);
}

export interface MatchAssessment {
  matchedBy: MatchedBy;
  /** 0..1 — how likely the top candidate is the card in the photo. */
  confidence: number;
  /** Similarity between the name Claude read and the catalog name. */
  nameSimilarity: number;
}

/**
 * Combine Claude's read-confidence with how the catalog match was made.
 *  - number matched and the name agrees → Claude's confidence as-is
 *  - number matched but the name disagrees → halved (a digit was likely misread)
 *  - name-only match → capped: the number was unreadable or is not in the catalog
 */
export function assessMatch(seen: { name: string; confidence: number }, candidate: { name: string } | null, exactNumber: boolean): MatchAssessment {
  if (!candidate) return { matchedBy: null, confidence: 0, nameSimilarity: 0 };
  const read = Math.min(1, Math.max(0, seen.confidence));
  const sim = nameSimilarity(seen.name, candidate.name);
  const round = (x: number) => Math.round(x * 100) / 100;
  if (exactNumber) {
    return sim >= 0.5
      ? { matchedBy: "number", confidence: round(read), nameSimilarity: sim }
      : { matchedBy: "number-name-differs", confidence: round(read * 0.5), nameSimilarity: sim };
  }
  return { matchedBy: "name", confidence: round(read * (sim >= 0.8 ? 0.6 : 0.4)), nameSimilarity: sim };
}

/** Rows at or above this are shown as confident; below it they land in the "needs review" filter. */
export const REVIEW_THRESHOLD = 0.8;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Clamp a model-supplied bounding box (fractions of the image) to something drawable, or drop it. */
export function cleanBox(box: Partial<Box> | null | undefined): Box | null {
  if (!box) return null;
  const { x, y, w, h } = box;
  if (![x, y, w, h].every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  const cx = r4(Math.min(Math.max(x!, 0), 1));
  const cy = r4(Math.min(Math.max(y!, 0), 1));
  const cw = r4(Math.min(Math.max(w!, 0), 1 - cx));
  const ch = r4(Math.min(Math.max(h!, 0), 1 - cy));
  if (cw < 0.02 || ch < 0.02) return null;
  return { x: cx, y: cy, w: cw, h: ch };
}
