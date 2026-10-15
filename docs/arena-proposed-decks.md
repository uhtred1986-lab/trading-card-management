# Proposed arena deck and scenario programme

Source: the 6,552-definition Masters catalog snapshot reviewed for PR #823/#824. These are **candidate recipes**, not completed legal deck lists or claims of passed tests. Quantities, ban/restriction checks, leader restrictions, specified costs and current stored-rule qualification still need auditing before assembly. The target column names mechanics printed on the identified supporting cards; it does not claim those keywords are printed on the Leader. Release codes are used because this snapshot has no verified release-title metadata. The saved catalog predates the official BT5-119 World Peace correction: its scenario uses the current recorded erratum, energy cost **3 or less**, independent of current energy, rather than the stale catalog sentence.

## First wave: 16 decks

Seven booster releases, two decks each, plus the two existing starter controls. This prioritizes observed failures and the known blocker mechanisms before expanding historical coverage.

| Release | Proposed deck name | Leader (actual catalog name) | Target keyword/mechanic | Printed supporting cards | Why first |
|---|---|---|---|---|---|
| BT3 | Bardock — Great Ape cleanup | BT3-082 — Bardock | Blocker; combo-end Evolve | BT3-098 — Hidden Power Great Ape Fasha; BT3-096 — Hidden Power Great Ape Tora | Open combo-end/evolution follow-up |
| BT3 | Trunks — Over Realm return | BT3-108 — Trunks | Over Realm 3; Battle/deck→Warp self Auto | BT3-112 — Unrelenting Assault Trunks | Open movement-trigger follow-up |
| BT5 | Pilaf — Wish / Desire | BT5-002 — Pilaf | Wish; Dragon Ball; all-area Desire | BT5-024 — Oolong's Wish; BT5-119 — World Peace | Reviewed identity/World Peace regressions |
| BT5 | Black Masked Saiyan — Warp pressure | BT5-105 — Black Masked Saiyan | Burst 3; Critical | BT5-111 — Black Masked Saiyan, the Devastator | Distinct Black Saiyan archetype |
| BT6 | Gogeta — Br fusion | BT6-001 — Son Goku and Vegeta | Union-Fusion | BT6-012 — Veku, Contents Under Pressure | Fusion prerequisites and payment control |
| BT6 | Paragus — Broly recovery | BT6-053 — Paragus | Optional exact two-card payment; KO/removed Auto | BT6-062 — Broly, Berserker Origins | New full-or-decline payment regression |
| BT27 | Mechikabura — multiple attacks | BT27-092 — Mechikabura | Triple Attack; Deflect | BT27-093 — SS4 Vegito, Barrage | Recent native-keyword fuzz failure |
| BT27 | Piccolo — Namekian revival | BT27-045 — Piccolo | Revive Blue/Green; Energy-Exhaust | BT27-129 — Nail, Survival Strategy | Auto keyword price/order control |
| BT29 | Cooler — Squadron return loop | BT29-029 — Cooler | Swap 5; Battle→hand watcher | BT29-037 — Dore, Power | Open qualified-watcher follow-up |
| BT29 | Vegeta — Saiyan evolution | BT29-057 — Vegeta | EX-Evolve | BT29-064 — Vegeta, One-Man Army | Printed leader-name condition matches awakened leader |
| BT30 | Brianne — Maiden stack play | BT30-082 — Brianne De Chateau | Play onto; card name in skill text | BT30-084 — Support Broadcast | Existing stack-integrity/crash regression |
| BT30 | Super Saiyans United — red attacks | BT30-001 — Son Goku, Vegeta, & Trunks | Dual Attack | BT30-004 — SS Son Goku, Unmatched Power | Same-release comparison deck |
| BT31 | Gogeta — widened fusion | BT31-001 — Son Goku & Vegeta | Union-Fusion; Revenge | BT31-014 — SS Gogeta, Revoker of Evil | Leader-back fusion permission and native Revenge |
| BT31 | White Cell — reveal/evolve | BT31-116 — Cell | EX-Evolve; Dual Attack; Revealed/Hidden energy | BT31-129 — Cell, Perfect Form | White-card costs and visibility paths |
| SD5 | Crimson Saiyan starter control | SD5-01 — Golden Great Ape Son Goku | Swap 8; Barrier; Double Strike | SD5-03 — SSB Son Goku, at the Apex | Existing audited starter, full printed list source available |
| SD15 | Pride of the Saiyans starter control | SD15-01 — Vegeta | Spirit Boost 1; Dual Attack; Unison markers | SD15-03 — Son Goku, Spirit Boost Warrior; SD15-02 — SS Cabba, Spirit Resonance | Existing audited owner-amended starter; specified costs known |

