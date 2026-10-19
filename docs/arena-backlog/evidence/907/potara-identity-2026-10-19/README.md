# Typed Union-Potara authority

The candidate records Potara identity, two material selectors, Hand activation, Battle material area and explicit extension opt-ins in `cost.potara` v1. Existing selection, payment, Counter windows, stacking and carryover procedures remain in the shared Union engine. An opt-in enables an existing permission check; it grants no permission by itself. Missing, malformed or contradictory identity requires rebuilding the record or saved continuation.

Only **BT2-012/front/0, id10297 v1 → proposed v2** is proposed for application. [The frozen reference](reference-before.json) also contains actual rows 10298 (Triple Strike) and 10299 (attack Auto); both remain excluded and obsolete. This is no whole-card, deck or playing-strength qualification.

[The proposal](proposal.json) adds `cost.version`, `cost.readable`, `cost.potara`, `usage` and `validity`, with version/update bookkeeping. The existing five-energy cost body, effect, condition, trigger, printed text, reading, source/status and private fields are preserved. [The proposed safe record](proposed-record.json) is input to the same proof intended for eventual approved readback. Approval digest: `0abeab213937eb646d2211188767c97de8c70e27d8bf3be4816a5433542017da`.

**Owner approval is pending. This proposal has not been applied.** The guarded writer checks the full row and catalog identity atomically and refuses stale state, wrong digest and replay.

[Verification](verification.json) records the final 76-case provided-record proof and typecheck at `84fcc4a8`, plus original 925/927/929/930 preservation checks and full lint at `205cc4d0`. The proof covers both seats, stored/display mutations, mandatory Battle/Z-Battle material type, permission boundaries, typed grants, saved identity/source occurrences, valid Fusion shared branches and ordinary seven-energy play without Potara materials. Companions are compiled fixtures, not refreshed actual card rows. The earlier PGlite writer proof passed; replaying the preview produced the identical digest. Final focused lint passed; full lint reported five existing warnings.

**926 is not a full pass.** [The baseline comparison](baseline-926.json) pins the same unchanged line344 refusal-category failure on deployed `51d6fe97` and candidate `205cc4d0`. The preceding activation-not-offered assertion passes. No original oracle was changed to hide this unrelated Fusion diagnostic mismatch.

Official sources and interpretation are recorded in [the source findings](online-sources-findings.md). In particular, a source leaving Hand and returning is a new occurrence: the old activation cannot play or discard that returned card. An unchanged incoming source still goes to Drop when stale material prevents entry, preserving the existing failure rule.

No full test suite, application build, strength games or live database write was performed for this preparation.
