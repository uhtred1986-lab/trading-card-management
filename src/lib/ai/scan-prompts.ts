/**
 * What the scan model is told, per game. Pure text and schemas, no I/O, so the prompt a game gets
 * can be tested without a model call.
 *
 * Dragon Ball (both `dbs` and `fusion`: one prompt covers Bandai's two lines, and a photo may mix
 * them) keeps the exact text it has always had; Pokemon has its own.
 */
import { z } from "zod";
import type { Game } from "@/lib/catalog/games";

export const DBS_SCAN_SYSTEM =
  "You identify Dragon Ball Super Card Game cards (Bandai). Both of Bandai's lines are in scope and a photo may mix them: the original game numbers cards like BT18-020, SD22-02, EX13-16, P-181, TB1-005, DB2-010, and Fusion World like FB07-021, FS01-01, FP-060, SB01-046, ST01-014. Report numbers exactly as printed; if unsure of a digit, lower the confidence rather than guess. For every card also give a bounding box (fractions of the image) around its face so the user can compare it with the catalog art.";

export function dbsScanInstruction(mode: "single" | "batch"): string {
  return mode === "single"
    ? "This photo shows one Dragon Ball Super Card Game card, from either the original game or Fusion World. Identify it: read the card number printed in the bottom corner and the name."
    : "This photo shows several Dragon Ball Super Card Game cards (a binder page, a spread, or a pile), from either the original game or Fusion World, possibly mixed. List every distinct card you can see, reading each card number and name. Work systematically across the image, left to right then top to bottom.";
}

/** What the model reads off one Pokemon card. Same style as the Dragon Ball `ScanSchema`. */
export const PokemonScanSchema = z.object({
  cards: z
    .array(
      z.object({
        name: z.string().describe("Card name as printed, in the card's own language (e.g. 'Glurak-ex' or 'Charizard ex'), including ex, V, VMAX, VSTAR or GX"),
        language: z.enum(["DE", "EN"]).nullable().describe("Language the card is printed in: DE for German, EN for English; null if you cannot tell"),
        number: z.string().nullable().describe("Collector number and set size from the bottom edge exactly as printed, e.g. '006/165'; just the number (or a promo code like 'SWSH062') when there is no slash; null if unreadable"),
        setCode: z.string().nullable().describe("Set code or symbol letters if printed next to the number (e.g. 'MEW', 'PAL'); null if none"),
        regulationMark: z.string().nullable().describe("Regulation mark, a single letter in a small box (e.g. 'G'); null if none"),
        finish: z.enum(["normal", "holo", "reverse", "unknown"]).describe("holo: the art box shines; reverse: the whole card except the art box shines; normal: no shine; unknown: cannot tell from the photo"),
        confidence: z
          .number()
          .describe("0-1: how sure you are that the number AND name are read correctly. 0.95+ only when every character of the number is clearly legible; 0.5 or lower when you guessed any digit."),
        position: z.string().describe("Where in the photo: e.g. 'top-left', 'row 2 col 3', 'only card'"),
        box: z
          .object({
            x: z.number().describe("Left edge as a fraction of image width, 0-1"),
            y: z.number().describe("Top edge as a fraction of image height, 0-1"),
            w: z.number().describe("Width as a fraction of image width, 0-1"),
            h: z.number().describe("Height as a fraction of image height, 0-1"),
          })
          .nullable()
          .describe("Approximate bounding box of this card's face in the photo; null if you cannot place it"),
        notes: z.string().nullable().describe("Glare, cut-off, sleeve reflections"),
      }),
    )
    .max(40),
  unreadable: z.number().int().describe("Count of cards visible but not identifiable"),
});
export type PokemonScanResult = z.infer<typeof PokemonScanSchema>;

export const POKEMON_SCAN_SYSTEM =
  "You identify Pokemon Trading Card Game cards. A photo may mix German and English cards. For every card read: the name as printed in the card's own language (keep ex, V, VMAX, VSTAR and GX in the name); the language the card is printed in (DE or EN); the collector number with the set size from the bottom edge exactly as printed, like 006/165 (a promo may print only a code like SWSH062); the set code if one is printed beside the number; the regulation mark, the single letter in a small box; and whether the card looks holo, reverse holo or plain. Report the number exactly as printed; if unsure of a digit, lower the confidence rather than guess. For every card also give a bounding box (fractions of the image) around its face so the user can compare it with the catalog art.";

export function pokemonScanInstruction(mode: "single" | "batch"): string {
  return mode === "single"
    ? "This photo shows one Pokemon Trading Card Game card. Identify it: read the name, the collector number with the set size printed along the bottom edge (like 006/165), and the language the card is printed in."
    : "This photo shows several Pokemon Trading Card Game cards (a binder page of up to nine cards, a spread, or a pile), possibly in both German and English. List every distinct card you can see, reading each name, collector number with set size, and language. Work systematically across the image, left to right then top to bottom, and give each card's box.";
}

export interface ScanPrompt {
  system: string;
  instruction: string;
}

/** The system prompt and the instruction a game's scan is sent with. Both Dragon Ball lines share theirs. */
export function scanPromptFor(game: Game, mode: "single" | "batch"): ScanPrompt {
  if (game === "pokemon") return { system: POKEMON_SCAN_SYSTEM, instruction: pokemonScanInstruction(mode) };
  return { system: DBS_SCAN_SYSTEM, instruction: dbsScanInstruction(mode) };
}