The SD5/SD15 starting quantities come from the existing `scripts/arena-deck-audit.mts` lists. SD15 uses the recorded owner amendment (BT10-008 ×1, BT5-023 ×3); it must not silently revert to the older illegal printed quantity. Proposed booster decks can use appropriate older support cards where needed, while their featured Leader and mechanic cards remain explicit.

## Small scenarios to run before whole games

| Scenario | Printed anchor | Small setup and required observation |
|---|---|---|
| Wish and Desire | BT5-002 + BT5-024 / BT5-119 | Seven Dragon Balls enable Wish and the printed Desire recovery; six do not. All-area Desire identity survives source-area changes. World Peace uses its fixed energy-cost limit of 3 or less regardless of current energy; wrong Leader or cost-4 target is refused. |
| Exact-or-decline payment | BT6-062; BT3-109; SD8-03 | Fewer than N, exactly N and excess eligible cards; decline or accept; no partial movement/payoff; reload between picks. |
| Special combo-end evolution | BT3-098 / BT3-096 | Own turn, card used in Combo and actually moved to Drop at cleanup; optional correct Fasha/Tora base; successful stack and evolved-into payoff once. Other turn, no combo and diverted cleanup are negative controls. |
| Warp return | BT3-112 | Battle→Warp at Over Realm turn end and deck→Warp by a skill return the same copy to hand; hand/Drop→Warp and a replaced destination do not. |
| Qualified hand return | BT29-029 back #0 | Blue Armored Squadron card and blue Extra return from your original Battle Area; capture event-time identity; decline/full energy play and Rest-Mode energy follow-up; once-per-turn and wrong-side controls. |
| Fusion ingredients and expanded areas | BT6-012; BT31-001 back #0 + BT31-014 | Two correct named ingredients and matching printed power; missing/wrong ingredient refused. Gogeta Leader-back permission permits the printed expanded areas and correct destinations; unawakened/foreign Leader does not. |
| Multiple attack native Autos | BT27-093; BT30-004 | Triple/Dual Attack reactivation occurs after battle within its printed allowance; do not exceed the count, trigger before battle ends or require a nonexistent card-rule record for a bare native keyword. |
| Revenge and Blocker | BT31-014; BT7-081 | Surviving Revenge defender KOs the attacker after battle; a KO-before-resolution case follows the printed keyword rules; Blocker changes the legal guard once. Include reload at the battle boundary. |
| Revive payment | BT27-129 | KO, mandatory trigger timing, optional printed Blue/Green payment with enough/insufficient cards; no free revival or half-paid price. Track the same source copy and play counter window. |
| Swap transaction | BT29-037; SD5-03 | Correct named/trait/cost replacement in hand, full skill price, new play then old card returned; missing target and refused price leave state consistent. |
| Unison and Spirit Boost | SD15-02 / SD15-03 | Correct specified cost, marker change, Spirit Boost removal and its resulting Auto; insufficient marker, wrong Unison and unsupported price controls; save/reload before paying. |
| White energy visibility | BT31-116 / BT31-129 | Printed White Evolve requirement, energy switched to Revealed/Hidden mode, legality and information shown to each viewer; no hidden identities leaked in snapshots or UI. |
| Stack and text-referenced target | BT30-084 | The card named in a skill on the chosen Maiden card is selected from Warp and played onto that physical host; invalid name/area and missing host cases preserve one-place invariants. |

