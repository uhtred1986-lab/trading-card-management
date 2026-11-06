# R452 — trait-qualified EX-Evolve discard prices

TB1-052's printed generic 1 followed by its two-card Universe 7 discard now reads as one energy plus the complete action payment. The raw printed text is unchanged. TB1-052, TB1-077 and TB1-097 now persist the existing EX-Evolve source/base contract for one trait, one character and a minimum printed Battle Card cost. This also repairs the two already-readable records' missing occurrence protection.

Source review used the official TB1-052 card image (`https://www.dbs-cardgame.com/images/cardlist/cardimg/TB1-052.png`), all three own-card FAQ entries, and RM 22-5-3 through 22-5-7 and 3-1-4. Each own FAQ confirms Rest/Active and power-effect carry, but no granted Double Strike carry. The base uses the existing printed-cost semantics (#1136), including specified-cost floor. No relevant erratum changes these prices.

The incoming matching Battle Card can itself pay the hand discard. Existing BT6-014 native coverage already establishes that behavior. Its payment remains paid, but the fresh Drop occurrence cannot play as the old activated source. This differs from the Extra energy-alternative procedure covered by DB2-164; that FAQ is not extended to Battle skill costs. No new payment runtime or source-exclusion rule was introduced.

The compiler normalizes only a leading generic integer followed by a comma in EX-Evolve's parsed cost. The typed base reader admits the exact trait/character/minimum-cost shape; all other descriptor shapes remain conservative. Existing saved-source and base epochs, strict keyword payments, stored identity validation and stack behavior provide execution. Old rows lacking the required descriptor refuse native activation across draft, confirmed and corrected statuses. No rules database or existing matches were rewritten.

## Evidence

Recovery input: `/workspace/shared/arena-support5/recovery/catalog.json`, SHA256 `d3646487f34749d905a65b2473f21aee7984e4aac640c631bc0deb319e512bfb` (6,597 public cards). This recovered input is not claimed byte-equivalent to the earlier lost snapshot.

Artifacts: `/workspace/shared/arena-support5/conditions-r452/`. `after-full.json` compared every field of all 13,964 records with `recovery/thirtyfourth-full.json`. `full-diff.json` contains exactly three cost-only deltas: TB1-052#0, TB1-077#0, TB1-097#0. Only TB1-052's cost readability changes; the other two gain typed evolution metadata. Printed text, effect bodies and unrelated fields are unchanged.

Validation logs in that directory:

- `native.log`: 156 stored native scenarios in both seats, serialized actions/context, correct and wrong base filters/areas/controllers, generic energy, complete trait discard, matching Extra payers, legal source-as-payer, source/base reentry, missing saved identity, stale rows across all review statuses, mode/power/granted-keyword carry and language/editor roundtrip.
- `existing-after.log`: existing 62 EX-Evolve907 cases.
- `printed-base.log`, `orbs.log`: existing printed-base and 32 native Evolve-orb cases.
- `language.log`, `teach.log`, `rulings.log`: language, Teach and ruling validation.
- `type-final.log`, `lint-final.log`: typecheck and changed-file ESLint.

No full gate, build, dependency installation, database work or paid network operation was run. Broader descriptor shapes, general native movement lifetime research (R454), and the remaining payment families retain their separate completion scope.
