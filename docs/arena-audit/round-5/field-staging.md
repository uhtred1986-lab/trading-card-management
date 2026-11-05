# Field staging and cleanup — R457 / R469

Implementation checkpoint, not a completed support claim. Branch starts at f06cda50. The native payment dispatcher and mandatory cleanup continuation are not yet wired; the old native Field behavior remains until their replacement is complete. Do not integrate this checkpoint as a finished card-support batch.

Sources: RM12-2-2 and12-2-4 (Extra activation),22-3 (Field),9-1-2 and9-1-6 (negated printed versus granted/reference skills), BT13-084 own FAQ, R074 card-number identity, R270 invocation restriction, R420 conditional admission, R448 scoped coupons and R460 activation provenance. Official BT27-119/120 images confirm Field Limit1 Draw1, total2 and Red1/Blue1. No catalog correction is needed.

The corrected corpus has80 Field descriptors. Only BT27-119/120 have the new draw-one action price; BT29-041/042 have existing blue-Cooler Leader conditions. The Field grant census finds no explicit Field grants; the helper nevertheless supports effective grants through the existing keyword API and tests both a live and negated grant. Generic copySkills records are included in the census artifact for follow-up inspection.

Current implementation adds typed `fieldKeepOthers`, a generic observed `copiesOf` activation relation, the two complete King Cold Permanents, a Field rule-identity helper, and source-bound ordered-payment helpers. Positive keyword qualifiers in copiesOf are explicitly checked through effective hasKeyword: ordinary CardFilter keyword matching still reads printed skill text, and is not globally changed here.

The first16 both-seat typed tests pass: original-cost2 versus1, multicolor, Leader/source-controller/negation, same number versus same name, negated printed Field versus live duplicate-reference semantics, and granted/negated-grant Field identity. Typecheck passes at this checkpoint. Native staging, replacement cleanup, saved payment proofs, full-record comparison, compatibility and final fuzz remain to be completed.

Evidence directory: `/workspace/shared/arena-support5/conditions-r457/`. Baseline trace demonstrates direct hand-to-Battle placement and optional up-to-one cleanup; both are incorrect and are the intended runtime corrections. Full-record baseline for final comparison is `recovery/fortieth-full.json`, SHA ce49f615d5c76423a2f77a2f4a9c023b8718c9040168c32c5ec4e5df32eeb805.
