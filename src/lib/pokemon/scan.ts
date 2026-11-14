/**
 * Reading Pokémon cards off a photo: the model reads each card (`readPokemonPhotoTiered`, through
 * the app's provider routing, recorded in the ledger as `scan_identify` like the Dragon Ball scan),
 * then every read is looked up live at TCGdex and matched (`matchPokemon`). Nothing is stored here:
 * the photo is not kept, and a card is written only when the child confirms it
 * (`addPokemonLotAction`).
 *
 * `/api/pokemon/scan` is the thin guarded route over `handlePokemonScan`; the model call, the
 * search and the ledger write are injectable so the scripts run it with none of them.
 */
import type { Db } from "@/db";
import { describeAiError, hasAnthropic, recordRun } from "@/lib/ai/client";
import { cleanBox, type Box } from "@/lib/ai/scan-match";
import { prepareImage, readPokemonPhotoTiered, type PreparedImage } from "@/lib/ai/scan";
import type { PokemonScanResult } from "@/lib/ai/scan-prompts";
import { matchPokemon, pokemonScanQueries, type PokemonMatchConfidence } from "./scan-match";
import { searchPokemon } from "./tcgdex";
import type { PokemonHit } from "./types";

export type PokemonScanMode = "single" | "batch";

type Read = PokemonScanResult["cards"][number];

export interface PokemonScanDetection {
  index: number;
  /** What the model read, with the box cleaned. */
  seen: Omit<Read, "box"> & { box: Box | null };
  confidence: PokemonMatchConfidence;
  /** The card to preselect (exact and likely only). An unsure or none read has none: a tap picks. */
  best: PokemonHit | null;
  /** Best first. */
  candidates: PokemonHit[];
  /** Plain German reason for the badge. */
  reason: string;
}

export interface PokemonScanDeps {
  read: typeof readPokemonPhotoTiered;
  search: (q: string) => Promise<PokemonHit[]>;
  record: typeof recordRun;
  available: () => boolean;
}

const defaultDeps: PokemonScanDeps = {
  read: readPokemonPhotoTiered,
  search: (q) => searchPokemon({ q }),
  record: recordRun,
  available: hasAnthropic,
};

const RANK: Record<PokemonMatchConfidence, number> = { exact: 3, likely: 2, unsure: 1, none: 0 };

/** One read card to its detection: the queries run together, their hits merged and matched. */
export async function detectionFor(read: Read, index: number, search: PokemonScanDeps["search"]): Promise<PokemonScanDetection> {
  const seen = { ...read, box: cleanBox(read.box) };
  const queries = pokemonScanQueries({ name: read.name, language: read.language, number: read.number });
  const settled = await Promise.allSettled(queries.map((q) => search(q)));
  const hits = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (settled.length > 0 && settled.every((r) => r.status === "rejected")) {
    return { index, seen, confidence: "none", best: null, candidates: [], reason: "Die Kartensuche ist gerade nicht erreichbar." };
  }
  const m = matchPokemon({ name: read.name, language: read.language, number: read.number, setCode: read.setCode, confidence: read.confidence }, hits);
  return { index, seen, confidence: m.confidence, best: m.best, candidates: m.candidates.map((c) => c.hit), reason: m.reason };
}

/** The whole read of one photo. `image` may be the raw upload or an already prepared image. */
export async function identifyPokemonCards(
  db: Db,
  image: Buffer | PreparedImage,
  mode: PokemonScanMode,
  deps: Partial<PokemonScanDeps> = {},
): Promise<{ runId: number; unreadable: number; detections: PokemonScanDetection[] }> {
  const d = { ...defaultDeps, ...deps };
  const prepared = Buffer.isBuffer(image) ? await prepareImage(image) : image;
  let id = 0;
  let output!: PokemonScanResult;
  for (const r of await d.read(prepared, mode)) {
    ({ id, output } = await d.record<PokemonScanResult>(db, "scan_identify", { mode, game: "pokemon", ...(r.fallbackFrom ? { fallbackFrom: r.fallbackFrom } : {}) }, r.res));
  }
  const detections = await Promise.all(output.cards.map((card, index) => detectionFor(card, index, d.search)));
  return { runId: id, unreadable: output.unreadable, detections };
}

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * The request behind `POST /api/pokemon/scan`: `image` (a JPEG or any image the phone made) and
 * `mode` ("single", the default, or "batch" for a binder page). The route has already checked who
 * is asking.
 */
export async function handlePokemonScan(req: Request, db: Db, deps: Partial<PokemonScanDeps> = {}): Promise<Response> {
  const d = { ...defaultDeps, ...deps };
  if (!d.available()) return Response.json({ error: "ANTHROPIC_API_KEY is not set." }, { status: 503 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "No image uploaded." }, { status: 400 });
  }
  const file = form.get("image");
  if (!(file instanceof File)) return Response.json({ error: "No image uploaded." }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "Image is larger than 20 MB." }, { status: 413 });
  const mode: PokemonScanMode = form.get("mode") === "batch" ? "batch" : "single";
  try {
    const { detections, unreadable } = await identifyPokemonCards(db, Buffer.from(await file.arrayBuffer()), mode, deps);
    // A single card: the best read first. A binder page keeps the model's order (the grid places by box).
    const out = mode === "single" ? [...detections].sort((a, b) => RANK[b.confidence] - RANK[a.confidence] || b.seen.confidence - a.seen.confidence) : detections;
    return Response.json({ detections: out, unreadable }, { headers: { "cache-control": "private, no-store" } });
  } catch (err) {
    return Response.json({ error: describeAiError(err) }, { status: 502 });
  }
}
