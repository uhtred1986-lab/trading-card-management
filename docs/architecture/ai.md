# Architecture: Claude features outside the arena

Read before touching deck analysis, the wizard, card scanning, the cart explainer or "Build a deck with Claude". Moved unchanged from `CLAUDE.md` (issue #382); the text is verbatim, so a comment that says "see CLAUDE.md" means this file.

- **AI**: `src/lib/ai/deck.ts` (summary, wizard, set review), `src/lib/ai/scan.ts` (photo → cards,
  matched by number then name), `src/lib/ai/cart.ts` (explains the optimiser's output, never does
  the arithmetic). The wizard's pool is scoped to the leader's colours and capped at 450; every
  deck prompt is scoped to one game — only the scanner reads both at once, since a photo can mix
  them.
- **Leaders → "Build a deck with Claude"** (`/leaders`, `src/lib/ai/deck-builder.ts`): the draft
  gets an owned pool and a capped buy pool, runs through `sanitiseDraft`, and becomes a *virtual*
  deck with a shopping list. Owned/buy flags come from the collection, not the model.

## Models and spend (owner's ruling, 1 Oct 2026, #381)

Model ids, providers, capabilities and list prices are in `docs/architecture/ai-providers.md` (see
**Models** and **As built** sections). `npm run ai:spend` reports billed and notional cost per provider.
`recordRun` takes the model and provider from the call's result, so `ai_runs` records what actually ran.

| Call | Model | Request shape |
|---|---|---|
| Cart explain (`cart.ts`) | Haiku 4.5 | no `thinking`, no `effort` (Haiku rejects both); Zod `format` only |
| Deck summary (`deck.ts`), arena game review (`arena/ai/review.ts`) | Sonnet 5.5 | adaptive thinking, effort `medium` |
| Scan identify (`scan.ts`) | Sonnet 5.5, Opus fallback | adaptive thinking, effort `medium` |
| Wizard, set review, deck builder, from-card | Opus, unchanged | |
| Arena "Teach it · In my words" (`arena/ai/teach.ts`, #473) | `MODEL` (Opus), as `clarify.ts` | adaptive thinking, effort `medium`; the language reference (`teach/words.ts` `languageForPrompt()`) is a 1 h-cached system block; `ai_runs.kind` `arena_teach` |
| Arena Sparring / Tournament | unchanged (counter and blocker stay on Opus `medium`) | |

**Scan fallback.** `readPhotoTiered` reads on Sonnet first and repeats the read on Opus when
Sonnet's answer is unparseable (the SDK throws a non-API error, or `parsed_output` is null) or
low-confidence per `needsOpusFallback` in `scan-match.ts`: any card with no number, any `confidence`
below `REVIEW_THRESHOLD` (0.8), `unreadable > 0`, or an empty list for a `single` photo. A refusal
or an API error (key, rate limit) is not retried on Opus. When both reads ran, both are written to
`ai_runs` (the Opus row's `input` carries `fallbackFrom`), so the fallback rate and its cost show in
`ai:spend`. Accuracy is verified by `npm run ai:scan-compare -- [--dir <folder>] [--limit 20]`, which
reads each photo on Opus alone and with the new pipeline and lists any photo whose matched card ids
differ. It spends real money and needs the key and `DATABASE_URL`, so the owner runs it; saved scan
photos only exist for batches still open (completed batches drop their bytes), hence `--dir`.

## Per-game adapter (lane I of the Pokémon plan, `src/lib/ai/games/`)

Deck analysis, the wizard and "Build a deck with Claude" are game-neutral: they call one adapter per game
(`adapterFor(game)`; modules `dbs.ts`, `fusion.ts` (both on `bandai.ts`), `pokemon.ts`), never branch on the game.
An adapter supplies: the prompt name (`GAME_INFO[game].promptName`), the deck rules as text (from
`GAME_INFO[game].deck`; for Pokémon also the rules of `pokemonLegality.ts`), how a card row is described
(`describeCard`, `deckBlock`), the wizard's answer schema and swap instruction, the **card source**
(`wizardSource`) and `validate(rows, format)` = `legality(rows, game, format)` (a label, never a block). The
interface is `GameAdapter` in `games/types.ts`; the entry points another screen needs, with the component and
props for each, are listed at the top of `games/index.ts`.

- **Dragon Ball (`dbs`, `fusion`)**: the code that was in `deck.ts`, moved unchanged; the card source is the local
  catalog. The requests they send, the `ai_runs` rows and the decks created are the ones from before the layer:
  `scripts/verify/ai-games.mts` compares them with `scripts/verify/fixtures/ai-games/dragonball-requests.json`,
  recorded by `ai-games-capture.mts` on the base commit (both games, byte for byte, on the recorded Anthropic
  transport). Re-record the fixture only when a Dragon Ball prompt is changed on purpose, in that commit.
- **Pokémon**: cards are described from `cards.details` (names in both languages, type, HP, stage, evolves from,
  attacks, legality in Standard and Expanded). The card source is the viewer's own stored cards (`OWN×n`, in the
  cached system block, scoped to the deck owner) plus **live lookups** over TCGdex: `search_cards`, `evolves_from`
  (the `evolveFrom` filter, which `searchPokemon` cannot ask) and `get_card` (`pokemon-source.ts`). A card the model
  picks that is not stored is stored with `ensurePokemonCard` before it is shown or put in a deck.
- **Lookups ride on the JSON answer** (`src/lib/ai/tools.ts`): the provider contract has no tool call, so each reply
  is `{ lookups, answer }`; the loop runs the lookups and sends the results back as the next turn (at most 5 rounds,
  then a forced answer). Every round is a `generateJson` through the router, so API, plan, OpenRouter and the fake
  provider all work and the ledger sees one row per run (usage summed, lookups kept in `ai_runs.input.lookups`). A
  game with no tools (Dragon Ball) calls `generateJson` with the request untouched.
- **Answer language**: for a game with `uiLang: "de"` the system prompt ends with an instruction to answer in German,
  in plain words for a 12-year-old (`games/language.ts`). Dragon Ball stays English and gets no extra line.
- **Starting a deck** (`games/build.ts`): `buildDeckWithClaude(game, input, { db, owner })` and
  `buildDeckAroundCard(game, cardId, { db, owner, mode, format })`. Dragon Ball reaches `suggestDeck` /
  `suggestDeckFromCard` (a Leader decides the deck; Claude only). Pokémon builds from a seed card and / or a wish
  (`pokemon-build.ts`: the draft is cleaned, 4 by name, one ACE SPEC and Radiant, never over 60, unknown ids
  dropped, then labelled by `legality`) and has a **free deterministic draft** around a card (`pokemon-around.ts`):
  the evolution line (down by `evolveFrom`, up by the `evolveFrom` filter; 4-3-2), 12 to 16 basic Energy of its
  type, Trainers the viewer owns that are legal in the format, owned cards first; it never pads and says it is a
  draft. Both stamp `decks.owner`. The Server Functions are `buildDeckWithClaudeAction` and
  `buildDeckAroundCardAction` (`src/app/decks/claude-actions.ts`).
- **Components**: `NewDeckWithClaude` (`games`), `NewDeckFromCard` (`game`) and `DeckAI` take the game and a
  `labels` object (English by default, so the Dragon Ball screens do not change; German sets in
  `games/labels-de.ts`).
- **Testing without a model**: a request is read off the recorded transport or the scripted fake provider
  (`createFakeProvider`), the TCGdex tools run on the recorded fixtures through a stubbed `fetch`, creation runs on
  PGlite. No test calls a model; a real run of the Pokémon paths is the owner's to ask for.
