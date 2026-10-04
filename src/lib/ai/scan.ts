/**
 * Card identification from a photo (single card or several in frame).
 *
 * Claude reads the image and lists every card it can see with its printed
 * number, name and rough position; each is then matched against the local
 * catalog (exact number first, fuzzy name second) and given a match
 * confidence (`assessMatch`). The photo is never stored — only the matched
 * catalog card is, on confirmation. Several photos = several calls; the
 * client fans them out one request each.
 */
import { sql } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import type { Db } from "@/db";
import { cardPrints } from "@/db/schema";
import { quickSearch } from "@/lib/catalog/queries";
import { generateJson } from "./core";
import { AiError } from "./errors";
import { SONNET_MODEL, recordRun } from "./client";
import { assessMatch, cleanBox, needsOpusFallback, normaliseNumber, type Box, type MatchedBy } from "./scan-match";
import type { AiResult } from "./types";

/** Longest edge sent to the model; keeps image tokens bounded (~1.2k per image). */
const MAX_EDGE = 1568;

export const ScanSchema = z.object({
  cards: z
    .array(
      z.object({
        name: z.string().describe("Card name as printed (front side for leaders)"),
        number: z.string().nullable().describe("Card number as printed, e.g. BT18-020 or P-181; null if unreadable"),
        confidence: z
          .number()
          .describe("0–1: how sure you are that the number AND name are read correctly. 0.95+ only when every character of the number is clearly legible; 0.5 or lower when you guessed any digit."),
        position: z.string().describe("Where in the photo: e.g. 'top-left', 'row 2 col 3', 'only card'"),
        box: z
          .object({
            x: z.number().describe("Left edge as a fraction of image width, 0–1"),
            y: z.number().describe("Top edge as a fraction of image height, 0–1"),
            w: z.number().describe("Width as a fraction of image width, 0–1"),
            h: z.number().describe("Height as a fraction of image height, 0–1"),
          })
          .nullable()
          .describe("Approximate bounding box of this card's face in the photo; null if you cannot place it"),
        notes: z.string().nullable().describe("Glare, cut-off, foil/alt-art hints, language"),
      }),
    )
    .max(40),
  unreadable: z.number().int().describe("Count of cards visible but not identifiable"),
});
export type ScanResult = z.infer<typeof ScanSchema>;

export interface ScanCandidate {
  id: string;
  name: string;
  setCode: string;
  imageUrl: string | null;
  cardType: string;
  colors: string[];
  rarityCode: string;
  prints: { id: string; label: string }[];
}

export interface ScanDetection {
  index: number;
  seen: Omit<ScanResult["cards"][number], "box"> & { box: Box | null };
  /** Best match first. Empty when nothing plausible was found. */
  candidates: ScanCandidate[];
  /** True when the printed number matched a catalog id directly. */
  exact: boolean;
  matchedBy: MatchedBy;
  /** 0..1 — how likely `candidates[0]` is the card in the photo (0 when unmatched). */
  matchConfidence: number;
}

export interface PreparedImage {
  data: string;
  mediaType: "image/jpeg";
  /** The exact bytes sent to the model — stored with a scan batch so crops line up. */
  buffer: Buffer;
  width: number;
  height: number;
}

export async function prepareImage(buf: Buffer): Promise<PreparedImage> {
  const { data: out, info } = await sharp(buf)
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  return { data: out.toString("base64"), mediaType: "image/jpeg", buffer: out, width: info.width, height: info.height };
}

const SCAN_SYSTEM =
  "You identify Dragon Ball Super Card Game cards (Bandai). Both of Bandai's lines are in scope and a photo may mix them: the original game numbers cards like BT18-020, SD22-02, EX13-16, P-181, TB1-005, DB2-010, and Fusion World like FB07-021, FS01-01, FP-060, SB01-046, ST01-014. Report numbers exactly as printed; if unsure of a digit, lower the confidence rather than guess. For every card also give a bounding box (fractions of the image) around its face so the user can compare it with the catalog art.";

function scanInstruction(mode: "single" | "batch"): string {
  return mode === "single"
    ? "This photo shows one Dragon Ball Super Card Game card, from either the original game or Fusion World. Identify it: read the card number printed in the bottom corner and the name."
    : "This photo shows several Dragon Ball Super Card Game cards (a binder page, a spread, or a pile), from either the original game or Fusion World, possibly mixed. List every distinct card you can see, reading each card number and name. Work systematically across the image, left to right then top to bottom.";
}

