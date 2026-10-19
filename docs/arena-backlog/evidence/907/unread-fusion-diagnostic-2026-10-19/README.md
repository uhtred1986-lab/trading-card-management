# Retain an unread Fusion activation's diagnostic

The original #926 proof fails on main `d343114e32dbde6b48802ff67e48e2ceef049b50`
at its unchanged line 344: raw BT31-149 is correctly absent from legal moves,
but no rejected candidate reports its unread price. The earlier
[Potara baseline receipt](../potara-identity-2026-10-19/baseline-926.json)
remains valid historical evidence; this increment fixes that diagnostic gap.

`recordedSkillIdentity` intentionally removes native keyword hooks from blocked
records. `activationsOf` consequently lost the candidate before `canResolve`
could explain the refusal. Activation enumeration now recovers a Fusion candidate
only when its stored keyword kind and complete typed Fusion price identity are
valid. It retains the original blocked script, so the candidate is refused as
unread and cannot pay, activate or run native hooks. Display text supplies no
identity. Missing or contradictory contracts remain blocked, and Hidden Mode
still exposes no candidate. No compiler output, record contract, stored rule,
price, payment sequence or rules interpretation changes.

## Evidence

[Verification receipt](verification.json) pins source hashes and command outcomes.
The original `scripts/verify/keyword-action-costs-926.ts` is byte-identical to the
baseline and now passes its full existing both-seat proof. Its assertion has not
been removed, relaxed or replaced.

[Identity proof](identity-proof.json) records 42 cases, including eight added
both-seat/status cases. The additions cover unread draft/open/confirmed/corrected
records, JSON round trips, mutated display tags, exactly one unread rejection,
forged-action refusal without state changes, suppressed native hooks, Hidden Mode
and identical opponent snapshots with/without the private candidate. Existing
missing/wrong-kind identity cases also assert no display-derived candidate.
Existing readable records, typed mutations and saved-frame refusal cases pass.

The original typed-payment proof passes. The unchanged Drop-to-bottom verifier
passes all 116 cases against the actual four-record export applied in #1086;
[control proof](drop-bottom-control.json). This rerun is offline and performs no
migration. Typecheck and focused lint pass. Independent implementation review
found no blockers. No full suite, local build, catalog sweep, games or database
writes were run. This bounded repair does not close #907, #923, #929 or #930.

## Classification

- **Repaired diagnostic regression:** BT31-149's unread price is visible again
  without making the skill executable. Baseline and repaired checks use the same
  frozen inputs and original oracle.
- **Preserved:** valid Fusion identity, payment/refusal and saved-state behavior;
  applied Drop-to-bottom records; blocked native hooks and opponent privacy.
- **Unchanged scope:** prior Absorb/Potara applications and remaining Union support
  acceptance. Historical #926 failure receipts are retained, not rewritten as passes.

[Deployment receipt](deployment.json): PR #1087 merged as `cf81bef6` and Vercel
production is READY. No guarded record migration was needed or run.
