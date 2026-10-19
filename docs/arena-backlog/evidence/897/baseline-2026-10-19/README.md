# #897 baseline/provenance slice — 19 October 2026

Reporting owner: #907. Starting main: `b47de15a559b3af0bd48db1120f4b424b7c9fa61`,
the merge of #1064 itself. `git fetch origin` found no later commits. #1064 changed
documentation and issue ownership, not engine behaviour.

This increment separates compiler-generated evidence from exact exported-record
execution in the existing #1030 corpus runner. It does not apply stored rules,
confirm drafts, qualify the selected additional decks, or change the compiler,
VM or policy. #897 stays open for its remaining deck-qualification acceptance.

## Delivery receipts inspected before assignment

- #1030: historical SD15/SD5 compiler pack, 16 completed games, no illegal,
  interrupted or limited outcomes; no stored-program certification.
- #923: dated Union inventory and residual evidence matrix remain the Union
  evidence owner, not another implementation queue.
- #929 / #1017 (`0455167d`): Counter windows, failed entry and stale materials,
  all three variants and both seats with save/reload scenarios.
- #930 / #1019 (`204ddefe`): Absorb action costs, Potara source extensions,
  Fusion Warp spellings and granted Fusion scenarios; residual indexed clauses
  remain open.
- [18 October application receipt](https://github.com/uhtred1986-lab/trading-card-management/issues/907#issuecomment-6247494085):
  52 Union-Absorb rows applied for #1017, two unread held; eight rows refreshed
  and 16 already current for #1019, with BT4-018 still unread. This is dated
  application evidence, not a fresh export or blanket Union qualification.
- #932 is completed and is not reopened.

The focused `union-counter-929.ts` and `union-sources-930.ts` proofs passed at
starting main. No underlying engine source changes are intended in this slice.

## Reproduction and interpretation

```sh
env -u DATABASE_URL npx tsx scripts/verify/arena-corpus-provenance.mts
env -u DATABASE_URL npx tsx scripts/arena-corpus-freeze.mts --mode compiler --check --pairs 4 --max-moves 3000 --seed-base 897000 --out /tmp/starter-baseline.json
```

Stored execution uses the same runner with `--mode stored --stored-rules
<complete-export.json>`, plus the matching `--catalog` and `--decks` inputs.
The input is an array of complete application camelCase or database snake_case
records, including source text, kind, cost, trigger, condition, operations,
unread diagnostics, source, status and version. Incomplete exports are refused.
Supplying rows selects stored mode if mode is omitted; combining rows with
explicit compiler mode is an error. No freshly compiled program fills a missing
stored record. Fresh compilation is retained only as comparison evidence.

Keep outputs built from private lists or exports private. The pack embeds exact
input data and rule records as well as hashes. Production export/application and
Testing & stats import are separate actions, not implied by a successful run.

Source freshness compares every expected front/back skill with its printed source;
status independently records human review. A protected/manual program differing
from fresh compilation is not stale merely because it differs. Support admission
checks the loaded program and known metadata boundaries. Typed orb/either/marker/
burst/spirit-boost costs omitted by the loader, and text-derived activation or
trigger constraints, remain named blockers. Completing matches is recorded apart
from semantic verification and skill execution coverage.

## Frozen control preservation

`main-preservation.json` compares the original #1030 pack with the unchanged
starting-main run (`--check --pairs 4`, seed base 897000, move cap 3000).
Both SD15 and SD5 controls were admitted: 16/16 games completed, zero illegal,
interrupted or limited games. Every recorded game outcome and trace is identical.
Catalog and program hashes match the historical pack. The ruleset and runtime
revisions differ and are recorded explicitly; this is version drift with
preserved control outcomes, not a silently replaced expectation.

These compiler-mode results neither certify production stored records nor show
that every skill was exercised. No complete production rule export was available
in this offline slice.

## Scope and next single action

The additional pair is the existing prepared BT6 Gogeta / Br Fusion versus
BT6 Paragus / Broly recovery pair. Exact public lists, source hashes and blockers
are in the adjacent pair-selection receipt. Private owner lists and replays were
not accessed or published.

Next implementation action under #907: carry one Union activated skill's complete
typed payment contract through compilation, persistence, loading, legal offers,
payment and replay. Preserve the distinct Fusion/Potara/Absorb procedures and the
accepted #929/#930 scenarios. Use #923's matrix for positive/negative modifiers
and unaffected-variant controls. Trigger qualification follows as a separate
bounded slice. Additional-pair qualification follows the required repairs.

## Validation scope

The owner explicitly requested essential testing only for this increment, including
workers. The focused provenance proof, frozen starter controls, typecheck, touched
lint and the two Union preservation suites are the intended gate. Full `npm test`
and production build are not claimed. No database write, Testing & stats import,
production refresh, migration, paid call or AI-strength change is part of this PR.
