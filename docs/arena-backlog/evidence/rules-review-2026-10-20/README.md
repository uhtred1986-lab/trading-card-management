# Rules review, 20 Oct 2026: first batch of the owner's deck cards

Authorization: owner, 18 Oct 2026 ("full permission to write into the db in production") and 20 Oct 2026
(have Claude validate the rules and confirm how the cards work, and attempt to fix one). Writes went only through
the repo's guarded paths: `confirmRule` / `flagRule` in `src/lib/rules-review/deck-review.ts` (the connector's
confirm and flag logic, `confirmBlocker` respected) and `saveRule` in `src/lib/arena/rules-store.ts`.
No ad hoc SQL, no owner-confirmed or owner-corrected row touched, no P-616, no errata edit.

## Scope

Owner `patvolny`, non-testing `dbs` decks (22 decks, 307 cards). 203 cards were `unchecked`; the 30 used by the
most decks were reviewed (ordered by deck count, ties by id). Of their skill rows, the keyword-line rows
(Swap, Barrier, Over Realm, Double Strike, Super Combo, ...) are health `done` already and were not touched.

Basis used for every row, in the order asked:

1. Official card Q&A (`card_faq.php`, the data in `src/lib/rules-review/faq.generated.json`): quoted per card below when one exists.
2. Official errata (`https://www.dbs-cardgame.com/us-en/rule/errata-cards.php`, fetched 20 Oct 2026): none of the 30 cards, nor BT6-010, is listed.
   `errata.ts` holds only a typo fix for BT3-104.
3. Rule Manual / glossary (`src/lib/arena/glossary.ts`), same-release cards, and the repo's engine proofs on the real card text
   (`scripts/verify/u1a|u1b|u1c-*-757.ts`, `counter-action-price-716.ts`, `arena-real-card-tactics.mts`, `typed-combo-907.ts`).
4. Try it boards (`tryRule(probeRuleOf(...))`, as `probe-actions.ts` does).

