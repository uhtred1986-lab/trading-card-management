# Complete card support workstream

The owner requested on 4 Nov 2026: “Continue until all cards are supported.” Continue in PR #1249; do not stop after one bounded family. The batch process still governs validation and combined integration.

## Starting point

At `93ebd6b9`, the frozen public Masters catalog has 6,597 cards and 13,964 skill records: 12,956 readable and 1,008 unread, spread across 916 cards. The catalog SHA-256 is `dcfba11b09fe10746a5f86176511bc9edd85c6156f239508a301326440339fb4`; the full-record baseline SHA-256 is `2284c8aa822b4cf781fc0338e377bd777eef35abfca28a5d5c5d7eff512fcac7`. This is compiler coverage, not a claim of fully verified gameplay or refreshed production records.

The fresh first-clause queue contains 206 moment, 107 condition, 279 selector and 414 effect skills. These overlap through later clauses. Two additional unread records are excluded by the current cluster tool’s defensive-refusal filter: BT28-028#0b and BT23-042#0. They remain in the completion scope; an excluded cluster is not a supported skill.

## Completion criteria

- Every catalog skill has an accurate, source-backed reading, or an explicit, reviewed explanation that it is a keyword/reminder/deck-construction line handled by the appropriate subsystem. No swallowed clause or unread-list suppression counts as support.
- All compiled operations, triggers, payment paths and permissions needed by those cards execute through stored rules. A parsed trigger with no event, or an invocation without the printed payment, does not count.
- Review every changed record’s costs, conditions, targets, side, area, count, optionality, duration and trigger. Exercise each new runtime family with actual actions/events, negative controls, both seats and saved-state checks where relevant.
- Recheck deliberately refused records and the silent-reading detector. Retain defensive guards for malformed or obsolete saved data; full support does not mean deleting every `NotYet` exception.
- Keep the games separate. The present 13,964-record audit measures Masters. Fusion fixture fuzz is a regression check, not proof that every Fusion card or every Masters deck is supported.
- Integrate the families and run the repository’s full gate once on the combined head, including the direct arena run and fixture review. Production record refresh is a separate, explicit integration step that respects confirmed records.

## Active sequence

1. Bring the previously reviewed seven condition misread corrections from the condition lane into PR #1249 and recheck their combined behavior.
2. Work the condition and trigger queues in separate worktrees. Reuse existing state/events where they express the printed rule faithfully; add missing state only with source research and runtime proof.
3. Continue into selector and effect mechanisms: non-hand activation permissions, invoked skills and costs, counted choices, copied/granted skills, replacements, delayed effects and paid-card references. These are dependencies to implement, not permanent deferrals.
4. Regenerate the full-record comparison and remaining queue after each combined batch. Preserve actual totals and evidence; do not report a percentage as complete card support.
5. Resolve genuine unanswered rules decisions from the documented source order. Ask the owner only for decisions that remain open after that research, while continuing independent work.

Record completed batches and their exact receipts below as they are integrated. Historical receipts retain the validation that ran on their own heads; they are not automatically evidence for a newer combined head.

## Integrated progress

- **Seven known condition misreads**, combined head `29326703`: the previously reviewed condition work is now in PR #1249. The new combined-head `audit-conditions-4` suite passes. A full-record comparison against `93ebd6b9` changes exactly the seven expected records, with no read/unread transitions; every changed cost field is its condition, with payment components preserved. Totals remain 12,956 readable / 1,008 unread. The full-record artifact SHA-256 is `72478eb41970effb1a7c27bb97721fc96c5cdd1c7c7298ec6b4a930d2a33ff73`; [structural evidence](round-4/conditions-port-program-diff.json) and [original source/review receipt](round-4/conditions-followup.md). New families continue below this checkpoint.
