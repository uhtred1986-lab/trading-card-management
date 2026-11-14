/**
 * The contract of one game's Claude adapter (docs/architecture/ai.md, "Per-game adapter").
 * The analysis, the wizard and the deck builders talk to this and never branch on the game.
 *
 * Types only, so a client component can import the label shapes without pulling a server module.
 */
import type { z, ZodType } from "zod";
import type { Db } from "@/db";
import type { Game } from "@/lib/catalog/games";
import type { DeckLegality, LegalityCard } from "@/lib/decks/legality";
import type { DeckCardRow, getDeck } from "@/lib/decks/queries";

export type DeckForAi = NonNullable<Awaited<ReturnType<typeof getDeck>>>;

/** What a lookup tool receives: the one flat argument shape every tool reads from (a tool ignores what it does not use). */
export interface LookupArgs {
  name: string | null;
  type: string | null;
  category: string | null;
  id: string | null;
}

/**
 * A lookup the model may ask for while it works (the Pokémon card source). The provider contract has
 * no native tool call, so `generateWithLookups` (`../tools.ts`) carries it in the JSON answer; every
 * step still goes through `generateJson`, the router and the ledger.
 */
export interface LookupTool {
  name: string;
  /** One or two sentences: what it answers and which arguments it reads. */
  description: string;
  /** The tool's text answer. It never throws: a source that is down answers in words. */
  run(args: LookupArgs): Promise<string>;
}

/** The cards a wizard run may draw from, and how the model reaches the rest. */
export interface WizardSource {
  /** The system block listing the cards on offer; null when the game offers no list (only lookups). */
  poolBlock: string | null;
  /** How many cards the list holds. */
  size: number;
  /** Set when this run cannot happen (nothing to offer): the message the caller throws. */
  error: string | null;
  tools: LookupTool[];
  /** Makes sure every named card exists in `cards` (a live-catalog game stores on reference). Unknown ids are left out, never an error. */
  materialise(db: Db, ids: string[]): Promise<void>;
}

/** Anything a card can be described from: the catalog row, a deck row or a pool row. */
export interface PromptCard {
  id: string;
  name: string;
  cardType: string;
  colors: string[];
  energyCost: string | null;
  power: number | null;
  skill: string | null;
  characters?: string[];
  traits?: string[];
  rarityCode?: string;
  /** `cards.details`: Pokémon's own data (stage, HP, attacks, legality). */
  details?: unknown;
}

export interface AnalysisContext {
  /** The deck's format, for a game that has formats. */
  format?: string | null;
}

/** Every game's adapter. One small module per game builds it (`dbs.ts`, `fusion.ts`, `pokemon.ts`). */
export interface GameAdapter {
  readonly game: Game;
  /** The language the model answers in. */
  readonly lang: "en" | "de";
  /** The game's name for the model: `GAME_INFO[game].promptName`. */
  readonly promptName: string;
  /** The deck rules as text for the model, from `GAME_INFO[game].deck` (and the game's own checker for Pokémon). */
  rulesText(ctx?: AnalysisContext): string;
  /** The system prompt of a deck analysis (summary, wizard, set review): who the model is, the rules, the answer language. */
  analystSystem(ctx?: AnalysisContext): string;
  /** One line describing a card to the model. */
  describeCard(card: PromptCard, maxSkill?: number): string;
  /** The deck as text for a prompt: list, the game's special rules and every card described. */
  deckBlock(rows: DeckCardRow[], ctx?: AnalysisContext): string;
  /** The sentence(s) of the wizard's ask that say what a swap is and which limits it keeps. */
  swapInstruction(): string;
  /** The wizard's answer schema (Dragon Ball's quantities stop at the 4-copy cap; Pokémon's Energy runs to a dozen). */
  wizardSchema: ZodType;
  /** The card source of the wizard: the local catalog (Dragon Ball) or the viewer's cards plus live search (Pokémon). */
  wizardSource(db: Db, deck: DeckForAi, scope: "owned" | "any"): Promise<WizardSource>;
  /** Labels a finished deck by the game's rules; it never refuses (`legality`). */
  validate(rows: LegalityCard[], format?: string | null): DeckLegality;
}

export type WizardAnswer<S extends ZodType> = z.infer<S>;
