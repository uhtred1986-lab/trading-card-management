# #897 additional pair baseline — 19 October 2026

## Selected pair

Select the prepared BT6 pair from #827:

- **BT6 — Gogeta / Br fusion**, Leader BT6-001 (`bt6-001-gogeta-br-fusion`)
- **BT6 — Paragus / Broly recovery**, Leader BT6-053 (`bt6-053-paragus-broly-recovery`)

This is the only same-release pair in the 17-list prepared corpus that is both
catalog-legal in its captured app catalog and available as a public authored
recipe. It gives a bounded payment-focused increment: Gogeta's Union-Fusion
activation and the BT6-062 optional exact-two-card payment, with the adjacent
Broly recovery/target-in-hand sequence. These are separate mechanics; the second
recipe is a useful payment/control contrast and does not itself prove Union.
Both recipes were already named first-wave priorities in #827, so this selection
does not add or invent a recipe.

`additional-pair.json` is the two-entry `--decks` input shape accepted by
`scripts/arena-corpus-freeze.mts`: one Leader, 50 expanded main-card IDs, and an
empty Z list per recipe. It preserves all copies and quantities from the source
recipe file. The two source list hashes are `7c929f18ca6126f6f7d64897d2155b1d3b60d792fdc1ebfcf72f0d313c991501`
and `9e5f0b951adceb2ea564b8952981bfd7b370bde591c02da4e33b0de41f540ea2`.

Exact captured main-deck quantities:

| Gogeta / Br fusion | Copies | Paragus / Broly recovery | Copies |
| --- | ---: | --- | ---: |
| BT6-012 | 4 | BT6-062 | 4 |
| BT6-013 | 4 | BT6-063 | 4 |
| BT6-003 | 4 | BT6-060 | 4 |
| BT6-004 | 4 | BT6-061 | 4 |
| BT6-005 | 4 | P-136 | 4 |
| BT6-007 | 4 | BT6-059 | 4 |
| BT6-008 | 4 | BT6-064 | 4 |
| BT6-009 | 4 | BT6-065 | 4 |
| BT6-011 | 4 | BT6-066 | 4 |
| BT6-015 | 4 | BT6-067 | 4 |
| BT6-006 | 4 | BT6-068 | 4 |
| BT6-010 | 4 | BT6-069 | 4 |
| BT6-014 | 2 | BT6-070 | 2 |
| **50 total** |  | **50 total** |  |

## Pinned public sources and inputs

- Exact recipes, quantities, list hashes, app-catalog legality, ingredients,
  named compile gaps, and `inputGaps: []`: [`src/lib/arena/testing/prepared-recipes.json`](../../../../../src/lib/arena/testing/prepared-recipes.json), captured at `2026-10-15T02:16:02.092Z`, source commit `b7fcf2237b9a6c6875772d2ae97f0a3cf1731efe`, SHA-256 `9ec32d4622d42140516447ee5325d731815a4adfc259b91feb4f916b6067b3c4`.
- Prepared-list receipt: [`evidence/827/prepared-lists/receipt.json`](../../827/prepared-lists/receipt.json), SHA-256 `94a9809f7116380dbbf7236440b043f64e77dcd007d0817ce96e57055bf06338`. It reports all 17 as draft and unqualified; both viewports report 17 lists, and neither reports a qualification run.
- The 15 October Union text/record inventory is [`evidence/923/inventory.json`](../../923/inventory.json), source snapshot `2026-10-15`, baseline compiler commit `15487afd`, SHA-256 `133344b946883ab47be06bd1ddf1c1f6ec4f0abca1aec80fa13a56dad63fd3a3`. It is an evidence inventory, not the full `CatalogCard[]` snapshot expected by the corpus runner.
- The corpus runner's committed catalog input is [`evidence/649/catalog-subset-2026-10-13.json`](../../649/catalog-subset-2026-10-13.json), SHA-256 `49c8271093a836849b37decbffc03da964980dd349d79d8b28a11a21a85a24c6`. It contains only the two SD starter controls' card pool (including BT6-010 and BT6-011), not the selected pair's full list. It cannot support offline admission for these recipes. No new/live catalog source was fetched for this baseline. Therefore the exact recipe inputs are pinned, but a complete frozen catalog input and stored-rule export for these lists are absent; the pair cannot yet be admitted by `arena-corpus-freeze.mts`.
- `additional-pair.json` expands only these public recipe IDs and quantities; the recipes are authored proposals, not official tournament lists or private owner decks.

The app-catalog legality result is not an independent check against the current
official restricted-card list. The recipes have 50 main cards each, zero Z cards,
no captured app-catalog legality issues, no missing recipe-declared ingredients,
and no recipe-declared input gaps. This says the list records have their stated
inputs; it does not show that all printed skills have current executable records.

## Baseline blockers before qualification

### Recipe/source blockers

