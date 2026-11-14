# Pokémon in the collection, deck and buying screens: plan

Status: **draft for the owner, 14 Nov 2026.** Nothing is built. Open questions are in §9; every
assumption they would change is marked **(Q n)**. The look and the flows are in `design.md` beside
this file.

## 1. Goal

The owner's daughter keeps her **Pokémon TCG** collection and her decks in this app on her phone,
finds cool cards and builds new decks around them, and marks what she wishes for. The owner buys
those cards on CardTrader with the existing cart optimiser.

In scope: collection, live card search and browsing, decks, wishes, trade list, CardTrader buying,
voice and photo input, photo override of a card's picture. Out of scope: the arena, meta, leaders,
set review, news and the rules screens (Pokémon gets `arena: false` and none of those tabs).

## 2. What the owner asked for, and how the plan answers it

| Requirement | Answer |
|---|---|
| Only owned cards stored locally (the pool is ~20,000 cards per language) | No Pokémon catalog import. A card gets a row in `cards` / `card_prints` only when something refers to it: a lot, a deck line or a wish (§4). |
| Other screens load cards live while searching | Search and browse call **TCGdex** through one server route with a one-day cache (§3). |
| Phone first, above all for looking through cards | 2-column grid with endless scroll and a full-screen swipe viewer (`design.md` §3). |
| A card's picture can be replaced by a phone upload | `card_photos` table, shrunk in the browser, shown in place of the catalog image (§5). |
| Input by reading aloud or by photo | German voice entry by name or number, and the existing scan pipeline with a Pokémon prompt (§6). |
| Daughter records collection and decks, builds decks from cool cards | Pokémon deck rules, "build around this card" (§7). |
| Owner buys through CardTrader | Wishes and deck shortfalls flow into `/cart`; an SL can open a player's wishes (§8). |

## 3. Card data source: TCGdex

Probed from this session on 14 Nov 2026 (`api.tcgdex.net/v2/{lang}/…`, no key, no SDK needed):

- German and English card data: name, category (Pokémon / Trainer / Energy), types, HP, stage,
  `evolveFrom`, attacks, weakness, retreat, rarity, `regulationMark`, `legal.standard` /
  `legal.expanded`, set with official card count, `dexId`.
- Name search with paging (`?name=like:Pika&pagination:page=…`), filter by set, type, legality.
- Images at `assets.tcgdex.net` (`…/low.webp` was 27 KB, `…/high.webp` for the viewer).
- Per variant (normal, holo, reverse): a **CardTrader id**, a Cardmarket id with **EUR prices**
  (low, trend, 7- and 30-day average) and a TCGplayer id. The Cardmarket EUR price removes the USD
  conversion for this game.

`pokemontcg.io`, the usual alternative, answered 503 during the probe and is English only.

Two things a worker proves first, because the plan leans on them:

1. That TCGdex's `thirdParty.cardtrader` number is a CardTrader **blueprint id** usable with
   `marketplace/products?blueprint_id=` (needs the CardTrader token; one read call).
2. German coverage of the newest sets. Where a German card is missing, the search falls back to the
   English record and says so.

## 4. Data model: "materialise on reference"

`owned_cards`, `deck_cards`, `want_list` and `ct_listings` all point at `cards` by foreign key.
Keeping that is what lets reservations, the cart and the optimiser work for Pokémon unchanged. So:

- **`ensurePokemonCard(tcgdexId, lang)`** fetches the card from TCGdex and upserts one `cards` row
  and one `card_prints` row per variant, inside the same transaction as the lot, deck line or wish
  that needs it. It is the only writer of Pokémon rows in `cards`.
- Card id: `PKM-` + TCGdex id (`PKM-sv03.5-006`); print id adds the variant
  (`PKM-sv03.5-006_holo`). The prefix keeps the id space apart from Bandai's.
- Column mapping: `card_type` = POKEMON / TRAINER / ENERGY, `colors` = types, `power` = HP,
  `skill` = abilities and attacks as text, `rarity` as printed. Everything else Pokémon-specific
  (stage, `evolveFrom`, attacks, weakness, retreat, regulation mark, legality, dex number, language,
  third-party ids) goes into one new nullable **`cards.details jsonb`**.
- New nullable columns only, from `db:generate`: `cards.details`, `cards.lang`,
  `card_prints.ct_blueprint_id`. Nothing existing changes shape.
- A card nobody refers to any more stays as a row (deleting catalog rows is not worth a destructive
  path); a nightly refresh skips them.
- Because Pokémon rows are written at request time, `ensurePokemonCard` expires the catalog cache
  tag (the hard rule for a new writer of a cached table).

Size: a few hundred to a few thousand rows for one child's collection, against 20,000+ for an import.

## 5. Pictures replaced from the phone

- New table `card_photos` (print id, owner, `data bytea`, mime, created). Same storage pattern as
  `scan_photos`, so **no new dependency and no Vercel setting**.
- The browser shrinks the photo on a canvas to about 750 px wide WebP (60 to 100 KB) before upload;
  the server refuses anything over 400 KB.
- `GET /api/card-photo/[id]` serves it with a long cache and an id that changes on re-upload.
  `CardImage` takes the photo when one exists, else the catalog image.
