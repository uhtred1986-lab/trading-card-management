# #907 authoritative Fusion material records — PR #1068

Starting main: `7b5b515edb2319b90c4414829fa88f829fa0d06f` (#1067).
Integrated implementation: `c3ba274d06f72174a3533c4b02ecb8bfa6cd1d24`.

Fusion material names and per-name filters, equality policy, hand procedure and
supported source-extension switches now survive compilation, persistence, match
loading, legal offers, payment and replay. Native records carry `cost.fusion`;
granted Fusion carries `permit.unionVariant` and `permit.price.fusion`. Actual
stored selectors control play even when they differ deliberately from current
compiler output. Display wording cannot replace them. The compiler still emits
the official equal-power requirement; test-only stored overrides demonstrate
record authority, not new official interpretations.

The implementation builds on existing typed filters, named-set selection,
permissions and the VM. It preserves Fusion's material-before-additional-cost
checkpoint and distinct Potara/Absorb procedures. Existing Battle/Drop and Warp
permissions retain their different destinations. No legacy material fallback is
retained: missing, malformed or obsolete contracts require rebuilding records
and saved matches explicitly.

[Fresh online evidence](online-sources.md) covers the official manual, card
listings, FAQ, errata and public forum cross-checks. No unresolved semantic
question affects this bounded slice. The #541 owner-approved printed-power
scenario is retained. EX23-36/P-519 print Drop-to-bottom permissions, with no
located equal-power waiver; those procedures remain unsupported. BT17-082 is
Absorb-specific. Historical inventory labels do not establish contrary rulings.

## Demonstrated boundary

`fusion-materials-907.ts` exercises native and granted Fusion on both seats,
reloading executable context and VM state at every action and replaying the same
actions to identical states/events. It proves stored names/filters/equality and
extension switches control selection; printed-material/display mutations do not.
It covers captured pending metadata, missing/malformed/obsolete native and grant
records, incorrect material card types, permitted/disallowed source areas,
mixed/all-outside materials and the existing combined-permission priority.
The language and block editor retain the same typed material contract.

Meaningful unimplemented clauses remain unread: material alternatives and
unsupported granted usage/timing metadata cannot be consumed into an unrestricted
Fusion. Nested malformed grants are detected by the actual loader as well as
export validation. Native keyword identity/timing dispatch and usage metadata
remain explicit provenance blockers; this is material authority, not a claim
that every field of every Union skill has migrated.

## Regression and expectation ledger

- **True regressions repaired:** unchanged #541/#925 fixtures pass on the earlier
  payment implementation `037478d3f81604c3c8ef197eff564202fdd16917`, but fail on
  starting main #1067. The #1066 main diff from that earlier implementation is
  only an authoring guard in `rules-store.ts`, not the runtime material path.
  #541's all-outside material pair was rejected because its empty hand partition
  was treated as an unpaid cost. The narrow exception allows that empty partition
  while still requiring the outside pair to be paid to Warp. #925's stale answer
  was incorrectly converted to ordinary payment failure; submitted choices are
  now validated before strict payment-failure classification.
- **Harness migration, no semantic rebaseline:** #541/#925 now answer #1067's
  post-material resource `chooseMode` prompt. Their original material and
  final-state assertions remain intact.
- **Exposed old misread:** Fusion previously accepted Unison/Z-Unison materials.
  The manual specifies Battle Cards; the new negative proof refuses those types.
  Potara's existing procedure is preserved and is not silently recertified here.
- **Stale validation expectation:** `blocks.ts` also failed on starting main:
  it treated `{Red: 0}` as malformed, while #1066's typed payment contract allows
  nonnegative orb counts. The validator is unchanged. The invalid-orb fixture
  now uses `-1`, and an explicit assertion records the existing zero acceptance.
- **Pre-merge defects prevented:** review caught a granted-Potara template
  regression, consumed material alternatives/granted usage metadata, and nested
  grant admission omissions. The final implementation preserves Potara's current
  parsing path and refuses unsupported Fusion clauses explicitly.

## Validation and review

Independent review tested worker commit
`fd2d4d8635b95015b6b6a3026c8a28362826ae8f`, cherry-picked unchanged as the integrated
revision above. No remaining code blocker was reported. Implementation/review
used workhorse agents; bounded online research used Luna. The source note needed
scope clarification that the unimplemented Drop permissions do not require a
new owner ruling for this slice. Workers ran no database command, full suite or
build. The owner explicitly requested essential checks only.

Integrated material/payment #907, #926/#929/#930/#541/#925, Auto #549,
language, blocks and corpus-provenance checks passed. Typecheck and lint passed
with only the five existing prototype warnings. Targeted #897/#907/#923/#930
backlog metadata/source paths match their live open issues. No full suite/build
or AI-strength test was run, per the owner's instruction.

[The starter pack](starter-compiler-pack.json) completes **16/16 games**:
A–A 4, A–B both seats 8, B–B 4; zero illegal, interrupted, limited, crashed or
other outcomes. [Exact comparison](control-preservation.json) preserves all 16
complete game records/trace hashes, all 75 programs/manifests, catalog, lists,
seeds, move limits, policy, ruleset and errata against the prior frozen
controls. Engine/loader/provenance source changes are pinned separately; no expectation
was rebaselined. The old comparison stopped on the changed runner hash because
that hash includes the intentionally changed provenance module; all game/program
and input equality assertions had already passed. The new comparison retains
those exact assertions and records the provenance revision explicitly. The match
runner itself is unchanged. These are compiler-mode controls, not proof of production
stored-program qualification or every skill's exercise.

## Stored application is separate from deployment

A fresh read of BT11-013, BT3-070 and both P-360 faces matched #1067's eleven
current, unconfirmed compiler drafts. The supported guarded dry run selected
exactly **BT11-013/front/10 and P-360/back/0**: two pending, zero new rows,
zero exclusions. Their material metadata changes even though the human effect
reading is unchanged. All other reference rows are outside the write set.
The refresh tool's focused exclusion/atomic-apply/recheck proof passed.

The former loader accepted the new field but dropped it, continuing to read
materials from text. Application therefore waited for the new engine's successful
deployment. #1068 merged as `ec22e4236fe6315d5fcdac969748efbd6511a1b0`;
Vercel succeeded at `2026-10-19T11:25:21Z`. At #1068's pre-merge boundary the
application was still pending. The [subsequent application receipt](application-receipt.json)
and [actual public reference export](reference-records.json) now record:

- Exactly two compiler-draft rows written: BT11-013/front/10 (`6545`) and
  P-360/back/0 (`12065`), each version 3 → 4; zero created/unread writes.
- Nine non-target reference rows are unchanged in full raw readbacks. Catalog sources and all printed skill sources are unchanged.
- All eleven expected stored skills are present, current and unconfirmed;
  native Deflect is separate. No protected/corrected/user/Claude row was touched.
- The guarded recheck and a separate subsequent dry run both report zero pending.
- Material and payment proofs both pass against these actual exported records,
  including P-360's real back-face grant, both seats and saved-context/state replay.

Strict admission still reports BT11-013's native identity/timing, BT3-070's
remaining Union material contract and P-360's two once-per-turn fields. Neither
successful loading nor these focused proofs certifies every skill/card/deck.
Other obsolete Fusion records still need explicit rebuilding; stored `unionLine`
grants, including Potara grants, also require typed variant identity. Potara
material parsing remains an explicit residual boundary. No corpus-wide refresh
or pair-row write is implied.

## Progress measures and remaining acceptance

| Measure | Evidence and limit |
| --- | --- |
| Parsed | The supported Fusion material grammar emits typed filters; unsupported alternatives/tags remain unread. |
| Stored/executable | Persisted/reloaded records control actual native/granted material choices; the actual two-row refresh/export passes the same focused proofs. |
| Human reviewed | No row confirmed by this work; compiler drafts remain unconfirmed. Independent code review is not card confirmation. |
| Verified/exercised | Named positive/negative material/payment/source/replay scenarios, including preserved #541/#925/#926/#929/#930 behavior. This is not every skill on each card. |
| Deck-qualified | No additional deck qualified. Starter controls are compiler-mode preservation evidence. |

The [selected public BT6 pair now has complete frozen inputs](../../897/selected-pair-inputs-2026-10-19/README.md):
28 catalog cards and 67 actual stored rows, including four protected corrected
rows. No pair row was changed. Stored admission refuses both lists, with zero
matches attempted; obsolete payment metadata, runtime trigger/use metadata and
unread clauses remain blockers. This supersedes the old missing-input limitation,
not the unqualified outcome. No private list or replay was queried or published.

**Next single task under #907:** persist combo-trigger qualification/binding for
BT6-006 front #10, BT6-010 front #0, BT6-066 front #0 and BT6-070 front #0 through
compilation, storage, loading, trigger offers and replay. Preserve current behavior
on frozen inputs. This follows the delivery plan's next trigger stage and uses
concrete blockers from the selected pair. Other Union authority, usage limits,
prohibitions and protected-row migration remain explicit. #897/#907/#923/#929/#930
stay open; #932 stays completed. No new pair or AI-strength work is scheduled.

## Reproduction

```sh
env -u DATABASE_URL npx tsx scripts/verify/fusion-materials-907.ts
env -u DATABASE_URL npx tsx scripts/verify/typed-payment-907.ts
env -u DATABASE_URL npx tsx scripts/verify/union-areas-541.ts
env -u DATABASE_URL npx tsx scripts/verify/union-exact-sets-925.ts
env -u DATABASE_URL npx tsx scripts/verify/union-counter-929.ts
env -u DATABASE_URL npx tsx scripts/verify/union-sources-930.ts
env -u DATABASE_URL npx tsx scripts/arena-corpus-freeze.mts --mode compiler --check --pairs 4 --max-moves 3000 --seed-base 897000 --out /tmp/material-starters.json
python3 docs/arena-backlog/evidence/907/fusion-materials-2026-10-19/compare-controls.py /tmp/material-starters.json /tmp/material-preservation.json
```

Both #907 proofs accept the actual export:

```sh
env -u DATABASE_URL npx tsx scripts/verify/fusion-materials-907.ts --reference-records docs/arena-backlog/evidence/907/fusion-materials-2026-10-19/reference-records.json
env -u DATABASE_URL npx tsx scripts/verify/typed-payment-907.ts --reference-records docs/arena-backlog/evidence/907/fusion-materials-2026-10-19/reference-records.json
```

The export has `catalog` and `after` fields. The pre-application #1067 export intentionally
requires rebuilding; it must not be silently recompiled to make that proof pass.

[Next handover task](handover.md) gives the bounded implementation brief.
