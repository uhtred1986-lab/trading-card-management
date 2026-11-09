# The latest Masters releases as AI test decks (9 Nov 2026)

The owner asked for decks from the latest releases, "as these have the most complicated game designs
and mechanisms per card", and for the results of games played with them.

## The decks and where the cards come from

- **Decklists.** The prepared, reviewable recipes from BT27 on, in
  `src/lib/arena/testing/prepared-recipes.json` (#827, `docs/arena-proposed-decks.md`). There are eight:
  two each for BT27, BT29, BT30 and BT31. Each has 50 main-deck cards; some have a Z-Deck.
- **Card text.** [catalog-subset-2026-11-09.json](catalog-subset-2026-11-09.json) holds only those decks'
  122 cards. It comes from read-only GETs of the public deckplanet Masters catalog (6,619 raw records),
  shaped by the app's own `shapeCatalog`, with `errata.ts` applied.
  - No database was read.
  - Refresh it with `npx tsx scripts/arena-latest-decks.mts --fetch`.
- **Rules.** As in the #649 audit, every card is compiled from its printed text with the repo's
  compiler. A game here shows what the engine plays from the text. The stored `card_rules` records can
  carry owner corrections, so a live game may differ.
- **Tooling.**
  - `scripts/arena-latest-decks.mts` reports, per deck, its legality and the faces the compiler cannot
    read.
  - The SPRT harness plays an ordered matchup of these decks named `p1~p2` (for example
    `bt31_116~bt29_029`). It uses the dev seed block `latest-decks`, and such a run is never a gate.

## Qualification: which decks play to the end

The heuristic played itself in each deck's mirror, 4 games each
([qualification-heuristic-mirrors.json](qualification-heuristic-mirrors.json)):

| Deck | Release | Legal | Unread faces | Games finished | Where games stop |
|---|---|---|---|---|---|
| White Cell, reveal/evolve (BT31-116) | BT31 | yes | 0 | 4/4 | — |
| Gogeta, widened fusion (BT31-001) | BT31 | yes | 0 | 4/4 | — |
| Cooler, Squadron return loop (BT29-029) | BT29 | yes | 0 | 4/4 | — |
| Mechikabura, multiple attacks (BT27-092) | BT27 | yes | 4 | 4/4 | none, but see the twin check below |
| Brianne, Maiden stack play (BT30-082) | BT30 | yes | 1 | 3/4 | BT30-099 Kakunsa: "you switch this card to Active Mode at the end of the turn" |
| Super Saiyans United, red attacks (BT30-001) | BT30 | yes | 1 | 0/4 | BT30-001's awakened Leader: "If you have 1 or more {Spirit} under any of the cards in your Battle Area and you place all of them at the bottom of their owner's deck" (turn 3, every game) |
| Vegeta, Saiyan evolution (BT29-057) | BT29 | yes | 3 | 0/4 | BT29-057's awakened Leader: "place up to 1 ≪Frieza's Army≫ card with {Battle With Vegeta} in its card name under the played card" |
| Piccolo, Namekian revival (BT27-045) | BT27 | yes | 1 | 0/4 | BT27-128 Dende: "add up to 1 green <Porunga>, ≪Namekian≫ … or Extra to your hand" (turn 2–3) |

- Every interruption is at a clause the compiler reports as unread. None comes from the engine or the
  AI.
- In one Mechikabura mirror game, the hidden-twin privacy check failed at a mode choice
  (`chooseMode`). The heuristic's answer played on the real position but was refused on a twin that
  differs only in hidden cards.
  - So the modes the engine offers there can depend on a hidden card.
  - It is recorded for the rules programme. It is not an AI defect, and it was not investigated
    further here.

The AI comparisons below use the three decks that read completely and finish every game: White Cell,
Gogeta and Cooler. That gives nine ordered matchups, three mirrors and six cross matchups.

## Results

Recorded in `docs/arena-lookahead.md` ("The latest releases").
