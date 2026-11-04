# Chosen keyword negation follow-up (4 Nov 2026)

Bounded follow-up to notes-S: BT2-048#0 and DB1-093#20 now require choosing one available keyword. “Up to 1” still offers None. The optional `mandatory` field preserves absent/false stored rules and survives primitive lowering in both rulesets and language round-trips. Larger-count keyword-negation pairs are refused before generic card choice can misread them; supported “choose all keyword skills” remains supported.

R-400 records RM 5-2-3/4/6 and 9-1-5. R-401 records official Q&A BT2-048, DB1-093 and BT6-057: a keyword on a Barrier card can be chosen, including Barrier itself, because the skill is chosen. No matching official errata exists. Barrier bypass is local to this operation, including legacy stored operations; normal card choices retain their ruleset protection, and beNegated prohibitions still apply. This runtime correction can change play without changing a corpus reading. Fusion has no Barrier hook; both games still test macro lowering and the operation contract.

## Remaining documented defect

Those same Q&As require only one instance of a keyword to be negated and allow a newly granted instance afterwards. Current chosen negation still executes name-wide suppression, incorrectly silencing duplicate copies and later grants. This batch does not make that family fully correct or refuse those cases. Next work should connect the chosen menu and negation effect to instance identity: `keywordInstancesInForce` in `vm/program.ts` already tracks timed `grantEffectId` and `standingGrantId`, but `printedKeywords` drops printed skill index and chosen negation currently reaches name-wide `keywordNegatedFor`. Preserve source/index identity through the menu, saved frame and timed effect before changing that behavior. BT22-037#0's follow-up “it gains that skill” remains unread.

## Evidence

`audit-keyword-negation-4` uses isolated fixture definitions and stored rules: 72 runtime combinations cover alias/primitive, both games, absent/false/true, both seats, selecting Barrier and Blocker, exact/optional legal menus, forged decline rejection, JSON reload, no candidates, negation prohibition, immutable input operations and duration cleanup. Compiler controls cover mandatory real cards, optional BT6-057, unsupported counts and the supported all-keyword form.

Baseline snapshot: `/tmp/arena-round4/catalog.json`, compiled on main `1d3962e4` into `/tmp/arena-round4/before.json`. Final artifacts: `/tmp/arena-keyword4/after.json` and `diff.md`. Batch checks and corpus results are recorded with the commit handoff; no production data is changed.
