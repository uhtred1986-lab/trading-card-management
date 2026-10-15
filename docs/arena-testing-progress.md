# Arena testing progress

The persisted progress page is **Arena → Testing & stats** (`/arena/testing`, admin access).
It contains 64 proposed deck recipes and 55 scenarios, editable progress/evidence,
actual-deck links, manually recorded results and separate server Arena statistics.
This file is the planning/evidence index for #827; live progress belongs in the portal.
Update evidence only after review, not merely because a deck compiles or a game finishes.

- [Complete deck proposal: two per BT1–BT31, plus starters](arena-proposed-decks.md)
- [24 scenario families, run limits and cost validation](arena-deck-coverage-plan.md)
- [General local-AI strategy benchmarks and promotion protocol](arena-strategy-validation.md)
- [White Cell: rule and opponent decision checks](arena-white-cell-validation.md)
- Known current-deck rule gaps: #825. Stronger local opponent: #826.

## Status at this handoff

| Item | Status | Evidence / next step |
|---|---|---|
| Release/Leader/mechanic proposal | Prepared | 62 booster candidates; 16 first-wave decks including two starter controls. |
| Final new deck quantities and legality | Pending | Check restrictions and required support before assembly; candidate recipes are not accepted decks. |
| Existing starter controls | Existing audited baseline | SD5/SD15 source lists and named proofs in `arena-offline-deck-audit.md`. |
| Small scenarios | Planned, existing proofs reusable | 24 rule families, 12 general strategy benchmarks, 12 White Cell rule cases and 7 White Cell strategy cases; exact variants remain to be built. |
| Combined PR #824 code gates | Passed | Integrated typecheck, lint, full tests and production build; isolated browser persistence/filtering checks at 390/1440 widths. |
| Broad stored-rule diagnostic sample | 39/40 complete; one known interruption | `arena-backlog/evidence/backlog-completion/captured-fuzz-summary.json`; SD13-05 repair approved. Not an ability coverage claim. |
| New bounded local search | Evaluated; not promoted | 41–39 over 80 held-out games; no justified stronger-difficulty claim. |
| Opus cost rate and account credit validation | Pending | Existing static price table is not current billing verification. |
| Opus pilot | Not started | 0 paid comparison games; $0 campaign spend. Suggested 8 games / $20 cap. |
| Full Opus campaign | Not started | Suggested 40 games / $100 total cap, inclusive of pilot. |
| White Cell strategic effectiveness | Unproven | Dedicated rule and decision checklist below; readiness is not strategy evidence. |
| Rename discoverability | Planned | Naming already works; visible access from title/game picker belongs to #827. |

## First-wave deck progress

Every new recipe starts at **proposal**. “Baseline proof” means reusable evidence
exists for that mechanic, not that the complete new deck or every ability passed.
No first-wave Opus game has run.

| Release | Deck / Leader ID | Target | Current evidence or blocker | New list / scenario / local run / Opus |
|---|---|---|---|---|
| BT3 | Bardock — Great Ape cleanup (BT3-082) | Blocker; combo-end Evolve | Combo-end Evolve gap #825 | Proposed / pending mapping / not run for this recipe / not run |
| BT3 | Trunks — Over Realm return (BT3-108) | Over Realm 3; Battle/deck→Warp self Auto | Warp self-trigger gap #825 | Proposed / pending mapping / not run for this recipe / not run |
| BT5 | Pilaf — Wish / Desire (BT5-002) | Wish; Dragon Ball; all-area Desire | World Peace and identity regression proofs | Proposed / pending mapping / not run for this recipe / not run |
| BT5 | Black Masked Saiyan — Warp pressure (BT5-105) | Burst 3; Critical | New printed-card cases pending | Proposed / pending mapping / not run for this recipe / not run |
| BT6 | Gogeta — Br fusion (BT6-001) | Union-Fusion | Union-Fusion baseline proof; new deck pending | Proposed / pending mapping / not run for this recipe / not run |
| BT6 | Paragus — Broly recovery (BT6-053) | Optional exact two-card payment; KO/removed Auto | Optional exact payment proof in #824 | Proposed / pending mapping / not run for this recipe / not run |
| BT27 | Mechikabura — multiple attacks (BT27-092) | Triple Attack; Deflect | Native Triple Attack proof in #824 | Proposed / pending mapping / not run for this recipe / not run |
| BT27 | Piccolo — Namekian revival (BT27-045) | Revive Blue/Green; Energy-Exhaust | Revive baseline; target-card mapping pending | Proposed / pending mapping / not run for this recipe / not run |
| BT29 | Cooler — Squadron return loop (BT29-029) | Swap 5; Battle→hand watcher | Qualified hand-return watcher gap #825 | Proposed / pending mapping / not run for this recipe / not run |
| BT29 | Vegeta — Saiyan evolution (BT29-057) | EX-Evolve | Evolve baseline; target-card mapping pending | Proposed / pending mapping / not run for this recipe / not run |
| BT30 | Brianne — Maiden stack play (BT30-082) | Play onto; card name in skill text | Stack/name-target regression exists | Proposed / pending mapping / not run for this recipe / not run |
| BT30 | Super Saiyans United — red attacks (BT30-001) | Dual Attack | Native attack baseline; new deck pending | Proposed / pending mapping / not run for this recipe / not run |
| BT31 | Gogeta — widened fusion (BT31-001) | Union-Fusion; Revenge | Union areas proof; approved stored-row refresh | Proposed / pending mapping / not run for this recipe / not run |
| BT31 | White Cell — reveal/evolve (BT31-116) | EX-Evolve; Dual Attack; Revealed/Hidden energy | Existing deck 29 gate accepted; targeted strategy unproven | Proposed / pending mapping / not run for this recipe / not run |
| SD5 | Crimson Saiyan starter control (SD5-01) | Swap 8; Barrier; Double Strike | Audited SD5 starter control | Baseline list / mapping pending / baseline evidence / not run |
| SD15 | Pride of the Saiyans starter control (SD15-01) | Spirit Boost 1; Dual Attack; Unison markers | Audited owner-amended SD15 starter control | Baseline list / mapping pending / baseline evidence / not run |

## Evidence recorded for each completed item

Record deck revision and quantities, engine/rule revision, card/face/skill IDs,
scenario ID and expected assertion, seed and seats, replay path, outcome and reviewer.
For games record actual fired skills, paid/declined costs, target choices and
interruptions. An unexercised ability stays pending even if its deck wins.

For Opus add exact model/rate-sheet revision, request IDs, token categories,
per-game spend and cumulative spend. Keep run traces private where they contain
player deck or hidden-state data; link a public aggregate summary here.

## White Cell progress

The current owner deck named White Cell was accepted by the existing readiness gate
and appeared in the random-game sample. Neither establishes that its full printed
engine behavior is correct or that either opponent uses it well. The proposed
BT31-116 recipe is not yet assembled and has no Opus result.

Use the [dedicated White Cell checklist](arena-white-cell-validation.md) to separately
mark **rule scenario passed**, **local policy decision passed**, **Opus decision
observed**, and **paired full-game result**. A strong explanation alone is not a
pass: the selected legal action sequence and resulting resources must demonstrate
the tactic. Independent expected rule outcomes come from printed text/manual/rulings,
never from asking Opus to grade itself.
