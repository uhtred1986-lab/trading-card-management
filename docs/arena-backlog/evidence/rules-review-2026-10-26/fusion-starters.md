# Rules review, 26 Oct 2026, Fusion World starters: every unchecked card of the four starter decks

Authorization: owner, 26 Oct 2026, in this chat: "Yes, read and draft" (the drafts) and "You merge and do all db work" (this review). Writes went only through the repo's guarded paths:
`confirmRule` / `flagRule` (`src/lib/rules-review/deck-review.ts`, attribution `claude-review`); no `saveRule`, no draft fix.
No ad hoc SQL, no owner-confirmed or owner-corrected row touched (there were none on these cards), no P-616, no errata edit. The database was proven to be this app's first (`to_regclass('public.card_rules')` = `card_rules`; `rules:batch` and `rules:snapshot` both check it).
All 75 rows of the 43 cards were snapshotted before the writes (`npm run rules:snapshot -- save`) and diffed after with `--expect status,confirmedAt,confirmedBy,confirmNote,reviewFlag`: `ok`, 61 rows changed (the reviewed ones), the 14 keyword rows byte-identical.

## Selection

Owner `patvolny` plus ownerless decks, game `fusion`, not testing (4 decks); cards whose health (`ruleHealth`, `src/lib/arena/rules-store.ts`) is `unchecked`: 43, ordered by deck count then id. The first 43 of the remaining 43:
FS01-01, FS01-02, FS01-03, FS01-04, FS01-05, FS01-06, FS01-08, FS01-09, FS01-12, FS01-15, FS01-16, FS02-01, FS02-03, FS02-06, FS02-07, FS02-08, FS02-09, FS02-10, FS02-11, FS02-13, FS02-15, FS02-16, FS03-01, FS03-04, FS03-06, FS03-07, FS03-10, FS03-11, FS03-12, FS03-13, FS03-15, FS03-16, FS04-01, FS04-02, FS04-03, FS04-04, FS04-05, FS04-07, FS04-09, FS04-11, FS04-12, FS04-15, FS04-16.
Rows on these cards: 75; to review 61; keyword lines left alone 14; already confirmed or corrected, left alone 0.

Basis order: official Q&A (`src/lib/rules-review/faq.generated.json`, then the live `card_faq.php`); official errata (`errata-cards.php`; `errata.ts`); Rule Manual / glossary (`src/lib/arena/glossary.ts`) and the repo's engine proofs;
Try it boards (`tryRule(probeRuleOf(...))`); throwaway engine proofs on the **stored rows** (`rulesFromRows`, staged boards, every prompt answered in the orders that matter).

## Totals

**61 rows on 43 cards: 55 confirmed, 6 flagged, 0 skipped.** No draft fixes.

## Per row (61 rows)

