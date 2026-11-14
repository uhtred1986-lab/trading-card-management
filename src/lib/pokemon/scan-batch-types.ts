/**
 * The shapes of a kept Pokémon binder page, free of any server import so the screens can use them
 * (`src/lib/pokemon/scan-batch.ts` has the database code).
 */
import type { PokemonScanDetection } from "./scan";
import type { PokemonLotLanguage } from "./collection";
import type { PokemonHit, PokemonVariant } from "./types";

export type PokemonItemState = "confirmed" | "check" | "skipped" | "saved";

export interface PokemonBatchItem {
  id: number;
  photoId: number;
  idx: number;
  detection: PokemonScanDetection;
  chosen: PokemonHit | null;
  /** The child (or the read) said yes. */
  include: boolean;
  /** Picked by hand, so it is as good as confirmed. */
  manual: boolean;
  /** Null until a variant is known (the card's variants are read when the cell is opened). */
  variant: PokemonVariant | null;
  language: PokemonLotLanguage;
  quantity: number;
  saved: boolean;
}

export interface PokemonBatchPhoto {
  id: number;
  position: number;
  width: number;
  height: number;
  status: "reading" | "done" | "error";
  error: string | null;
  found: number | null;
  unreadable: number | null;
}

export interface PokemonBatchState {
  batch: { id: number; name: string; deckId: number | null; owner: string | null; status: "open" | "done"; updatedAt: string };
  photos: PokemonBatchPhoto[];
  items: PokemonBatchItem[];
}

export interface PokemonBatchOffer {
  id: number;
  /** Cards still to save (not saved, not left out by hand). */
  cards: number;
  photos: number;
  updatedAt: string;
}

/** The state of one item as the grid draws it. */
export function itemState(i: Pick<PokemonBatchItem, "saved" | "chosen" | "include">): PokemonItemState {
  if (i.saved) return "saved";
  if (!i.chosen) return "check";
  return i.include ? "confirmed" : "skipped";
}

export interface PokemonItemPatch {
  /** A card picked by hand (or null to clear). Picking one confirms the cell. */
  chosen?: PokemonHit | null;
  include?: boolean;
  variant?: PokemonVariant;
  language?: PokemonLotLanguage;
  quantity?: number;
}

export interface PokemonCompleteResult {
  /** Cards (copies) written to the collection by this call. */
  added: number;
  deckAdded: number;
  deckId: number | null;
  /** Items that could not be saved; the batch stays open with them. */
  failed: { itemId: number; name: string; message: string }[];
  /** The batch is closed and its photos are gone. */
  done: boolean;
}

