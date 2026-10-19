# Recorded Union-Absorb authority — 19 October 2026

PR #1083 bounds the remaining native activation authority for **BT3-070/front/0**
under #907/#923. The prior eleven-row usage/validity application is complete;
this increment is separate. All eleven remain compiler drafts. This receipt
does not close the full Union inventory, certify whole decks or establish a new
Absorb interpretation.

## Contract and official basis

`cost.absorb = {version:1, variant:"Absorb", area:"battle"}` supplies stored
identity and activation area. The existing typed resource price, material cost
program and effect program retain their authority. No material text is parsed
at runtime to replace them. Native Union timing remains Main; Absorb keeps its
distinct cost-before-effect procedure and the existing Counter/failed-entry
machinery. Its captured continuation binds the activating source occurrence,
so leaving and returning does not silently supply a replacement host.

[Official source findings](online-sources-findings.md),
[receipts](online-sources.json) and [excerpts](online-sources-excerpts.txt)
record the binding 2018 errata: Android 14 and Android 15 are mandatory costs,
despite the stale official cardlist's “up to.” The current catalog and stored
program already incorporate that correction. No catalog correction is needed.

The common procedure validator accepts existing typed payment/effect shapes;
it does not hard-code this card's two Drop selections as the definition of all
Absorb. Unsupported/granted Absorb tails stay refused. Missing or malformed
identity requires rebuilding a rule/export; display tags do not supply a
fallback. Other native Union families retain their distinct contracts.

## One-record application boundary

[Deployment receipt](deployment-receipt.json): PR #1083 merged as `51d6fe97`;
the production deployment is READY and GitHub's Vercel status is successful.
Its merge tree matches the reviewed PR head. The grouped batch caused one
application deployment; the merged remote branch is deleted. This does not
apply the proposed database record.

`scripts/arena-absorb-record-907.mts` defaults to dry-run. The proposed target is
physical rule **6416**, **BT3-070/front/0**, **v9 → v10**, source `compiler`,
status `draft`. Only `cost.absorb`, version and update time may change. The tool
requires exact equality with the previously applied public v9 program and the
fresh compiler body except for that added field. It preserves every existing
cost component, effect, condition, trigger, reading, usage/validity and private
review field. It adds no human confirmation.

The guarded write binds an explicit reviewed digest, the full private raw row
and the full catalog row under atomic locks. Stale source, status, private-field
or version changes refuse the write. An already applied record cannot be
replayed. Public previews contain hashes and the narrow field change; private
snapshots stay outside the repository.

The [live dry-run proposal](proposal.json) binds digest
`512b924aaa08b28a217bd87ef4491be19e37e4292a7563b7493cdc8b8c2f4a8b`.
The live row was still the expected v9 draft. A final offline replay of the full
private snapshot produces the identical proposal bytes. Private fields are
represented only by a snapshot hash in this public preview.

**Application status:** separately approved and applied after deployment.
The [application receipt](application-receipt.json) records one write, rule6416
v9→v10, with the exact reviewed digest. Full private-field comparison confirms
only `cost.absorb`, version and update time changed. All original costs,
programs, conditions, readings, usage/validity, source/status and private review
fields remain exact; no human confirmation was added. The [actual stored
record](actual-record.json) passes all **66 scenarios** on deployed source
`51d6fe973c4846711d7f7c730f29fc571022ef45` (research worktree has documentation-only
commits). [Actual proof](actual-proof.json) uses this provided record with no
target compiler fallback. The earlier eleven-row approval was not reused.
## Essential verification

Source tree: `4b1bd2d226253e62b9e98e18b7a8e08c4848332c`. The final source and
tooling bytes match those checked; later receipt/backlog edits are documentation.
[Verification receipt](verification.json) records scope and review pins.

- `absorb-identity-923.ts --stored-records proposed-record.json`: **66 passing
  cases**, both seats with context/state restored for every action. The exact
  [one proposed record](proposed-record.json) is required, with no target
  compiler fallback. [Case receipt](proposed-proof.json) covers authoritative
  cost/material/arrival mutations, display tags, Main/Battle timing, source
  areas, saved identities/price lines and leave/return occurrences. Missing
  both old context metadata and post-payment capture refuses explicitly.
  Authoring round-trip preserves the Absorb contract; only the already redundant
  selector default `upTo:false` is normalized for that comparison.
- Original `union-counter-929.ts`, `union-sources-930.ts` and
  `typed-payment-907.ts` pass with their existing assertions on the final source.
  These preserve delivered Fusion/Potara/Absorb procedures and modifier controls;
  they are not complete printed-record proofs for every Union card.
- `absorb-record-907.mts` passes its PGlite stale-row/private-field/catalog-race,
  exact preservation, digest and replay checks. CLI guards refuse output/input
  collisions, public/private collisions and offline application.
- Historical `metadata-923.mts` passes without changing its archived proposal
  format/digest: ten original records admit, while the unchanged v9 Absorb record
  explicitly requires its separate identity migration.
- [Projected admission](projected-admission.json): **11/11** strict authoritative
  reference targets, replacing only6416 with the proposal and retaining ten
  actual records. This is an offline projection, not a live application receipt.
- Typecheck passes. Full lint passes with zero errors and five existing
  prototype warnings; final changed files also pass focused lint. Independent
  source/rules and migration-tool review report no remaining blockers.

The live dry-run reads the exact rule/catalog and writes nothing. Public
Snapshot shape is unchanged; this increment adds typed price JSON and internal
continuation metadata. No contract fixture emission is needed.

## Remaining scope

PR #1084 separately records [Potara native authority](../potara-identity-2026-10-19/README.md)
for one frozen target; its proposal needs its own approval and actual readback. Other
indexed #923/#930 support clauses and #929 composition proofs remain open.
Existing semantic controls are preservation evidence, not a claim that all
Absorb records or the 229-card Union inventory have been migrated or qualified.
No new games, policy tuning, Testing & stats import or broad catalog refresh
belongs to this increment. Essential checks only; no full local test suite or
production build, following the owner's instruction to group this work into one
PR/application deployment.