- **BT6 Gogeta:** the recipe's captured compiler-gap list includes BT6-001,
  BT6-012, BT6-013, and BT6-015. Specifically, BT6-001 back has unread
  `it's your turn`; BT6-012 and BT6-013 each retain unread Drop-area selection
  and add-to-hand clauses; BT6-015 has unread colour clauses. The recipe says
  Union-Fusion and the full recipe remain unqualified.
- **BT6 Paragus:** the captured compiler-gap list includes BT6-053 front/back;
  both retain the Life-to-hand restriction clause. Its note says the exact-two
  payment, optional decline, and target-in-hand cases remain unqualified.
- Both prepared recipes say `qualification: Not run`. No stored program source,
  hash, row version, engine revision, seed, or match result is pinned for these
  lists in this baseline. The recipes' capture-time clean/illegal catalog status
  cannot replace the stored-program gate in #897.
- Current stored rows cannot be reconciled from this public baseline. No private
  deck export, replay, database query, or production write was used.

### Inputs a future qualification run still needs

The public `prepared-recipes.json` has the exact deck lists and per-recipe gap
metadata, but it does not contain the full catalog records needed by the runner.
The runner's default catalog path (`docs/arena-backlog/evidence/649/catalog-subset-2026-10-13.json`)
does not cover these decks. A complete public/catalog input snapshot for all
leaders and main-deck cards, plus the exact stored-rule export after provenance
work, must be separately pinned before qualification. These missing run inputs
are distinct from the semantic/compiler gaps above.

## #825 eight-target reconciliation

PR #834 delivered the compiler/engine changes and focused evidence for all
eight #825 targets. The later public records do not all agree on the stored-row
application status. The exact per-target evidence is:

| Target | Code delivery | Later application receipt / dated readiness evidence |
| --- | --- | --- |
| BT29-029 back #0 | PR #834 / `docs/arena-backlog/evidence/825/` | #907's 17 Oct 15:43 receipt explicitly says rule row 9829 for BT29-029 back #0 was written after owner approval ([comment 6235968236](https://github.com/uhtred1986-lab/trading-card-management/issues/907#issuecomment-6235968236)). The checked-in `rule-refresh.json` instead records BT29-029 **back #10**, a different skill. The later #825 comment at 21:40 says repo receipts did not prove back #0 and cites readiness that still lists BT29-029 blocked ([comment 6241581216](https://github.com/uhtred1986-lab/trading-card-management/issues/825#issuecomment-6241581216)). Record this as conflicting application evidence; no current stored-row readback is available here. |
| BT3-112 front #10 | PR #834 | The 17 Oct readiness snapshot at deployed commit `1996255e` lists BT3-112 blocked. No later public application receipt names this exact target; the 18 Oct batches do not list it. Current freshness is unverified. |
| BT3-096 front #10 | PR #834 | The 17 Oct readiness snapshot at deployed commit `1996255e` lists BT3-096 blocked. No later public application receipt names this exact target; the 18 Oct batches do not list it. Current freshness is unverified. |
| BT3-098 front #10 | PR #834 | The 17 Oct readiness snapshot at deployed commit `1996255e` lists BT3-098 blocked. No later public application receipt names this exact target; the 18 Oct batches do not list it. Current freshness is unverified. |
| BT3-090 front #0 | PR #834 timing-reading change | No exact later public application receipt found; 18 Oct batches do not list this target. Current freshness is unverified. |
| BT7-040 front #10 | PR #834 timing-reading change | No exact later public application receipt found; 18 Oct batches do not list this target. Current freshness is unverified. |
| BT7-083 front #10 | PR #834 timing-reading change | No exact later public application receipt found; 18 Oct batches do not list this target. Current freshness is unverified. |
| BT7-086 front #10 | PR #834 timing-reading change | No exact later public application receipt found; 18 Oct batches do not list this target. Current freshness is unverified. |

The #907 17 Oct 15:43 comment is a specific application claim for BT29-029
back #0. It must be retained alongside the later #825 repo-only reconciliation
and the checked-in back #10 receipt; neither side is silently substituted for
the other. The 18 October #907 receipts describe other batches and do not name
the remaining seven targets. The checked-in `post-refresh-readiness.json` is
dated to deployed commit `1996255ea874bca8349ec64328ea4712e23505b0` and lists
four blocked cards. These are dated application/readiness records, not a current
database read or a claim about stored freshness today.

Sources: [#825](https://github.com/uhtred1986-lab/trading-card-management/issues/825),
[PR #834](https://github.com/uhtred1986-lab/trading-card-management/pull/834),
  [`docs/arena-backlog/evidence/825/validation.md`](../../825/validation.md),
  [`rule-refresh.json`](../../backlog-completion/rule-refresh.json),
  [`second-rule-refresh.json`](../../backlog-completion/second-rule-refresh.json),
  [`post-refresh-readiness.json`](../../backlog-completion/post-refresh-readiness.json),
and [#907's 18 October refresh receipt](https://github.com/uhtred1986-lab/trading-card-management/issues/907#issuecomment-6247494085).

This file freezes one pair and its baseline blockers. It does not claim
qualification, current stored-row freshness, match completion, actual skill
coverage, or strength.
