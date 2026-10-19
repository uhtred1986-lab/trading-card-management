# Rules backlog reconciliation — 19 October 2026

Reviewed implementation: main `48dd48e3`. Changes in this reconciliation are
documentation and issue metadata only; no application code, database, deployment
settings, dependency, schema or saved game changed. No paid calls ran.

## Backlog result

Eleven existing issues reconciled: #637, #827, #897, #899, #900, #906, #907, #923,
#929, #930 and #932. No new issue or milestone. #827 gains its missing local copy
and belongs to existing O5 milestone 22. #899/#827 are expansion/evaluation work,
not immediately ready implementation assignments.

#907 is the rules queue; #897 owns exact-program qualification and the next pair;
#923 owns the Union evidence matrix; #899 owns fresh strength evaluation; #906
owns the separately gated paid comparison. Union is the first reference family
for completing the existing typed rule boundary, preserving its three procedures.

[Original public issue bodies](issues-before.json) preserve the requirements and
historical dispatch text. [Current plan](../../../arena-rules-delivery.md) defines
bounded exits and the distinction between regressions, exposed old misreads and
source/application drift. Historical handoffs point to that plan.

## Validation

Node 24.19.0; `DATABASE_URL` removed for every application check. These commands
ran once on main application code `48dd48e3` with the documentation changes:

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass, zero errors; five existing warnings in prototype scripts |
| `npm test` | Full chain passed, including `verify-arena` 150/150, PGlite, policy/privacy, Worker/recovery, local board, rule refresh and progress tests |
| `npm run build` | Pass, production build and static generation complete |
| `tsx scripts/verify/backlog.ts` | Pass |
| Changed issue files through `parseIssueFile` / `missingSourcePaths` | All eleven pass; issue IDs, area/phase/model labels and source paths verified |
| Local Markdown links and `git diff --check` | Pass |
| `tsx scripts/sync-arena-backlog.mts --check` | Blocked before GitHub comparison by existing `917.md: front matter lacks 'stage'`; changed files checked directly instead |

The broad backlog parser problem is not caused or fixed by this reconciliation.
Full-suite passing results do not certify every catalog rule, qualify private
decks, or constitute fresh policy holdouts. No compiler/engine change was made,
so no new live fuzz, contract emission or catalog refresh was needed.

## #932 closeout

- [#989](https://github.com/uhtred1986-lab/trading-card-management/pull/989)
  records the 31 trait-only / 52 character-only inventory, shared filter, glossary,
  keyed corpus delta, positive/negative printed-card and stored-rule tests.
- [Application receipt](https://github.com/uhtred1986-lab/trading-card-management/issues/932#issuecomment-6243440584)
  records the guarded 25-row refresh, zero pending on recheck and 40 completed
  fuzz games, with five unrelated unread rows excluded and protected rules retained.
- The only remaining gate explicitly named by that closeout was full tests/build
  on integrated main. The passing commands above complete it. #932 is closed;
  no fix was reimplemented and no stored record was rewritten here.

#929 and #930 remain open for their residual acceptance, #923 for its full audit,
#897 for stored-program qualification/additional pair, and #899 for fresh holdouts.
Their continued open state is not evidence that their delivered implementations
are missing. #826 and #898 remain closed, and the #793 device-test waiver stands.
