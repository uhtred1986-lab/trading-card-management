# Classic tutorial decks

These are custom teaching decks built from real early-release cards, not official sealed starter lists. All printed abilities remain active.

Pinned from the read-only app catalog export dated 2026-10-15: BT1 Galactic Battle (2017). Both decks contain one leader and exactly 50 main cards, with no banned cards and no count above the exported copy limit. This checks the pinned export, not future ban-list changes.

## You · Goku

Leader: BT1-056 — Son Goku

| Copies | Card | Name |
| --- | --- | --- |
| 4 | BT1-060 | Son Goku |
| 4 | BT1-061 | Friend-Summoning Son Gohan |
| 4 | BT1-062 | Son Gohan, Family of Justice |
| 4 | BT1-065 | Furious Yell Vegeta |
| 4 | BT1-066 | Tenacious Vegeta |
| 4 | BT1-068 | Slasher Trunks |
| 4 | BT1-071 | Energy Power Gotenks |
| 4 | BT1-072 | Human Shield Krillin |
| 4 | BT1-079 | King Vegeta's Surprise Attack |
| 4 | BT1-080 | Full Power Energy |
| 4 | BT1-082 | Family Kamehameha |
| 2 | BT1-064 | Raging Attacker Vegeta |
| 2 | BT1-067 | Implacable Trunks |
| 2 | BT1-070 | Super Saiyan Gotenks |

## Frieza

Leader: BT1-084 — Frieza

| Copies | Card | Name |
| --- | --- | --- |
| 4 | BT1-089 | Avenging Frieza |
| 4 | BT1-093 | Tagoma, The Loyal Warrior |
| 4 | BT1-096 | Ginyu Force Recoome |
| 4 | BT1-097 | Ginyu Force Burter |
| 4 | BT1-099 | Ginyu Force Guldo |
| 4 | BT1-102 | Appule |
| 4 | BT1-103 | Sui |
| 4 | BT1-104 | Banan |
| 4 | BT1-105 | Cui |
| 4 | BT1-109 | Frieza's Call |
| 4 | BT1-088 | Frieza, Hellish Terror |
| 2 | BT1-090 | Mecha-Frieza, The Returning Terror |
| 2 | BT1-094 | Shisami, The Loyal Warrior |
| 2 | BT1-098 | Ginyu Force Jeice |

Setup uses seed **7**, the human first, both opening hands kept, and ordinary **eight Life**. The opening human hand includes Slasher Trunks (BT1-068). No card is removed, reskinned, or stripped of skills.

Rebuild offline with `node --import tsx scripts/build-arena-tutorial-pack.mts`. The source is `docs/arena-tutorial-classic-cards.json`; the output pins definitions, complete front/back compiled programs, and local image paths in `src/lib/arena/tutorial/classic-pack.json`. The builder fails on incomplete compiler support. Runtime imports only that output, never the compiler or database.

The free opponent chooses current legal actions, awakens when offered, charges, plays a Battle Card costing at most two while its Battle Area is empty, and attacks the leader. Mandatory card choices and response windows resolve through current legal actions. A 64-action bound returns control rather than running indefinitely. The policy is intentionally simple; it is not a strategic AI.

## Phone and guidance validation

Issue #875. `/arena/tutorial/phone` embeds the actual authenticated tutorial at a measured 390 × 844 CSS-pixel viewport (no desktop scaling). Local Chromium smoke verified the iframe dimensions, no horizontal overflow, real card artwork, charging and Slasher Trunks play review, with no JavaScript errors. This verifies phone layout, not a physical touchscreen. TinyFish live run follows deployment.

TypeScript, changed-file ESLint, focused session and lesson checks passed. Real session tests cover eight-Life conservation, legal lists, accepted/rejected payment, replay, three complete matches, Double Strike and Awaken. Independent static review found no hard blockers; missing ability-prompt guidance and Skip explanation behavior were corrected. The initial tutorial release already passed the full standard suite/build; these follow-up checks target the changed data and guidance rather than repeating broad engine suites.

Fixture/curriculum version 2 uses a separate save key, leaving the prior synthetic practice save untouched. The prior desktop agent run is not evidence for this new matchup.
