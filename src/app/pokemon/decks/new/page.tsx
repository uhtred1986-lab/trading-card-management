import { requireSignedInPage } from "@/lib/auth";
import { hasAnthropic } from "@/lib/ai/client";
import { lowImage } from "@/lib/pokemon/client";
import { isPokemonSourceError, getPokemonCard } from "@/lib/pokemon/tcgdex";
import { pokemonCardId, tcgdexIdOf } from "@/lib/pokemon/types";
import { NewDeckScreen, type NewDeckSeed } from "@/components/pokemon/NewDeckScreen";

export const dynamic = "force-dynamic";
/** Pasting a deck list reads every line at the card source (a Server Function of this page). */
export const maxDuration = 60;

export const metadata = { title: "Neues Deck" };

/**
 * Neues Deck: a name and a format, or a card to build around (`?card=PKM-sv03.5-006`), or Claude, or
 * a pasted deck list. The card is read live (cached a day at the source); when the source is down the
 * deck can still be made, only the picture is missing.
 */
export default async function NewPokemonDeckPage({ searchParams }: { searchParams: Promise<{ card?: string | string[] }> }) {
  await requireSignedInPage();
  const raw = (await searchParams).card;
  const param = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  let seed: NewDeckSeed | null = null;
  if (param && /^[\w.%-]{1,80}$/.test(param)) {
    const tcgdexId = tcgdexIdOf(param) ?? param;
    try {
      const rec = await getPokemonCard(tcgdexId);
      seed = { id: rec.hit.id, name: rec.hit.name, imageUrl: lowImage(rec.imageHigh), setName: rec.hit.setName, available: true };
    } catch (e) {
      // Not found: no card. The source is down: keep the id, the deck can still be built.
      if (isPokemonSourceError(e) && e.kind !== "not_found") seed = { id: pokemonCardId(tcgdexId), name: tcgdexId, imageUrl: null, setName: "", available: false };
    }
  }
  return <NewDeckScreen seed={seed} claudeEnabled={hasAnthropic()} />;
}