Each scenario needs independent expected results from printed text and the relevant manual/Q&A or recorded owner ruling. Whole games then supply integration evidence, with seed/action traces and complete/interrupted/action-limit/crash counts. Use forced scenarios to cover abilities the games never reach.

## Credits and opponent runs

Treat the reported $200 Anthropic credit balance as the total ceiling, not a spending target. Proposed staged caps: stop the pilot at 8 games or $20, whichever comes first; stop the first campaign at 40 games or $100 total (including the pilot), whichever comes first. Reserve $50 for regression work and $50 for future expansion. Start with free local scenarios and local-AI games in both seats over fixed seeds. Use selected Claude Opus games/reviews after qualification, retain reviewed action logs and relevant browser evidence, and stop at the per-stage cap. The API model and actual billing/credit applicability need coordinator verification before calls. No paid calls were made for this proposal.

## Release inventory and full main-booster proposal

The snapshot contains **BT1–BT31: 31 main-line booster release codes, 4,412 card definitions and 294 Leaders**. Two recipes per main-line release means **62 proposed booster decks**; with the two starter controls above, the initial programme expands to 64 decks. Only 16 enter the first wave. These 62 rows are planning targets, not a claim that all ingredients, prices or rules currently qualify. Each supporting-card mechanic was checked against actual printed text; colors and Leader/card identities were checked locally.