- One photo per print and owner; "Original wiederherstellen" removes it. **(Q 4)** decides whether
  the owner sees the daughter's photo too (assumed: yes, SLs see everyone's as with lots).
- Works for the Dragon Ball games as well, at no extra cost.

## 6. Input: voice and photo

**Voice** (free, on the device, no audio uploaded):
- `startListening` already takes a language; Pokémon uses `de-AT` **(Q 2)**.
- The child says a name ("Glurak ex") or a number ("sechs von hundertfünfundsechzig"). The text goes
  to the live search; number and set size narrow it. The answer is a row of pictures to tap, never a
  silent guess, since one name has dozens of printings.
- After a tap: big ± for the quantity, variant chips (normal / holo / reverse), then the mic
  reopens. Same loop shape as quick capture.

**Photo** (uses the existing paid scan pipeline at run time, as the Dragon Ball scan does):
- `src/lib/ai/scan.ts` gets a per-game system prompt and instruction. For Pokémon the model reads
  name, collector number (`006/165`), set code and regulation mark from the bottom edge.
- Matching: number + set size + name against TCGdex instead of the local `cards` table, then
  `ensurePokemonCard` on confirm.
- A binder page (9 cards in one photo) goes through the existing scan batch; a single card through
  quick capture.
- Building and testing this needs no paid call: the matcher is tested on recorded detections. One
  real photo test is the owner's to ask for.

## 7. Decks

- `GAME_INFO.pokemon.deck`: exactly 60 cards, no leader, no Z-Deck, 4 copies **by card name**
  (not by number), basic Energy unlimited, ACE SPEC and Radiant one per deck, at least one Basic
  Pokémon. Format (Standard / Expanded) comes from TCGdex's `legal` flags.
- `legality(rows, game)` keeps its contract: it labels, it never blocks. Pokémon gets its own branch
  rather than more conditions in the leader-and-Z-Deck code.
- Deck builder: groups are Pokémon / Trainer / Energy; the card picker searches live and offers
  "from my collection" first.
- **Build around this card**: from a card the child likes, propose its evolution line
  (`evolveFrom`, searched live), Energy of its type and Trainers she owns, as a draft deck she
  edits. Deterministic and free in this delivery. The Claude deck wizard for Pokémon is a later,
  separate step **(Q 6)**.
- Reservations, built vs. virtual decks and the over-reserve refusal apply unchanged.

## 8. Wishes, trading and buying

- **Wish**: a heart on any card in search, viewer or deck writes `want_list` for the child.
- **Owner's view**: `/cart` for an SL gains "Wishes of ‹player›". Today an SL sees a player's
  decks but not their wishes, so this closes a real gap for the Dragon Ball games too.
- **CardTrader**: Pokémon is a separate CardTrader game with far too many blueprints to sync.
  Instead the blueprint id arrives with the card from TCGdex (§3) and listings are fetched per
  wished card, as `refreshListingsForCard` does now. Filters: language **(Q 2)**, condition, EUR,
  seller country. The optimiser itself is already game-neutral.
- **Prices**: Cardmarket EUR from TCGdex for owned and wished cards only, refreshed by the existing
  06:00 price cron. Whether the child sees money at all is **(Q 3)**.
- **Trade list** **(Q 5)**: copies she owns beyond what her built decks reserve, as a list she can
  show a friend. Read-only and computed, like reservations.

## 9. Open questions for the owner

1. **Who uses it and how?** Her age and reading level; her own phone or yours; does she get her own
   join code (assumed: yes, a player account of her own, which keeps her collection apart from yours).
2. **Card and app language.** Are her cards German, English or mixed? Should the Pokémon screens
   speak German (the app is English today; assumed: German copy for the Pokémon screens only, cards
   stored in the language she adds them in)?
3. **Money.** Should she see prices and the cart, or only hearts, with prices and buying on your
   side (assumed: she sees no prices)?
4. **Photo override.** One picture per card for the whole family, or per person? And did "local"
   mean stored in the app (assumed) or only on the phone?
5. **Trading.** Is a list of spare cards to show friends what you meant, or trades between app
   users, or selling?
6. **Deck help.** Is the free "evolution line + Energy + owned Trainers" draft enough for the first
   delivery, with the Claude wizard later? The wizard costs per use.
7. **Deck format.** Kitchen-table decks (60 cards, 4 copies, no rotation check) or real Standard
   legality flags (assumed: flags shown, quietly, never blocking)?
8. **Card conditions and variants.** Track holo / reverse holo separately (assumed: yes, they differ
   in price) and condition (assumed: no, near mint when buying)?
9. **Start screen.** May the installed app open on her collection instead of `/arena` for a user
   whose game is Pokémon (assumed: yes, a per-user home game)?

## 10. Code improvements proposed alongside

From the code map made for this plan. Items 1 to 4 are needed for Pokémon anyway; 5 to 8 are worth
doing while the files are open; 9 and 10 are separate suggestions.

