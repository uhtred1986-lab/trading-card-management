# Architecture: collection, decks and scanning

Read before touching ownership, reservations, deck legality, deck owners, add-to-deck, voice entry, quick capture or scan batches. Moved unchanged from `CLAUDE.md` (issue #382); the text is verbatim, so a comment that says "see CLAUDE.md" means this file.

- **Reservations are computed, never stored** (`src/lib/decks/reservations.ts`): reserved = sum of
  `deck_cards` across decks with `is_built`; available = owned − reserved. Marking a deck built is
  **blocked outright** when it would over-reserve, and `buildConflicts` lists the exact shortfall.
  **Since 4 Oct 2026 a built deck reserves from its own owner's lots only** (owner's decision, when
  collections became private): `buildConflicts` counts the deck owner's copies and their other built
  decks; `allocationForCards` takes an `OwnerScope`.
- **Collections are private** (`src/lib/collection/scope.ts`, docs/architecture/auth.md): a player
  sees, counts and touches only lots and decks stamped with their own owner name; an SL sees
  everyone's (`OwnerScope` `undefined`). Every collection, deck, reservation and want-list read takes
  the looker's scope (`currentScope()`); every action that takes a lot, deck, batch or suggestion id
  checks it (`src/lib/auth/ownership.ts`). Lots and decks with no owner are an SL's to hand to a
  player from Settings → Users & access.