| Release | Pair A: Leader → supporting card → target | Pair B: Leader → supporting card → target |
|---|---|---|
| BT1 | BT1-001 **Champa** → BT1-004 Destructive Terror Champa → Evolve | BT1-056 **Son Goku** → BT1-066 Tenacious Vegeta → Revenge |
| BT2 | BT2-001 **Vegito** → BT2-012 Repeated Force Vegito → Union-Potara | BT2-035 **Trunks** → BT2-042 Trunks, The Constant Hope → Evolve |
| BT3 | BT3-082 **Bardock** → BT3-084 Desperate Warrior Super Saiyan Bardock → EX-Evolve | BT3-108 **Trunks** → BT3-110 Awakened Warrior Bardock → Over Realm 4 |
| BT4 | BT4-001 **Son Goku** → BT4-019 Saiyan Onslaught Kefla → Union-Potara | BT4-072 **Son Goku** → BT4-073 Bardock, the Progenitor → Swap 2 |
| BT5 | BT5-002 **Pilaf** → BT5-024 Oolong's Wish → Wish / Desire (Leader + supporting Extra) | BT5-105 **Black Masked Saiyan** → BT5-111 Black Masked Saiyan, the Devastator → Critical |
| BT6 | BT6-001 **Son Goku and Vegeta** → BT6-012 Veku, Contents Under Pressure → Union-Fusion | BT6-053 **Paragus** → BT6-062 Broly, Berserker Origins → Once per turn; optional exact payment |
| BT7 | BT7-025 **Son Goku & Vegeta** → BT7-039 Kale, Sister of Annihilation → EX-Evolve | BT7-075 **Caulifla & Kale** → BT7-081 Cabba, Undisguised Rage → Blocker; Revenge |
| BT8 | BT8-024 **Android 21** → BT8-038 Maleficent Technique Cell → Critical | BT8-067 **Super Baby 1** → BT8-083 Baby, Vengeful Upheaval → Union-Absorb |
| BT9 | BT9-002 **Cooler** → BT9-006 King Cold, Imminent Invasion → Blocker | BT9-053 **Jiren** → BT9-060 Jiren, Righteous Leader → Deflect |
| BT10 | BT10-002 **Pilaf** → BT10-025 Pilaf Machine, the Master Bot → Triple Attack | BT10-060 **Son Goku** → BT10-066 Intensive Training Son Goku → Barrier; Deflect |
| BT11 | BT11-001 **Gogeta** → BT11-013 Gogeta, Fusion of the Gods → Union-Fusion | BT11-092 **Garlic Jr.** → BT11-104 Garlic Jr., Overlord of the Dead Zone → EX-Evolve |
| BT12 | BT12-002 **King Piccolo** → BT12-018 King Piccolo, Time to Fight → EX-Evolve | BT12-056 **Turles** → BT12-068 Turles, Cosmic Rogue → Unique; Critical |
| BT13 | BT13-032 **Boujack** → BT13-046 Boujack, On a Rampage → Double Strike; Dual Attack | BT13-061 **King Cold** → BT13-077 Frieza, Revived and Reviled → Dual Attack |
| BT14 | BT14-002 **Jiren** → BT14-014 Jiren, Zenith of Power → EX-Evolve | BT14-062 **Majin Buu** → BT14-079 Majin Buu, Brilliant Absorption → Union-Absorb |
| BT15 | BT15-031 **Cabba** → BT15-047 SS Kefla, Unending Evolution → Union-Potara | BT15-061 **Son Goku** → BT15-066 Kaio-Ken Son Goku, Decisive Battle → EX-Evolve |
| BT16 | BT16-001 **Son Goku** → BT16-003 Golden Frieza & Android 17, Determined Tag Team → Empower | BT16-071 **Trunks** → BT16-075 SSB Son Goku, Future on the Line → EX-Evolve |
| BT17 | BT17-002 **Dr. Myuu & General Rilldo** → BT17-019 General Rilldo, Battle on Planet M-2 → Union-Absorb | BT17-032 **Gamma 1 & Gamma 2** → BT17-034 Dr. Gero, Abominable Creator → Empower |
| BT18 | BT18-001 **Son Goku & Vegeta** → BT18-019 SS4 Gogeta, Triumphant Together → Union-Fusion | BT18-089 **Bardock's Crew** → BT18-107 Bardock, Inherited Might → Revenge; Blocker |
| BT19 | BT19-035 **Son Goten & Trunks** → BT19-060 Gotenks, Reckless Rush → Union-Fusion | BT19-101 **Piccolo** → BT19-128 Son Gohan & Piccolo, Full-Power Training → Swap 8 |
| BT20 | BT20-023 **Android 18** → BT20-041 Android 18, Energy Wave → Double Strike | BT20-085 **Majin Buu** → BT20-090 Majin Buu, Two Hearts → Z-Stack 2 |
| BT21 | BT21-067 **Son Gohan** → BT21-069 SS2 Son Gohan, Trigger to Fierce Rage → Z-Awaken; Double Strike | BT21-101 **Frieza** → BT21-111 SSB SonGoku VS Golden Frieza, Spirit Clash → Swap 8 |
| BT22 | BT22-001 **Son Gohan** → BT22-010 Son Gohan, Ultimate Power of Legend → EX-Evolve | BT22-055 **Broly & Paragus** → BT22-058 SS3 Broly, Tyrant → Unique |
| BT23 | BT23-002 **Android 17 & Android 18** → BT23-006 Destroyed West City → Z-Stack | BT23-072 **Zamasu & Goku Black** → BT23-084 SSB Vegito, Resisting a God → Union-Potara |
| BT24 | BT24-001 **Vegeta** → BT24-014 Vegeta, Equalizer → Dual Attack | BT24-026 **Hirudegarn** → BT24-045 Hirudegarn, Center of Evil Energy → Blocker |
| BT25 | BT25-002 **King Piccolo** → BT25-020 King Piccolo, Restored Youth and Ultimate Evil Power → EX-Evolve | BT25-036 **Gotenks** → BT25-058 SS3 Gotenks, Energy Storm Explosion → Union-Fusion |
| BT26 | BT26-031 **Gogeta** → BT26-044 SSB Gogeta, Battle for Peace → Union-Fusion | BT26-091 **Cell** → BT26-109 Cell, Complete Terror → EX-Evolve; Critical |
| BT27 | BT27-092 **Mechikabura** → BT27-093 SS4 Vegito, Barrage → Triple Attack; Deflect | BT27-045 **Piccolo** → BT27-129 Nail, Survival Strategy → Revive Blue/Green; Energy-Exhaust |
| BT28 | BT28-079 **Vegito** → BT28-097 SS Vegito, Strongest Fighter in History → Union-Potara | BT28-056 **Tien Shinhan** → BT28-063 Tien Shinhan, Another Tough Battle → Dual Attack |
| BT29 | BT29-029 **Cooler** → BT29-037 Dore, Power → Swap 5 | BT29-057 **Vegeta** → BT29-064 Vegeta, One-Man Army → EX-Evolve |
| BT30 | BT30-082 **Brianne De Chateau** → BT30-084 Support Broadcast → Play onto; name-in-skill-text target | BT30-001 **Son Goku, Vegeta, & Trunks** → BT30-004 SS Son Goku, Unmatched Power → Dual Attack |
| BT31 | BT31-001 **Son Goku & Vegeta** → BT31-014 SS Gogeta, Revoker of Evil → Union-Fusion | BT31-116 **Cell** → BT31-129 Cell, Perfect Form → EX-Evolve; Dual Attack |

