# Rules review, 2026-10-25, batch 7: next 30 deck cards

Authorization: owner, in the coordinating chat, 25 Oct 2026: "you are allowed to use the neon tool and run scripts against the db, its only a selfimpossed issue",
and, asked "What should agents work on next?", the owner chose the option "Rules-review batch — The next batch of 30 deck cards against the live rules, using the repo's `rules-review-batch` routine."
Writes went only through the repo's guarded paths: `confirmRule` / `flagRule` (`src/lib/rules-review/deck-review.ts`, attribution `claude-review`); **no `saveRule`** (neither finding has an owner ruling on the fix).
No ad hoc SQL, no `db:*` script, no migration, no `arena:rule`, no owner-confirmed or owner-corrected row touched, no P-616, no errata edit, no paid call. The database was proven to be this app's first (`to_regclass('public.card_rules')` = `card_rules`).
All 55 rows of the 29 cards were snapshotted before (`npm run rules:snapshot -- save`), re-read just before the writes (`diff`: "No differences"), and re-read after:
`diff --expect status,confirmedAt,confirmedBy,confirmNote,reviewFlag` said **"ok: only status, confirmedAt, confirmedBy, confirmNote, reviewFlag (and updatedAt) differ"**; 38 rows changed, the other 17 are byte-identical.
Engine proofs ran on `e157e497` (main with #1149–#1165 merged).
Owner rulings recorded today (#1123, #930, #1157 comments) touch none of these 29 cards; the 20 Oct ruling on "cards in Rest Mode" (#1122, SD8-08) is the basis for SD8-07 f0.

## Selection

Owner `patvolny` plus ownerless decks, game `dbs`, not testing (25 decks); cards whose health (`ruleHealth`, `src/lib/arena/rules-store.ts`) is `unchecked`: 29, ordered by deck count then id. The first 29 of the remaining 29:
BT7-023, SD3-01, BT1-057, BT7-089, BT7-090, BT9-031, DB2-004, DB3-001, EX03-05, EX03-24, P-003, SD15-02, SD15-03, SD15-04, SD15-05, SD3-02, SD7-04, SD7-05, SD8-01, SD8-02, SD8-05, SD8-06, SD8-07, SD8-10, TB1-023, TB1-055, XD1-05, XD1-06, XD1-07.
Only 29 unchecked owner-deck cards exist, so this batch is all of them (fewer than 30). A plain `rules:batch --next 30` selected 0: every one is named in `deck-audit/deck-audit.md` (the 18 Oct audit lists every deck card) and SD3-01/BT1-057 in `937/validation.md` and batch 2;
none was reviewed in batches 1 to 6 except SD3-01 f10 and BT1-057 f20, which batch 2 confirmed and the #1142 refresh ([Awaken] "you may draw N" is mandatory, the batch-6 question) put back to `draft` on 20 Oct. So the batch was selected with `--include-listed`.
Rows on these cards: 55; to review 39 (1 cannot be confirmed here, see the table); keyword lines left alone 4; already confirmed or corrected, left alone 12. XD1-05 f0 is a row the coordinator refreshed today (Bond, v8, 10:07 UTC); it was judged as any other compiler draft.

Basis order: official Q&A (`src/lib/rules-review/faq.generated.json`: entries exist for BT1-057, SD3-01, EX03-24, P-003, SD3-02, SD8-01, SD8-07, TB1-055, XD1-05; the live `card_faq.php` was not fetched, the owner did not ask);
official errata (the live `errata-cards.php`, fetched 25 Oct, 356 KB: none of the 29 cards is on it; `src/lib/catalog/errata.ts` has none of them and was not edited); Rule Manual / glossary (13-2-1-3, 13-4-2 marker skills once per turn, 9-6-4 Auto prices, [Awaken], [Bond], [Burst], [Sparking]) and the owner ruling #1122;
Try it boards (`tryRule(ruleFrom(row, def, programOf(row)))` on all 38 rows, see the probe notes); throwaway engine proofs on the **stored rows** (`rulesFromRows` over the snapshot, real catalog definitions of the 29 cards, synthetic fodder and Leaders for traits and colours, every prompt answered in the orders that matter).

## Totals

**39 rows on 29 cards: 36 confirmed, 2 flagged, 1 skipped.** No draft fix saved (`saveRule` is only for a fix the owner ruled on). The skipped row is BT7-023 f0, the Claude-authored row `confirmBlocker` refuses.

## Per row (39 rows)

| Card | Skill | Printed (short) | Verdict | Basis |
|---|---|---|---|---|
| BT7-023 Denial of Hope | f0 | [Counter: Play] If your Leader Card is red: If the Battle Card your opponent is playing has 20000 po | skipped | Claude-authored row (source `claude`, v4): `confirmBlocker` refuses it here; still the owner's to review (as in batches 1 to 6). Not touched. |
| SD3-01 The Masked Saiyan | f10 | [Awaken] When your life is at 4 or less: You may draw 2 cards and flip this card over. | confirmed | Plays right after #1142: [Awaken] at life <= 4 draws 2 with no decline (official Q&A on BT2-001 and others: the draw cannot be declined) and flips; not offered at life 5. Engine proof 25 Oct on the stored row. |
| BT1-057 Broly | f20 | [Awaken] When your life is at 4 or less: You may draw 2 cards and flip this card over. | confirmed | Plays right after #1142: [Awaken] at life <= 4 draws 2 with no decline (official Q&A on BT2-001 and others) and flips; not offered at life 5. Engine proof 25 Oct on the stored row. |
| BT7-089 Magetta, Defender of Universe 6 | f10 | [Auto] When you combo with this card, if your Leader Card is a ≪Universe 6≫ card and your life is at | confirmed | Plays right: combo (from hand or Battle Area) with a Universe 6 Leader at life <= 5 draws 1 and +10000 combo power; nothing at life 6 or with a non-Universe 6 Leader. Engine proof 25 Oct. |
| BT7-090 Namekian Partner Saonel | f0 | [Auto] When you play this card, choose up to 1 {Namekian Partner Pirina} from your deck, add it to y | confirmed | Plays right: on play searches the deck for {Namekian Partner Pirina} only (a card of another name not offered), adds it to the hand, shuffles. Engine proof 25 Oct. |
| BT9-031 Android 18, Steadfast Technique | f0 | [Auto] Choose 1 Extra Card in your hand and place it in your Drop Area: When you combo with this car | confirmed | Plays right: on combo the Auto asks for its price (discard 1 Extra Card from the hand, declinable, 9-6-4); paid gives +6000 combo power, declined or no Extra in hand gives nothing. Engine proof 25 Oct. |
| DB2-004 Piccolo, Namekian Fortification | f0 | [Auto] Choose 1 card in your life and add it to your hand: When this card attacks, switch this card  | confirmed | Plays right: on attack asks for its price (1 life card to the hand, declinable); paid: switches to Active, +10000 power, can't attack for the turn; declined: nothing. Engine proof 25 Oct. |
| DB3-001 Master Roshi, Potential Unleashed | f0 | [Auto] If your Leader Card is red and your opponent's life is at 5 or more: When this card is played | confirmed | Plays right: played Unison with a red Leader deals 1 damage at opponent life 5 or 8; nothing at life 4 or with a blue Leader. Engine proof 25 Oct. |
| DB3-001 Master Roshi, Potential Unleashed | f10 | [+1][Activate: Main] This card gets +5000 power for the turn. | confirmed | Plays right: [+1] adds a marker and +5000 power for the turn; a second marker skill that turn is refused (Rule Manual 13-4-2). Engine proof 25 Oct. |
| DB3-001 Master Roshi, Potential Unleashed | f20 | [-4][Activate: Main] This card gets +15000 power and [Double Strike] for the turn. | confirmed | Plays right: [-4] not offered with 3 markers; with 5: markers to 1, +15000 power and [Double Strike] for the turn; then no marker skill for the turn (13-4-2). Engine proof 25 Oct. |
| EX03-05 Rampant Evil Majin Buu | f10 | [Auto] When you play this card, if your Leader Card is a ≪Majin≫, draw 1 card, choose up to 1 of you | confirmed | Plays right: on play with a Majin Leader draws 1, switches a chosen energy to Active and gains [Triple Strike] for the turn; with a non-Majin Leader nothing. Engine proof 25 Oct. |
| EX03-24 Clownish Destruction Belmod | f20 | [Auto] When you play this card, look at up to 3 cards from the top of your deck. Choose up to 1 card | confirmed | Plays right, matches the card's official Q&A: look 3, add up to 1, rest to the Drop; if none added (or 0 cards looked at) KO up to 1 opposing Rest Mode Battle Card (Active not offered). Engine proof 25 Oct. |
| P-003 Super Saiyan 3 Son Goku | f10 | [Auto] At the end of your turn, return this card to your hand. | confirmed | Plays right, matches official Q&A (the return cannot be declined): returns to the hand at the end of its owner's turn, stays at the end of the opponent's turn. Engine proof 25 Oct. |
| SD15-02 SS Cabba, Spirit Resonance | f0 | [Auto][Limit 1] (You can only activate this skill once per turn across all copies of this card.) Whe | confirmed | Plays right: placed in the Drop from the Unison Area (replaced by another Unison, 13-2-1-3) gives a chosen mono-red Leader +5000; a red/blue Leader is not offered; [Limit 1] holds across copies. Engine proof 25 Oct. |
| SD15-02 SS Cabba, Spirit Resonance | f10 | [+1][Activate: Main] Choose up to 1 of your opponent's Battle Cards or Unison Cards and it gets -100 | confirmed | Plays right: [+1] gives -10000 power for the turn to a chosen opposing Battle Card or Unison Card (both offered). Engine proof 25 Oct. |
| SD15-02 SS Cabba, Spirit Resonance | f20 | [-6][Auto] If your opponent's life is at 3 or more: When your mono-red ≪Saiyan≫ Leader Card is attac | **flagged** | Printed 'When your mono-red Saiyan Leader Card is attacked' but the trigger keeps no Leader description: engine proof 25 Oct fires (pays -6, 1 damage) with a red Namekian and a red/blue Saiyan Leader. The rest plays right. Compiler gap. |
| SD15-03 Son Goku, Spirit Boost Warrior | f10 | [Permanent] If this card is in Rest Mode and you have a red Unison Card with a specified cost of 2 i | confirmed | Plays right: in Rest Mode with a red Unison of specified cost 2 in play: self +1000 and red Leader +1000; nothing when Active, with no Unison, a cost-3 red or a blue Unison; a blue Leader gets nothing. Engine proof 25 Oct. |
| SD15-04 Surprise Attack Son Gohan | f0 | [activate: battle]{r}, if you have 2 or more mono-red Battle Cards in your Combo Area: Play this car | confirmed | Plays right: Activate:Battle from the hand paying {r} is offered only with 2 mono-red Battle Cards in your Combo Area (1, or 1 red + 1 red/blue, not offered); plays the card and gives -10000 to a chosen opposing Battle Card. Engine proof 25 Oct. |
| SD15-05 Surprise Attack SSB Vegeta | f10 | [Auto] If your opponent has 2 or more energy: When you remove a marker from one of your red Unison C | **flagged** | Printed 'remove a marker from one of your red Unison Cards using a [Spirit Boost] skill' but the trigger keeps no colour: engine proof 25 Oct offers the play after a Spirit Boost paid from a blue Unison. Opp energy gate and the may are right. Compiler gap. |
| SD3-02 Killer Sword Trunks | f20 | [auto] When a card evolves into this card, choose up to 1 Battle Card in your Warp with energy cost  | confirmed | Plays right: after [Xeno-Evolve], plays a chosen Battle Card of energy cost 3 or less from the Warp (cost 4 and an Extra not offered); a plain play does not trigger it. Engine proof 25 Oct. |
| SD7-04 Shenron, Figure of Majesty | f0 | [Permanent] This card can't attack. | confirmed | Plays right: no attack is offered for it (a plain card beside it can attack). Engine proof 25 Oct. |
| SD7-05 Mega Focus Son Goku | f0 | [Activate: Main][Once per turn][Burst 3] (You must place the top 3 cards of your deck in your Drop A | confirmed | Plays right: once per turn, [Burst 3] mills 3 (not offered with 2 in the deck), +5000 and can attack Active Mode Battle Cards for the turn. Engine proof 25 Oct. |
| SD8-01 Broly | b0 | [Permanent] If there are 2 or more Battle Cards in play in your Battle Area, you can't play Battle C | confirmed | Plays right, matches the card's official Q&A: awakened with 2+ Battle Cards in your Battle Area you can't play Battle Cards (Extras still playable); the opponent is not affected; front side not in force. Engine proof 25 Oct. |
| SD8-01 Broly | b10 | [Auto][Sparking 7] (This skill takes effect when you have 7 or more cards in your Drop Area.) When t | confirmed | Plays right: [Sparking 7], when it attacks draws until 6 in hand (3 -> 6 at 7 Drop cards; nothing at 6 Drop cards or with 7 in hand). Engine proof 25 Oct. |
| SD8-01 Broly | f0 | [Activate: Main] Choose up to 1 green ≪Frieza's Army≫ card with an energy cost of 1 from your deck a | confirmed | Plays right: adds a green Frieza's Army card of energy cost 1 from the deck (cost 2, blue and non-Frieza's Army not offered), shuffles, then the skill is negated for the game (not offered again that turn or the next). Engine proof 25 Oct. |
| SD8-01 Broly | f10 | [Awaken] When your life is at 4 or less: You may draw 1 card, then choose up to 1 of your energy, sw | confirmed | Plays right after #1142: [Awaken] at life <= 4 draws 1 with no decline (official Q&A on [Awaken] draws), switches up to 1 energy to Active and flips; not offered at life 5. Engine proof 25 Oct. |
| SD8-02 Broly, the Ravager | f10 | [Activate: Battle][Once per turn][Burst 3] (You must place the top 3 cards of your deck in your Drop | confirmed | Plays right: Activate:Battle once per turn (not in the Main Phase), [Burst 3] mills 3, the opponent chooses and discards 1. Engine proof 25 Oct. |
| SD8-05 Cheelai, Frieza Force Soldier | f0 | [auto] When you play this card, draw 1 card. | confirmed | Plays right: on play draws 1. Engine proof 25 Oct. |
| SD8-05 Cheelai, Frieza Force Soldier | f10 | [activate: main] {g}{1}: Choose up to 1 green ≪Frieza's Army≫ card with an energy cost of 2 or less  | confirmed | Plays right: {g}{1} paid, plays a green Frieza's Army card of energy cost 2 or less from the deck (cost 3, red and non-Frieza's Army not offered), shuffles. Engine proof 25 Oct. |
| SD8-06 Lemo, Frieza Force Soldier | f0 | [activate: main][once per turn] {g}, choose 1 card from your hand and place it in your Drop Area: Ch | confirmed | Plays right: once per turn, {g} and 1 hand card to the Drop (not offered with an empty hand); plays a <Cheelai: Br> of energy cost 2 or less from the deck (cost 3 and plain <Cheelai> not offered). Engine proof 25 Oct. |
| SD8-07 Son Goku, Time to Fight | f0 | [Permanent] If your opponent has 4 or more cards in Rest Mode, reduce the energy cost of this card i | confirmed | Plays right per the owner ruling of 20 Oct (#1122, SD8-08 same text): 4+ opposing Rest Mode cards, energy included, reduce the cost 4 -> 1; 3 do not; the specified cost stays (official Q&A). Engine proof 25 Oct. |
| SD8-07 Son Goku, Time to Fight | f10 | [Auto] When you play this card, you can't play {Son Goku, Time to Fight} for the duration of the tur | confirmed | Plays right: after it is played a second {Son Goku, Time to Fight} is not offered for the turn; another card is. Engine proof 25 Oct. |
| SD8-10 Godly Destruction Beerus | f0 | [Auto] When you play this card, choose up to 1 of your opponent's Battle Cards in Rest Mode with an  | confirmed | Plays right: on play KOs a chosen opposing Rest Mode Battle Card of energy cost 2 or less (Active, cost 3 and [Barrier] not offered). Engine proof 25 Oct. |
| TB1-023 Strategies of Universe 7 | f0 | [Activate: Main] Choose all red ≪Saiyan≫ cards in your Battle Area. They gain [Barrier] (They can't  | confirmed | Plays right: the red Saiyan Battle Cards in play at resolution gain [Barrier] (blue Saiyan, red non-Saiyan and a later-played card do not) through the opponent's next turn; gone on your next turn. Engine proof 25 Oct. |
| TB1-055 Infinite Energy Android 18 | f0 | [Auto] At the end of the battle after you combo with this card from your hand, if your Leader Card i | confirmed | Plays right, matches official Q&A: after a combo from the hand with a Universe 7 Leader it is played in Rest Mode at battle end (own or opponent's turn); not from the Battle Area, not if returned to the hand, not with another Leader. Engine proof 25 Oct. |
| XD1-05 Hit, Ace of Universe 6 | f0 | [Auto][Bond 2] ≪Universe 6≫: (This skill takes effect when you have 2 or more of the specified Battl | confirmed | Plays right after the 25 Oct Bond refresh: with 2 Universe 6 Battle Cards in play the blue/yellow Universe 6 cards in hand get combo cost -1 for the turn (red U6 and non-U6 not; floor 0 per official Q&A); with 1, nothing. Engine proof 25 Oct. |
| XD1-06 Cabba, Saiyan of Universe 6 | f0 | [Auto] When you play this card, look at up to 7 cards from the top of your deck, choose up to 2 blue | confirmed | Plays right: look 7, add up to 2 blue/yellow Universe 6 (asked one at a time), shuffle; if one was added, discard 1; nothing added, no discard. Engine proof 25 Oct. |
| XD1-06 Cabba, Saiyan of Universe 6 | f10 | [Auto] When you play this card, if {Planet Sadala} is in your Battle Area, choose up to 1 of your op | confirmed | Plays right: with {Planet Sadala} in your Battle Area the chosen opposing Rest Mode card stays in Rest through the opponent's next turn (Charge Phase and an opposing skill both refused, #1138); without Sadala nothing. Engine proof 25 Oct. |
| XD1-07 Caulifla, Troublemaker of Universe 6 | f0 | [Auto] When you play this card, you may choose 1 card in your life and add it to your hand. If you d | confirmed | Plays right: on play you may take 1 life card to the hand; if you do, up to 1 opposing energy goes to Rest Mode; declined, nothing. Engine proof 25 Oct. |

## Left alone

- BT7-089 f0: keyword line (health done)
- SD3-02 f0: keyword line (health done)
- SD3-02 f10: keyword line (health done)
- SD8-02 f0: keyword line (health done)
- SD3-01 b0: corrected/user
- SD3-01 b10: confirmed/compiler
- SD3-01 f0: corrected/user
- BT1-057 b0: confirmed/compiler
- BT1-057 b10: confirmed/compiler
- BT1-057 f0: confirmed/compiler
- BT1-057 f10: confirmed/compiler
- P-003 f0: corrected/user
- SD15-03 f20: corrected/user
- SD7-04 f10: corrected/user
- SD8-01 b20: confirmed/compiler
- SD8-07 f20: corrected/user

## The two flagged rows, in more detail

| Row | Finding | State |
|---|---|---|
| **SD15-02 front 20** "[-6][Auto] If your opponent's life is at 3 or more: When your **mono-red ≪Saiyan≫** Leader Card is attacked, deal 1 damage to your opponent." | The stored trigger is `yourLeaderAttacked` with no condition on the Leader; `cond` holds only the opponent's life. The trigger text matcher (`src/lib/arena/text/triggers.ts`, `/when your [^,]{0,60}leader(?: card)? is attacked/`) swallows the description and nothing records it. Engine proof on the stored row: with a red ≪Namekian≫ Leader and with a red/blue ≪Saiyan≫ Leader, the opponent's attack on the Leader asks "Pay: 6 markers / Don't pay", and paying deals 1 damage (markers 7 to 1). The rest is right: mono-red ≪Saiyan≫ Leader fires, opponent life 2 does nothing, the marker price is asked and can be declined (9-6-4), and it is a marker skill (13-4-2). Fix: a Leader-description condition (`leaderMatches` red, mono-colour, ≪Saiyan≫) beside the life condition. | flagged; compiler gap; no draft saved |
| **SD15-05 front 10** "[Auto] If your opponent has 2 or more energy: When you remove a marker from one of your **red** Unison Cards using a [Spirit Boost] skill, you may play this card from your hand." | The stored trigger `spiritBoostPaid` keeps no colour for the Unison. Engine proof: a synthetic red Battle Card's "[Activate: Main][Spirit Boost 1] Draw 1 card." paid from a **blue** Unison (specified cost Blue 2) offers "play this card from your hand / Don't", and accepting plays SD15-05. Right otherwise: from a red Unison (DB3-001) it is offered and plays; "Don't" leaves it in hand; with 1 opposing energy nothing is offered. Fix: the paying Unison's colour as a trigger qualification. | flagged; compiler gap; no draft saved |

## Throwaway engine proofs (not committed)

Run 25 Oct 2026 on the rules engine (`RULES`) with the real card definitions of the 29 cards from the catalog and the **stored** rule rows from the before-snapshot (`rulesFromRows`; the rest of the world from the compiler), synthetic fodder and Leaders (mono-red ≪Saiyan≫, red ≪Namekian≫, red/blue ≪Saiyan≫, ≪Universe 6≫, ≪Universe 7≫, ≪Majin≫, plain colours), every prompt answered:
the three [Awaken] Leaders at life 4 and 5 (no decline offered, flip, SD8-01's energy choice); SD8-01 back 0 (1 and 2 Battle Cards, an Extra, the opponent's side, the front side), back 10 (Drop 6/7, hand 3/7), front 0 (search filter, the game-long negation over two turns);
the Unisons DB3-001 and SD15-02 played for X, their marker lines (13-4-2 lock, -4 with 3 and 5 markers), DB3-001's play damage at opponent life 4/5/8 and with a blue Leader, SD15-02 front 0 by replacing it with a second Unison (13-2-1-3) with both Leaders and twice in a turn ([Limit 1]), front 10 against a Battle Card and an opposing Unison, front 20 through a real opposing attack with three Leaders, two life counts, paid and declined;
SD15-03's Permanent with five Unison and mode boards and a blue Leader; SD15-04 through a real attack with 2 mono-red, 1, and 1 red + 1 red/blue combo cards; SD15-05 with a red and a blue Unison, 1 and 2 opposing energy, accepted and declined;
the combos BT7-089 (Leader, life 4/5/6, hand and Battle Area), BT9-031 (price paid, declined, no Extra), TB1-055 (own and opponent's turn, other Leader, from the Battle Area, returned to the hand mid-battle); DB2-004 paid and declined;
EX03-05 and EX03-24 (add, add none, empty deck), XD1-05 (Bond with 1 and 2 Universe 6 cards, a non-U6 second card; effective combo costs read back), XD1-06 both lines (with and without {Planet Sadala}, add or not, through the opponent's Charge Phase and against an opposing untap skill), XD1-07 taken and declined, TB1-023 (who gains [Barrier], a later card, the opponent's KO choice, expiry),
SD8-07 f0 prices at 2+2, 2+1, 0+4 and 4+0 rested cards, SD8-07 f10, SD8-05, SD8-06 (empty hand), SD8-02 f10 (Main Phase, battle, once), SD8-10 (rest/active/cost/[Barrier]), SD7-04, SD7-05 (deck of 2), SD3-02 f20 (Xeno-Evolve and a plain play), P-003 (own and opponent's End), BT7-090.

## Notes on the Try it probe (artefacts, not rule defects)

- [Awaken] rows (BT1-057 f20, SD3-01 f10, SD8-01 f10): the "your life at 5" board reports a fire and "your life at 4" reports "the probe broke" on SD3-01/SD8-01; the engine does not offer [Awaken] at life 5 (proof above). The probe's life knob does not reach the keyword's hoisted condition.
- Leader-gated rows (BT7-089, DB3-001 f0, EX03-05, TB1-055, BT7-023): "no edge board for leaderMatches"; DB3-001 f0 and SD3-02 f20 "nothing (gate WHEN)" because the probe plays a stand-in card or never evolves.
- SD15-02 f0 and SD15-05 f10: "the engine knows no moment for this wording" (no board for `unisonToDrop` / `spiritBoostPaid`); SD15-04 "not offered" (the probe stages no combo cards); SD15-02 f20 and SD8-01 b10 "nothing" (no marker / Drop staging); DB3-001 f20 not offered (6 markers are not staged).
- XD1-06 lines: "Game interrupted" on the probe board; SD15-03 f10 "inForce 20000" without a Unison staged.

## Known engine gaps that touch these cards (referenced, not re-investigated)

- SD15-03 f20 (owner-corrected, not touched): its own explanation says [Spirit Boost 1] is not charged for an [Auto] on the rules engine yet.
- XD1-05's reduction is fixed to the cards in hand when it resolves; that matches the official P-003 Q&A pattern ("a card played after does not gain the effect"). The owner's 25 Oct ruling on #930 (one-use Union reductions reach later cards) is about a different wording ("the next time you activate…") and was not applied here.
- SD3-02 f20 offers the [Xeno-Evolve] base just sent to the Warp (cost 2) among the Warp targets; the printed text does not exclude it, and no Q&A says otherwise.
- "Choose up to N" is asked one card at a time (XD1-06 "up to 2"), which is equivalent.

## Engine issues / owner questions (candidates; opening them is the owner's call)

1. **A Leader description in "When your … Leader Card is attacked" is dropped** (SD15-02 f20; the `yourLeaderAttacked` matcher in `text/triggers.ts` accepts up to 60 characters of description and records none). Other rows with that trigger and a description probably fire for any Leader too (not listed here); the compiler should hoist the description into a `leaderMatches` condition.
2. **"one of your red Unison Cards" on `spiritBoostPaid` is dropped** (SD15-05 f10): the trigger fires for a Spirit Boost paid from any Unison. Needs a colour qualification on the paying Unison.
3. BT7-023 f0 (Claude-authored, skipped since batch 1) is now the only unchecked owner-deck card left; it needs the owner's own review.

## Not done / caveats

- Confirmations rest on the printed text, the cited Q&A, the owner ruling #1122, the Rule Manual and the throwaway engine proofs above. The live `card_faq.php` was not fetched (not asked for); the errata page was.
- Not reached on a real board: TB1-055's Q&A case with an actual opposing skill (simulated by moving the card to the hand mid-battle); SD8-06 and SD8-05 f10's energy colour choice (only the count of rested energy was read); a Unison losing its last marker by an attack as the SD15-02 f0 trigger (reached by replacement only).
- After this batch the owner's decks have **one** unchecked card (BT7-023); the two flagged cards moved from `unchecked` to `incomplete` by their flags.
- The throwaway proofs are not committed; they can be rewritten from the notes. Nothing else in the repo changed.