Confirmed rows carry `confirmed_by = claude-review` and a one-line note citing the basis (visible as the row's confirm note).

## Totals

33 confirmed, 1 flagged, 1 skipped (Claude-authored row, cannot be confirmed here), plus BT6-010 skill 0 (Task B check below, confirmed, owner flag cleared) and one Claude correction saved as a draft (BT3-120).

## Per card (30 cards)

"Boards" = Try it outcome. Several boards say "nothing"/"not offered" because the probe cannot reach the moment; those are called out.

| Card | Skill | Verdict | Basis | Boards | Action |
|---|---|---|---|---|---|
| BT4-081 Dynasty Deferred Son Goku | 20 auto end of turn: switch to Active | Plays right | Official Q&A: the auto still activates at end of turn after Cold Bloodlust negation | fires (turnEnd) | confirmed |
| BT4-089 Dynasty's Solace Chi-Chi | 0 look 3, take up to 1 Goku's Lineage, shuffle | Plays right | Official Q&A (search, reveal on add to hand) | fires | confirmed |
| BT5-023 Afterimage Technique | 10 Permanent alt Counter price (life) | Plays right | Glossary altCost; `counter-action-price-716.ts` covers BT5-023 | in force (probe text "not valid in hand" is cosmetic for an alt-cost Permanent) | confirmed. Skill 0 is owner-corrected: untouched |
| BT5-115 Power Burst | 0 Counter: negate, black cost-1 card Drop/Warp to hand | Plays right | Text; Q&A (auto of a negated attacker still resolves) | fires | confirmed |
| BT5-115 Power Burst | 10 Permanent alt Counter price | Plays right | Same shape as BT5-023 | in force | confirmed |
| SD5-02 Power Charge Bardock | 0 may draw, else Double Strike | Plays right | Text; `u1a/u1b/u1c-757` | draws 1 | confirmed |
| SD5-03 SSB Son Goku, at the Apex | 30 on play, Goku's Lineage leader: KO | Plays right | Text; `u1a-triggers-757.ts` | KOs | confirmed |
| SD5-04 Reborn Might SS4 Son Goku | 10 Activate: Main, life price, Triple Strike at life <= 2 | Plays right | `u1a-triggers-757.ts`, `u1b-prices-757.ts` and `arena-real-card-tactics.mts` run this exact card (price first, condition read after) | **probe says "Cannot pay" on every board incl. life 2/3: a probe artefact** (same for BT6-053), the engine proofs pass | confirmed |
| SD5-05 Ultimate Potential SS2 Son Gohan | 10 on play KO Rest Mode Battle Card | Plays right | Text; `u1a` | fires | confirmed |
| BT3-113 Supreme Kai of Time | 10 combo: 5+ Warp, draw, +10000 combo power | Plays right | Text (Q&A is deck-limit only) | held / not held boards correct | confirmed |
| BT4-085 Prodigal Dynasty Son Goten | 10 combo: yellow Battle Card attacked, +10000 | Plays right | Text | Leader attacked = nothing (correct) | confirmed |
| BT4-086 Plucky Dynasty Pan | 20 combo: yellow Goku's Lineage leader, life <= 4 | Plays right | Text | life 4 fires, 5 nothing | confirmed |
| BT4-096 10x Kamehameha | 0 Activate: Battle +15000 and Double Strike | Plays right | Text; `u1c-conditions-757.ts` | IF false on the probe's leader (no edge board) | confirmed |
| BT6-025 Transcendent Strike | 0 Activate: Main KO power <= 20000 | Plays right | Text; `u1b/u1c-757` | fires / not offered correctly | confirmed |
| BT7-023 Denial of Hope | 0 Counter: Play | **Not reviewed for confirmation** | Source is `claude` (a Claude draft with the owner's explanation); `confirmBlocker` refuses non-compiler rows | fires | skipped |
| BT1-082 Family Kamehameha | 0 KO cost <= 2 | Plays right | Text | fires | confirmed |
| BT1-109 Frieza's Call | 0 deck search cost <= 2, play in Rest, shuffle | Plays right | Official Q&A: cards played by skills do not pay energy | fires | confirmed |
| BT2-072 Bundle of Curiosity Son Goku | 0 on play draw 1 | Plays right | Official Q&A: the draw is mandatory (program has no `may`) | draws 1 | confirmed |
| BT28-102 Stop Laughing! | 0 Counter, 10 Permanent Heroic, 20 Permanent alt price | Plays right | Text; altCost glossary | fires / in force | confirmed (3 rows) |
| BT3-027 Unending Awakening | 0 Counter: negate, red Saiyan Leader +5000 | Plays right | Text; `u1b/u1c-757` | fires | confirmed |
| BT3-097 Unwavering Solidarity Tora | 0 Permanent free play with 2+ opposing Rest Mode Battle Cards | Plays right | Official Q&A: "Battle Card" means the Battle Area, not Energy Area | in force | confirmed |
| BT3-102 Nappa | 0 attack: opp Rest Mode card, +10000 | Plays right | Text | nothing when none rest (correct) | confirmed |
| BT3-104 Flying Nimbus | 0 Counter: negate, may discard yellow, opp one more attack | Plays right | Official Q&A: a second Nimbus gives no extra attack; glossary `uses: 1` "one more time"; errata.ts is a typo fix only | fires | confirmed |
| BT3-110 Awakened Warrior Bardock | 10 auto when played using Over Realm | Plays right | Text; `playedUsingOverRealm` is a supported moment | **probe cannot reach an Over Realm play (not offered)**, so no firing board | confirmed |
| BT3-111 Trunks, Power Overseeing Time | 20 auto Over Realm: Warp card to hand | Plays right | Official Q&A: a card sent to Warp by this Over Realm can be added | same limitation | confirmed |
| BT3-121 Dark Plot | 0 play cost <= 4 from Warp, Over Realm: 3 energy active | Plays right | Official Q&A: no energy paid for skill plays | fires | confirmed |
| BT3-122 Time's Judgement | 0 Counter: negate, may drop 2 to take this back | Plays right | Q&A (negated attacker's autos) | fires | confirmed |
| BT31-070 Vegeta, the Targeted Prince | 10 KO Rest Mode; 20 Active +5000 (both once per turn) | Plays right | Text | fires | confirmed (2 rows) |
| BT31-110 United Across Time | 0 Counter, Limit 1, under Leader, +5000 | Plays right | Text | +5000 | confirmed |
| BT31-110 United Across Time | 10 auto at Main Phase start from under the Leader | **Unsure** | Reads right on paper, but no board puts the card under the Leader, so firing from that zone is unverified | trigger never came | **flagged** (`review_flag`) |
| BT4-010 Digging Deep Vegeta | 0 once per turn, up to 2 life to hand, then Active +5000 | Plays right | Text | moves life cards | confirmed |
| BT5-063 Physical Mastery Uub | 0 [Burst 3] then KO power <= 15000 | Plays right | Text | fires | confirmed |

## Task B: BT6-010 Support Attack Trunks (owner flag "wrong timing", 4 Oct)

Before: skill 0 was `draft`/`compiler`, flagged "only at the end of a battle in which you comboed with this card from your hand
during your opponent's turn; the draft reads any end of battle".
Now: the stored rule carries the v6 combo qualification `{turn: opponent, timing: battleEnd, origins: [hand], subject: self}`
plus `IF leaderMatches(red)`, then `play(self, rest)`. `scripts/verify/typed-combo-907.ts` (36 seat/scenario cases, run 20 Oct,
passes) covers this card, including the official Q&A Jaco bounce case (returned to hand: not played) and opponent-turn only.
Verdict: **plays right now; the flag was stale.** Cleared by confirming through the connector path (`confirmRule`, which also clears the flag),
confirmed_by `claude-review`. (The card page's `approveFlaggedAction` would record the owner's own approval; the connector path keeps the attribution honest.)
Skill 10 (the -5000 on play) is a compiler draft left for a later batch.

Finding: most of the owner's 4 Oct "Wrong" flags checked were already fixed by later compiler/engine work and now only
need an approve-and-clear (SD5-01 front, BT3-109 [20] via `optional-exact-538.ts`, BT6-009 anyOf filter, BT3-043 per its Q&A, BT3-010, BT2-001 back [10]).

## Task B fix: BT3-120 Haru Haru, Attacker Majin, front skill 10

Flag (Claude deck audit #1050, 18 Oct): printed "place **up to 2** cards from the top of your deck in the Drop Area", program milled exactly 2.

- Basis: card text; "up to N" is any number 0..N (Rule Manual 20-16 and the engine's own `choose upTo`); no official Q&A and no errata for BT3-120.
  The language's `mill` has no up-to form, so the rule is two chained optional single mills.
- Before (`compiler`, `draft`, v2): `THEN mill(n: 2, as: "m0")`, reads "2 from the top of the deck to the Drop".
- After (`claude`, `draft`, v3, explanation citing the basis; not an owner approval):
  `may(mill 1)`, then `if did(may): may(mill 1)`; reads "you may: 1 from the top of the deck to the Drop, if the offer was taken: you may: 1 from the top of the deck to the Drop".
- `readRule` and `validateRule`: ok. Try it boards: both fire (play), interrupted at the decision prompt, as a decision should.
- Engine run (real `RULES.apply` flow on the card's real printed text with the new ops injected; throwaway script, not committed):
  accept+accept = Drop +2, accept+decline = +1, decline first = 0, prompts `chooseMode` then `main`.
- The identical wording on BT3-119 Shun Shun (same flag) and five other cards was left for after the owner accepts this shape.
- The audit flag on the row is kept for the owner to clear on approval.

## Fuzz

`npm run arena:fuzz -- 20`: 20 games: 19 completed, 0 interrupted, 0 action limits, 1 crash. The crash is "missing or malformed typed combo
qualification; regenerate rules and rebuild the match (#907)" in Yellow Jiren vs Universe 6 Cabba, at a combo of Frost: an out-of-date typed
combo record (the known `needsRebuild` state), not touched by these writes (only status/confirm fields and one BT3-120 program changed).

## Not done / caveats

- Where a board is "nothing" the probe often could not reach the moment (Over Realm plays, under-Leader autos, `leaderMatches` has no edge board);
  those confirmations rest on the printed text, the supported trigger and the cited engine proofs, and say so in their notes.
- The remaining 173 unchecked deck cards are not reviewed.
