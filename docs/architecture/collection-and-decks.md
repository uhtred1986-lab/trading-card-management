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

## Offline reading

A phone is often without signal, so the pages a person reads (not edits) keep working from what the
device last saw (`public/sw.js`, job 0 in its header; `scripts/verify/offline-reading.mts`). Read this
before touching that list, the worker's page cache, `src/proxy.ts`' `x-card-who` stamp or the sign-in pages.

- **Which pages** (`readableArea` in the worker, `src/lib/offline-pages.ts` the same list for the page;
  the proof fails when they differ): `/pokemon`, `/pokemon/wishes`, `/pokemon/decks` and
  `/pokemon/decks/<x>`, `/collection`, `/decks`, `/decks/<id>`. Nothing else: no `/settings`, `/cart`,
  `/login`, `/join`, no `/api/` but `GET /api/card-photo/<id>`.
- **Strategy.** Network first, copy second. A navigation or a followed link (Next's `_rsc` fetch, which
  is not a prefetch) goes to the network; a 200 with the stamp is kept; the kept copy is shown when the
  fetch fails, takes over 8 s, answers 5xx, or the browser says it is offline. A 404, a redirect or a 4xx is
  the truth and is shown. A query string keeps its own copy and also becomes the page's "last seen" copy,
  which stands in for a filter this device never saw. The payload of a followed link is kept under its exact
  `_rsc` URL (Next hashes its router headers into it), so it is only ever shown to the request it was
  made for; a miss makes Next load the page itself, which the HTML copy answers. After a payload is kept
  the page's HTML is fetched too (a page reached only by tapping would have none for a cold start).
  Pictures: card art on a CDN is the old art cache (`ART_HOSTS`); `/_next/image` (what the Dragon Ball
  grids use) and `/api/card-photo/<id>` go in the per-person cache; with no network a big picture never
  fetched falls back to the optimiser copy or `low.webp`. `/_next/static/` files that no arena shell holds
  go to `dbs-offline-static-v1` so a cold start has its JavaScript.
- **Privacy: one person's copy at a time.** The worker cannot read the HttpOnly session cookie, so the
  proxy stamps every response it lets through with `x-card-who` (`src/lib/auth/who.ts`: a salted SHA-256
  of the identity, 24 hex characters, no email). `dbs-offline-pages-v1` records the `who` it belongs to
  and holds only that person's pages, payloads and pictures. The whole cache is deleted when a response
  carries another `who` or none, on a 401/403, on any request for `/login`, `/join` or `/password-login`
  by the worker, and from the page itself (`ServiceWorker.tsx`) when it lands on one of them (signing out
  is a Server Function redirect the worker never sees as a request). Chosen over keying every URL by
  person because there is exactly one signed-in person per browser profile, and "nothing of the last
  person survives" is simpler to prove than "the right key is always used". Basic Auth has no sign-out:
  its copy goes when the credentials change. Not covered: card art on a CDN (the shared art cache has
  always held public art), and a person's copy stays on the device until one of the events above.
- **The start URL.** `/?source=pwa` is a 200 with a meta-refresh (the root `loading.tsx` makes
  `redirect()` stream), not a 3xx, so the worker leaves it alone online and reads the redirect target
  from the first 64 KB of a copy (`__next-page-redirect`), remembered in the person's cache. Offline it
  goes where it went last: the arena's shell for `/arena` (a prepared device), the kept `/pokemon` for a
  Pokémon player; with nothing remembered, the shell if there is one, else a kept `/pokemon`, else the
  plain notice. A fetch that fails with the browser reporting online is still never an offline launch.
- **Honest when offline.** `OfflineNotice` (root layout) shows a line on these pages while
  `navigator.onLine` is false: "Kein Internet. Du siehst den letzten Stand." under `/pokemon`, English
  elsewhere. Any form submit there and any click on `[data-needs-network]` is stopped with "Kein
  Internet. Das geht erst wieder mit Verbindung." / "You are offline. This needs a connection."; the
  `LiveSearch` box says so instead of navigating; the Pokémon screens already say it when a heart, an add
  or a search fails. A page never seen answers 503 with a notice (German under `/pokemon`), other
  `/pokemon/*` pages (add, discover) say they need the server. Limits: a Server Function started by an
  unmarked click, outside a form, is not caught by the notice (it fails as before); `navigator.onLine` is
  true on a phone with a bar of signal and no data, where the notice does not show but the copy still
  is (the fetch fails).
- **Updating.** No `skipWaiting`, no `clients.claim`, as for the arena (its tests pin that and the art
  cache name `dbs-card-art-v1`): a new worker waits until every window is closed, and a page opened
  before the worker existed is not controlled until its next full load. The worker is a new file byte
  for byte, so a registered device gets it from the browser's own update check; the page registers
  `/sw.js?v=<shell version>` on a prepared device as before.
