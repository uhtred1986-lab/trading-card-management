/**
 * `npm run ai:scan-compare -- [--dir <folder>] [--limit 20] [--mode single|batch]`
 *
 * Proves #381's scan change: for each saved photo, reads it with the old setup
 * (Opus alone) and the new one (Sonnet, Opus fallback via `readPhotoTiered`),
 * matches both against the catalog, and lists the photos where the matched
 * card ids differ. The PR's acceptance is identical matches on at least 20 photos.
 *
 * COSTS REAL MONEY (about two to three scan calls per photo) and needs
 * ANTHROPIC_API_KEY and DATABASE_URL, so the owner runs it, not an agent.
 * Photos come from `scan_photos` (only batches still open keep their bytes;
 * a completed batch drops them) or, with --dir, from a folder of jpg/png/webp
 * files, which still needs the database for the catalog match.
 *
 * Exit code 1 when any photo differs or fewer than 20 photos were compared.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const { sql } = await import("drizzle-orm");
const { db } = await import("../src/db/index.ts");
const { rows } = await import("../src/db/rows.ts");
const { MODEL, SONNET_MODEL, hasAnthropic } = await import("../src/lib/ai/client.ts");
const { prepareImage, readPhoto, readPhotoTiered, matchDetection } = await import("../src/lib/ai/scan.ts");
const { assessMatch, cleanBox } = await import("../src/lib/ai/scan-match.ts");
type Prepared = Awaited<ReturnType<typeof prepareImage>>;

if (!hasAnthropic()) {
  console.error("ANTHROPIC_API_KEY (or APP_ANTHROPIC_API_KEY) is not set.");
  process.exit(2);
}

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const limit = Math.max(1, Number(arg("limit") ?? 20) || 20);
const dir = arg("dir");
const modeArg = arg("mode");

type Photo = { label: string; mode: "single" | "batch"; prepared: Prepared };
const photos: Photo[] = [];
if (dir) {
  const mode = modeArg === "single" ? "single" : "batch";
  for (const f of readdirSync(dir).filter((n) => /\.(jpe?g|png|webp)$/i.test(n)).sort().slice(0, limit)) {
    photos.push({ label: f, mode, prepared: await prepareImage(readFileSync(join(dir, f))) });
  }
} else {
  type Row = { id: number; batch_id: number; mode: string; data: Buffer | Uint8Array };
  const found = rows<Row>(
    await db.execute(sql`
      select p.id, p.batch_id, b.mode, p.data
      from scan_photos p join scan_batches b on b.id = p.batch_id
      where p.data is not null
      order by p.id desc
      limit ${limit}
    `),
  );
  for (const r of found) {
    photos.push({ label: `photo ${r.id} (batch ${r.batch_id})`, mode: r.mode === "single" ? "single" : "batch", prepared: await prepareImage(Buffer.from(r.data)) });
  }
}
if (photos.length === 0) {
  console.error("No photos found. Completed scan batches drop their bytes; pass --dir <folder> instead.");
  process.exit(2);
}

/** The matched catalog ids of one read, in the photo's own card order, the way the app would pick them. */
async function matched(cards: { name: string; number: string | null; confidence: number; box: unknown }[]): Promise<string[]> {
  const out: string[] = [];
  for (const c of cards) {
    const seen = { name: c.name, number: c.number, confidence: c.confidence, box: cleanBox(c.box as never) };
    const { list, exact } = await matchDetection(db, seen);
    const { matchedBy } = assessMatch(seen, list[0] ?? null, exact);
    out.push(`${list[0]?.id ?? "unmatched"}${matchedBy ? "" : "?"}`);
  }
  return out.sort();
}

let same = 0;
let fellBack = 0;
const different: string[] = [];
for (const [i, p] of photos.entries()) {
  const base = (await readPhoto(MODEL, p.prepared, p.mode)).parsed_output;
  const tiered = await readPhotoTiered(p.prepared, p.mode);
  const last = tiered[tiered.length - 1];
  const used = tiered.length > 1 ? `${SONNET_MODEL} -> ${MODEL}` : last.model;
  if (tiered.length > 1) fellBack++;
  const next = last.res.parsed_output;
  const a = base ? await matched(base.cards) : ["(unparseable)"];
  const b = next ? await matched(next.cards) : ["(unparseable)"];
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) same++;
  else different.push(p.label);
  console.log(`${String(i + 1).padStart(2)}. ${p.label} [${p.mode}] via ${used}: ${ok ? "IDENTICAL" : "DIFFERENT"}  ${a.join(", ")}${ok ? "" : `\n      new: ${b.join(", ")}`}`);
}

console.log(`\n${same}/${photos.length} photos matched identically; ${fellBack} fell back to ${MODEL}.`);
if (different.length) console.log(`Different: ${different.join("; ")}`);
if (photos.length < 20) console.log("Fewer than 20 photos: the acceptance bar is not met.");
process.exit(different.length || photos.length < 20 ? 1 : 0);