| Card | Skill | Printed (short) | Verdict | Basis |
|---|---|---|---|---|
| FS01-01 Son Goku | b0 | [when attacking] Draw 1 card. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS01-01 Son Goku | b10 | [activate battle][once per turn] Choose up to 1 of your Battle Cards and it gets +5000 power for the | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS01-01 Son Goku | f0 | [when attacking] Draw 1 card. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS01-01 Son Goku | f10 | [awaken] When your life is at 4 or less, draw 1 card. Then, flip this card over. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS01-02 Whis | f0 | [On Play] Choose up to 1 of your opponent's Battle Cards and it gets -5000 power for the turn. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS01-03 Master Roshi | f0 | [On Play] Draw 1 card. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS01-04 Krillin | f0 | [permanent][your turn] This card gets +5000 power. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS01-04 Krillin | f10 | [on play] Add up to 1 card from your life to your hand. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS01-05 Shin | f10 | [auto][opponent's turn] When you use this card in a combo from your hand, this card gets +10000 comb | flagged | `combo.origins` is null, so it also fires on a combo from the field; the card says "from your hand". Compiler task. |
| FS01-06 Android 17 | f0 | [permanent][opponent's turn] This card gets +5000 power. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS01-06 Android 17 | f10 | [on play] Add up to 1 card from your life to your hand. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS01-08 Son Goku | f10 | [on play] Choose up to 1 of your opponent's Battle Cards and it gets -20000 power for the turn. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS01-09 Son Gohan: Adolescence | f10 | [when attacking] Choose up to 1 of your opponent's Battle Cards and it gets -10000 power for the tur | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS01-12 Beerus | f10 | [when attacking] Choose up to 1 of your other Battle Cards and it gets +5000 for the turn. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS01-15 Kamehameha | f0 | [Activate Battle] Choose your Leader or up to 1 of your Battle Cards and it gets +15000 power for th | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS01-16 God Kamehameha | f0 | [permanent] If you have no Battle Cards, reduce the cost of this card in your hand by 1. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS01-16 God Kamehameha | f10 | [activate main] Choose up to 1 of your opponent's Battle Cards with 30000 power or less and KO it. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS02-01 Vegeta | b0 | [when attacking] Draw 1 card. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS02-01 Vegeta | b10 | [activate main][once per turn] If you have 7 or fewer cards in your hand, this card gets +15000 powe | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS02-01 Vegeta | f0 | [when attacking] Draw 1 card. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS02-01 Vegeta | f10 | [awaken] When your life is at 4 or less, draw 1 card. Then, flip this card over. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS02-03 Gotenks | f0 | [On Play] If you have 7 or fewer cards in your hand, add up to 1 <Son Goten> and up to 1 <Trunks: Yo | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. Its two `<Name>` picks match only since #1217 (catalog rows had no characters). |
| FS02-06 Son Goten | f0 | [When Attacking] Add up to 1 card from your life to your hand. Then, if you have 7 or fewer cards in | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS02-07 Son Gohan: Adolescence | f0 | [Permanent][Your Turn] If you have 7 or fewer cards in your hand, this card gets +15000 power. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS02-08 Trunks: Youth | f0 | [On Play] Draw 1 card. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS02-09 Trunks: Youth | f0 | [permanent][your turn] If you have 7 or fewer cards in your hand, this card gets +10000 power. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS02-09 Trunks: Youth | f10 | [on play] Add up to 1 card from your life to your hand. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS02-10 Videl | f10 | [auto][opponent's turn] When you use this card in a combo from your hand, this card gets +10000 comb | flagged | as FS01-05 f10 (`combo.origins` null; "from your hand" not enforced). |
| FS02-11 Piccolo | f0 | [On Play] If you have 7 or fewer cards in your hand, add up to 1 Extra from your Drop to your hand. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS02-13 Vegeta | f10 | [on play] Choose up to 1 of your opponent's Battle Cards with a cost of 4 or less and place it at th | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. The reading omits "bottom"; the program has `position: bottom`. |
| FS02-15 Galick Gun | f0 | [Activate Battle] Choose your Leader or up to 1 of your Battle Cards and it gets +15000 power for th | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS02-16 Final Flash | f0 | [permanent] If you have 7 or fewer cards in your hand, reduce the cost of this card in your hand by  | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS02-16 Final Flash | f10 | [activate main] Discard 1 card from your hand: Choose up to 1 of your opponent's Battle Cards with a | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. The reading omits "bottom"; the program has `position: bottom`. |
| FS03-01 Broly | b0 | [Activate Main][Once per turn] Place 1 of your energy in your Drop: Draw 1 card. Then, this card get | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS03-01 Broly | f0 | [when attacking] Draw 1 card. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS03-01 Broly | f10 | [awaken] When your life is at 4 or less, add 1 card from your life to your energy in Rest Mode. Then | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. [Awaken]: life card to energy in Rest Mode, condition hoisted (life at 4 or less, #1205). |
| FS03-04 Turles | f10 | [on play] Add up to 1 card with a cost of 3 or more from your Drop to your energy. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS03-06 Paragus | f0 | [Activate Main][Once per turn] If your Leader is <Broly> and you have no <Shamoian> Battle Cards, pl | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. Its `<Broly>`/`<Shamoian>` checks match only since #1217. |
| FS03-07 Paragus | f0 | [on play] Add up to 1 card from your life to your hand. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS03-07 Paragus | f10 | [when attacking] If your Leader is <Broly> and you have no <Shamoian> Battle Cards, play up to 1 <Sh | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. Its `<Broly>`/`<Shamoian>` checks match only since #1217. |
| FS03-10 Broly: BR | f0 | [on play] Draw 1 card. Then, choose up to 1 of your opponent's Battle Cards and KO it. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS03-10 Broly: BR | f10 | [when attacking][once per turn] Switch this card to Active Mode. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS03-11 Vegeta | f10 | [permanent] If you have 6 or more energy, this card gets +5000 power. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS03-12 King Vegeta | f10 | [auto][opponent's turn] When you use this card in a combo from your hand, this card gets +10000 comb | flagged | as FS01-05 f10. |
| FS03-13 Moah | f0 | [On Play] Look at 5 cards from the top of your deck, reveal up to 1 <Paragus> or up to 1 Extra and a | flagged | the rest go to the bottom in the looked-at order, not "a random order" (#1208's reading). Owner ruling or a shuffle. |
| FS03-15 Gigantic Meteor | f0 | [Activate Battle] Choose your Leader or up to 1 of your Battle Cards and it gets +15000 power for th | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS03-16 Destructive Strength | f0 | [Activate Main] Add 1 card from the top of your deck to your energy. | flagged | "from the top of your deck" is stored as choose any 1 card in the deck. Compiler task. |
| FS04-01 Frieza | b0 | [when attacking] Draw 1 card. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS04-01 Frieza | b10 | [end of your turn] Choose up to 2 of your Battle Cards and switch them to Active Mode. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS04-01 Frieza | f0 | [when attacking] Draw 1 card. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS04-01 Frieza | f10 | [awaken] When your life is at 4 or less, draw 1 card. Then, flip this card over. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS04-02 Cui | f10 | [when ko'd] Draw 1 card. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS04-03 Golden Frieza | f10 | [when attacking] Choose up to 1 of your opponent's Rest Mode Battle Cards and it can't switch to Act | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS04-04 King Cold | f10 | [when ko'd] Choose up to 1 of your opponent's Rest Mode Battle Cards with a cost of 4 or less and KO | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS04-05 Zarbon | f10 | [on play] Add up to 1 card from your life to your hand. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS04-07 Sorbet | f0 | [On Play] Draw 1 card. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS04-09 Cheelai: BR | f10 | [auto][opponent's turn] When you use this card in a combo from your hand, this card gets +10000 comb | flagged | as FS01-05 f10. |
| FS04-11 Frieza | f0 | [On Play] Choose up to 1 of your opponent's Battle Cards and switch it to Rest Mode. | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS04-12 Frieza | f0 | [When Attacking] Add up to 1 card from your life to your hand. Then, choose up to 1 of your opponent | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS04-15 Golden Death Beam | f0 | [Activate Main] Choose up to 1 of your opponent's Rest Mode Battle Cards with a cost of 3 or less an | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |
| FS04-16 Death Ball | f0 | [Activate Battle] Choose your Leader or up to 1 of your Battle Cards and it gets +15000 power for th | confirmed | stored program reads as printed; identical to the record the Fusion World suite and `arena:fuzz 200 --game fusion` (200/200) exercise. No FW Q&A or errata. |

## Left alone

- FS01-05 f0: keyword line (health done)
- FS01-08 f0: keyword line (health done)
- FS01-09 f0: keyword line (health done)
- FS01-12 f0: keyword line (health done)
- FS02-10 f0: keyword line (health done)
- FS02-13 f0: keyword line (health done)
- FS03-04 f0: keyword line (health done)
- FS03-11 f0: keyword line (health done)
- FS03-12 f0: keyword line (health done)
- FS04-02 f0: keyword line (health done)
- FS04-03 f0: keyword line (health done)
- FS04-04 f0: keyword line (health done)
- FS04-05 f0: keyword line (health done)
- FS04-09 f0: keyword line (health done)

## Not done / caveats

- **Basis.** No official Q&A or errata exist for these cards on Bandai's Fusion World site, so the basis is the printed text (the catalog rows, which match Bandai's card list), the FW Official Rule Manual (v1.10 plus the 1 Jul 2024 first-turn draw), and engine proof: each confirmed row's stored program (kind, trigger, ops, condition) is identical in canonical JSON to the record the Fusion World suite and a 200-game fuzz exercise on the four starters (56 of 57 non-keyword rows identical as drafted; FS02-03 differed only in the catalog's "Trunks: Youth" spelling, which is the right one).
- **Found during the review and fixed first (#1217):** all 2,104 Fusion World catalog rows had an empty `characters` list, so no `<Name>` filter or "your Leader is <Name>" check could match in a real game (FS02-03, FS03-06, FS03-07 f10, FS03-13). A Fusion World card's name is now its character. Those rows are confirmed on the strength of that fix.
- **Engine gaps behind the flags (issues are the owner's call to open):** the Fusion World [Super Combo] [Auto] stores `combo.origins` null instead of `["hand"]` (4 rows); "add 1 card from the top of your deck" is read as a choice from the whole deck (FS03-16); "in a random order" is read as a fixed order (FS03-13).
- **Not verified:** Try it boards were not used (the probe stages original-game boards); no live game against the database decks was played. The original-game fuzz on the database decks ran the same day: 40/40 completed, 0 crashes.

## Addendum, 26 Oct 2026 evening: the six flagged rows, after #1225 (F1-11, #1220)

The compiler fixes merged in #1225. Each flagged card was re-drafted (`npm run arena:draft -- --card <id>`). All six were
compiler-owned drafts, so the drafter rewrote them in place: "1 compiler rows updated, 0 person-owned rows now differ".
Each new reading was then checked against the printed text and confirmed through `confirmRule` (attribution
`claude-review`), which also clears the review flag. The rows were saved before the re-draft (10 rows of the 6 cards) and
diffed afterwards with `--expect combo,ops,pattern,reads,version,status,confirmedAt,confirmedBy,confirmNote,reviewFlag`:
the result was `ok`. The six reviewed rows changed and the other 4 rows are untouched.

| Row | New reading | Result |
|---|---|---|
| FS01-05 f10, FS02-10 f10, FS03-12 f10, FS04-09 f10 | `combo.origins: ["hand"]`: the +10000 combo power applies only when the card joins a combo from the hand | confirmed |
| FS03-13 f0 | the rest go to the bottom of the deck with `random: true`, shuffled by the game's seeded RNG | confirmed |
| FS03-16 f0 | `moveTo energy` of the top card of the deck (`take: 1`), not a choice from the whole deck | confirmed |

**Totals for the four starter decks: 61 rows reviewed, 61 confirmed, 0 flagged.**