- **Lot owner**: every `owned_cards` row records `owner` = the viewer's owner name
  (`currentOwner()`: a player's, an SL's, or the Basic Auth login's); null when the app runs open.
  Every path that creates lots stamps it — keep that true for new paths. A player's lots always
  carry their own name (`ownerFor`); only an SL may enter or re-own someone else's.
- **Decks belong to a login too** (`decks.owner`, issue #279): stamped from `currentOwner()` on
  every path that creates a deck — keep that true for new ones. A deck's owner also gates
  *visibility* (`listDecks`/`getDeck` take an `OwnerScope`); a deck id that isn't yours answers
  `not_found`. A deck with no owner is visible to SLs only. Deck transfer between logins and the
  Rules screens' rule-coverage pages are deliberately out of scope.
- **The shopping list is per owner** (`want_list.owner`, migration 0043): one row per owner and
  card; an SL also sees the wants from before lists were per owner.
- **Deck legality is a flag, never a block** (`src/lib/decks/legality.ts`): a deck saves in any
  state; `legality(rows, game)` labels it **legal / incomplete / illegal** with per-card flags. The
  one thing actually *refused* is over-reserving a **built** deck — that's ownership, not legality.
  Colour differs in *kind* per game: a warning in the original game, illegal in Fusion World (which
  also has no Z-Deck).
  **Deck-building clauses printed on cards** (#1146, `parseDeckBuilding` in `cardRules.ts`) are read
  from the text, never from ids: the Leader's "can't include …" / "only … in your Z-Deck" (front and
  back), a card's own copy limit ("up to 7 copies", "as many … as you like", "1 copy in your Z-Deck")
  and pooled limits ("up to 7 ≪Dark Dragon Ball≫"). A broken one is an `illegal` flag naming the
  Leader's rule and the card; a clause the parser cannot read is reported in `unread`, never guessed.
  Original game only. The arena shares the parser (a deck-building clause is read-and-empty).
- **Pokémon decks** have their own checker (`pokemonLegality.ts`, chosen by `GAME_INFO.pokemon.deck.ruleset`,
  not by `game ===` tests; German texts): exactly 60 cards, no Leader or Z-Deck, at most 4 per
  **name** (`details.names.en`, else the card name; basic Energy unlimited, `copiesBy: "name"`), one
  ACE SPEC and one Radiant per deck (`details.onePerDeck`), at least one Basic Pokémon. **Format** is
  `decks.format` (`standard` by default, `expanded`; `legality(rows, game, format)`; `setDeckFormatAction`
  stores it, `GAME_INFO[game].deck.formats` says which are valid): a card whose `details.legal[format]`
  is `false` is flagged illegal, a card with no legality data is a `warning` ("unknown"), never a
  guess. Every Pokémon card lands in `main`; `getDeck` orders Pokémon (by stage, then name), Trainer,
  Energy. Reservations and the over-reserve refusal are unchanged. Library code asks `GAME_INFO` /
  `DeckRules` (`leader`, `zMax`, `printedRules`, `copiesBy`, `formats`) rather than testing for a game;
  `strictGame()` is for write paths (an unknown game is an error), `gameOr()` for reads.
  **Her decks' screens** (`/pokemon/decks`, `/pokemon/decks/[id]`, `/pokemon/decks/new`; German copy in
  `PK.decks` / `PK.newDeck` / `PK.importList`): pure logic in `src/lib/pokemon/deck-logic.ts` (size text,
  `summariseIssues` collapses many cards failing one format rule into one line and shows at most four,
  `missingCopies`, `builtRefusal`, the German sentence of the one refusal), data in `deck-data.ts` (list,
  `wishMissing` writes the *deck owner's* wishes with `addWant`, idempotent; `importPokemonDeckList`).
  "Owned" on a row is `alloc.owned` of the deck owner, as a built deck reserves it. The Server Functions
  (`src/app/pokemon/decks/actions.ts`) check `assertPokemonDeck` (owner or SL, and the game). **Pasted deck
  lists** (`decklist.ts`, "4 Charizard ex OBF 125", English and German sections): a line with set code and
  number is searched in that set (`deck-source.ts` turns "OBF" into TCGdex's set id through
  `sets?abbreviation.official=`), else by name and number (several prints: the newest, listed as a guess),
  else by name; lines nothing matches are returned, never dropped. A Pokémon deck opened under `/decks/[id]`
  shows no Leader or Z-Deck tiles, groups by card type and links to the Pokémon page.
- **"Also add to deck"** (`DeckPicker`, `src/lib/decks/add.ts`): every add path can target a deck.
  `addCardsToDeck` sorts by zone and **never caps or replaces** — an over-limit add is flagged
  rather than dropped.
- **Voice bulk entry** (`VoiceEntry`, `src/lib/scan/voice.ts`): browser speech recognition, no
  audio uploaded. `parseSpoken` returns *ordered* interpretations rather than deciding;
  `resolveSpokenAction` picks the first whose card number exists in the catalog, falling back to a
  name search.
- **Quick capture** (`/add/quick`, `POST /api/scan/quick`): phone loop — one photo → identified
  immediately (nothing stored) → quantity with big ± buttons → `addLot` → the camera re-opens.
- **Scan batches** (`src/lib/scan/batches.ts`): a scan is persisted as it happens so a batch
  started on the phone can be finished on the PC. `POST /api/scan` stores the photo *before*
  identifying so a retry never needs the phone again.

- **Own card photos** (`src/lib/collection/photos.ts`, `card_photos`; every game): a person can replace
  a card's picture with a phone photo. `PhotoOverride` crops it to 63:88, shrinks it to 750 px WebP (JPEG
  fallback) in the browser; `saveCardPhotoAction` stamps `owner` from the viewer and the library refuses
  over 400 KB, other mimes than WebP/JPEG and more than 1,000 photos per owner. One photo per print and
  owner; replacing deletes and re-inserts, so the id (and the cached URL) changes. Scope works as for lots:
  a player sees only their own, an SL every owner's (preferring their own per print). `GET /api/card-photo/[id]`
  serves it (`private, immutable`, 404 when not visible); `CardImage` takes `photoId` and shows a camera
  badge. Pages fetch ids in one batched `cardPhotoIds` call (card page: base print; collection: grid by
  card, list by print). Photos are not in the catalog cache, nothing to expire. Deck and arena screens
  still show the catalog picture.