/** One read of one photo on the given tier. Sonnet and Opus take the same request shape. */
export function readPhoto(tier: "standard" | "best", prepared: Pick<PreparedImage, "data" | "mediaType">, mode: "single" | "batch") {
  return generateJson({
    task: "scan_identify",
    tier,
    maxTokens: 8000,
    thinking: "adaptive",
    effort: "medium",
    schema: ScanSchema,
    system: [{ text: SCAN_SYSTEM }],
    messages: [
      {
        role: "user",
        parts: [
          { type: "image", mediaType: prepared.mediaType, base64: prepared.data },
          { type: "text", text: scanInstruction(mode) },
        ],
      },
    ],
  });
}

type ScanRead = AiResult<ScanResult>;

/**
 * Sonnet first, Opus only when Sonnet's answer is unparseable (`bad_output`)
 * or low-confidence ({@link needsOpusFallback}). A refusal, or any other
 * error such as a rejected key or a rate limit, is not retried on Opus.
 * Returns every read that came back, in order, so the caller can record each
 * one; the last is the answer.
 */
export async function readPhotoTiered(prepared: Pick<PreparedImage, "data" | "mediaType">, mode: "single" | "batch"): Promise<{ model: string; res: ScanRead; fallbackFrom?: string }[]> {
  let first: ScanRead | null = null;
  try {
    first = await readPhoto("standard", prepared, mode);
  } catch (err) {
    if (!(err instanceof AiError) || err.kind !== "bad_output") throw err;
  }
  if (first?.parsed && !needsOpusFallback(first.parsed, mode)) return [{ model: first.model, res: first }];
  // An unparseable first read has no model on it; the standard tier's model is what it ran on.
  const second = { model: "", res: await readPhoto("best", prepared, mode), fallbackFrom: first?.model ?? SONNET_MODEL };
  second.model = second.res.model;
  return first?.parsed ? [{ model: first.model, res: first }, second] : [second];
}

export async function identifyCards(
  db: Db,
  image: Buffer | PreparedImage,
  mode: "single" | "batch",
): Promise<{ runId: number; result: ScanResult; detections: ScanDetection[]; prepared: PreparedImage }> {
  const prepared = Buffer.isBuffer(image) ? await prepareImage(image) : image;

  let id = 0;
  let output!: ScanResult;
  for (const r of await readPhotoTiered(prepared, mode)) {
    ({ id, output } = await recordRun<ScanResult>(db, "scan_identify", { mode, ...(r.fallbackFrom ? { fallbackFrom: r.fallbackFrom } : {}) }, r.res));
  }

  // Each card on the photo is matched on its own, so all of them at once: a
  // nine-card binder page was nine rounds of lookups one after another.
  const detections: ScanDetection[] = await Promise.all(
    output.cards.map(async (card, index) => {
      const seen = { ...card, box: cleanBox(card.box) };
      const { list, exact } = await matchDetection(db, seen);
      const { matchedBy, confidence } = assessMatch(seen, list[0] ?? null, exact);
      return { index, seen, candidates: list, exact, matchedBy, matchConfidence: confidence };
    }),
  );
  return { runId: id, result: output, detections, prepared };
}

export async function matchDetection(db: Db, seen: { name: string; number: string | null }): Promise<{ list: ScanCandidate[]; exact: boolean }> {
  const number = normaliseNumber(seen.number);
  const base = number?.split("_")[0] ?? null;
  const found = new Map<string, ScanCandidate>();
  let exact = false;

  // Every id looked up at once, then added in the order asked, so the list
  // reads exactly as it did when they were looked up one by one.
  const push = async (ids: string[]) => {
    const todo = [...new Set(ids)].filter((id) => !found.has(id));
    const looked = await Promise.all(
      todo.map(async (id) => {
        const [hits, prints] = await Promise.all([
          quickSearch(db, id, 1),
          db
            .select({ id: cardPrints.id, label: cardPrints.label })
            .from(cardPrints)
            .where(sql`${cardPrints.cardId} = ${id}`)
            .orderBy(cardPrints.isBase),
        ]);
        const hit = hits.find((h) => h.id === id);
        return hit ? { ...hit, prints: prints.reverse() } : null;
      }),
    );
    for (const [i, id] of todo.entries()) if (looked[i]) found.set(id, looked[i]);
  };

  if (base) {
    await push([base]);
    exact = found.size > 0;
  }
  if (!exact && seen.name) {
    const byName = await quickSearch(db, seen.name, 4);
    await push(byName.map((h) => h.id));
  }
  return { list: [...found.values()], exact };
}