1. **Per-game capabilities in `GAME_INFO`**, not branches. About 25 places test for `"fusion"` or
   `"dbs"` (card types, colours, deck zones, stat labels, external links, catalog and price source).
   Moving these into `GAME_INFO` makes the third game data, and a fourth one cheap.
2. **Sync loops ask for the games that have that source.** `syncCatalog`, `syncPrices` and the meta
   sync iterate all of `GAMES` with `Record<Game, …>`; Pokémon has no deckplanet path or tcgcsv
   category. A `catalog.kind` of `sync` or `live` replaces the assumption.
3. **`gameOr` and `gameOfSetCode` fall back to `"dbs"` silently.** With a third game an unknown
   value should be an error in tests and a visible "unknown game" in the UI, not Dragon Ball.
4. **Card detail and tiles driven by a per-game stat list** (Energy / Power / Combo today) instead of
   fixed fields, so `cards/[id]` and `CardTile` need no game checks.
5. **SLs can open a player's wishes** (§8).
6. **Image hosts listed once.** `next.config.ts` `remotePatterns` and `public/sw.js` `ART_HOSTS`
   repeat the same list by hand; generate the second from the first.
7. **Voice language per user**, not the `en-US` default.
8. **The PWA name and start URL** ("DBS Card Companion", `/arena`) become neutral, with the start
   screen chosen per user.
9. **One reusable swipe viewer.** Built here for Pokémon, then offered on `/cards` and `/collection`
   for the Dragon Ball games.
10. **Collection and decks offline.** Only the arena works offline today; a child's phone is often
    without signal. Sized separately, not part of this delivery.

## 11. Delivery: one run, one PR

Owner's wish: cheaper models do the work in one go and one PR, with a stronger model coordinating.

- **Coordinator:** this session (it holds the plan, the code map and the owner's answers), or an
  Opus session started from these two files if this one is gone. The coordinator writes the
  foundation commit and the briefs, reviews every diff against its acceptance, integrates and runs
  the gate. It writes no feature code beyond the foundation.
- **Workers:** Sonnet, the repo's default for UI, features and tests. Haiku for the docs and
  bookkeeping lane. At most three at a time, each in its own worktree, each told it is a worker.
- **One integration branch, one PR.** Workers branch from the integration branch and the coordinator
  merges their branches into it. This departs from "one PR per issue" in `docs/agent-brief.md` on
  the owner's instruction; the PR lists the lanes and their evidence one by one instead.

| Wave | Lane | Model | Owns (hot files in bold) |
|---|---|---|---|
| 0 | Foundation: third game in **`games.ts`**, capability fields, **`schema.ts`** + generated migration, id helpers, fix every `Record<Game>` so typecheck is green | coordinator | serial, before anything else |
| 1 | A. TCGdex client, `/api/pokemon/search`, `ensurePokemonCard`, cache tag | Sonnet | `src/lib/pokemon/*` (new) |
| 1 | B. Pokémon legality, zones, `add.ts`, deck queries | Sonnet | **`legality.ts`**, `decks/*` |
| 1 | C. Photo override: table use, upload action, route, `CardImage` | Sonnet | `CardImage.tsx`, new route |
| 2 | D. Browse grid, swipe viewer, home game, navigation, German copy | Sonnet | `src/app/pokemon/*` or game-aware `/cards`, **`navigation.ts`** |
| 2 | E. Voice (de-AT) and photo scan for Pokémon | Sonnet | `scan/*`, `ai/scan.ts` |
| 2 | F. Wishes for SL, CardTrader by blueprint id, EUR prices, trade list | Sonnet | `marketplace/*`, `cart/*` |
| 3 | G. Deck builder UI and "build around this card" | Sonnet | `DeckBuilder.tsx`, after B and D |
| 3 | H. Docs (`CLAUDE.md`, architecture pages), `verify-rules` / `verify-db` cases, guards | Haiku | docs, `scripts/verify*` |

Gate, once, on the combined head: `npm run checks -- full` with `--build`, `npm run shots:compare`
for every touched route at 390 and 1440, a live read against TCGdex, the CardTrader blueprint proof
(§3), and the migration SQL read for anything destructive. Merging deploys and migrates production,
so the PR stays a draft until the owner has seen the screenshots.

Needs the owner's say-so before the run: nothing, if the assumptions hold. No new npm dependency, no
destructive migration and no Vercel setting. A paid photo-scan test only if the owner asks for it.

## 12. Risks

- **TCGdex is a community service.** One-day cache on every read, and owned cards never depend on
  it once materialised. If it is down, search says so; collection and decks keep working.
- **CardTrader id mapping** unproven until §3 step 1. Fallback: match by expansion and collector
  number, as the Dragon Ball crosswalk does.
- **German speech recognition of Pokémon names** is uneven. The tap-to-confirm row and the number
  path are the answer; a typed search stays one tap away.
- **`cards` now holds rows written at request time.** The catalog cache and the errata rule
  ("fixed in `errata.ts`, never by UPDATE") were designed for a synced catalog; lane A documents
  the Pokémon exception in `catalog-and-sync.md`.
- **Database size** from photos: about 100 KB each. A thousand overrides is 100 MB on Neon; the
  upload action counts and refuses beyond a ceiling the owner can raise.
