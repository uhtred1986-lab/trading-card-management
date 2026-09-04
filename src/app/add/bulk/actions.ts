"use server";

import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { cards } from "@/db/schema";
import { quickSearch } from "@/lib/catalog/queries";
import { parseSpoken, spokenQuantity } from "@/lib/scan/voice";

export interface SpokenCard {
  id: string;
  name: string;
  setCode: string;
  game: string;
  cardType: string;
  colors: string[];
  rarityCode: string;
  imageUrl: string | null;
}

export type SpokenResult =
  | { ok: true; card: SpokenCard; prints: { id: string; label: string }[]; foil: number; normal: number; heard: string; via: "number" | "name" }
  | { ok: false; heard: string; reason: string };

async function load(cardId: string): Promise<{ card: SpokenCard; prints: { id: string; label: string }[] } | null> {
  const card = await db.query.cards.findFirst({
    where: (c, { eq }) => eq(c.id, cardId),
    columns: { id: true, name: true, setCode: true, game: true, cardType: true, colors: true, rarityCode: true, imageUrl: true },
  });
  if (!card) return null;
  const prints = await db.query.cardPrints.findMany({
    where: (p, { eq }) => eq(p.cardId, cardId),
    columns: { id: true, label: true, isBase: true },
  });
  return {
    card,
    prints: prints.sort((a, b) => Number(b.isBase) - Number(a.isBase) || a.id.localeCompare(b.id)).map(({ id, label }) => ({ id, label })),
  };
}

/**
 * Resolve what was heard to one catalog card. Every alternative the recogniser
 * offered is tried by card number first — the catalog decides which reading of
 * the digits is real — then, failing that, as a card name.
 */
export async function resolveSpokenAction(alternatives: string[]): Promise<SpokenResult> {
  const heard = alternatives[0]?.trim() ?? "";
  if (!heard) return { ok: false, heard, reason: "Nothing was picked up." };

  for (const alt of alternatives) {
    const { options } = parseSpoken(alt);
    if (options.length === 0) continue;
    const ids = [...new Set(options.map((o) => o.cardId))];
    const found = new Set((await db.select({ id: cards.id }).from(cards).where(inArray(cards.id, ids))).map((r) => r.id));
    const hit = options.find((o) => found.has(o.cardId));
    if (!hit) continue;
    const loaded = await load(hit.cardId);
    if (loaded) return { ok: true, ...loaded, foil: hit.foil, normal: hit.normal, heard: alt, via: "number" };
  }

  for (const alt of alternatives) {
    const { query } = parseSpoken(alt);
    if (query.replace(/[^a-z]/g, "").length < 3) continue;
    const hits = await quickSearch(db, query, 1);
    if (!hits[0]) continue;
    const loaded = await load(hits[0].id);
    if (loaded) return { ok: true, ...loaded, ...spokenQuantity(alt), heard: alt, via: "name" };
  }

  return { ok: false, heard, reason: "No card matched that number or name." };
}
