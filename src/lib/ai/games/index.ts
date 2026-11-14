/**
 * The game-neutral Claude layer (lane I of docs/pokemon/plan.md; docs/architecture/ai.md "Per-game adapter").
 *
 * One adapter per game (`dbs.ts`, `fusion.ts`, `pokemon.ts`, found with `adapterFor`) supplies the
 * prompt name, the deck rules as text, how a card is described, how a finished deck is validated
 * (`legality`) and the card source: the local catalog for the Dragon Ball games, the viewer's cards plus
 * live TCGdex lookup tools for Pokémon. Deck analysis, the wizard and the deck builders call the adapter;
 * provider routing, the ledger and the UI components stay single. The model answers in the game's screen
 * language (`GAME_INFO[game].uiLang`): German, in plain words for a 12-year-old, for Pokémon.
 *
 * ## For the Pokémon screens (another lane, German): the three entry points
 *
 * 1. **"Deck mit Claude bauen"** (a new deck from a wish and / or a card)
 *    `<NewDeckWithClaude enabled={hasAnthropic()} games={["pokemon"]} labels={NEW_DECK_WITH_CLAUDE_LABELS_DE} deckHref="/pokemon/decks/{id}" />`
 *    from `@/components/NewDeckWithClaude`, labels from `@/lib/ai/games/labels-de`. A free-text wish and a
 *    format select; optional `seed={{ id, name, imageUrl }}` builds around a known card (the picker is the
 *    caller's: pass `renderSeedPicker` to put a live Pokémon search in). Calls `buildDeckWithClaudeAction`
 *    (`@/app/decks/claude-actions`), which creates a virtual deck and routes to `/decks/<id>`; pass
 *    `deckHref` to route elsewhere (e.g. `/pokemon/decks/<id>`).
 * 2. **"Deck analysieren"** (summary and the improvement wizard on a deck page)
 *    `<DeckAI deckId aiSummary aiSummaryAt enabled openSuggestions labels={DECK_AI_LABELS_DE} />` from
 *    `@/components/DeckAI`. The server side is already game-neutral (`summariseDeckAction`,
 *    `wizardAction` read the deck's own game).
 * 3. **"Neues Deck mit dieser Karte"** (from a card the child likes)
 *    `<NewDeckFromCard enabled game="pokemon" seed={{ id, name, imageUrl, colors, cardType }}
 *    labels={NEW_DECK_FROM_CARD_LABELS_DE} />` from `@/components/NewDeckFromCard`. With a `seed` there is
 *    no search box. It shows a free "Entwurf" button (deterministic, no model) and, when `enabled`, a
 *    "Mit Claude" button; both call `buildDeckAroundCardAction`.
 *
 * Server side, for a page that needs the function directly: `buildDeckAroundCard(game, cardId, opts)` and
 * `buildDeckWithClaude(game, input, opts)` from `./build`.
 */
export { adapterFor } from "./registry";
export { answerLanguageLine } from "./language";
export { buildDeckAroundCard, buildDeckWithClaude, hasFreeDraft } from "./build";
export type { AroundOptions, BuildInput, BuildOptions, BuildResult } from "./build";
export type { AnalysisContext, GameAdapter, LookupArgs, LookupTool, PromptCard, WizardSource } from "./types";
export { pokemonAdapter, liveDeps } from "./pokemon";
export type { PokemonDeps } from "./pokemon";
export { describePokemonCard, liveSource, pokemonLookupTools } from "./pokemon-source";
export type { PokemonSource } from "./pokemon-source";
