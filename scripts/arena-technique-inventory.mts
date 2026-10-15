/** Offline research only; never imported by the arena runtime.
 * npx tsx scripts/arena-technique-inventory.mts --input work/masters-catalog.json --date YYYY-MM-DD
 * Quotes preserve the cached catalog's exact unstyled text (including <br>).
 */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const args = process.argv.slice(2);
const option = (name: string) => args[args.indexOf(name) + 1];
if (!args.includes("--input") || !args.includes("--date")) {
  throw new Error("Required: --input <cached JSON array> --date <research YYYY-MM-DD>");
}
const date = option("--date");
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid research date");
const input = await readFile(option("--input"), "utf8");
const cards: Record<string, unknown>[] = JSON.parse(input);
if (!Array.isArray(cards)) throw new Error("Expected a flat cached catalog array");
const candidates = [
  ["kamehameha", ["Kamehameha"]],
  ["final-flash", ["Final Flash"]],
  ["galick-gun", ["Galick Gun"]],
  ["big-bang-attack", ["Big Bang Attack"]],
  ["masenko", ["Masenko"]],
  ["special-beam-cannon", ["Special Beam Cannon", "Makankosappo"]],
  ["destructo-disc", ["Destructo Disc", "Destructo Disk", "Kienzan"]],
  ["solar-flare", ["Solar Flare"]],
  ["death-beam", ["Death Beam"]],
  ["death-ball", ["Death Ball"]],
  ["supernova", ["Supernova", "Super Nova"]],
  ["spirit-bomb", ["Spirit Bomb"]],
] as const;
const sorted = [...cards].sort((a, b) => Number(a.id) - Number(b.id));
const inventory = candidates.map(([id, aliases]) => {
  const patterns = aliases.map((alias) => ({ alias, pattern: new RegExp(
    `(?<![\\p{L}\\p{N}])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "giu",
  ) }));
  const seen = new Set<string>();
  const matches = sorted.flatMap((card) => (["front", "back"] as const).flatMap((face) => {
    const key = `${card.id}:${face}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const prefix = face === "front" ? "card_" : "card_back_";
    const title = card[`${prefix}name`];
    const skill = card[`${prefix}skill_unstyled`];
    const evidence = ([['title', title], ['skill', skill]] as const).flatMap(([field, text]) => {
      if (typeof text !== "string") return [];
      return patterns.flatMap(({ alias, pattern }) => {
        // Do not match within HTML tag names/attributes. Keep the original quote intact.
        const searchable = text.replace(/<[^>]*>/g, (tag) => " ".repeat(tag.length));
        const occurrences = [...searchable.matchAll(pattern)].map((match) => ({
          exactMention: match[0], offset: match.index,
        }));
        return occurrences.length ? [{ field, alias, quote: text, occurrences }] : [];
      });
    });
    if (!evidence.length) return [];
    return [{ catalogId: card.id, cardNumber: card.card_number, variantOf: card.variant_of ?? null,
      face, title: typeof title === "string" ? title : null, evidence }];
  }));
  return {
    id, aliases: aliases.map((text) => ({ text, status: "unverified-alias", officialSources: [] })),
    reviewStatus: "candidate-pending-review", voice: "unavailable", runtimeMappingApproved: false,
    mentionCount: matches.reduce((total, match) => total + match.evidence.reduce(
      (sum, evidence) => sum + evidence.occurrences.length, 0), 0),
    matchedPrintFaceCount: matches.length,
    distinctCardNumberCount: new Set(matches.map((match) => match.cardNumber)).size,
    matches,
  };
});
const output = {
  schemaVersion: 1,
  purpose: "Offline candidate research; no named technique audio or runtime mapping is approved.",
  source: {
    url: "https://api.deckplanet.net/cardsearch/dbs_masters_cards?limit=500&page=1",
    pagination: "Cached flattened array; API page count and retrieval time unavailable in this cache.",
    researchDate: date, retrievalDate: null,
    sha256: createHash("sha256").update(input).digest("hex"), rows: cards.length,
    authority: "Third-party catalog transcription; printed-card/official alias review still required.",
  },
  method: {
    fields: ["card_name", "card_skill_unstyled", "card_back_name", "card_back_skill_unstyled"],
    matching: "Case-insensitive literal alias, Unicode letter/number boundaries; excludes HTML tags. No fuzzy, character, art, substring, or transliteration inference.",
    deduplication: "One record per catalog id and face per candidate; alternate print ids remain explicit. Distinct card-number count is separate.",
    counts: "Literal title/skill occurrences in this cached sample, including quoted references to other cards; not usage, popularity, character ownership, or an attack execution claim.",
    aliasEvidence: "No official alias sources verified offline. Grouped alternate names are research hypotheses, not verified equivalences.",
    quotes: "Exact cached unstyled field strings; HTML breaks retained. Not a claim of image-verified printed transcription.",
  },
  candidates: inventory,
};
await writeFile(args.includes("--output") ? option("--output") : "docs/arena-immersion-techniques.json", `${JSON.stringify(output, null, 2)}\n`);
console.log(inventory.map(({ id, mentionCount, matchedPrintFaceCount }) => `${id}: ${mentionCount} mentions / ${matchedPrintFaceCount} print faces`).join("\n"));
