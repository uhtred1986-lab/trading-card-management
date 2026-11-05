# Combo replacement Auto timing — 5 Nov 2026

Intermediate checkpoint in PR #1249, source head `791280bc`, ruling-order integration repair `27f7666e`. Complete card support remains in progress.

R-424 follows the four Turles cards’ own FAQs and RM 4-3-2-3/4, 9-10 and 20-1-11. Their exact Combo-to-Drop self-play replacement Autos now activate once and receive the shared before/after Counter windows. Ordinary Permanent replacement application remains distinct. Source condition, validity, usage, negation and activation restrictions remain binding. Unsupported activation prices and external taxes explicitly refuse before canceling the original movement; payment continuation is the next batch.

A failed substitute resumes original-departure arbitration after its scope, preserving other eligible choices. Standing replacements retain source occurrence identity; installed timed effects retain effect identity. Each applies at most once to the same original event. The original Combo occurrence cannot move a later re-entered card. A completed original movement credits its parent’s action-result witness once; substitute play or another redirect does not. Saved frames lacking the required occurrence/provenance fail explicitly.

Typed optional timed redirects now retain their optional flag in captured and live-selector forms. This fixes the runtime contract without claiming a new printed optional timed-redirect family. Existing printed mandatory redirection remains mandatory. [Source reasoning and remaining boundaries](../round-5/replacement-auto-timing.md).

Combined checks pass **576 counted scenarios**: replacement timing 49, confirmed Combo replacement support 84, shared scope 94, Z-Awaken prices 148, native Z-Awaken 60, invocation 82 and delayed replacements 59. Cleanup, Universe 3 removal, attack preview, language/lang/Teach, typecheck, changed-file lint and capability inventory (77 VM sites) pass. The ruling check caught the merged R-424 entry after R-442; moving it to numeric order restored the check (203 rulings, zero pending). Fixture fuzz completes **40/40**, with zero crashes, interruptions or action limits.

The 49-case suite includes actual stored records and native Counter answers alongside explicitly labeled staged fault controls. Direct movement and typed-effect injections at saved windows test continuation robustness; they are not evidence of a printed Counter creating those changes.

The full 6,597-card offline comparison is byte-identical to checkpoint 11: all **13,964 records unchanged**, **12,980 readable / 984 unread**, with **31 additional readable runtime gaps**. SHA-256: `0fdde1eae505ee3a772dbfe4efbdfe3c9e3382bfd1c6495f12712877cd507dad`. Runtime timing improves without changing compiled records; no refresh delta is invented. No production refresh, database change, deployment or merge occurred. The full integration gate remains for the complete combined deliverable.
