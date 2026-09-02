/**
 * Card identification from a photo (single card or several in frame).
 *
 * Claude reads the image and lists every card it can see with its printed
 * number and name; each is then matched against the local catalog (exact
 * number first, fuzzy name second). The photo is never stored — only the
 * matched catalog card is, on confirmation.
 */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { sql } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import type { Db } from "@/db";
import { cardPrints } from "@/db/schema";
import { quickSearch } from "@/lib/catalog/queries";
import { MODEL, anthropic, recordRun } from "./client";

/** Longest edge sent to the model; keeps image tokens bounded (~1.2k per image). */
const MAX_EDGE = 1568;

export const ScanSchema = z.object({
  cards: z
    .array(
      z.object({
        name: z.string().describe("Card name as printed (front side for leaders)"),
        number: z.string().nullable().describe("Card number as printed, e.g. BT18-020 or P-181; null if unreadable"),
        confidence: z.number().min(0).max(1),
        position: z.string().describe("Where in the photo: e.g. 'top-left', 'row 2 col 3', 'only card'"),
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
  seen: ScanResult["cards"][number];
  /** Best match first. Empty when nothing plausible was found. */
  candidates: ScanCandidate[];
  exact: boolean;
}

export async function prepareImage(buf: Buffer): Promise<{ data: string; mediaType: "image/jpeg" }> {
  const out = await sharp(buf).rotate().resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  return { data: out.toString("base64"), mediaType: "image/jpeg" };
}

export async function identifyCards(db: Db, image: Buffer, mode: "single" | "batch"): Promise<{ runId: number; result: ScanResult; detections: ScanDetection[] }> {
  const { data, mediaType } = await prepareImage(image);
  const instruction =
    mode === "single"
      ? "This photo shows one Dragon Ball Super Card Game card. Identify it: read the card number printed in the bottom corner and the name."
      : "This photo shows several Dragon Ball Super Card Game cards (a binder page, a spread, or a pile). List every distinct card you can see, reading each card number and name. Work systematically across the image.";

  const res = await anthropic().messages.parse({
    model: MODEL,
    max_tokens: 6000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: zodOutputFormat(ScanSchema) },
    system:
      "You identify Dragon Ball Super Card Game cards (Bandai; not Fusion World). Card numbers look like BT18-020, SD22-02, EX13-16, P-181, TB1-005, DB2-010. Report numbers exactly as printed; if unsure of a digit, lower the confidence rather than guess.",
    messages: [
      {
        role: "user",
        content: [{ type: "image", source: { type: "base64", media_type: mediaType, data } }, { type: "text", text: instruction }],
      },
    ],
  });
  const { id, output } = await recordRun<ScanResult>(db, "scan_identify", { mode }, res);

  const detections: ScanDetection[] = [];
  for (const [index, seen] of output.cards.entries()) {
    const candidates = await matchDetection(db, seen);
    detections.push({ index, seen, candidates: candidates.list, exact: candidates.exact });
  }
  return { runId: id, result: output, detections };
}

function normaliseNumber(n: string | null): string | null {
  if (!n) return null;
  const s = n.trim().toUpperCase().replace(/\s+/g, "").replace(/[–—]/g, "-");
  // Common OCR slips: "BT18 020" → "BT18-020", "0" vs "O" in the prefix.
  const m = /^([A-Z]{1,5})(\d{1,2})?-?(\d{2,3})([A-Z0-9_]*)$/.exec(s.replace(/O/g, (ch, i) => (i < 2 ? ch : "0")));
  if (!m) return s;
  return `${m[1]}${m[2] ?? ""}-${m[3]}${m[4] ? `_${m[4].replace(/^_/, "")}` : ""}`;
}

async function matchDetection(db: Db, seen: ScanResult["cards"][number]): Promise<{ list: ScanCandidate[]; exact: boolean }> {
  const number = normaliseNumber(seen.number);
  const base = number?.split("_")[0] ?? null;
  const found = new Map<string, ScanCandidate>();
  let exact = false;

  const push = async (ids: string[]) => {
    for (const id of ids) {
      if (found.has(id)) continue;
      const hits = await quickSearch(db, id, 1);
      const hit = hits.find((h) => h.id === id);
      if (!hit) continue;
      const prints = await db.select({ id: cardPrints.id, label: cardPrints.label }).from(cardPrints).where(sql`${cardPrints.cardId} = ${id}`).orderBy(cardPrints.isBase);
      found.set(id, { ...hit, prints: prints.reverse() });
    }
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

