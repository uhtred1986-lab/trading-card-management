/** Display-only deck facts. No ownership, database, or arena engine imports. */
export interface DiscoveryDeck {
  id: string;
  name: string;
  description: string | null;
  leaderName: string | null;
  leaderId?: string | null;
  leaderImage?: string | null;
  colors: string[];
  group: string;
  mainCount: number;
  /** Set where a list can mix games (the arena pickers): a `GameMark` chip is drawn beside the name. */
  game?: string;
  locked?: boolean;
  status?: string;
  note?: string;
  href?: string;
  /** A game that plays in formats shows its deck's here ("Standard format") in place of the leader line. */
  formatLabel?: string;
}
/**
 * Where a deck row links to: a Pokémon deck has its own (German) deck page, every other game's deck is
 * at `/decks/<id>`. `format` is the deck's stored format; a Pokémon deck without a known one is Standard.
 */
export function deckListLink(game: string, id: number | string, format?: string | null): { href: string; formatLabel?: string } {
  if (game !== "pokemon") return { href: `/decks/${id}` };
  return { href: `/pokemon/decks/${id}`, formatLabel: format === "expanded" ? "Expanded format" : "Standard format" };
}
export interface DeckFilters { q: string; color: string; leader: string; group: string; readyOnly: boolean }
export const emptyDeckFilters = (readyOnly = false): DeckFilters => ({ q: "", color: "", leader: "", group: "", readyOnly });
export function filterDecks(decks: DiscoveryDeck[], filters: DeckFilters): DiscoveryDeck[] {
  const words = filters.q.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return decks.filter((d) => {
    const text = [d.name, d.description, d.leaderName, d.leaderId, ...d.colors].join(" ").toLocaleLowerCase();
    return words.every((w) => text.includes(w)) && (!filters.color || d.colors.includes(filters.color))
      && (!filters.leader || (d.leaderId || d.leaderName) === filters.leader)
      && (!filters.group || d.group === filters.group) && (!filters.readyOnly || !d.locked);
  });
}
