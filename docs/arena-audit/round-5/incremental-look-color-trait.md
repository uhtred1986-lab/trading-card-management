# R534: twelve exact color-and-trait inspections

This separate slice follows R533 commit8256a88f, initially frozen WIP. Its retained original230-case native matrix later completed with exit0, recorded in a separate receipt follow-up; it was not restarted or retroactively assigned a commit hash. R534's dedicated native suite passes **918 cases** across twelve original ordinary played Autos. Pan BT31-043 is excluded for a separate Unison price/producer review.

## Source and pricing evidence

The fixture `incremental-look-color-trait-5.json` preserves all twelve complete source cards, no back faces, every frozen sibling row, all supplied FAQs, genuine matching target definitions, explicit image-backed source prices and official image URL/SHA-256. The worker and parent independently viewed the source images. Vados's own FAQs allow stopping early without declaring N and forbid inspecting unrelated Deck/Life cards. Other supplied FAQ objects are empty; this is not a broader FAQ absence claim.

| Exact row | Total energy | Specified energy | Required color and trait | Genuine target IDs |
|---|---|---|---|---|
| BT17-020#10 | 1 | Red 1 | Red + machine mutant | P-112, BT8-135 |
| BT27-083#10 | 1 | Yellow 1 | Yellow + frieza clan | P-331, BT17-140 |
| BT6-086#0 | 1 | Yellow 1 | Yellow + Saiyan | BT10-104, BT22-135 |
| BT27-075#0 | 1 | Yellow 1 | Yellow + fierce foe | BT27-088, BT27-140 |
| BT17-091#10 | 1 | Yellow 1 | Yellow + namekian | BT7-091, BT17-139 |
| BT27-018#10 | 3 | Red 1 | Red + saiyan | BT11-010, BT18-142 |
| BT1-009#0 | 3 | Red 1 | Red + Alien | BT17-027, BT14-145 |
| BT22-025#10 | 1 | Red 1 | Red + red ribbon army | BT22-022 |
| EX20-03#0 | 1 | Green 1 | Green + android | BT2-084, BT9-114 |
| BT31-132#0 | 1 | White 1 | White + android | BT31-131 |
| BT30-116#0 | 1 | None | White + king kai's planet | BT30-117 |
| BT30-090#0 | 1 | None | Black + universe 7 | BT30-086, BT30-141 |

Vados is3/Red1: the original image has one Red orb at the upper-right of the3, correcting the initial scratch review's tentative generic3 reading. BT27-018 Trunks is3/Red1 with a preserved Warp reduction sibling; ordinary BT6-086 Trunks is1/Yellow1. White Cell has a White orb. White Bubbles and Black Krillin have no specified orb, and native tests pay with Blue. All twelve source images show combo0+5000. Matching targets retain complete catalog identity/text but their unplayed cost/combo defaults are not independently verified pricing claims.

## Exact admitted lines

**BT17-020#10**

> [auto] When this card is played, look at up to 5 cards from the top of your deck, add up to 1 red ≪Machine Mutant≫ card among them to your hand, then shuffle your deck.

**BT27-083#10**

> [Auto] When this card is played, look at up to 5 cards from the top of your deck, add up to 1 yellow ≪Frieza Clan≫ card to your hand, then shuffle your deck.

**BT6-086#0**

> [Auto] When you play this card, look at up to 3 cards from the top of your deck, choose up to 1 yellow ≪Saiyan≫ card among them and add it to your hand, then shuffle your deck.

**BT27-075#0**

> [Auto] When this card is played, look at up to 5 cards from the top of your deck, add up to 1 yellow ≪Fierce Foe≫ card to your hand, then shuffle your deck.

**BT17-091#10**

> [auto] When this card is played, look at up to 5 cards from the top of your deck, add up to 1 yellow ≪Namekian≫ card among them to your hand, then shuffle your deck.

**BT27-018#10**

> [Auto] When this card is played, look at up to 5 cards from the top of your deck, add up to 1 red ≪Saiyan≫ card to your hand, then shuffle your deck.

**BT1-009#0**

> [Auto] When you play this card, look at up to 3 cards from the top of your deck. Choose up to 1 red ≪Alien≫ among them and add it to your hand. Then, shuffle your deck.

**BT22-025#10**

> [Auto] When this card is played, look at up to 5 cards from the top of your deck, add up to 1 red ≪Red Ribbon Army≫ card to your hand, then shuffle your deck.

**EX20-03#0**

> [Auto] When this card is played, look at up to 5 cards from the top of your deck, add up to 1 green ≪Android≫ card among them to your hand, then shuffle your deck.

**BT31-132#0**

> [Auto] When this card is played, look at up to 5 cards from the top of your deck, add up to 1 white ≪Android≫ card to your hand, then shuffle your deck.

**BT30-116#0**

> [auto] When this card is played, look at up to 5 cards from the top of your deck, add up to 1 white ≪King Kai's Planet≫ card to your hand, then shuffle your deck.

**BT30-090#0**

> [auto] When this card is played, look at up to 5 cards from the top of your deck, add up to 1 black ≪Universe 7≫ card to your hand, then shuffle your deck.

## Kernel and record boundaries

The sole runtime edit is the filter gate in `vm/incremental-look.ts::requireShape`: active colors require an actual array containing exactly one recognized positive non-Colorless color, exactly one nonempty trait, and no characters. All other active fields still refuse. Empty/absent colors preserve the existing empty, character-only and trait-only shapes. `validateProgram` still runs first; malformed numeric/non-array traits refuse before array/trim use. Color-only, two colors/traits, color+characters, notColors, monoColor, multiColor, originalColors, exactColors, cost, type and unknown color values remain outside the scope.

