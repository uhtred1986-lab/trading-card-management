# Architecture: collection, decks and scanning

Read before touching ownership, reservations, deck legality, deck owners, add-to-deck, voice entry, quick capture or scan batches. Moved unchanged from `CLAUDE.md` (issue #382); the text is verbatim, so a comment that says "see CLAUDE.md" means this file.

- **Reservations are computed, never stored** (`src/lib/decks/reservations.ts`): reserved = sum of
  `deck_cards` across decks with `is_built`; available = owned − reserved. Marking a deck built is
  **blocked outright** when it would over-reserve, and `buildConflicts` lists the exact shortfall.
- **Lot owner**: every `owned_cards` row records `owner` = the Basic Auth username
  (`currentUser()`); null when the app runs open. Every path that creates lots stamps it — keep
  that true for new paths.
- **Decks belong to a login too** (`decks.owner`, issue #279): stamped from `currentOwner()` on
  every path that creates a deck — keep that true for new ones. A deck's owner also gates
  *visibility* (`listDecks`/`getDeck` hide a deck owned by someone else); a deck id that isn't
  yours answers `not_found`. Reservations do **not** follow ownership — every built deck counts
  against the shared collection regardless of owner. Deck transfer between logins and the
  workbench's rule-coverage pages are deliberately out of scope.
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
