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
  workbench's rule-coverage pages are deliberately out of scope.
- **The shopping list is per owner** (`want_list.owner`, migration 0043): one row per owner and
  card; an SL also sees the wants from before lists were per owner.
- **Deck legality is a flag, never a block** (`src/lib/decks/legality.ts`): a deck saves in any
  state; `legality(rows, game)` labels it **legal / incomplete / illegal** with per-card flags. The
  one thing actually *refused* is over-reserving a **built** deck — that's ownership, not legality.
  Colour differs in *kind* per game: a warning in the original game, illegal in Fusion World (which
  also has no Z-Deck).
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
