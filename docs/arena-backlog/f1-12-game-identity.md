---
title: "Arena F1-12: make it obvious which game you play — official game logos, a game switch at launch, a badge everywhere"
issue: 1223
milestone: Arena F1 — Fusion World: the four launch starter decks
labels: backlog, ready-for-agent, area:arena-ui, phase:fusion-world, model:sonnet-5
stage: fusion-world
priority: P2
status: closed
closed_at: 2026-10-26
touches: next.config.ts, src/components/arena/GameSwitch.tsx, src/components/DeckDiscovery.tsx, src/lib/catalog/games.ts, src/components/GameMark.tsx, src/app/arena/page.tsx, src/components/arena/PlayPicker.tsx, src/components/arena/Invitations.tsx, src/components/arena/GamesList.tsx, src/components/arena/ComputerPlayCard.tsx, src/components/arena/ArenaHeader.tsx, src/components/arena/stage/ArenaStage.tsx, src/components/arena/GameOver.tsx
---
Tracking: Arena F1 (#1193). Asked for by the owner on 26 Oct 2026 ("make it very obvious which game you play,
maybe with icon"; icons: "fetch the official icons"). Priority P2, size M, Sonnet. Skill `screen-proof`.

## Why

The arena now plays both games, but the launch screen still reads as if it plays only one:

- `src/app/arena/page.tsx` says "choose a ready Masters deck" and, with no ready deck, "the arena does not play
  Fusion World". `PlayPicker.tsx` line ~112 says "Masters decks only. Fusion World uses different rules."
  `ArenaHeader.tsx` ~133 says "all playable Masters decks". All four are untrue since #1201.
- The deck pickers mix both games. The only hint is a `[Fusion World] ` text prefix in the invitation select
  (and none in `PlayPicker`), so you can pick a Super deck against a Fusion World deck. The server refuses the
  pair (`startGame` in `src/lib/arena/games.ts`: "the two decks belong to different games"), but only after
  submit, as a thrown error page.
- Nothing on the board, the games list, the Continue strip or the game-over screen says which game it is.
- The built-in computer ("Vs computer", `src/lib/arena/local/pack.ts`) plays Super only (`game: "dbs"`), and
  doesn't say so.

## The official art (owner's choice: Bandai's own, no home-made icons)

Bandai's game-select page `https://www.dbs-cardgame.com/` uses these. **The repository is public, so do
not commit Bandai's images.** Hot-link them through `next/image` exactly as the app already does for card
art (`next.config.ts` `images.remotePatterns` for `www.dbs-cardgame.com`). Add two patterns with a comment:
`/gameselect/images/**` and `/fw/renewal01/images/common/**`.

| Use | Super (`dbs`) | Fusion World (`fusion`) |
|---|---|---|
| Game tile (470×666 jpg, the game-select buttons) | `https://www.dbs-cardgame.com/gameselect/images/btn_master.jpg` (orange, "CARD GAME MASTERS") | `https://www.dbs-cardgame.com/gameselect/images/btn_fw.jpg` (cyan, "FUSION WORLD") |
| Wordmark logo, white on transparent | `https://www.dbs-cardgame.com/gameselect/images/logo.png` (461×169) | `https://www.dbs-cardgame.com/fw/renewal01/images/common/logo_fw_w.png` (510×272) |
| Accent colour, sampled from the tile | orange, about `#f77f00` (sample it) | cyan, about `#14b4f0` (sample it) |

Put these in `GAME_INFO` (`src/lib/catalog/games.ts`) as `art: { tile, logo, accent }` so every screen reads one
place. If an image fails to load (offline, Bandai moves it), the component falls back to the game's `short` name on
the accent colour, never a broken image.

## Build

1. **`src/components/GameMark.tsx`** (new, shared). `<GameMark game size="chip" | "logo" | "tile" />`:
   - `chip`: a small rounded pill with the accent colour as its background or border and the game's `short` name
     (`Super`, `Fusion World`). It is the readable mark at 16–20 px. Logos are not legible that small, so the
     chip carries the colour and the word.
   - `logo`: the white wordmark on a dark ground, for headers.
   - `tile`: the game-select tile, for the launch switch.
   - It always has a text alternative (`alt`/`aria-label` = `GAME_INFO[game].label`).
2. **Launch screen (`/arena`), the game switch.** When the viewer has ready decks of both games, the "Set up a
   match" section opens with the two official tiles side by side as a radio group (`?game=dbs|fusion`, links
   like `GameFilter` so it is one tap and survives reload). The chosen tile is full colour with an accent ring.
   The other is dimmed. The choice:
   - filters **both** deck pickers in `PlayPicker` to that game, so a mixed pair can no longer be chosen;
   - preselects from `lastPlayedDecks` within that game; with no `?game=`, it defaults to the game of the last
     played deck, then `dbs`.

   With one game only, there is no switch: a single `logo` heading shows which game it is. On phones (390 px)
   the two tiles sit side by side at about 45% width each and are cropped to the upper half, so the switch stays
   one short row. Use `object-cover` and keep the `tap` class.
3. **Deck tiles and selects.** Every deck in `PlayPicker` and `Invitations` shows a `chip`, in place of the
   `[Fusion World] ` text prefix in `page.tsx`. An invitation's join select offers only decks of the inviter's
   game (read the inviter's deck game in `listOpenMatches` if it is not already there). Joining with the other
   game must be impossible from the UI, not only refused by the server.
4. **The board.** `ArenaStage.tsx` shows the game's `chip` in the top bar beside the turn/phase readout
   (`live.game.game` is already there; `wordsFor(live.game.game)` sits at line ~293). Also give the board a
   one-pixel accent line in the game's colour along the top bar. That is enough; do not re-theme the board. The
   dbs board must look the same apart from the chip and the line.
5. **Games list, Continue strip, game over.** Each row in `GamesList.tsx`, the `ContinueStrip` and the
   `GameOver` heading carry the `chip`. Check what `listGames`/`listPlayingGames` return; add the game from
   `arena_games` only if it is already stored there or derivable without a migration. If neither, say so in the
   PR and leave rows without the chip rather than adding a column.
6. **Built-in computer.** `ComputerPlayCard` shows the Super chip and says "Super starter decks", because the
   offline pack is Super only.
7. **Untrue copy, fixed.** The four sentences under Why, plus `src/app/decks/[id]/page.tsx`'s eyebrow if it reads
   wrong. Say "Super" for `dbs`, following `GAME_INFO.short`; the catalogue calls it Masters only where it means
   the Masters sets.

## Out of scope

Re-theming the board per game; a Fusion World offline pack or tutorial; new npm dependencies; committing Bandai
images; any migration.

## Acceptance

- `npm run checks`, `npm test` (guards), `npm run build`.
- `npm run shots:compare -- /arena` at 1440 and 390, before/after, with a viewer holding ready decks of both games
  (the F1-07 fixtures or a locally seeded PGlite are enough). The PR shows the switch with each game chosen.
- A dbs board (`/arena/<id>`) before/after: only the chip and the accent line differ. A Fusion World board shows
  the Fusion World chip.
- With an image URL blocked (DevTools or a route stub), the switch and chips fall back to text on the accent
  colour; screenshot in the PR.
- Picking Fusion World leaves only Fusion World decks in both pickers. An invitation from a Super deck offers
  only Super decks to join with.
- `grep -rn "Masters deck\|does not play Fusion\|Masters decks only" src` returns nothing untrue; paste it in the
  PR.
