# Deck-card audit (18 Oct 2026)

Pre-check for the deck-first review: every skill of every card in the eligible decks (main + Z + leader, both faces), compared with its printed text and the card's official FAQ (`faq.generated.json`). Read-only on the database; no deck or owner names are recorded here.

## Counts (skills)

| | OK | SUSPECT | UNREAD | MISSING | total |
|---|---|---|---|---|---|
| Before (rows as stored) | 559 | 55 | 1 | 0 | 615 |
| After (this PR, with the Refresh line applied) | 607 | 8 | 0 | 0 | 615 |

306 cards, 615 skill rows. MISSING is 0: every skill the card text prints has a row. OK means the stored reading matches the printed text and the FAQ; a keyword whose reading is empty on purpose (Barrier, Blocker, Swap, Over Realm, Union, deck-building lines) is OK, and so are the owner's corrected and confirmed rows unless one is wrong against the card text. Before-SUSPECT includes the draft rows only a Refresh brings up to date.

## What the audit changed

- **Compiler**: "SD3-04: When you've sent 7 or more cards to your Warp" is read as 7 or more cards in your Warp (labelled best guess). The other compiler findings of this audit - a plain `choose` after a look read from the cards in play (BT3-028 and thirteen more skills), and the readings that said "the chosen cards" for "the rest", dropped the filter of a "for each", or called a combo-cost reduction "costs 1 less" - were fixed on main (#1049) while this audit ran; this PR merges that work and the Refresh line below brings the stored rows up to it.
- **Readings** (`describeScript`; the programs were right): "play ... on top of ..." and "with its skills negated" are said (fifteen skills, among them BT31-088/-089, BT10-073), a limited attack allowance reads "can attack ... only one more time" (BT3-104) instead of "can't attack ... once more", and a replacement aimed at their cards says "one of your skills" (BT29-040).
- **Refresh**: 49 deck skills are draft compiler rows whose stored reading or program is older than the current compile (the PR body carries the Refresh line).

## Still SUSPECT after the fixes (Flag)

| Skill | Card (decks) | Why | What the owner has to decide |
|---|---|---|---|
| BT3-043#10 | Powers Combined, Kibito Kai (2) | RESOLVED 18 Oct 2026 (#1052): the official FAQ wins over the 4 Oct ruling; only the +10000 needs a blue Leader and life <= 4, the return and the draw resolve regardless. Row refreshed in production. | Confirm via the connector. |
| BT3-119#10 | Shun Shun, Protector Majin (2) | Printed 'place UP TO 2 cards from the top of your deck in the Drop Area'; the program mills exactly 2 (mill has no up-to). | Engine: mill with an up-to count. Low impact (milling fewer is rarely wanted). |
| BT3-120#10 | Haru Haru, Attacker Majin (2) | Printed 'place UP TO 2 cards from the top of your deck in the Drop Area'; the program mills exactly 2 (mill has no up-to). | Engine: mill with an up-to count. Low impact. |
| BT1-073#20 | Broly, The Rampaging Horror (1) | Printed: 'choose up to 2 cards from your opponent's hand at random'. Program lets the master choose the cards (no random op exists); the FAQ says 'at random' means chosen without player involvement. Also exactly 2 vs up to 2 is not distinguished when the hand is short. | Needs a seeded random pick in the engine (new op); until then the player picks. |
| BT3-096#10 | Hidden Power Great Ape Tora (1) | RESOLVED 18 Oct 2026: owner agreed to replace his row with the compiler reading, which evolves the chosen <Tora> into this card from the Drop Area. That is right: by manual 8-5-8 the combo card is in the Drop before 'at the end of the battle' skills trigger (8-5-9). (This note first said 'from the Combo Area'; that was wrong.) Written as confirmed. | Done. |
| BT3-098#10 | Hidden Power Great Ape Fasha (1) | RESOLVED 18 Oct 2026: same as BT3-096#10 for <Fasha>; compiler reading written as confirmed. | Done. |
| BT30-104#0 | Su Roas, Fighting Maiden (1) | Printed: if your black Maiden Squadron card would be removed from a Battle Area by an opponent's skill, you may remove THIS card in your Warp from the game INSTEAD (the Maiden Squadron card stays; FAQ: one removal of this card from the Warp prevents all of them). Program is a redirect of the leaving card itself to 'removed' (the Maiden Squadron card is the one that leaves the game) and has no cost or Warp-side condition. | Needs a replacement whose substitute removes this card from the Warp and cancels the departure. |
| SD3-04#10 | Encroaching Threat Masked Saiyan (1) | UNREAD before: 'When you've sent 7 or more cards to your Warp' (open row). Now compiled as a LABELLED BEST GUESS: '7 or more cards are in your Warp' (no manual rule, erratum or FAQ covers it; the engine keeps no count of cards ever sent). The 'in your hand and Warp' half is not modelled (hand only). | Confirm the reading of 'you've sent 7 or more cards to your Warp' (count in the Warp now vs cards ever sent), and whether the Warp copy's cost matters. |

## Owner and confirmed rows with an older reading text

The program is untouched; the connector shows the stored text, and a row a person owns is not refreshed by script: EX02-01#10, BT30-083#20, BT30-084#10, BT30-098#10, BT30-101#0, BT30-104#10, BT30-106#20. BT1-077#0 is a confirmed row whose reading says "play the chosen cards" where the current compile says "activate (its [Field] skill, else play)" (printed "choose and activate 1 {Broly's Ring}"); left alone.

Never refresh (not compiler drafts, and a fresh compile reads them worse): BT7-023#0 (claude row; a fresh compile leaves its condition unread) and the owner rows SD3-01#0/#0b, BT3-051#20, BT30-099#20, BT30-101#0, BT30-104#10, BT31-085#10b, BT6-001#10b, BT6-015#20, SD13-02#20, SD7-04#10, P-003#0, P-048#10.

## Keyword rows the connector cannot confirm

119 deck skill rows read as nothing (keywords the engine plays itself, and deck-building lines). `confirm_rule` refuses a row that "reads as nothing", so these cannot reach `confirmed` through the connector and the deck-weighted progress keeps them in "read". Either the connector needs a keyword path or they are confirmed in the workbench.

## Review notes (judged OK, worth one look)

- SD8-07#0, SD8-08#10: "4 or more cards in Rest Mode" is read as cards your opponent has in play (Leader and Battle Areas, 20-1-6), not their rested energy.
- BT3-039#10: the program is `payWith` (rest this card for an energy cost); the FAQ limits it to energy costs in the Battle Area, not skill costs - engine behaviour, not reading.
- [Awaken] leaders (SD5-01, SD3-01, BT2-001, ...): the reading shows the effect; the "life at 4 or less" gate and the flip belong to the keyword.
- BT2-010#0, BT6-010#0, BT3-091#0, TB1-055#0: the "after you combo with this card (from your hand)" timing is read from the printed text by the trigger interpreter, not from the program.
- BT28-138#10: the reading adds "and in active mode" to the Hidden Mode card switched to Rest Mode (it can only be switched if active).

## Cards, by deck appearances

| Card | Decks | Skills (after) |
|---|---|---|
| BT4-097 Instant Transmission | 5 | #0 OK; #10 OK |
| BT4-078 Dependable Dynasty Son Goku | 4 | #0 OK |
| BT4-081 Dynasty Deferred Son Goku | 4 | #0 OK; #10 OK; #20 OK |
| BT4-089 Dynasty's Solace Chi-Chi | 4 | #0 OK |
| BT5-023 Afterimage Technique | 4 | #0 OK; #10 OK |
| BT5-115 Power Burst | 4 | #0 OK; #10 OK |
| SD5-02 Power Charge Bardock | 4 | #0 OK |
| SD5-03 SSB Son Goku, at the Apex | 4 | #0 OK; #10 OK; #20 OK; #30 OK |
| SD5-04 Reborn Might SS4 Son Goku | 4 | #0 OK; #10 OK |
| SD5-05 Ultimate Potential SS2 Son Gohan | 4 | #0 OK; #10 OK |
| BT3-113 Supreme Kai of Time, World's Protector | 3 | #0 OK; #10 OK |
| BT4-077 Indomitable Dynasty SS Son Goku | 3 | #0 OK; #10 OK |
| BT4-084 Intrepid Dynasty Son Gohan | 3 | #0 OK; #10 OK |
| BT4-085 Prodigal Dynasty Son Goten | 3 | #0 OK; #10 OK |
| BT4-086 Plucky Dynasty Pan | 3 | #0 OK; #10 OK; #20 OK |
| BT4-091 Adoptive Father Son Gohan | 3 | #0 OK; #10 OK |
| BT4-096 10x Kamehameha | 3 | #0 OK |
| BT6-025 Transcendent Strike | 3 | #0 OK |
| BT7-023 Denial of Hope | 3 | #0 OK |
| SD5-01 Golden Great Ape Son Goku | 3 | #0b OK; #10b OK; #0 OK; #10 OK |
| BT1-082 Family Kamehameha | 2 | #0 OK |
| BT1-107 Cold Bloodlust | 2 | #0 OK |
| BT1-109 Frieza's Call | 2 | #0 OK |
| BT2-072 Bundle of Curiosity Son Goku | 2 | #0 OK |
| BT27-093 SS4 Vegito, Barrage | 2 | #10 OK |
| BT28-102 Stop Laughing! | 2 | #0 OK; #10 OK; #20 OK |
| BT3-027 Unending Awakening | 2 | #0 OK |
| BT3-043 Powers Combined, Kibito Kai | 2 | #0 OK; #10 FAQ (#1052) |
| BT3-097 Unwavering Solidarity Tora | 2 | #0 OK |
| BT3-102 Nappa, Vegeta's Attendant | 2 | #0 OK |
| BT3-104 Flying Nimbus | 2 | #0 OK (was SUSPECT) |
| BT3-109 SS3 Bardock, Power Unleashed | 2 | #0 OK; #10 OK; #20 OK |
| BT3-110 Awakened Warrior Bardock | 2 | #0 OK; #10 OK |
| BT3-111 Trunks, Power Overseeing Time | 2 | #20 OK |
| BT3-119 Shun Shun, Protector Majin | 2 | #0 OK; #10 SUSPECT FLAG; #20 OK |
| BT3-120 Haru Haru, Attacker Majin | 2 | #0 OK; #10 SUSPECT FLAG; #20 OK |
| BT3-121 Dark Plot | 2 | #0 OK |
| BT3-122 Time's Judgement | 2 | #0 OK |
| BT31-070 Vegeta, the Targeted Prince | 2 | #10 OK; #20 OK |
| BT31-110 United Across Time | 2 | #0 OK; #10 OK (was SUSPECT) |
| BT4-010 Digging Deep Vegeta | 2 | #0 OK |
| BT4-079 Unbroken Dynasty Son Goku | 2 | #0 OK |
| BT5-063 Physical Mastery Uub | 2 | #0 OK |
| BT5-088 Full Surveillance Jaco | 2 | #0 OK; #10 OK |
| BT5-108 Kami, Global Unifier | 2 | #0 OK; #10 OK; #20 OK (was SUSPECT) |
| BT5-114 Temporal Rescue Trunks | 2 | #0 OK; #10 OK |
| BT6-009 Vegeta, Prepping for Fusion | 2 | #0 OK (was SUSPECT) |
| BT6-010 Support Attack Trunks | 2 | #0 OK; #10 OK |
| BT6-011 Bulma, from the Sidelines | 2 | #0 OK |
| BT6-026 Is That All You've Got? | 2 | #0 OK |
| BT6-078 Wrathful Charge | 2 | #0 OK |
| EX02-01 Time Patrol Trunks | 2 | #0 OK; #10 OK |
| EX03-17 Limitless Energy Android 17 | 2 | #20 OK |
| SD3-01 The Masked Saiyan | 2 | #0b OK; #10b OK; #0 OK; #10 OK |
| SD3-03 Quick blade Trunks | 2 | #0 OK |
| SD7-02 Dimensional Warrior Son Goku | 2 | #0 OK; #10 OK; #20 OK |
| SD7-03 Vegeta, Returned from Darkness | 2 | #0 OK; #10 OK |
| SD8-04 Defending Father Paragus | 2 | #0 OK; #10 OK |
| SD8-08 Vegeta, Time to Fight | 2 | #0 OK; #10 OK |
| TB1-005 Gale Strike Vegeta | 2 | #0 OK |
| BT1-014 Saiyan Cabba | 1 | #0 OK |
| BT1-027 Cabba's Awakening | 1 | #0 OK |
| BT1-055 Whis's Coercion | 1 | #0 OK |
| BT1-057 Broly | 1 | #0b OK; #10b OK; #0 OK; #10 OK; #20 OK |
| BT1-064 Raging Attacker Vegeta | 1 | #10 OK; #20 OK |
| BT1-070 Super Saiyan Gotenks | 1 | #0 OK; #20 OK |
| BT1-071 Energy Power Gotenks | 1 | #0 OK |
| BT1-073 Broly, The Rampaging Horror | 1 | #0 OK; #20 SUSPECT FLAG |
| BT1-074 Rampaging Lifeform Bio-Broly | 1 | #0 OK; #10 OK; #20 OK |
| BT1-076 Broly, Dawn of the Rampage | 1 | #0 OK |
| BT1-077 Paragus, Controller of Monsters | 1 | #0 OK |
| BT1-078 Overflowing Bio Warrior Army | 1 | #0 OK |
| BT1-079 King Vegeta's Surprise Attack | 1 | #0 OK |
| BT1-080 Full Power Energy | 1 | #0 OK |
| BT1-081 Broly's Ring | 1 | #0 OK |
| BT1-089 Avenging Frieza | 1 | #0 OK |
| BT10-008 Yamcha, Merciless Barrage | 1 | #0 OK; #10 OK |
| BT10-072 Frieza, Cosmic Horror | 1 | #10 OK |
| BT10-073 Frieza, Terrifying Transformation | 1 | #0 OK; #10 OK (was SUSPECT) |
| BT10-080 Burter, Fastest in the Universe | 1 | #10 OK |
| BT10-083 Dodoria the Cold-Blooded | 1 | #0 OK |
| BT10-085 Zarbon the Gorgeous | 1 | #10 OK |
| BT10-087 Frieza the Power Monger | 1 | #10 OK; #20 OK |
| BT10-091 One-Star Ball, Parasitic Darkness | 1 | #0 OK; #10 OK; #20 OK (was SUSPECT) |
| BT11-008 Son Goku, Saiyan Youth | 1 | #10 OK |
| BT11-011 Vegeta, Saiyan Youth | 1 | #0 OK |
| BT14-010 Tien Shinhan, Universe 7 Challenger | 1 | #10 OK |
| BT2-001 Vegito | 1 | #0b OK (was SUSPECT); #10b OK (was SUSPECT); #0 OK (was SUSPECT); #10 OK; #20 OK |
| BT2-004 Relentless Super Saiyan 3 Son Goku | 1 | #10 OK; #20 OK |
| BT2-009 Ultimate Evil Dark Prince Vegeta | 1 | #0 OK; #10 OK |
| BT2-010 Double Shot Super Saiyan 2 Vegeta | 1 | #0 OK |
| BT2-012 Repeated Force Vegito | 1 | #0 OK; #10 OK; #20 OK (was SUSPECT) |
| BT2-013 Lightning Speed Vegito | 1 | #0 OK; #10 OK; #20 OK |
| BT2-027 Awakening Evil Majin Buu | 1 | #0 OK; #10 OK (was SUSPECT) |
| BT2-067 Zen-Oh Button | 1 | #0 OK |
| BT27-095 Bardock, Destiny-Changing Willpower | 1 | #0 OK; #10 OK |
| BT28-110 Transcendent Limit Break | 1 | #0 OK; #10 OK |
| BT28-121 Android 17, Teaming Up to Protect the Earth | 1 | #0 OK; #10 OK; #20 OK |
| BT28-138 Battles of the Gods of Destruction | 1 | #0 OK; #10 OK |
| BT29-029 Cooler | 1 | #0b OK; #10b OK; #0 OK; #10 OK; #20 OK; #30 OK |
| BT29-030 Armored Squadron, Attack! | 1 | #10 OK; #20 OK; #30 OK |
| BT29-031 Cooler, Incredible Ultimate Evolution | 1 | #10 OK (was SUSPECT); #20 OK; #30 OK |
| BT29-032 Cooler, Incredible Ultimate Power | 1 | #0 OK; #10 OK; #20 OK |
| BT29-033 Salza, Elite Squad Splendor | 1 | #10 OK |
| BT29-035 Salza, Technique | 1 | #0 OK; #10 OK |
| BT29-036 Dore, Elite Squad Splendor | 1 | #10 OK |
| BT29-037 Dore, Power | 1 | #0 OK; #10 OK |
| BT29-038 Neiz, Elite Squad Splendor | 1 | #10 OK |
| BT29-039 Neiz, Speed | 1 | #0 OK; #10 OK |
| BT29-040 Yes, Time to Die! | 1 | #0 OK (was SUSPECT); #10 OK (was SUSPECT) |
| BT29-041 Fearsome Conquest | 1 | #10 OK; #20 OK |
| BT29-042 Loyalty to Cooler | 1 | #10 OK; #20 OK |
| BT29-065 Vegeta, Back From the Brink of Death | 1 | #10 OK; #20 OK; #30 OK; #40 OK |
| BT29-098 Trunks, Battle With a God | 1 | #0 OK (was SUSPECT); #10 OK (was SUSPECT) |
| BT3-003 Victorious Fist Super Saiyan 3 Son Goku | 1 | #0 OK; #20 OK |
| BT3-004 Rising Fist Super Saiyan 2 Son Goku | 1 | #0 OK; #20 OK |
| BT3-005 Determined Super Saiyan Son Goku | 1 | #0 OK; #10 OK |
| BT3-006 Pint-sized Warrior Son Goku | 1 | #0 OK |
| BT3-010 Reliable Trunks | 1 | #0 OK; #20 OK |
| BT3-011 Quick Rush Trunks | 1 | #0 OK |
| BT3-013 Handy Giru | 1 | #0 OK; #10 OK |
| BT3-015 Bodyguard Ledgic | 1 | #0 OK; #10 OK |
| BT3-028 Grand Tour Spaceship | 1 | #0 OK (was SUSPECT) |
| BT3-030 Planet M-2 | 1 | #0 OK; #10 OK; #20 OK |
| BT3-031 Majin Buu | 1 | #0b OK; #10b OK; #0 OK; #10 OK |
| BT3-036 Final Explosion Prince of Destruction Vegeta | 1 | #10 OK |
| BT3-037 Universal Leader, Grand Supreme Kai | 1 | #0 OK |
| BT3-038 Unyielding Defender, East Supreme Kai | 1 | #0 OK; #10 OK |
| BT3-039 Majin Defier, West Supreme Kai | 1 | #0 OK; #10 OK |
| BT3-040 Majin Defier, South Supreme Kai | 1 | #0 OK; #10 OK |
| BT3-041 Majin Defier, North Supreme Kai | 1 | #0 OK; #10 OK |
| BT3-042 Kibito, Kai's Attendant | 1 | #0 OK |
| BT3-045 Agent of Resurrection, Babidi | 1 | #0 OK |
| BT3-046 Magician's Father, Bibidi | 1 | #0 OK; #10 OK |
| BT3-047 The Ultimate Evil, Majin Buu | 1 | #0 OK; #10 OK; #20 OK |
| BT3-048 Out of Control Evil, Majin Buu | 1 | #0 OK (was SUSPECT); #10 OK |
| BT3-049 Power Absorbing Majin Buu | 1 | #0 OK; #20 OK |
| BT3-050 Majin Buu, Dawn of the Rampage | 1 | #0 OK (was SUSPECT); #10 OK; #20 OK |
| BT3-051 God Absorber Majin Buu | 1 | #0 OK; #10 OK; #20 OK |
| BT3-052 The Most Evil Absorption in History | 1 | #0 OK |
| BT3-054 Buu Make You Cookie | 1 | #0 OK |
| BT3-055 Vegito | 1 | #0b OK; #10b OK; #0 OK; #10 OK |
| BT3-058 Pressure Assault Super Saiyan Son Goku | 1 | #0 OK; #10 OK |
| BT3-061 Unyielding Justice SS2 Trunks | 1 | #0 OK; #10 OK; #20 OK; #30 OK |
| BT3-062 Trunks, Bridge to the Future | 1 | #0 OK (was SUSPECT) |
| BT3-082 Bardock | 1 | #0b OK; #10b OK; #0 OK; #10 OK |
| BT3-084 Desperate Warrior Super Saiyan Bardock | 1 | #0 OK; #10 OK; #20 OK |
| BT3-085 Great Protector, Great Ape Bardock | 1 | #0 OK; #10 OK; #20 OK; #30 OK |
| BT3-086 Striker Bardock | 1 | #0 OK; #10 OK (was SUSPECT) |
| BT3-087 Gine, Family of Justice | 1 | #0 OK; #10 OK |
| BT3-091 Kakarot, the Child Who Got Away | 1 | #0 OK |
| BT3-092 Absolute Defense Great Ape King Vegeta | 1 | #0 OK; #20 OK; #30 OK (was SUSPECT) |
| BT3-093 Lord of the Great Apes, King Vegeta | 1 | #0 OK |
| BT3-095 Youthful Bulma | 1 | #0 OK |
| BT3-096 Hidden Power Great Ape Tora | 1 | #0 OK; #10 CONFIRMED; #20 OK |
| BT3-098 Hidden Power Great Ape Fasha | 1 | #0 OK; #10 CONFIRMED; #20 OK |
| BT3-099 Unwavering Solidarity Fasha | 1 | #0 OK |
| BT3-100 Unwavering Solidarity Shugesh | 1 | #0 OK; #10 OK |
| BT3-101 Unwavering Solidarity Borgos | 1 | #0 OK |
| BT3-105 Planet Vegeta | 1 | #0 OK; #10 OK; #20 OK |
| BT3-106 March of the Great Ape | 1 | #0 OK |
| BT3-112 Unrelenting Assault Trunks | 1 | #0 OK; #10 OK |
| BT30-019 Son Goku, Adventure Partner | 1 | #10 OK; #20 OK |
| BT30-082 Brianne De Chateau | 1 | #0b OK; #10b OK; #0 OK; #10 OK |
| BT30-083 Heles, Graceful Beauty | 1 | #10 OK; #20 OK |
| BT30-084 Support Broadcast | 1 | #0 OK (was SUSPECT); #10 OK |
| BT30-095 Ribrianne, Witchy Warrior | 1 | #10 OK; #20 OK |
| BT30-096 Song of Love and Victory! Maiden Squadron | 1 | #0 OK; #10 OK (was SUSPECT) |
| BT30-097 Formation!! Brianne De Chateau | 1 | #10 OK |
| BT30-098 Brianne De Chateau, Hope of the Multiverse | 1 | #0 OK; #10 OK |
| BT30-099 Kakunsa, Witchy Warrior | 1 | #10 OK; #20 OK |
| BT30-100 Formation! Sanka Ku | 1 | #10 OK |
| BT30-101 Sanka Ku, Fighting Maiden | 1 | #0 OK; #10 OK |
| BT30-102 Rozie, Witchy Warrior | 1 | #0 OK; #10 OK |
| BT30-103 Formation! Su Roas | 1 | #10 OK |
| BT30-104 Su Roas, Fighting Maiden | 1 | #0 SUSPECT FLAG; #10 OK |
| BT30-106 Delivery of Love | 1 | #0 OK; #10 OK; #20 OK |
| BT30-110 Soul Punisher, Purifying Blast | 1 | #0 OK; #10 OK |
| BT31-001 Son Goku & Vegeta | 1 | #0b OK (was SUSPECT); #10b OK; #0 OK; #10 OK |
| BT31-003 SS Gogeta, Invincible Power | 1 | #10 OK (was SUSPECT); #20 OK |
| BT31-007 SS3 Son Goku, Struggle in Another World | 1 | #0 OK; #10 OK |
| BT31-008 Son Goku, Other World Warrior | 1 | #0 OK; #10 OK; #20 OK |
| BT31-009 Son Goku, Training in Another World | 1 | #10 OK |
| BT31-010 Son Goku & Vegeta, Battling Against Evil | 1 | #10 OK (was SUSPECT); #20 OK |
| BT31-011 SS Vegeta, Struggle in Another World | 1 | #0 OK; #10 OK |
| BT31-012 Vegeta, Hellish Warrior | 1 | #0 OK; #10 OK; #20 OK |
| BT31-013 Veku, Incomplete Fusion | 1 | #10 OK; #20 OK (was SUSPECT); #30 OK (was SUSPECT) |
| BT31-014 SS Gogeta, Revoker of Evil | 1 | #10 OK; #20 OK; #30 OK |
| BT31-015 SS Gogeta, Vanquisher | 1 | #10 OK; #20 OK; #30 OK |
| BT31-024 Power Release | 1 | #0 OK; #10 OK |
| BT31-025 Buying Time | 1 | #0 OK; #10 OK |
| BT31-054 The Mightiest Warrior's Power | 1 | #0 OK; #10 OK (was SUSPECT) |
| BT31-071 Vegeta, Backup From Afar | 1 | #10 OK; #20 OK |
| BT31-085 Vegito | 1 | #0b OK (was SUSPECT); #10b OK; #0 OK; #10 OK (was SUSPECT) |
| BT31-087 Chronoa, God's Power Stolen | 1 | #0 OK; #10 OK |
| BT31-088 Son Goku & Vegeta, Warriors United | 1 | #10 OK; #20 OK (was SUSPECT) |
| BT31-089 Son Goku & Vegeta, Interdimensional Warriors United | 1 | #10 OK; #20 OK (was SUSPECT) |
| BT31-090 SSB Vegito, Azure Flash | 1 | #10 OK; #20 OK (was SUSPECT); #30 OK |
| BT31-091 SSB Vegito, Fusion Surpassing the Legends | 1 | #10 OK; #20 OK; #30 OK |
| BT31-092 Vegito, the Mightiest Fusion | 1 | #0 OK (was SUSPECT); #10 OK; #20 OK |
| BT31-093 SS4 Limit Breaker Vegito, Crimson Flash, Super Full Power | 1 | #10 OK; #20 OK; #30 OK |
| BT31-094 SS4 Vegito, Dimension Transcending Peerless Warrior | 1 | #0 OK; #10 OK; #20 OK |
| BT31-095 SS3 Vegito, Unparalleled Power | 1 | #10 OK |
| BT31-096 SS Vegito, Dimension Transcending Fusion Warrior | 1 | #0 OK; #10 OK; #20 OK |
| BT31-116 Cell | 1 | #0b OK (was SUSPECT); #10b OK; #0 OK; #10 OK; #20 OK |
| BT31-119 Cell, Creeping Terror | 1 | #10 OK; #20 OK |
| BT31-126 Android 18, Supporter | 1 | #10 OK |
| BT31-128 Cell, Ultimate Form | 1 | #10 OK; #20 OK; #30 OK |
| BT31-129 Cell, Perfect Form | 1 | #10 OK; #20 OK; #30 OK |
| BT31-130 Cell, Absorbed Form | 1 | #10 OK; #20 OK |
| BT31-131 Cell, Ominous Android | 1 | #10 OK; #20 OK (was SUSPECT) |
| BT31-132 Cell, Ominous Larva | 1 | #0 OK; #10 OK |
| BT31-133 Cell Jr., the Fiendish | 1 | #0 OK; #10 OK |
| BT31-138 Cell's Solar Flare | 1 | #0 OK |
| BT31-139 Absorb and Power Up | 1 | #0 OK (was SUSPECT) |
| BT31-140 Regeneration Skill | 1 | #0 OK |
| BT31-141 Cell Jr. Summon | 1 | #0 OK |
| BT31-142 Cell's Kamehameha | 1 | #0 OK |
| BT31-149 SS Gogeta, Hell-Piercing Flash | 1 | #10 OK; #20 OK (was SUSPECT); #30 OK (was SUSPECT) |
| BT31-150 SSB Kaio-ken Vegito, True God Power | 1 | #20 OK; #30 OK |
| BT4-005 Blazing Spirit Son Goku | 1 | #0 OK |
| BT4-011 Daily Training Vegeta | 1 | #0 OK |
| BT4-012 Intensifying Power Trunks | 1 | #0 OK |
| BT4-095 Successor of Hope | 1 | #0 OK |
| BT4-114 Gravy, in Demigra's Thrall | 1 | #0 OK |
| BT5-013 Puar, Best Pal | 1 | #0 OK |
| BT5-014 Scheming Oolong | 1 | #0 OK |
| BT5-024 Oolong's Wish | 1 | #0 OK; #10 OK |
| BT5-032 Great Saiyaman, Town Hero | 1 | #0 OK; #10 OK |
| BT5-042 South Kai, Keeping Watch | 1 | #0 OK |
| BT5-043 West Kai, Keeping Watch | 1 | #0 OK; #10 OK |
| BT5-050 Dimension Magic | 1 | #0 OK; #10 OK |
| BT5-057 Spirited Search Pan | 1 | #0 OK (was SUSPECT) |
| BT5-059 Defensive Stance SS Vegeta | 1 | #0 OK; #10 OK |
| BT5-061 Defensive Stance Piccolo | 1 | #0 OK; #10 OK |
| BT5-062 Negotiator Krillin | 1 | #0 OK; #10 OK |
| BT5-075 Shocking Death Ball | 1 | #0 OK; #10 OK |
| BT5-101 Time Magic | 1 | #0 OK (was SUSPECT); #10 OK |
| BT5-107 Dragon Ball Seeker Bulma | 1 | #0 OK |
| BT5-117 Dragon Ball | 1 | #0 OK; #10 OK |
| BT5-119 World Peace | 1 | #0 OK; #10 OK |
| BT6-001 Son Goku and Vegeta | 1 | #0b OK; #10b OK; #0 OK; #10 OK |
| BT6-003 Harmonic Energy SSB Son Goku | 1 | #0 OK; #10 OK; #20 OK |
| BT6-004 Preemptive Strike SSG Son Goku | 1 | #0 OK; #10 OK; #20 OK |
| BT6-005 Son Goku, Prepping for Fusion | 1 | #0 OK (was SUSPECT) |
| BT6-006 Support Attack Son Goten | 1 | #0 OK; #10 OK |
| BT6-007 Harmonic Energy SSB Vegeta | 1 | #0 OK; #10 OK (was SUSPECT); #20 OK |
| BT6-008 Preemptive Strike SSG Vegeta | 1 | #0 OK; #10 OK (was SUSPECT); #20 OK |
| BT6-012 Veku, Contents Under Pressure | 1 | #0 OK; #10 OK; #20 OK; #30 OK |
| BT6-013 Veku, the Fragile | 1 | #0 OK; #10 OK; #20 OK |
| BT6-014 SSB Gogeta, Fusion Onslaught | 1 | #0 OK; #20 OK; #30 OK; #40 OK |
| BT6-015 Gogeta, Unparalleled Fusion Warrior | 1 | #10 OK; #20 OK; #30 OK |
| BT6-052 Spirit Sword | 1 | #0 OK |
| BT6-062 Broly, Berserker Origins | 1 | #0 OK; #10 OK |
| BT6-063 Broly, Unrealized Ambition | 1 | #0 OK; #10 OK |
| BT6-065 Paragus, Deadly Premonition | 1 | #0 OK; #10 OK |
| BT6-069 Ties that Bind Ba | 1 | #0 OK |
| BT6-076 Broly Control Mechanism | 1 | #0 OK; #10 OK |
| BT6-110 Master Roshi, Strict Instructor | 1 | #0 OK; #10 OK |
| BT7-003 Raditz, the Oppressor | 1 | #0 OK; #10 OK |
| BT7-082 Cabba, Brimming with Spirit | 1 | #0 OK |
| BT7-085 Caulifla, the Bold Sister | 1 | #0 OK; #10 OK |
| BT7-087 Frost, the Path to Full Power | 1 | #0 OK |
| BT7-089 Magetta, Defender of Universe 6 | 1 | #0 OK; #10 OK |
| BT7-090 Namekian Partner Saonel | 1 | #0 OK |
| BT8-051 Yamcha, the Cunning | 1 | #0 OK |
| BT9-031 Android 18, Steadfast Technique | 1 | #0 OK |
| DB1-019 Niagara Drop | 1 | #0 OK |
| DB2-004 Piccolo, Namekian Fortification | 1 | #0 OK |
| DB3-001 Master Roshi, Potential Unleashed | 1 | #0 OK; #10 OK; #20 OK |
| EX03-05 Rampant Evil Majin Buu | 1 | #10 OK |
| EX03-14 Last One Standing Son Goku | 1 | #0 OK; #10 OK |
| EX03-16 Deathless Warrior Broly | 1 | #0 OK; #10 OK; #20 OK |
| EX03-19 Jiren | 1 | #0b OK; #10b OK; #0 OK; #10 OK |
| EX03-24 Clownish Destruction Belmod | 1 | #20 OK (was SUSPECT) |
| P-003 Super Saiyan 3 Son Goku | 1 | #0 OK; #10 OK |
| P-048 Dimension Control Demigra | 1 | #10 OK |
| SD13-01 Frieza | 1 | #0b OK; #10b OK; #0 OK; #10 OK; #20 OK |
| SD13-02 Frieza : Xeno, Darkness Overflowing | 1 | #0 OK; #10 OK; #20 OK |
| SD13-03 Ginyu, Frieza's Greatest Soldier | 1 | #0 OK; #10 OK |
| SD13-04 Zarbon, Frieza's Right-Hand Man | 1 | #0 OK; #10 OK |
| SD13-05 Dodoria, Frieza's Devoted Servant | 1 | #0 OK; #10 OK |
| SD15-01 Vegeta | 1 | #0b OK; #10b OK; #0 OK; #10 OK |
| SD15-02 SS Cabba, Spirit Resonance | 1 | #0 OK; #10 OK; #20 OK |
| SD15-03 Son Goku, Spirit Boost Warrior | 1 | #10 OK; #20 OK |
| SD15-04 Surprise Attack Son Gohan | 1 | #0 OK |
| SD15-05 Surprise Attack SSB Vegeta | 1 | #10 OK |
| SD3-02 Killer Sword Trunks | 1 | #0 OK; #10 OK; #20 OK |
| SD3-04 Encroaching Threat Masked Saiyan | 1 | #0 OK; #10 SUSPECT (was UNREAD) FLAG |
| SD7-01 Dragon Ball | 1 | #0b OK; #10b OK; #0 OK; #10 OK; #20 OK |
| SD7-04 Shenron, Figure of Majesty | 1 | #0 OK; #10 OK |
| SD7-05 Mega Focus Son Goku | 1 | #0 OK |
| SD8-01 Broly | 1 | #0b OK; #10b OK; #20b OK; #0 OK; #10 OK |
| SD8-02 Broly, the Ravager | 1 | #0 OK; #10 OK |
| SD8-03 Broly, Rushing Forth | 1 | #0 OK; #10 OK |
| SD8-05 Cheelai, Frieza Force Soldier | 1 | #0 OK; #10 OK |
| SD8-06 Lemo, Frieza Force Soldier | 1 | #0 OK |
| SD8-07 Son Goku, Time to Fight | 1 | #0 OK; #10 OK; #20 OK |
| SD8-09 Godly Destruction Whis | 1 | #0 OK; #10 OK |
| SD8-10 Godly Destruction Beerus | 1 | #0 OK |
| TB1-023 Strategies of Universe 7 | 1 | #0 OK |
| TB1-055 Infinite Energy Android 18 | 1 | #0 OK |
| XD1-01 Cabba | 1 | #0b OK; #10b OK; #20b OK; #30b OK; #0 OK; #10 OK; #20 OK |
| XD1-05 Hit, Ace of Universe 6 | 1 | #0 OK (was SUSPECT) |
| XD1-06 Cabba, Saiyan of Universe 6 | 1 | #0 OK; #10 OK |
| XD1-07 Caulifla, Troublemaker of Universe 6 | 1 | #0 OK |

## Findings that changed a reading or program

- **BT3-104#0** Flying Nimbus (2): Stored reading says less or something else than the printed text (the program is right, or was right with the wording lost): see storedReads/freshReads. Fixed by: describeScript wording + Refresh.
- **BT31-110#10** United Across Time (2): Stored reading says less or something else than the printed text (the program is right, or was right with the wording lost): see storedReads/freshReads. Fixed by: describeScript wording + Refresh.
- **BT5-108#20** Kami, Global Unifier (2): Stored reading is older than the current compile and misses printed text (e.g. 'ignoring [Barrier]', or 'or' between names). Fixed by: Refresh (draft row, current compile is more faithful).
- **BT6-009#0** Vegeta, Prepping for Fusion (2): Stored reading says less or something else than the printed text (the program is right, or was right with the wording lost): see storedReads/freshReads. Fixed by: describeScript wording + Refresh.
- **BT10-073#10** Frieza, Terrifying Transformation (1): Stored reading says less or something else than the printed text (the program is right, or was right with the wording lost): see storedReads/freshReads. Fixed by: describeScript wording + Refresh.
- **BT10-091#20** One-Star Ball, Parasitic Darkness (1): Stored reading says less or something else than the printed text (the program is right, or was right with the wording lost): see storedReads/freshReads. Fixed by: describeScript wording + Refresh.
- **BT2-001#0b** Vegito (1): Stored reading is older than the current compile and misses printed text (e.g. 'ignoring [Barrier]', or 'or' between names). Fixed by: Refresh (draft row, current compile is more faithful).
- **BT2-001#10b** Vegito (1): Stored reading is older than the current compile and misses printed text (e.g. 'ignoring [Barrier]', or 'or' between names). Fixed by: Refresh (draft row, current compile is more faithful).
- **BT2-001#0** Vegito (1): Stored reading is older than the current compile and misses printed text (e.g. 'ignoring [Barrier]', or 'or' between names). Fixed by: Refresh (draft row, current compile is more faithful).
- **BT2-012#20** Repeated Force Vegito (1): Stored reading says less or something else than the printed text (the program is right, or was right with the wording lost): see storedReads/freshReads. Fixed by: describeScript wording + Refresh.
- **BT2-027#10** Awakening Evil Majin Buu (1): Stored reading says less or something else than the printed text (the program is right, or was right with the wording lost): see storedReads/freshReads. Fixed by: describeScript wording + Refresh.
- **BT29-031#10** Cooler, Incredible Ultimate Evolution (1): Stored reading is older than the current compile and misses printed text (e.g. 'ignoring [Barrier]', or 'or' between names). Fixed by: Refresh (draft row, current compile is more faithful).
- **BT29-040#0** Yes, Time to Die! (1): Stored reading says less or something else than the printed text (the program is right, or was right with the wording lost): see storedReads/freshReads. Fixed by: describeScript wording + Refresh.
- **BT29-040#10** Yes, Time to Die! (1): Reading text is the same, but the stored cost lacks the printed cost/Awaken condition the current compile reads (the condition is parsed now). Fixed by: Refresh (draft row).
- **BT29-098#0** Trunks, Battle With a God (1): Stored reading is older than the current compile and misses printed text (e.g. 'ignoring [Barrier]', or 'or' between names). Fixed by: Refresh (draft row, current compile is more faithful).
- **BT29-098#10** Trunks, Battle With a God (1): Stored reading says less or something else than the printed text (the program is right, or was right with the wording lost): see storedReads/freshReads. Fixed by: describeScript wording + Refresh.
- **BT3-028#0** Grand Tour Spaceship (1): Program chose the card from the cards in play, not from the 7 cards looked at. Fixed by: compiler: a plain choose after a look is read from the cards looked at (landed on main in #1049 while this audit ran; same fix).
- **BT3-048#0** Out of Control Evil, Majin Buu (1): Stored reading says less or something else than the printed text (the program is right, or was right with the wording lost): see storedReads/freshReads. Fixed by: describeScript wording + Refresh.
- **BT3-050#0** Majin Buu, Dawn of the Rampage (1): Stored reading says less or something else than the printed text (the program is right, or was right with the wording lost): see storedReads/freshReads. Fixed by: describeScript wording + Refresh.
- **BT3-062#0** Trunks, Bridge to the Future (1): Stored reading says less or something else than the printed text (the program is right, or was right with the wording lost): see storedReads/freshReads. Fixed by: describeScript wording + Refresh.
- **BT3-086#10** Striker Bardock (1): Stored reading says less or something else than the printed text (the program is right, or was right with the wording lost): see storedReads/freshReads. Fixed by: describeScript wording + Refresh.
- **BT3-092#30** Absolute Defense Great Ape King Vegeta (1): Stored reading says less or something else than the printed text (the program is right, or was right with the wording lost): see storedReads/freshReads. Fixed by: describeScript wording + Refresh.
- **BT30-084#0** Support Broadcast (1): Stored reading says less or something else than the printed text (the program is right, or was right with the wording lost): see storedReads/freshReads. Fixed by: describeScript wording + Refresh.
- **BT30-096#10** Song of Love and Victory! Maiden Squadron (1): Stored reading is older than the current compile and misses printed text (e.g. 'ignoring [Barrier]', or 'or' between names). Fixed by: Refresh (draft row, current compile is more faithful).
- **BT31-001#0b** Son Goku & Vegeta (1): Stored reading is older than the current compile and misses printed text (e.g. 'ignoring [Barrier]', or 'or' between names). Fixed by: Refresh (draft row, current compile is more faithful).
- **BT31-003#10** SS Gogeta, Invincible Power (1): Stored reading is older than the current compile and misses printed text (e.g. 'ignoring [Barrier]', or 'or' between names). Fixed by: Refresh (draft row, current compile is more faithful).
- **BT31-010#10** Son Goku & Vegeta, Battling Against Evil (1): Stored reading is older than the current compile and misses printed text (e.g. 'ignoring [Barrier]', or 'or' between names). Fixed by: Refresh (draft row, current compile is more faithful).
- **BT31-013#20** Veku, Incomplete Fusion (1): Stored reading says less or something else than the printed text (the program is right, or was right with the wording lost): see storedReads/freshReads. Fixed by: describeScript wording + Refresh.
- **BT31-013#30** Veku, Incomplete Fusion (1): Stored reading is older than the current compile and misses printed text (e.g. 'ignoring [Barrier]', or 'or' between names). Fixed by: Refresh (draft row, current compile is more faithful).
- **BT31-054#10** The Mightiest Warrior's Power (1): Stored reading is older than the current compile and misses printed text (e.g. 'ignoring [Barrier]', or 'or' between names). Fixed by: Refresh (draft row, current compile is more faithful).
- **BT31-085#0b** Vegito (1): Stored reading is older than the current compile and misses printed text (e.g. 'ignoring [Barrier]', or 'or' between names). Fixed by: Refresh (draft row, current compile is more faithful).
- **BT31-085#10** Vegito (1): Reading text is the same, but the stored cost lacks the printed cost/Awaken condition the current compile reads (the condition is parsed now). Fixed by: Refresh (draft row).
- **BT31-088#20** Son Goku & Vegeta, Warriors United (1): Stored reading says less or something else than the printed text (the program is right, or was right with the wording lost): see storedReads/freshReads. Fixed by: describeScript wording + Refresh.
- **BT31-089#20** Son Goku & Vegeta, Interdimensional Warriors United (1): Stored reading says less or something else than the printed text (the program is right, or was right with the wording lost): see storedReads/freshReads. Fixed by: describeScript wording + Refresh.
- **BT31-090#20** SSB Vegito, Azure Flash (1): Stored reading is older than the current compile and misses printed text (e.g. 'ignoring [Barrier]', or 'or' between names). Fixed by: Refresh (draft row, current compile is more faithful).
- **BT31-092#0** Vegito, the Mightiest Fusion (1): Stored reading is older than the current compile and misses printed text (e.g. 'ignoring [Barrier]', or 'or' between names). Fixed by: Refresh (draft row, current compile is more faithful).
- **BT31-116#0b** Cell (1): Stored reading is older than the current compile and misses printed text (e.g. 'ignoring [Barrier]', or 'or' between names). Fixed by: Refresh (draft row, current compile is more faithful).
- **BT31-131#20** Cell, Ominous Android (1): Stored reading says less or something else than the printed text (the program is right, or was right with the wording lost): see storedReads/freshReads. Fixed by: describeScript wording + Refresh.
- **BT31-139#0** Absorb and Power Up (1): Stored reading says less or something else than the printed text (the program is right, or was right with the wording lost): see storedReads/freshReads. Fixed by: describeScript wording + Refresh.
- **BT31-149#20** SS Gogeta, Hell-Piercing Flash (1): Stored reading is older than the current compile and misses printed text (e.g. 'ignoring [Barrier]', or 'or' between names). Fixed by: Refresh (draft row, current compile is more faithful).
- **BT31-149#30** SS Gogeta, Hell-Piercing Flash (1): Stored reading is older than the current compile and misses printed text (e.g. 'ignoring [Barrier]', or 'or' between names). Fixed by: Refresh (draft row, current compile is more faithful).
- **BT5-057#0** Spirited Search Pan (1): Stored reading says less or something else than the printed text (the program is right, or was right with the wording lost): see storedReads/freshReads. Fixed by: describeScript wording + Refresh.
- **BT5-101#0** Time Magic (1): Stored reading is older than the current compile and misses printed text (e.g. 'ignoring [Barrier]', or 'or' between names). Fixed by: Refresh (draft row, current compile is more faithful).
- **BT6-005#0** Son Goku, Prepping for Fusion (1): Stored reading says less or something else than the printed text (the program is right, or was right with the wording lost): see storedReads/freshReads. Fixed by: describeScript wording + Refresh.
- **BT6-007#10** Harmonic Energy SSB Vegeta (1): Stored reading is older than the current compile and misses printed text (e.g. 'ignoring [Barrier]', or 'or' between names). Fixed by: Refresh (draft row, current compile is more faithful).
- **BT6-008#10** Preemptive Strike SSG Vegeta (1): Stored reading is older than the current compile and misses printed text (e.g. 'ignoring [Barrier]', or 'or' between names). Fixed by: Refresh (draft row, current compile is more faithful).
- **EX03-24#20** Clownish Destruction Belmod (1): Stored reading says less or something else than the printed text (the program is right, or was right with the wording lost): see storedReads/freshReads. Fixed by: describeScript wording + Refresh.
- **XD1-05#0** Hit, Ace of Universe 6 (1): Stored reading says less or something else than the printed text (the program is right, or was right with the wording lost): see storedReads/freshReads. Fixed by: describeScript wording + Refresh.
