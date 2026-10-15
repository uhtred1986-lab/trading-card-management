# Masters unread-rule audit — 15 October 2026

[Consolidated repair issue #907](https://github.com/uhtred1986-lab/trading-card-management/issues/907) · [Rules milestone 32](https://github.com/uhtred1986-lab/trading-card-management/milestone/32) · [Complete card checklist](cards.md) · [Machine-readable audit](audit.json)

The live census found **1,714 cards / 1,985 skills** with unread clauses. A reviewed targeted refresh fixed **22 skills on 22 cards**, leaving **1,694 cards / 1,963 skills**. Twenty cards lost their last unread skill; two still have a different unread skill. These are compiler drafts, not approvals. The remaining 1,694 catalog entries include 40 Energy Markers; excluding those markers, **1,654 non-marker cards** still have unread skills.

| Measure | Before | After |
| --- | ---: | ---: |
| Masters catalog cards | 6,552 | 6,552 |
| Fusion World cards (excluded from Arena) | 2,064 | 2,064 |
| Stored Masters skill records | 13,615 | 13,615 |
| Open/unread skills | 1,985 | 1,963 |
| Draft skills | 11,568 | 11,590 |
| Corrected / confirmed | 57 / 5 | 57 / 5 |
| Cards with unread skills | 1,714 | 1,694 |

The snapshot also covered all 29 saved decks: none of their cards had unread stored clauses. This is a narrow statement about unread text; runtime gaps such as missing triggers and strategic mistakes remain separate. No private deck names, lists or owner identifiers are published.

## What was checked and repaired

A single live read captured the app’s catalog, persisted rules and deck membership. The app-specific pooled database was selected from Vercel and verified by `to_regclass('public.card_rules')`; the environment’s unrelated DATABASE_URL was not used. Credentials and private snapshots remain outside the repository.

Offline compilation of all 6,552 Masters cards at `e486c64b` had no exceptions and no missing expected stored skill records. All 1,985 affected skills were compared with current compilation. Thirty-one now compile without unread clauses; 22 had exact matching printed text, no named runtime gap or contextual support warning and were individually compared with their fresh reading, costs and condition. They were refreshed using the existing `applyReviewedRefresh` compare-and-swap helper, then read back. Printed text, source and explanation were preserved; versions increased by one and status became draft. The reviewed categories are summed-cost/power targeting, activation taxes, mixed Leader/Unison targeting, token creation and specified-cost/marker follow-up. Existing printed-card/manual-based evidence includes `scripts/verify/wordings.ts`, `grouped-readings-573.ts`, `activation-taxes-677.ts`, `activate-battle-alt-742.ts`, `duration-shuffle-574.ts` and the full rules-engine suites. Manual basis includes 20-1 (area defaults), 20-14 (unless/additional price) and 20-16 (conditional follow-up); no new card-specific official Q&A was fetched.

[Refresh receipt](refresh-receipt.json) records the exact card/face/skill IDs and versions. Post-write comparison found **85 owner- or Claude-owned records unchanged**, **13,593 untargeted programs unchanged**, and no unexpected changes. Eight unrelated promo records received only the owner-requested explanation via `arena:rule`.

## Findings requiring engineering or owner input

- **Held clean parses:** P-616/front/20, BT7-040/front/10, BT7-083/front/10, BT7-086/front/10, BT3-090/front/0, DB2-177/front/40, EB1-68/front/10, EX19-01/front/10 and BT26-119/front/10 remain unchanged. Runtime/context warnings and semantic review prevent blanket refresh. Their full evidence is in audit.json.
- **Confirmed wrong reading:** P-616 requires a total of seven or more `<GT>`-named cards across energy, Z-Energy, Battle and Drop, but fresh compilation reads one or more in energy. Preserve the unread record until an exact multi-area threshold fixture and negative boundary prove the repair. A clean parse is insufficient.
- **Owner decision received:** P-514–P-516 and P-588–P-592 print “You and your opponent compliment each other.” The owner chose **show a compliment, then acknowledge the instruction**. This ruling is saved on all eight records. Visible implementation and an acknowledgement scenario are still open; no empty program was substituted.
- **Classification review:** 40 Energy Marker records are tagged `dbs` and included in the raw unread count. Verify product/catalog classification and how marker instructions should be represented before excluding them or inventing card effects. This audit did not change game tags.
- **Remaining engineering queue:** the other unresolved records are indexed by full printed face/skill and unread clauses. Their complete semantics have not all been individually adjudicated. Shared wording/mechanism buckets are triage hints, not authoritative diagnoses; do not ask the owner to interpret every parser gap.

## Shared-shape triage

The remaining skills contain **3196 unread clause occurrences across 2,212 normalized shapes**. Existing classifier hints include:

| Existing classifier hint | Clause occurrences |
| --- | ---: |
| phrasing only | 2243 |
| energy manipulation | 175 |
| prohibition | 150 |
| delayed effect | 144 |
| search a secret area | 87 |
| replacement effect | 85 |
| cost change | 69 |
| count-based amount | 57 |
| cards under cards | 41 |
| keyword not implemented | 39 |
| skill negation | 35 |
| static in other areas | 28 |
| reveal / look at | 18 |
| targeting protection | 12 |
| modal choice | 11 |
| turn structure | 2 |

These are clause occurrences, not distinct cards or verified engineering diagnoses. In particular, “phrasing only” is the classifier’s fallback when no named regex matches; it does not prove a wording-only repair is safe or that runtime support exists. Review the full skill when fixing a common fragment such as “draw 1 card” or “If you do,” because preceding conditions, choices and costs may be the actual blocker.

## Repair order and acceptance

1. Keep the currently qualified starter controls playable; prioritize any newly requested deck and #827 release pairs over bulk catalog percentage.
2. Fix P-616’s unsafe condition and the bounded held cases before applying any further clean-parse refresh. Implement the eight social promos from the recorded owner ruling.
3. Review repeated shapes in audit.json and fix the compiler pattern once, with real printed-card positive/negative cases. Keep each affected card’s checklist/evidence current. Inspect full skill costs, triggers, sources, follow-up and area restrictions.
4. For semantics, check printed text, the manual and official Q&A; if no ruling exists say so. Only ask the owner for a real unresolved ruling or missing input.
5. Refresh only reviewed compiler-owned open/draft records through supported guarded paths; never rewrite confirmed/corrected/user/Claude programs. Keep unread, runtime support, review status and test evidence distinct.
6. Update glossary alongside compiler behavior, diff readings/gaps, run the required local checks and retain exact scenario/replay evidence. A game win cannot close a skill’s correctness acceptance.

The delivered #830/#831 guided review workflow is the base. Any further UI work should add useful grouping, context and a direct queue link rather than create a second editor or require manual per-card busywork.

## Final local validation

TypeScript, lint (five pre-existing prototype warnings), all 91 pure rules-engine suites, full `npm test` and production build passed. Tests/build ran with DATABASE_URL unset. Audit cardinalities and card-type totals were checked, and all twelve new issue bodies/metadata were compared with their canonical files. The repository-wide backlog drift tool stops on existing `848.md` missing `stage`; this does not affect the direct checks of these twelve files. No UI, engine or policy code changed. See [validation.json](validation.json).
