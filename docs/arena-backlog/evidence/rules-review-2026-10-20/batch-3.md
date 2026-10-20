# Rules review, 20 Oct 2026, batch 3: Warp "up to N" shape, next 30 cards

Authorization: owner, 18 Oct 2026 ("full permission to write into the db in production without further asking") and
20 Oct 2026 ("Yes, the same optional one-at-a-time ruling applies to 'send up to N from the top of your deck to the Warp'. Apply it to
that family, then continue with the next 30 unchecked deck cards"). Writes went only through the repo's guarded paths: `arena:rule`
(`scripts/arena-rule.mts`), `saveRule` (`src/lib/arena/rules-store.ts`), and `confirmRule` / `flagRule`
(`src/lib/rules-review/deck-review.ts`, attribution `claude-review`). No ad hoc SQL, no owner-confirmed or owner-corrected row touched,
no P-616, no errata edit. The database was proven to be this app's first (`to_regclass('public.card_rules')` = `card_rules`).

## 1. Ruling recorded first

`npm run arena:rule -- BT12-122 --skill 20 "Owner approved 20 Oct 2026: 'send up to N cards from the top of your deck to the Warp' is an optional,
one-at-a-time choice (may 1, then if taken may 1 ...) ..."` Recorded on BT12-122 front skill 20 (the explanation was then replaced by the
shape's own explanation when that row was rewritten, as for BT3-120 in batch 2).

**A slip to report.** `arena:rule --skill 20` matches every face's skill 20, so the ruling text was also stamped on **BT12-122 back skill 20**
(an unrelated [Counter] row: compiler draft, its program untouched). Its explanation was empty before, I believe; the only guarded
writer that can empty it (`setBrief`) was refused by the session's permission check as not one of the paths named above, so I did not work
around that. The row still reads as a compiler draft with a stray explanation; clearing the explanation (set it back to empty) is a one-line
owner/coordinator action.

## 2. The Warp family

Shape: `may( look 1 from the top, move it to the Warp )`, then `if did(may): may(...)`, N deep, same nesting as the Drop cards in batch 2.
The language's `mill` can only go to the Drop, so each step is `look` (top 1) plus `moveTo warp`, which keeps "the top card" (the old
stored form was "choose up to N cards **in your deck**", a free pick from the whole deck, the same defect as the Drop wording). The engine's own
`deckToWarpBySkill` moment is raised for each card moved. **N=5 is written flat** (`may`, then four times `if did(may): may`), because the
validator refuses a chain nested five deep ("nested too deeply"); the flat form behaves the same because only `may` sets the answer
(proved below). Reading shows e.g. "you may: look at the top 1, move the chosen cards to warp, if the offer was taken: you may: ..."; the
"look at the top 1" is the engine's word for "the top card" here.

Candidates: every dbs rule whose printed text says "up to N cards from the top of your deck" with a Warp that are stored as the "choose in the deck + move to Warp" pair: 18 rows (17 changed below, BT21-137 skipped). Written as `source claude`,
`status draft`, explanation "Owner-approved shape 20 Oct 2026 (Warp ruling): optional one-at-a-time". Only the "choose up to N in the deck + move to Warp"
pair was replaced; every other op, the hoisted IF, trigger, combo, cost and usage were passed back explicitly (lesson of batch 2), and after each save the row was re-read
and `cond`, `trigger`, `combo` and the ops were asserted equal to what was meant (none dropped). `readRule` / `validateRule` ok on all.

| Row | Before (reads) | After (same IF / rest kept) | v |
|---|---|---|---|
| BT12-122 front 20 [Activate: Main][Once per turn] | choose up to 5 in the deck, to Warp | N=5 flat | 3 |
| BT12-122 back 10 [Auto] attacks | draw 1, then the same | draw 1, N=5 flat | 3 |
| BT13-127 front 10 | if Leader black <Supreme Kai of Time>: up to 2, draw 1 | same IF, N=2 chain, draw 1 | 6 |
| BT13-131 front 10 | same text | same IF, N=2 chain, draw 1 | 6 |
| BT16-099 front 10 [+1][Activate: Main] | if Leader black Saiyan: up to 3 | same IF, N=3 chain | 6 |
| BT16-103 front 10 | up to 3 | N=3 chain | 3 |
| BT16-104 front 0 | up to 3 | N=3 chain | 3 |
| BT18-130 front 10 | draw 1, if Leader black Demon Realm Race: up to 2 | draw 1, the inner IF kept, N=2 chain | 7 |
| BT18-132 front 10 | draw 1, up to 2 | draw 1, N=2 chain | 4 |
| BT18-135 front 0 | search 5 + shuffle, if Leader black Demon Realm Race: up to 2 | search kept, the inner IF kept, N=2 chain | 7 |
| BT29-086 back 10 | up to 2, then opponent's Battle Card to Warp | N=2 chain, opponent part kept | 6 |
| BT29-088 front 20 [+1] | up to 2, switch this card Active | N=2 chain, switch kept | 3 |
| BT29-089 front 20 [0] | up to 2, +5000 | N=2 chain, +5000 kept | 3 |
| BT29-090 front 20 [+1] | draw 1, up to 1 | draw 1, `may` of one | 3 |
| BT29-091 front 30 [+1] | up to 2 | N=2 chain | 3 |
| BT29-093 front 20 [+1] | up to 2 | N=2 chain | 3 |
| P-621 front 20 | if Trunks: Xeno-only Leader and opp 2+ energy: up to 3, then the Warp cost reduction | same IF, N=3 chain, reduction kept | 6 |

**17 rows (16 cards) changed.** BT29-090 is "up to 1": the ruling is trivially satisfied, but the old form let the player pick *any* card of the deck, so
I applied it (nothing reads the card afterwards).

Typed records: all 17 rows were older records whose `usage` / `validity` and/or typed payment record were missing or malformed (#907), which makes `saveRule`
refuse. As in batch 2, I filled exactly those records from the compiler's current record for the same printed line (`skillRecords`), after checking the compiler's
program, IF and trigger for that line equal the stored ones (filters normalised with `completeFilters`, because the stored filters lacked newer default keys).
BT12-122 front 20 got `oncePerTurn: true` this way (it was stored as no ceiling at all), BT29-088/-091/-093 got their [+1] marker payment record, and the rest
got unlimited usage / no Sparking / a readable payment record.

Engine proof (throwaway, not committed): the chain segment taken from each saved row, run on the real interpreter (`stepScript`) in a staged game with
the answers yes/no in every order: accept all = the **top N** cards of the deck go to the Warp in order (+N), accept k then decline = +k and no further
question, decline first = 0, nothing goes to the Drop. Results, one line per row:
BT12-122 f20/b10 (N=5): +5/+1/+2/+3/+4/0; BT13-127, BT13-131, BT18-130, BT18-132, BT18-135, BT29-086, BT29-088, BT29-089, BT29-091, BT29-093 (N=2): +2/+1/0;
BT16-099, BT16-103, BT16-104, P-621 (N=3): +3/+1/+2/0; BT29-090 (N=1): +1/0. The generated chains for N=2, 3 and 5 were also run before saving.
Try it boards after the change (no "before" boards were taken for these stale rows): BT12-122 f20, BT16-103, BT16-104, BT18-135, BT29-088/-089/-091/-093 fire; BT18-130/-132 fire (draw 1);
the IF rows (BT13-127/-131, BT16-099, P-621) and the attack Autos (BT12-122 back, BT29-086 back) do not reach their moment on the probe board, as before.

Listed and not changed:

| Row | Why |
|---|---|
| BT21-137 front 10 (open) | unread clauses ("play up to 1 black Unison with a specified cost of 3 and a marker on it"); the Warp part is the last clause |
| TB2-015 front 0 | "place up to 5 cards from the top of your deck **under** the chosen card", not the Warp wording (same free-pick defect; owner to say if the ruling extends to it) |
| BT30-083, BT30-101 (x2), BT30-104, BT30-106 | owner-corrected rows, not this wording (look at N / choose among them) |
| BT15-134, BT18-122, BT29-020/-021, BT29-086 front, BT31-088/-089, BT25-144 | the Warp is a cost or a "look at N, take among them" wording, not "send up to N from the top" |

## 3. The next 30 deck cards

Selection: owner `patvolny` plus ownerless decks, game `dbs`, not testing (25 decks); cards whose health is `unchecked` (147 after batch 2), ordered by deck count then id,
skipping the 60 cards of the two earlier receipts (BT3-119 and BT3-120 are Claude drafts awaiting the owner from batches 1-2, and BT31-110 f10 / BT7-023 stay flagged / skipped as left). Every remaining card is in exactly one deck, so the order is by id:
BT10-085, BT10-087, BT10-091, BT11-008, BT11-011, BT14-010, BT2-001, BT2-013, BT2-027, BT2-067, BT27-095, BT28-110, BT28-121, BT28-138, BT29-031, BT29-033, BT29-037, BT29-038,
BT29-040, BT29-065, BT29-098, BT3-003, BT3-004, BT3-005, BT3-006, BT3-013, BT3-015, BT3-028, BT3-037, BT3-039. (BT2-001 and BT2-013 each have a row the owner or an earlier batch already
decided: those were not touched.) Keyword-line rows (Swap, Evolve, Critical, Blocker, Barrier, Super Combo, Union-Potara ...) are health `done` and were left alone, as in batch 1.

Basis order as in batches 1 and 2: official Q&A (`faq.generated.json`), errata page (none of these cards), Rule Manual / glossary, the repo's engine proofs, Try it boards, plus throwaway engine
proofs (real printed text, staged boards, and for the three fixes the *stored* rows via `rulesFromRows`) where the probe cannot reach the moment.

**Totals: 48 rows on 30 cards: 42 confirmed, 6 flagged (2 of them with a Claude draft fix saved), 0 skipped.**

### Per row (48 rows)

| Card | Skill | Printed (short) | Verdict | Basis / reason |
|---|---|---|---|---|
| BT10-085 Zarbon the Gorgeous | f10 | [Auto] If your Leader Card is green and your life is at 4 or less: When this card is used ... | confirmed | same text as BT14-010 with green; combo-used entry, leader green and life <= 4 then draw 1; BT14-010's engine proofs u1b-prices-757 / u1c-conditions-757 / u1c-effects-757 run this exact shape. Try it: no fire when the probe leader is not green (correct). |
| BT10-087 Frieza the Power Monger | f10 | [auto] If your opponent has 3 or more energy: When this card is removed from a Battle Area... | confirmed | Try it: fires with 3 opposing energy, not with 2; WHEN lists both KO'd and removed-by-skill as printed; Drop to hand, green Extra cost <= 1. |
| BT10-087 Frieza the Power Monger | f20 | [activate: battle]{g}{2}: This card gets +15000 power and [double strike] for the battle. | confirmed | Try it: +15000 and Double Strike for the battle; price {g}{2} = 3 orbs with 1 green as printed. |
| BT10-091 One-Star Ball, Parasitic Darkness | f0 | [Permanent] This card gains ≪Dark Dragon Ball≫ in all areas. | confirmed | Try it: in force on the board; the trait is gained in all areas (allAreas) as printed. |
| BT10-091 One-Star Ball, Parasitic Darkness | f10 | [Activate: Battle] Choose 1 of your cards and it gets +5000 power for the battle. | confirmed | Try it: Activate Battle gives the chosen card +5000 for the battle. |
| BT10-091 One-Star Ball, Parasitic Darkness | f20 | [Activate: Main] Choose 1 <Frieza> card with an energy cost of 4 in your Battle Area and p... | **flagged** | 20 Oct review: engine cannot offer this line. Its price 'place this card under it' (moveTo under) is refused by canPayPriceProgram (activation-price-support.ts), so with a cost-4 <Frieza> in play and a Xeno in hand the engine still says 'cannot pay' (proof 20 Oct). Same class: 133 stored Activate rows. Engine change needed, not a rule edit. |
| BT11-008 Son Goku, Saiyan Youth | f10 | [Auto] If you have a red Unison Card in play: When this card is played, draw 1 card. | confirmed | engine proofs u1a-triggers-757 and u1c-effects-757 (BT11-008 #10) run this exact line; Try it: no draw without a red Unison, draw with one. |
| BT11-011 Vegeta, Saiyan Youth | f0 | [Auto] If your Leader Card is red: When this card is played from your hand, choose up to 1... | confirmed | engine proofs u1a-triggers-757 / u1c-effects-757 (BT11-011 #0) and u1c-moves-757 run this exact line; played-from-hand moment, leader red, marker on a red Unison. |
| BT14-010 Tien Shinhan, Universe 7 Challenger | f10 | [Auto] If your Leader Card is red and your life is at 4 or less: When this card is used in... | confirmed | engine proofs u1b-prices-757 (l.263), u1c-conditions-757 (l.50, both halves of the AND) and u1c-effects-757 (l.342) run this exact line. |
| BT2-001 Vegito | b0 | [Permanent] Each <Son Goku> and <Vegeta> in all of your areas gain red, blue, and green co... | confirmed | official Q&A: 'all areas' includes Energy Area, deck and hand ('Yes, it does'); the BT2-001 Q&A on paying BT1-066's blue through this permanent; Try it: in force. |
| BT2-001 Vegito | f0 | [Permanent] Each <Son Goku> and <Vegeta> in all of your areas gain red, blue, and green co... | confirmed | same permanent as the back side; official Q&A (all areas incl. energy, deck, hand); Try it: in force. |
| BT2-001 Vegito | f10 | [Auto] When this card attacks, place up to 1 card from the top of your deck in the Drop Ar... | **flagged** | 20 Oct review: 'place up to 1' was a forced mill. Claude draft fix v7 saved: the mill and the red check sit in one 'may' (owner's 20 Oct ruling on 'up to N'). Engine proof with the stored row: red top +5000 (10000 to 15000), non-red nothing, declined leaves the card on the deck. Owner to approve. |
| BT2-001 Vegito | f20 | [Awaken] When your life is at 4 or less: You may draw 2 cards and flip this card over. | confirmed | [Awaken]: glossary engine rule (condition in the price, effect, then the engine flips the Leader); engine proof 20 Oct on the real Leader: no Awaken offered at life 5, offered at life 4; the draw is a 'may' as printed. |
| BT2-013 Lightning Speed Vegito | f10 | [Permanent] This card can attack Battle Cards that are in Active Mode. | confirmed | engine proof 20 Oct: with BT2-013 in play it may attack the opponent's Active Battle Card as well as the Leader; permit attackActive (protected-grammar-907 pins it). Note: the card's Union-Potara row has an old typed record that makes the Try it probe error; the match itself ran. |
| BT2-027 Awakening Evil Majin Buu | f10 | [union absorb] Place 1 Battle Card from your hand under this card: Choose up to 1 <Majin B... | confirmed | [Union-Absorb]: engine proof 20 Oct: activated from the Battle Area it asks for the hand Battle Card (placed under), then a <Majin Buu> 25000+ from the deck, plays it on top, both cards under it; glossary Union (Absorb) and absorb-identity-923. |
| BT2-067 Zen-Oh Button | f0 | [Counter: Attack] Switch all of your blue energy to Active Mode. | confirmed | Try it: Counter Attack fires; switches all blue Energy Area cards to Active as printed. |
| BT27-095 Bardock, Destiny-Changing Willpower | f0 | [Counter: Attack][Limit 1] If your Leader is black: Negate the attack and play this card. | confirmed | Try it: Counter Attack, negates and the card goes to the Battle Area (same self-play shape as BT10-008); engine proof 20 Oct for the counter flow (negated=true). |
| BT27-095 Bardock, Destiny-Changing Willpower | f10 | [Permanent] If your life is at 4 or less and you have 5 or more cards in your Drop, you ca... | confirmed | engine proof 20 Oct: alternative Counter price offered only with life <= 4 and 5+ Drop cards (not at life 5, not at 4 Drop cards); using it sends the whole Drop (5) to the Warp, negates the attack and plays the card. |
| BT28-110 Transcendent Limit Break | f0 | [Activate: Battle]Remove this card from the game: Switch up to 1 of your energy to Reveale... | confirmed | engine proof 20 Oct: from hand during the combo window with white energy, the card leaves the game as the price and the hidden energy is revealed; +10000 chosen as printed (energy cost of the Extra is paid like any Extra). |
| BT28-110 Transcendent Limit Break | f10 | [Activate: Battle]{w}, place 1 of your Z-Energy into its owner's Drop and remove this card... | confirmed | engine proof 20 Oct: offered from hand in the combo window with white energy and a Z-Energy card, the card leaves the game; the Hidden Mode battle card switch and the +15000 are optional/chosen ('up to 1') as printed; Try it: draw 1 first. |
| BT28-121 Android 17, Teaming Up to Protect the Earth | f0 | [Counter: Play][Limit 1] Choose 1 of your white Battle Cards and switch it to Hidden Mode:... | **flagged** | 20 Oct review: unsure on one edge. Official Q&A: if the card this skill switched to Hidden is revealed by another skill and then hidden again, it is NOT revealed at end of turn. The program reveals c0 unconditionally in a delay at turnEnd (hidden.ts proves only the plain case). Otherwise plays right. |
| BT28-121 Android 17, Teaming Up to Protect the Earth | f10 | [Permanent] If your Leader is a white ≪Universe 7≫ card and you have a Hidden Mode card in... | confirmed | the Permanent reads as printed: Leader white Universe 7 (hoisted IF) and a Hidden Mode card in the Battle Area, then this card costs 2 less in hand; hidden.ts reads the same Hidden Mode permanent family; Try it: in force. |
| BT28-121 Android 17, Teaming Up to Protect the Earth | f20 | [Auto] When this card is played, draw 1 card. | confirmed | Try it: draws 1 when played. |
| BT28-138 Battles of the Gods of Destruction | f0 | [Counter: Attack] Negate the attack. Additionally, you may switch 1 of your white energy t... | confirmed | Try it: negates and draws after the optional white-energy switch; official Q&A: markers cannot be switched (markers are not Energy Area cards in the engine) and Hidden Mode energy has no colour. |
| BT28-138 Battles of the Gods of Destruction | f10 | [Permanent] If your Leader is white, you can activate this card's [Counter] skill from you... | confirmed | hidden.ts (BT28-124/-138 block, 5-8-2-2) runs this exact permanent text: a Hidden Mode Active Battle Card is rested to pay instead of energy; a rested one cannot. |
| BT29-031 Cooler, Incredible Ultimate Evolution | f10 | [auto][once per turn] When this card attacks, choose up to 1 of your opponent's Battle Car... | confirmed | Try it: once per turn on attack, returns the chosen opposing Battle Card to hand (ignoring Barrier). |
| BT29-031 Cooler, Incredible Ultimate Evolution | f20 | [activate: main]{2}, if your Leader is a <Cooler> card and your opponent has 3 or more ene... | confirmed | engine proof 20 Oct: from hand with {2}, a <Cooler> Leader and 3 opposing energy it draws 1 and plays the card; not offered with 2 opposing energy. |
| BT29-031 Cooler, Incredible Ultimate Evolution | f30 | [activate: battle][limit 1] Choose 1 blue ≪Cooler's Armored Squadron≫ card or blue Extra i... | confirmed | engine proof 20 Oct: during a battle with a blue Cooler's Armored Squadron card in play it is returned to hand as the price and this card switches to Active. |
| BT29-033 Salza, Elite Squad Splendor | f10 | [Auto][Limit 1] When this card is played, draw 1 card, then choose up to 1 of your cards a... | confirmed | Try it: draws 1 then +5000 on a chosen card; Limit 1. |
| BT29-037 Dore, Power | f10 | [auto] When this card is played, draw 1 card. | confirmed | Try it: draws 1 when played. |
| BT29-038 Neiz, Elite Squad Splendor | f10 | [Auto][Limit 1] When this card is played, draw 1 card, and this card gains [Barrier] until... | confirmed | Try it: draws 1 and gains Barrier until the end of the opponent's turn (shown as until the start of your next turn). |
| BT29-040 Yes, Time to Die! | f0 | [activate: main/battle][limit 1] If your Leader is blue: Until the end of your opponent's ... | confirmed | owner's 4 Oct ruling quoted on the row; readings.ts and qualified-movement-evolve-825 run the real line on the engine (hand return by your skill goes to the deck bottom until the opponent's turn ends; own bounce and Drop moves untouched). |
| BT29-040 Yes, Time to Die! | f10 | [activate: main][limit 1]{u}, if your Leader is a blue <Cooler> card, you choose 1 blue Ex... | **flagged** | 20 Oct review: wrong as compiled (offered only from play, never from the Drop). Claude draft fix v7 saved: 'this card' now named with area Drop (rule 9-1-3-2, as BT29-020/-021). Engine proof with the stored row: offered from the Drop, returns the card and the blue Extra to hand. Residual: still also offered from the Battle Area (pays the price, card goes to the Drop). Owner to approve. |
| BT29-065 Vegeta, Back From the Brink of Death | f10 | [permanent] If your life is at 6 or less, this card gets +10000 power. | confirmed | Try it: +10000 at life <= 6 and not at 7. |
| BT29-065 Vegeta, Back From the Brink of Death | f20 | [permanent] If your life is at 4 or less, this card gets +10000 power. | confirmed | Try it: +10000 at life <= 4 and not at 5. |
| BT29-065 Vegeta, Back From the Brink of Death | f30 | [permanent] If your life is at 2 or less, this card gets +10000 power. | confirmed | Try it: +10000 at life <= 2 and not at 3. |
| BT29-065 Vegeta, Back From the Brink of Death | f40 | [auto] If your Leader is {Vegeta, Warrior Race Pride}: When your life moves to another are... | **flagged** | 20 Oct review: wrong in the engine. The Auto is meant to fire from the Drop but lifeLeft is pended only for cards in play (script.ts damage -> cardsInPlay). Engine proof: Leader {Vegeta, Warrior Race Pride}, card in the Drop, 1 damage to life: no offer is made. |
| BT29-098 Trunks, Battle With a God | f0 | [auto] When this card is played, look at up to 5 cards from the top of your deck, add up t... | confirmed | look 5, up to 1 black-or-white Son Goku/Vegeta/Vegito to hand, shuffle: colour filter is an either-of AND the three names, as printed; Try it fires on play. |
| BT29-098 Trunks, Battle With a God | f10 | [activate: main][limit 1] If your Leader is a black <Son Goku>-only card and your opponent... | confirmed | engine proof 20 Oct: with a black Son Goku-only Leader and 3 opposing energy, {SS2 Trunks, Pursuit} from the Drop or the Warp is played on top of this card. |
| BT3-003 Victorious Fist Super Saiyan 3 Son Goku | f20 | [auto] [once per turn] When this card attacks, switch this card to Active Mode, and it gai... | confirmed | Try it: on attack, switches to Active and +5000 for the turn; once per turn. |
| BT3-004 Rising Fist Super Saiyan 2 Son Goku | f20 | [auto] When a card evolves into this card, draw 2 cards. | confirmed | evolvedInto moment (readings.ts l.1188 pins the wording When a card evolves into this card; same moment as BT3-109 / BT1-074 reviewed earlier); draw 2; the probe cannot evolve, so this rests on the printed text and that proof. |
| BT3-005 Determined Super Saiyan Son Goku | f10 | [Permanent] When your life is at 4 or less, increase the energy cost of this card in your ... | **flagged** | 20 Oct review: wrong in the engine. The +2 is applied to costOf (5 at life <= 4) but cost filters read the printed energyCost, so a 'cost 3 or less' KO still targets it at life 4 (engine proof), which the printed skill prevents. |
| BT3-006 Pint-sized Warrior Son Goku | f0 | [Auto] When you play this card, look at up to 7 cards from the top of your deck. Choose up... | confirmed | Try it: fires on play; look 7, up to 1 red <Son Goku: GT> to hand, shuffle; official Q&A on searching. |
| BT3-013 Handy Giru | f10 | [Auto] When you combo with this card, if your Leader Card is red and your life is at 4 or ... | confirmed | Try it: at life 4 +10000 combo power and draw 1, at life 5 nothing; leader red; combo-used entry moment. |
| BT3-015 Bodyguard Ledgic | f10 | [Permanent] When your opponent has Battle Cards in their Battle Area and you have no Battl... | confirmed | engine proof 20 Oct: playable with no energy when the opponent has a Battle Card and you have none, not otherwise; official Q&A (a Field Extra does not count as a Battle Card) matches the BATTLE filter. |
| BT3-028 Grand Tour Spaceship | f0 | [Activate: Main] Look at up to 7 cards from the top of your deck, and choose 1 <Son Goku: ... | confirmed | Try it fires; look 7 and 'choose 1' (not up to) as printed, played free (official Q&A: no energy for skill plays), shuffle. |
| BT3-037 Universal Leader, Grand Supreme Kai | f0 | [Auto] When you play this card, choose up to 1 Battle Card other than <Grand Supreme Kai> ... | confirmed | Try it fires; official Q&A (reveal; Gowasu allowed) matches namesIncluding 'Supreme Kai' minus <Grand Supreme Kai>. |
| BT3-039 Majin Defier, West Supreme Kai | f10 | [Permanent] You can use this card to pay energy costs even when it's in your Battle Area. | confirmed | keywords.ts 20-19 block runs this exact permanent text: the Battle Card is rested where it stands, never moves, a rested one cannot pay again; official Q&A agrees. |

### The six flagged rows, in more detail

| Row | Finding | State |
|---|---|---|
| **BT10-091 front 20** [Activate: Main] "place this card under it: play ... Frieza: Xeno on top" | Wrong in the engine, not in the rule: `canPayPriceProgram` refuses any price program with `moveTo under` (`vm/activation-price-support.ts`), so with a cost-4 <Frieza> in play, a Xeno in hand and energy the line is rejected "cannot pay" (engine proof 20 Oct). The same refusal covers **133 stored Activate rows** (a query of the stored price programs: place-under, KO as price, `comboFrom`, shuffle, reveal ...). | flagged; needs an engine change |
| **BT3-005 front 10** [Permanent] "+2 energy cost in the Battle Area at life <= 4" | The program is the one the rules-language doc gives for 20-21 and `costOf` becomes 5 at life 3 or 4, but cost filters read the printed `energyCost`: engine proof, a "cost 3 or less" KO still targets BT3-005 at life 4, which is the whole point of the printed skill. | flagged; engine design (filters vs `costOf`) |
| **BT29-065 front 40** [Auto] "when your life moves to another area, play this card from your Drop" | Engine never pends `lifeLeft` for a card in the Drop (it loops over cards in play only, `vm/script.ts` damage). Proof: Leader {Vegeta, Warrior Race Pride}, the card in the Drop, one point of skill damage: no offer. Front 10/20/30 (+10000 at life 6/4/2) confirmed. | flagged; needs a Drop-zone trigger |
| **BT28-121 front 0** [Counter: Play] | One edge: official Q&A says that if the card this skill hid is revealed by another skill and hidden again it is *not* revealed at end of turn; the delayed reveal ignores that. The plain case is the one `hidden.ts` proves. Everything else plays right. | flagged (unsure, edge) |
| **BT29-040 front 10** [Activate: Main] "Add this card in your Drop to your hand" | The compiler's draft moved "this card" with no area, so the engine never offers the line from the Drop (engine proof: no action at all with the card in the Drop). Claude draft fix v7 saved (`moveTo` self with area Drop, rule 9-1-3-2, as BT29-020/-021); proof with the stored row: offered from the Drop, the blue Extra and the card return to hand. Residual: the line is also still offered from the Battle Area, where paying the price and moving the card to the Drop does nothing useful. | flagged for the owner to approve the draft |
| **BT2-001 front 10** [Auto] "place up to 1 card from the top ... if that card is red, +5000" | A forced one-card mill ("up to 1" under the owner's 20 Oct ruling is optional). Claude draft fix v7 saved: one `may` holding the mill and the red check (no card placed, no check). Proof with the stored row: red top card +5000 (Leader 10000 -> 15000), non-red nothing, declined leaves the card on the deck. | flagged for the owner to approve the draft |

Both fixes are `source claude`, `status draft`, explanation naming the basis; their `cond`, `trigger`, `cost`, `usage` were re-read and unchanged. The audit
flag text on each row carries the same finding. Nothing was confirmed on a row Claude wrote.

Engine proofs run for this batch (throwaway, not committed; real printed text compiled from the catalog, staged boards): BT27-095 alt Counter price (life 4 / Drop 5 offered; life 5 and Drop 4 not;
using it sends the Drop to the Warp and negates), BT28-110 [0]/[10] (from hand in the combo window with white energy), BT29-031 [20] from hand (opponent energy 3 yes, 2 no) and [30] in battle,
BT29-098 [10] (from Drop and Warp), BT2-027 [10] Absorb, BT2-001 Awaken (Leader life 5 refused, 4 offered), BT2-013 attacking an Active Battle Card, BT3-015 free play (0 own / 1 opposing yes, otherwise no),
the three above, and the Warp chains.

## 4. Fuzz

`npm run arena:fuzz -- 20`: **20 games: 20 completed, 0 interrupted, 0 action limits, 0 crashes.** (Batches 1 and 2 each had one crash from an out-of-date typed combo record on Frost, the Path to Full Power;
that did not recur in this run, which does not mean the record was refreshed. The games here include Claude-draft decks.)

## Not done / caveats

- Where Try it says "did not fire" or "changes nothing" the probe could not reach the moment (leader conditions, attacks, evolve, removal); those rows rest on the printed text, the cited repo
  proofs and the throwaway proofs above, and each note says which.
- No "before" Try it boards were captured for the 17 Warp rows (their older records are stale, so the probe breaks or refuses on them); the engine chain proofs are the evidence.
- BT12-122 back 20 carries a stray explanation (section 1). BT2-013 front 0 (Union-Potara) has an old typed record that makes the Try it probe error on that card; a match with the card ran.
- The throwaway engine proofs are not committed; they can be rewritten from the notes. Nothing else in the repo changed.
- 116 unchecked owner-deck cards remain (146 after skipping the earlier receipts, minus these 30).
