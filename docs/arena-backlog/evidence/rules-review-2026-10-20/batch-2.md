# Rules review, 20 Oct 2026, batch 2: "up to N" mill shape, stale flags, next 30 cards

Authorization: owner, 18 Oct 2026 ("full permission to write into the db in production without further asking") and
20 Oct 2026 ("The BT3-120 fix shape is right. Apply the same correction to BT3-119 and the other cards with the same
'up to 2 from the top of your deck' wording, then continue the review with the next 30 unchecked deck cards").
Writes went only through the repo's guarded paths: `arena:rule` (`scripts/arena-rule.mts`), `saveRule`
(`src/lib/arena/rules-store.ts`), and `confirmRule` / `flagRule` (`src/lib/rules-review/deck-review.ts`, attribution
`claude-review`). No ad hoc SQL, no owner-confirmed or owner-corrected row touched, no P-616, no errata edit. The database
was proven to be this app's first (`to_regclass('public.card_rules')`).

## 1. Ruling recorded first

`npm run arena:rule -- BT3-120 --skill 10 "Owner approved 20 Oct 2026: 'place up to N cards from the top of your deck in the Drop Area' is an
optional, one-at-a-time choice (may 1, then if taken may 1 ...), not a forced mill of exactly N."`
Recorded on BT3-120 front skill 10 (it replaced the earlier Claude explanation on that row; the program is unchanged).

## 2. The shape applied to the same wording

Shape (generalised for N): `may(mill 1)`, then `if did(may): may(mill 1)`, nested N deep. Written as `source claude`,
`status draft`, explanation "Owner-approved shape 20 Oct 2026 (BT3-120 ruling): optional one-at-a-time". Only the mill (or the
"choose up to N in the deck, move to Drop" the compiler used for three cards) was replaced; every other op, the hoisted IF, the
trigger and the price were kept. Candidates were every stored rule whose printed text says "place up to N cards from the top of your
deck in/into ... Drop": 32 rows (BT3-120 included). None is owner-confirmed or owner-corrected.

Checks per row: `readRule` / `validateRule` ok; Try it boards run before and after (identical outcomes; the probe cannot answer a
decision prompt, so these are "fires / changes nothing" or "did not fire" for leader-colour and attack conditions, and the activate
rows are "probe broke" before and after, see below); saved through `saveRule`.
Engine proof (throwaway script, not committed; the real `RULES.apply` flow with the saved program on a played card):
BT3-119 (N=2): accept+accept Drop +2, accept+decline +1, decline first 0; P-082 (N=3): 3 / 2 / 1 / 0 for the same answers.

Two things to know about how the 21 rows were written:

- 20 of the 21 rows are older records that lack the typed `usage` / Sparking `validity` / payment records (#907), and `saveRule`
  refuses a write over such a row. For those I filled exactly those three records from the compiler's current record for the same
  printed line (`skillRecords`, what the records refresh would write), keeping the row's own trigger and combo. For every filled row
  the compiler's own current program equals the stored one up to key order, so nothing else changed.
- My first pass forgot the hoisted IF (`saveRule` writes `cond: null` unless given). I saw it in the reads, and restored the compiler's
  IF on all ten rows that have one within the same session (BT4-040, EX02-06, EX03-25 x2, BT4-116, EX02-07, P-068, BT9-134, BT27-094,
  BT21-038), so those rows have two version bumps. For a few minutes those ten rows were stored without their IF; no match was running.

| Row | Before (reads) | After (reads, same IF kept) |
|---|---|---|
| BT3-119 front 10 | 2 from the top of the deck to the Drop | may 1, then if taken may 1 (N=2) |
| BT3-107 back 10 (Activate Main) | 2 from the top of the deck to the Drop | N=2 chain |
| BT3-108 back 0 (Activate Main) | 2 from the top ... | N=2 chain |
| P-082 front 20 | 3 from the top ... | N=3 chain |
| BT4-092 front 10 | 2 from the top, choose up to 1 energy active, draw 1 | N=2 chain, then the same energy and draw |
| BT4-093 front 0 | 2 from the top, up to 2 energy active, draw 1 | N=2 chain, same rest |
| BT4-040 front 0 | if Leader blue: 3 from the top | same IF, N=3 chain |
| EX02-06 front 10 | if Leader green/yellow: 2 from the top | same IF, N=2 chain |
| EX02-07 front 0 | if Leader red/blue: 2 from the top | same IF, N=2 chain |
| BT4-116 front 10 | if Leader <Demigra>: 2 from the top | same IF, N=2 chain |
| EX03-25 front 20 and back 10 | if attacking a Leader: 2 from the top, draw 1 | same IF, N=2 chain, draw 1 |
| BT2-100 back 10 | 3 from the top, up to 1 Meta-Cooler from Drop to hand | N=3 chain, same pick |
| BT16-001 back 10 | draw 1, 3 from the top | draw 1, N=3 chain |
| BT4-038 front 0 | "choose up to 3 cards in your deck" to Drop (a free pick from the whole deck) | N=3 chain (top of deck, one at a time) |
| DB3-111 front 0 | mode 2: 2 from the top, +5000 | mode 2: N=2 chain, +5000 (other modes untouched) |
| EX03-21 front 0 | if Leader Frieza Clan: 3 from the top, then the draw / tokens | same, N=3 chain inside |
| P-068 front 0 | after the life-card choice: 3 from the top, opponent discards 1 | N=3 chain inside "if you did", discard kept |
| BT9-134 front 10 | if all energy black: Warp their card, 4 from the top | same, N=4 chain |
| BT27-094 front 0 | if Leader black: "choose up to 2 in your deck" to Drop | same IF, N=2 chain |
| BT21-038 front 20 | priced IF: "choose up to 2 in the deck" to Drop, then the combo use | same IF, N=2 chain, combo use kept |

Totals: **21 rows (20 cards) changed**; BT3-120 was done in batch 1. Row flags the Claude audit left on BT3-119 are kept for the owner.

Listed and not changed:

| Row | Why |
|---|---|
| BT4-056 front 0, BT4-006 front 0, BT4-074 front 0 (up to 3, attack or combo) | the stored record has no typed combo qualification and an old trigger list (`attacks, comboed, comboUsed` against the compiler's `attacks, comboUsed`); `saveRule` refuses it. Needs the compiler refresh first; changing the trigger is not part of this ruling |
| BT2-101 front 0 and back 0 | open rows with unread clauses ("if there was a Frieza Clan among them") that depend on all N cards being milled |
| BT19-140 front 20, BT16-125 front 0 | open rows with unread clauses |
| BT2-001 front 10 | "up to 1", and the following clause reads the milled card; not an N-card chain |
| EX08-04 front 30, BT18-041 front 20 | same "up to 2 from the top" but the zone is the energy area (wording differs materially) |
| "Send up to N cards from the top of your deck to your Warp" (BT12-122 front 20 and back 10, BT16-099, BT16-103, BT16-104, BT18-132, BT18-130, BT29-086/-088/-089/-091/-093, TB2-015) | the same defect (stored as "choose up to N in the deck"), but the ruling was about the Drop wording. Owner to say whether it extends to the Warp |
| BT2-013, BT30-101 (owner-corrected) | not this wording (exact 10 / look at 2); untouched |

## 3. The owner's possibly stale "Wrong (phone review)" flags

All six rows now play right; each was confirmed through `confirmRule` (confirmed_by `claude-review`, which also clears `review_flag`) with the note
"answers the owner's 4 Oct flag: ...".

| Row | Owner flag (4 Oct) | Why it is resolved | Result |
|---|---|---|---|
| SD5-01 front 0 | draws on every attack; should only be vs a Leader | trigger attacks + IF the opponent's Leader is the one attacked, then draw; `u1a-triggers-757.ts` and `u1c-effects-757.ts` run this exact text (both pass) | flag cleared, confirmed |
| BT3-109 front 20 | "exactly 5, not up to 5; board wiped after moving even 1" | optional exact choice of 5, the opposing board goes to the Warp only if all 5 were placed; `optional-exact-538.ts` (pass) | cleared, confirmed |
| BT6-009 front 0 | red applies to Son Goku: Br only | filter `anyOf[<Veku: Br>, red <Son Goku: Br>]`; `readings.ts` pins "red is Son Goku's alone" (pass) | cleared, confirmed |
| BT3-043 front 10 | (the flag on the row is the 18 Oct audit's, not 4 Oct) the 'Then' parts were nested under the opening condition | the stored ops have the IF around the +10000 only; the return and the draw are top-level. This is the official Q&A answer ("can you resolve the Then parts even if the Leader isn't blue or life isn't 4 or less? Yes"), pinned by `grouped-readings-573.ts` (owner 18 Oct: the official FAQ is final); Try it at life 5 still returns and draws | cleared, confirmed |
| BT3-010 front 20 | only offers the Leader | two modes, red Leader or red Battle Card; `readings.ts` "BT3-010: red either way" | cleared, confirmed |
| BT2-001 back 10 | needs 10 of both names in total, not of one | one total count over `son goku` or `vegeta`; `grouped-readings-573.ts` runs the engine at 9 and 10 (pass); Q&A: the draw is mandatory | cleared, confirmed |

**6 flags cleared, 0 kept.**

## 4. The next 30 deck cards

Selection: owner decks (SL owner `patvolny` plus ownerless, `dbs`, not testing: 25 decks, 314 cards), cards whose health is `unchecked` (177 left after batch 1),
ordered by deck count then id, skipping the 30 cards of the first receipt (and BT3-120, BT6-010's skill 0 and the six stale-flag rows above, which were already done):
SD5-01, BT5-088, BT5-108, BT5-114, BT6-010, BT6-011, BT6-026, BT6-078, EX03-17, SD3-01, SD7-02, SD8-04, SD8-08, BT1-014, BT1-027, BT1-055, BT1-057, BT1-064, BT1-070,
BT1-071, BT1-074, BT1-076, BT1-078, BT1-079, BT1-080, BT1-089, BT10-008, BT10-072, BT10-073, BT10-083. Keyword-line rows (Super Combo, Deflect, Double Strike, Barrier, Blocker, Evolve;
10 rows on these cards) are health `done` and were left alone, as in batch 1. Basis order as in batch 1: official Q&A, errata (none for these cards), Rule Manual / glossary,
the repo's engine proofs, Try it boards, plus throwaway engine proofs where the probe cannot reach the moment (below).

Engine proofs run for this batch (throwaway, not committed): each card's real printed line compiled, the compiled program asserted identical to the stored row, then played on the rules engine.

| Card / skill | Verdict | Basis (see each row's confirm note) |
|---|---|---|
| SD5-01 back 0, back 10, front 10 | plays right (3 rows) | engine proofs: leader attack draws; permanent power/Critical by life; Awaken in glossary + Q&A |
| BT5-088 f10, BT5-114 f10, SD8-04 f10 | plays right | combo autos with Leader colour + life/Sparking; Try it at life 4/5; typed-validity-907 |
| BT5-108 f10, f20 | plays right | f20 engine proof: offered only with 4+ opposing Battle Cards, KOs both boards incl. itself (as printed) |
| BT6-010 f10, BT6-011 f0, EX03-17 f20, SD7-02 f20, BT10-072 f10 | plays right | Try it; Q&A (0 power to Drop); u1a/u1b/u1c-757 on BT6-011 |
| BT6-026 f0, BT6-078 f0 | plays right | counter-action-price-716, u1c-757 (BT6-026); same shape for BT6-078 |
| SD3-01 back 10, front 10 | plays right | engine proof (draw on leader attack); Awaken. Probe errors on this card (owner-corrected skill 0 rows carry an old payment record; not touched) |
| BT1-014, BT1-027, BT1-055, BT1-070 f20, BT1-080, BT1-089, BT1-076, BT1-079, BT10-083 | plays right | Q&A quoted in each note; u1a/u1b/u1c-757; Try it; battles.ts for Revenge |
| BT1-057 back 0, back 10, front 0, front 10, front 20 | plays right (5 rows) | attack-restrictions-1005 / attack-target-937; engine proof for both attack autos (each side's hand/Battle/Drop counts) |
| BT1-064 f20 | plays right | Try it KOs; Q&A: skill plays pay no energy |
| BT1-071 f0 | plays right | engine proof: Leader attack makes the opponent discard, Battle Card attack does not |
| BT1-074 f20 | plays right | evolvedInto (same trigger as BT3-109); readings.ts / wordings.ts; probe cannot evolve |
| BT1-078 f0 | plays right | engine proof: with a <Broly> Leader the offer is made and the card is played back; with another Leader nothing |
| BT10-008 f0, f10 | plays right | u1c-effects-757 asserts the -15000 and that Yamcha is played; counter-action-price-716 |
| BT10-073 f0, f10 | plays right | removedByOpponent in readings.ts; f10 engine proof (only the cost-4 Frieza, from hand or Drop, Active) |
| **SD8-08 f10** | **flagged: unsure** | Permanent cost -3 "if your opponent has 4 or more cards in Rest Mode" is read as cards in play (Leader/Battle/Unison); no source says whether rested Energy Area cards count. Needs a ruling |
| **BT1-064 f10** | **flagged: wrong in the engine; Claude draft fix saved** | see below |

**Totals: 41 rows on 30 cards: 39 confirmed, 2 flagged, 0 skipped.**

### Finding: BT1-064 [Counter: Attack] "Play this card from your hand"

The stored program chose the card from the Hand and played it. A card that activated a [Counter] has already left the hand (Rule 22-10-7), so on the engine the card
was paid for (energy 4 to 1) and then sent to the Drop without being played (`counter.mts` throwaway: the card ends in the Drop). With "negate the attack, then play this card" (no area) it
enters the Battle Area, as BT10-008's does. Saved as a Claude draft (v4): the self-choice no longer names an area; engine proof after the change: the card enters the Battle Area after
paying its cost, the attack is not negated (not printed). The row carries the flag for the owner to approve. Other counters with the same self-from-hand shape, not touched:
BT23-055 front 10, BT1-091 front 20 (and the generic check found BT14-082, TB3-033, DB1-014, BT3-122 with hand selections that are not the card itself, so unaffected).

## 5. Fuzz

`npm run arena:fuzz -- 20` (run twice, same result): **20 games: 19 completed, 0 interrupted, 0 action limits, 1 crash.** The crash is the same one as in batch 1:
"missing or malformed typed combo qualification; regenerate rules and rebuild the match (#907)", Yellow Jiren Rest-Lock Beatdown vs Universe 6 Cabba, at a combo of Frost, the Path to
Full Power: an out-of-date typed combo record on a card these writes did not touch.

## Not done / caveats

- Where Try it says "did not fire" or "changes nothing" the probe could not reach the moment (leader-colour conditions, Leader attacks, evolve, removal by a skill); those rows rest on
  the printed text, the cited repo proofs and the throwaway engine proofs above, and each note says which.
- The throwaway engine proofs are not committed (scratch only); they can be rewritten from the notes. Nothing else in the repo changed.
- The rest of the 177 unchecked deck cards are not reviewed; the first batch's flagged BT31-110 front 10 and skipped BT7-023 (Claude-authored) are as left there.
- Records still stale (not touched): the BT4-056/-006/-074 combo records, SD3-01's corrected skill 0 payment records, and the Frost combo record behind the fuzz crash. A run of
  `npm run arena:protected-records` (owner-approved rows) and the compiler refresh (drafts) would clear them.