`frozenEligible`, `equivalentCandidates`, original source capture and all publication/view/resume hooks are unchanged. Positive colors use membership, so a Red/Yellow card can satisfy Red. Trait identity remains whole and case-normalized. The effective ordered candidate set must equal the frozen printed-definition set before phase completion/chooser publication, saved preask/view and answer. Completed consumed receipts retain their historical handling. No host, interpreter, index, snapshot, UI or other VM file changes.

Every exact candidate's whole original row differs only in optional-look and derived narration. All siblings remain byte-equivalent in the full-record assertions: Rilldo/Piccolo Union-Absorb, Meta-Cooler Counter/up-to100 Combo, Turles paid discard watcher, Hedo conditional power/Active attack, Android17 under-Leader Main, Cell Drop removal/discard, Bubbles under-Serpent Road Combo, Krillin Drop Combo, and Trunks's cost reduction/Main. Ordinary paid Hand play does not newly prove those specialized producers.

The Cheelai shape-contract negative formerly rejected one color plus one trait, which is exactly the new approved capability. Only that negative changes to two colors; all other Cheelai checks and its53-case count remain. New explicit one-color/trait positives and malformed trait controls cover the reviewed extension. No source receipt or dynamic eligibility safeguard was relaxed.

## Native acceptance

The918 cases comprise nine sources77 each and Hedo/White Cell/Bubbles75 each (one genuine target instead of mono+multicolor alternatives). Both seats use real paid Hand play and the original free pending Auto with its exact stored script. The controlled initial50-copy filler deck and staged energy/ordered Deck are explicit mechanism fixtures, not legal tournament deck claims.

Each printed one-color price is paid by its required color; Vados and BT27-018 pay one Red plus two Blue, proving3 total and only1 specified Red. Trunks has no Saiyans in Warp, so the reduction is inactive. First-player setup has no energy marker; wrong-color or insufficient-energy menus and forged direct plays refuse without mutating input. Bubbles/Krillin pay Blue, Cell pays White. Complete source definitions and all original siblings are loaded throughout.

Per source: stop0/1/fullN, choose0/1, final nonmatching face before Continue, exact ordered private prefix, unchanged Deck/RNG during Next, selected filtered Hand reveal and final shuffle, short Deck and ordinary empty-Deck loss, JSON replay/input purity, forged/unseen/nonmatching choices, saved postactivation source departure, case-normalized whole-trait Extra matches, wrong-color and Colorless nonmatches, and positive multicolor matches. Genuine mono/multicolor target alternatives are exercised when supplied; the explicit MULTI definition is a labeled synthetic mechanism control, including for the three sources without a selected genuine multicolor target. Near-match maximum/color/trait/tail/producer lines remain unadmitted. Paired stop0 loop variants publish no chooser.

Dynamic controls begin with native original-source activation, then use labeled identity-effect interventions. Gaining the required color on an inspected wrong-color card, or gaining the required trait on an inspected wrong-trait card, produces exactly an interrupted outcome before chooser publication. Input, zones, resources and RNG stay unchanged; no Hand move/shuffle occurs. Both terminal boardView and full Snapshot remain projectable and hide all inspected IDs/names. The corresponding changes after a saved chooser refuse on view, preask and answer. An unrelated extra color/trait/character gain followed by expiry preserves eligibility and succeeds. This does not claim arbitrary removal of a printed color through the gains API; direct definition mutation is tested separately as immutable-source corruption.

Each source also has21 malformed/unreviewed shape controls, an authenticated positive original conjunction, and stored-program positives for []/absent colors with its lone trait. These are kernel contracts, not extra printed card admissions. Missing source receipt and changed immutable color definition refuse.

Opponent boardView/full Snapshot/events/beats never show private inspection or unseen faces. Only the selected filtered Hand occurrence is shown through the existing authenticated event alias, without physical/decklist ID; the later ordinary opponent Hand projection remains hidden. RM20-12, RM3-1-7, RM5-2-7 and RM5-3-1 supply the rule basis.

## Verification and remaining scope

Dedicated native suite:918 pass. Compatibility passes: Gohan/Trunks48, saved/empty contracts86, language22, Babidi29, Cheelai53, ordinary played422 and public move projection28. Final TypeScript, touched-file ESLint, whitespace and rulings checks pass (305 worker rulings,172 cited; the parent has separately integrated work). Only formatting and removal of an unused import followed the918-case run; no native assertions or production behavior changed. The separately retained R533 full matrix completed230 cases against its original loaded kernel, and is not rerun merely to duplicate its expensive proof here; parent owns its final combined-head run with R534. No database, dependency installation, full scan, full gate, build, push or runner/registry edit was performed here.

Pan's Green orb count is still unconfirmed from the small official image. Its real X-cost Unison payment/marker/pending producer requires separate proof; its frozen marker-X Main is also still unread. This twelve-Battle slice neither admits Pan nor marks that entire card supported. Bio-Man remains a separate owner/source identity review.

## Integrated catalog comparison

The coordinator compiled the complete frozen catalog after integrating R534 at `f77308f9`. Compared with the R533 snapshot, exactly the twelve intended skill records change, each only in `ops` (the initial look gains `upTo: true`) and derived `reads`. The other **13,954 complete records and their field sets are identical**, including all sibling skills. Totals remain **6,597 cards / 13,966 records / 13,032 readable / 934 unread**. Snapshot SHA-256: `72c862d822402206ec3e912dc18032ce2f73e11b6b5bcb9088345dc64a13ea47`.

The suite is registered in the main arena runner. The historical-filter refusal retains its stable capability ID with its reviewed new AST signature; the inventory remains 277 sites. Integrated R534 TypeScript, focused lint, whitespace and ruling verification (306 rulings, 172 cited) passed. Later standing read-scope integration has its own verification and does not alter compiler records. The combined full gate remains pending.