Some recipes intentionally exercise a supporting character rather than the Leader’s own archetype. They remain candidate testing shells; review every supporting card’s full text and ingredients before writing final quantities. For example, BT13-046 prints an unreadable `?` in its EX-Evolve price in this catalog; its row targets the clearly printed Double Strike/Dual Attack, and resolving the price input is a prerequisite to qualifying the complete deck. The local review cross-checked Leader IDs, colors, supporting IDs and printed skills. Before assembling a list, recheck against the current catalog and errata.

### Phasing after the first wave

1. Finish the first-wave blocker scenarios and assemble/qualify its 14 booster recipes plus two starter controls. Give each a meaningful saved name and a card/face/skill coverage ledger. Run local games in both seats before budgeted Opus games.
2. Add BT1–BT2, BT4, BT7–BT10 as the next **14 booster recipes**: core Evolve/Potara/Swap, Revenge, Extra/field/trigger controls and the transition to Unisons.
3. Add BT11–BT17 as **14 more recipes**, then BT18–BT26 and BT28 as **20 recipes**, retaining explicit missing inputs and capability gaps instead of forcing packs through qualification. This completes the 62 BT recipes.

### Starters and other product codes

The snapshot also contains **SD1–SD23** (23 Starter product codes, one Leader each). Keep starters separate from “two different decks per booster”: SD5/SD15 are the existing complete-list controls, then add the other printed starters in small audited batches. A starter code has only 5–10 unique catalog cards here, so its real full printed list includes reprints from other releases; the unique subset alone is not a 50-card deck.

| Additional code family | Available records / Leaders | Treatment |
|---|---|---|
| DB1 | 103 cards / 0 Leaders | Supplemental release card-pool scenarios/deck variants using a verified compatible existing Leader; this snapshot has no Leader for the code. |
| DB2 | 177 cards / 0 Leaders | Supplemental release card-pool scenarios/deck variants using a verified compatible existing Leader; this snapshot has no Leader for the code. |
| DB3 | 144 cards / 0 Leaders | Supplemental release card-pool scenarios/deck variants using a verified compatible existing Leader; this snapshot has no Leader for the code. |
| TB1 | 97 cards / 8 Leaders | Additional paired recipes after the BT first wave; select actual Leaders and verify product identity/list sources. |
| TB2 | 69 cards / 5 Leaders | Additional paired recipes after the BT first wave; select actual Leaders and verify product identity/list sources. |
| TB3 | 69 cards / 5 Leaders | Additional paired recipes after the BT first wave; select actual Leaders and verify product identity/list sources. |
| EB1 | 68 cards / 5 Leaders | Additional paired recipes after the BT first wave; select actual Leaders and verify product identity/list sources. |

EX01–EX25, XD1–XD3, P, M and token-only prefixes also exist. Their product identity is not established by this definition-only snapshot; do not automatically call every prefix a booster release or invent two new Leaders for leaderless products. Track their printed mechanics in the scenario ledger and add supplemental deck variants where appropriate. Release-name/product metadata can refine this inventory later.

For every release, two recipes are a minimum integration sample, not complete ability coverage. Unincluded or unexercised abilities remain named gaps in the ledger and get a small scenario or an extra deck. No catalog/database writes, final deck creation, paid calls or whole-game runs were performed to produce this proposal.
