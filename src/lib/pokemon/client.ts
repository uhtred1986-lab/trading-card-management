/**
 * What the Pokémon screens in the browser share: the shape of a tile, the shape of one card read
 * from `/api/pokemon/card/[id]`, and how to turn a live search hit into a tile. Types and pure
 * helpers only (no database, no server code), so client components can import it.
 */
import type { OwnedLine } from "./collection";
import type { PokemonVariantInfo } from "./tcgdex";
import { pokemonImage, type PokemonDetails, type PokemonHit } from "./types";

/** One card as a tile and a slide of the swipe viewer. Stored cards and live hits both become this. */
export interface PokemonTile {
  /** Catalog id, `PKM-sv03.5-006`. */
  id: string;
  tcgdexId: string;
  name: string;
  altName: string | null;
  setName: string;
  localId: string;
  setTotal: number | null;
  /** About 245 px wide, for tiles. */
  imageLow: string | null;
  /** About 600 px wide, for the viewer. */
  imageHigh: string | null;
  /** The viewer's own photo of this card (`card_photos`), shown instead of the catalog picture. */
  photoId?: number | null;
  /** Cardmarket trend in integer EUR cents, when known. */
  priceCents?: number | null;
}

/** `…/006/high.webp` to `…/006/low.webp`: how a stored card (it keeps the viewer-size URL) gets its tile picture. */
export function lowImage(high: string | null | undefined): string | null {
  if (!high) return null;
  return high.replace(/\/high\.webp$/, "/low.webp");
}

/** A live search hit as a tile. */
export function tileFromHit(hit: PokemonHit): PokemonTile {
  return {
    id: hit.id,
    tcgdexId: hit.tcgdexId,
    name: hit.name,
    altName: hit.altName,
    setName: hit.setName,
    localId: hit.localId,
    setTotal: hit.setTotal,
    imageLow: pokemonImage(hit.image, "low"),
    imageHigh: pokemonImage(hit.image, "high"),
    priceCents: hit.priceCents,
  };
}

/** "006/165", or "006" when the set's size is unknown. */
export function numberLabel(t: Pick<PokemonTile, "localId" | "setTotal">): string {
  return t.setTotal ? `${t.localId}/${t.setTotal}` : t.localId;
}

/** The answer of `/api/pokemon/card/[id]`, as the viewer uses it. */
export interface PokemonCardInfo {
  hit: PokemonHit;
  details: Partial<PokemonDetails>;
  variants: PokemonVariantInfo[];
  rarity: string | null;
  setId: string;
  setLogo: string | null;
  imageHigh: string | null;
  /** The viewer's own copies, by variant and language. */
  owned: OwnedLine[];
  wished: boolean;
  /** The viewer's own photo (an id of `card_photos`) per print they own. */
  photos?: Record<string, number>;
}

export class CardInfoError extends Error {
  constructor(
    readonly kind: "unavailable" | "not_found" | "failed",
    message: string,
  ) {
    super(message);
    this.name = "CardInfoError";
  }
}

/** Reads one card (live, cached a day at the source) with the viewer's copies and wish. */
export async function fetchCardInfo(tcgdexId: string, signal?: AbortSignal): Promise<PokemonCardInfo> {
  let res: Response;
  try {
    res = await fetch(`/api/pokemon/card/${encodeURIComponent(tcgdexId)}`, { signal, headers: { accept: "application/json" } });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new CardInfoError("unavailable", "offline");
  }
  if (res.status === 503) throw new CardInfoError("unavailable", "source_unavailable");
  if (res.status === 404) throw new CardInfoError("not_found", "not_found");
  if (!res.ok) throw new CardInfoError("failed", String(res.status));
  return (await res.json()) as PokemonCardInfo;
}

/** The cards around one card's evolution line, as tiles (`/api/pokemon/card/[id]/evolutions`). */
export interface PokemonEvolutions {
  from: PokemonTile | null;
  into: PokemonTile[];
}

const evolutionsCache = new Map<string, PokemonEvolutions>();

/**
 * Reads the evolution line of one card. Answers `null` when the source is down or the browser is offline:
 * the detail sheet then simply has no such section. A good answer is kept for the page's lifetime.
 */
export async function fetchEvolutions(tcgdexId: string, signal?: AbortSignal): Promise<PokemonEvolutions | null> {
  const kept = evolutionsCache.get(tcgdexId);
  if (kept) return kept;
  try {
    const res = await fetch(`/api/pokemon/card/${encodeURIComponent(tcgdexId)}/evolutions`, { signal, headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const body = (await res.json()) as { from: PokemonHit | null; into: PokemonHit[] };
    const out: PokemonEvolutions = { from: body.from ? tileFromHit(body.from) : null, into: (body.into ?? []).map(tileFromHit) };
    evolutionsCache.set(tcgdexId, out);
    return out;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    return null;
  }
}

/** The type chips of the search: the API value (English), the German label and the dot colour (a type's own colour, not a skin colour). */
export const TYPE_CHIPS: readonly { value: string; label: string; color: string }[] = [
  { value: "Fire", label: "Feuer", color: "#e8562a" },
  { value: "Water", label: "Wasser", color: "#2f8fd8" },
  { value: "Grass", label: "Pflanze", color: "#4a9d3c" },
  { value: "Lightning", label: "Elektro", color: "#e2ac00" },
  { value: "Psychic", label: "Psycho", color: "#a45bb5" },
  { value: "Fighting", label: "Kampf", color: "#b5622b" },
  { value: "Darkness", label: "Unlicht", color: "#3d4a57" },
  { value: "Metal", label: "Metall", color: "#7c8a96" },
  { value: "Dragon", label: "Drache", color: "#b08a1c" },
  { value: "Fairy", label: "Fee", color: "#d96fa5" },
  { value: "Colorless", label: "Farblos", color: "#8a8f98" },
];
