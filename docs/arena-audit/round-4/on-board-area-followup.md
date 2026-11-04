# Explicit on-board areas (4 Nov 2026)

Continuation of the selector work in PR #1249. BT7-094#10 explicitly checks for a <Goku Black> card in its controller's Battle Area or Leader Area before allowing a free play from hand. The old selector used `area: "play"`, which includes the Unison Area. An explicit pair must keep exactly its named areas; a generic “in play” condition retains its broader meaning. RM 3-1-1, 3-5, 3-6 and 3-11 distinguish these areas and their masters.

## BT12 audit discrepancy

The next item in notes-S alleged that BT12-005#0, BT12-006#10, BT12-009#10 and BT12-010#10 nested their “If you didn't play a card” fallback inside the optional offer. Direct compilation of the exact catalog skills disproved that claim. Their program already has:

```text
under the printed Leader/energy condition:
  may: move the top deck card to life
  choose this card in life
  play the chosen card
  if no card was played: move this card from life to Drop
```

The human reading has no closing delimiter for `may`, so it cannot establish the nesting. The actual play is also outside the offer. The parser deliberately treats `then` as sequence outside an offer, and R-322 records the owner's same construction for DB2-126 without an `If you do` hinge. RM 20-16/20-17 describe those hinges; RM 9-6-4-1 says an unpaid Auto does not activate or resolve. None proves a card-specific exception here. No direct FAQ or official erratum exists for these four cards. The implementation remains unchanged, and notes-S now records the actual structure rather than the unverified inferred defect.

## Validation method

The before snapshot was captured on `3c9d708b` from the same frozen public catalog used by the earlier PR receipts. Its 13,964 full `SkillRecord` values include operations, conditions, costs, usage and validity as well as printed text and readings. Its normal reading projection exactly matches the previous keyword-negation snapshot. This captures structural changes that prose-only diffs can miss.

Before artifact: `/tmp/arena-life4/before-full.json`, SHA-256 `f0a37f43d4d60b36fc964d6bae19e083309c74b0209783857efbc31a16dd6f3f`. The temporary capture used `arena-snapshot-compile.mts` with each record value replaced by the complete `skillRecords` result; it accessed no database. The public catalog provenance and hash are in [the earlier receipt](keyword-negation-followup.md).

## Corpus result

All 13,964 complete records were compared. Exactly eight changed: BT7-094#10, BT3-087#10, EX03-04#10, BT12-120#10, BT15-088#20, EX08-03#10, P-085#0 and P-197#0. Each change replaces an overly broad `play` selector with the exact Leader/Battle area union, in a condition or effect, plus its corresponding reading. Costs, usage, validity, triggers, other operations and unread clauses are unchanged. See [the complete changed-field evidence](explicit-area-program-diff.json), which includes printed text and both structures.

BT12-120's later “If you paid the energy cost…” clause remains unread; its supported first selection is now correctly scoped. The normal snapshot diff reports seven visible reading changes because it displays only unread clauses for partially unread records. Comparing full records catches this eighth change. Totals remain 12,953 read and 1,011 unread, with no status transitions. The four BT12 optional-life records reviewed above are unchanged.

Final artifact: `/tmp/arena-life4/after-full.json`, SHA-256 `c5a6ef70aab360c7f2a865b849cd29a024130240c6e1a2e5bc93f59aca919504`. After integration, refresh the eight named records deliberately, alongside BT2-048 and DB1-093 from the earlier work; respect confirmed records and the existing unread tail. No production reads or writes were performed.

## Check receipt

Implementation commit: `2235721c`. `explicit-board-areas-4.ts` passes 18 stored-rule scenarios: both players, real free-play cost and legal-action checks, accepted Leader/Battle matches, rejected Unison/energy/hand/opponent matches, generic in-play controls and a pooled two-card choice across the named areas. Compiler controls cover both orders and `and`, `or`, `and/or`, plus opponent wording and Leader/Unison pairs. R-340's off-board area-choice behavior is unchanged.

Passed: typecheck; changed-file eslint (no warnings); audit-conditions-1, audit-selectors-3, audit-effects-3, census-triggers-907, keywords followed by wordings, lang, rulesets, rulings, audit-effects-1, audit-selectors-1 and compiler. The last two suites contained old assertions of the broad `play` selector; they now assert the explicit pair while retaining their original filter and cost checks, and both reruns pass. The rulings check reports zero pending decisions.

Final-source Fusion fixture fuzz completed 40/40 games with zero crashes, interruptions or action-limit failures (`/tmp/arena-life4/area-fuzz.json`). Independent review confirmed all eight full-record changes and the AND/OR, owner-side and pooled-choice cases. No remaining review blocker. The complete PR's normal reading projection differs from main in ten records: these eight plus BT2-048 and DB1-093 from the keyword work.

This continuation changes no VM, rules-language schema or client Snapshot fields. No fixture emission, repeated Teach run or full gate was needed; the Teach prompt-budget failure documented at that point was subsequently fixed directly in this PR (`766971a3`; Teach suite passes at 20,955 characters). Full integration checks remain for the combined batch under `docs/arena-batch-process.md`.
