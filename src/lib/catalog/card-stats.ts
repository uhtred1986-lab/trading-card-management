/**
 * The stat list of a card, per game (docs/pokemon/plan.md §10 item 4). The shared card page used to
 * hard-code Dragon Ball's Energy, Power, Combo ... and showed dashes for a Pokémon card. Now a small
 * function keyed by game returns the label / value pairs the page draws, so the page itself has no
 * game check and a fourth game adds one branch here.
 *
 * Pure: it reads a card row (and, for Pokémon, the base print's stored Cardmarket price) and returns
 * strings. English, like the shared screens.
 */
import { formatCents } from "@/lib/money";
import { pokemonDetails } from "@/lib/pokemon/types";
import { gameOr, type Game } from "./games";

export interface CardStat {
  label: string;
  value: string;
}

/** The columns of a card row the stat lists read. */
export interface StatCard {
  game: string;
  energyCost: string | null;
  power: number | null;
  comboCost: number | null;
  comboPower: number | null;
  zEnergyCost: string | null;
  characters: string[];
  traits: string[];
  eras: string[];
  limitedTo: number | null;
  colors: string[];
  details: unknown;
}

/** What a game's list may need besides the card row. */
export interface StatContext {
  /** The stored Cardmarket trend and low of the card's base print, integer EUR cents (Pokémon). */
  market?: { trendCents: number | null; lowCents: number | null } | null;
}

const dash = "—";

function dragonBall(card: StatCard): CardStat[] {
  return [
    { label: "Energy", value: String(card.energyCost ?? dash) },
    { label: "Power", value: card.power?.toLocaleString() ?? dash },
    { label: "Combo", value: card.comboCost != null ? `${card.comboCost} / ${card.comboPower?.toLocaleString() ?? dash}` : dash },
    { label: "Z-Energy", value: String(card.zEnergyCost ?? dash) },
    { label: "Character", value: card.characters.join(", ") || dash },
    { label: "Traits", value: card.traits.join(", ") || dash },
    { label: "Era", value: card.eras.join(", ") || dash },
    { label: "Copy limit", value: card.limitedTo?.toString() ?? dash },
  ];
}

function pokemon(card: StatCard, ctx: StatContext): CardStat[] {
  const d = pokemonDetails(card.details);
  const attacks = (d.attacks ?? []).map((a) => (a.damage ? `${a.name} (${a.damage})` : a.name)).join(", ");
  const legal = d.legal ? (["standard", "expanded"] as const).map((f) => `${f === "standard" ? "Standard" : "Expanded"} ${d.legal![f] ? "legal" : "not legal"}`).join(" · ") : dash;
  const market = ctx.market;
  const price = market?.trendCents != null ? `${formatCents(market.trendCents, "EUR")}${market.lowCents != null && market.lowCents !== market.trendCents ? ` (low ${formatCents(market.lowCents, "EUR")})` : ""}` : dash;
  return [
    { label: "HP", value: card.power != null ? String(card.power) : dash },
    { label: "Types", value: card.colors.join(", ") || dash },
    { label: "Stage", value: d.display?.stage ?? d.stage ?? dash },
    { label: "Evolves from", value: d.evolveFrom ?? dash },
    { label: "Attacks", value: attacks || dash },
    { label: "Weakness", value: d.weakness ?? dash },
    { label: "Retreat", value: d.retreat != null ? String(d.retreat) : dash },
    { label: "Regulation", value: d.regulationMark ?? dash },
    { label: "Legality", value: legal },
    { label: "Cardmarket", value: price },
  ];
}

const STATS: Record<Game, (card: StatCard, ctx: StatContext) => CardStat[]> = {
  dbs: dragonBall,
  fusion: dragonBall,
  pokemon,
};

/** The label / value pairs to draw for this card, in order. */
export function cardStats(card: StatCard, ctx: StatContext = {}): CardStat[] {
  return STATS[gameOr(card.game)](card, ctx);
}
