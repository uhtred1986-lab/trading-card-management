# Shared Counter timing, R-422

This continues R-421's serialized lifetime work. Ordinary Activate/Auto effects, effect-invoked Extra skills, actual delayed effects, and Counter motions with immediate plays use one before/after boundary around the whole effect. Tokens and Unisons count as plays. The eight previously explicit ordinary play/Evolve paths join this boundary while retaining their existing material and base checks. Keyword and declared paths retain their separate timing implementation.

## Sources and conflict resolution

- Current Rule Manual 4-3-2-3/4 gives before/after effect timings; 4-3-2-7 prevents duplicating the same response opportunity.
- 9-7-3-5-1 explicitly returns to Counter timing when a resolved Counter effect creates one. 22-10-3-1 names activation or resolution of a play skill. The older BT1-107 FAQ says new Counters cannot activate once a Counter finishes resolving; that broad sentence conflicts with the current manual, which wins under repository source priority. The after window offers Counter:Play, not Counter:Counter.
- 9-11-1 and BT21-002's FAQ establish the nested invoked skill's own timing. Its parent continues afterward.
- General Deflect FAQ permits activating a Counter against Deflect. Protection applies to effects on the incoming card, per Counter actor, not the response menu or observational conditions. General Unison Q19 permits a Counter:Play response to Unison play while a Battle-only instruction excludes the Unison.
- BT1-110's FAQ applies Crusher Ball to all three Ghost Tokens from BT2-014. Each arrival receives the bound pure transformation; no per-card extra response window is invented.
- BT1-107's FAQ distinguishes entry negation from Window2 negation. Manual 9-6-11 preserves an already-pending Auto after later negation/departure. Full and partial entry negation now apply before arrival triggers are created.
- Actual delayed effects use their own lifetime under 1-7-2-1-1/1-7-2-2-1, 4-2-2-4 and 9-2-1-3, without an invented Auto activation or activation price. Stored BT14-004 proves the delayed-play boundary.

## Stored records and saves

`resolvingPlay.cardType` preserves an explicit Battle/Unison/Extra noun. The `replace(event:play)` primitive carries it through macro expansion and reads it back. Battle includes tokens and Z-Battle Cards. Old affected records are marked needs-rebuild and blocked for drafts as well as reviewed rows before activation payment. A partly migrated record with an unqualified play transform also fails the contract. Printed text detects the need to migrate; it never supplies executable runtime filters.

Shared scopes and new effect provenance are version 2. Version 1 certified only R-421's lifetime boundaries and cannot prove a before window happened. Affected version-1 active roots/scopes refuse explicitly; unrelated non-play version-1 frames remain usable. Untagged affected old roots and matching delayed bodies also refuse. Scope ancestry, phases, profiles, occurrence ledgers, window ownership and stored pure binding provenance are validated. The held declared card's original occurrence is checked after a nested Counter uses that same physical card.

## Corpus evidence

Frozen catalog: 6,597 cards, SHA-256 `dcfba11b09fe10746a5f86176511bc9edd85c6156f239508a301326440339fb4`. Full snapshot: 13,964 records, 12,962 read / 1,002 unread in this lane's dependency base. No readability changes. Compared with the earlier Life-blind checkpoint, 88 records differ: 59 previously approved R420 narration changes, 15 entry-negation dependency changes, and exactly 14 new qualifier changes. Removing only `cardType` restores each of those 14 prior operation trees byte-for-byte after JSON serialization. Every new qualifier was checked against the explicit Battle Card noun in its print. New compiler records have zero played-card contract gaps.

Refresh: BT7-110#0, BT10-044#0, BT1-110#0, BT14-154#10, XD1-10#10, BT10-105#10, BT15-149#10, EX09-05#10, BT8-088#0, EB1-46#0, BT15-096#10, BT1-107#0, P-171#0, EX12-03#0.

Artifacts: `/tmp/arena-support5/triggers/after-shared-scope.json`, `shared-scope-changed.json`, `resolving-type-review.md`, `scope-contract-gaps.json`. Runtime changes intentionally affect existing records beyond these fourteen; a compiler diff cannot prove runtime behavior.

## Runtime proof and immediate continuation

The native both-seat suite covers single/multiple/zero arrival boundaries; actual Ghost Token and delayed-play records; Deflect; Battle-only exclusions against Unisons; entry versus post-entry negation; pending Auto source departure and saved replay; exact Window2 arrival candidates excluding a left/reentered copy; nested invocation; exact Counter line choice in a combined prompt; cancellation of a held declared play after the same physical card is used as Counter; and version/provenance failures. The four stored ordinary Evolve effects BT1-017/P018/P065/EX06-04 resolve through the shared window. Qualified-movement825 covers BT29-029 and both Great Apes; non-evolve933 covers P336. Existing Counter-chain552, Counter action prices716, Union stored records929, invocation70 and entry-negation48 remain regression checks.

Remaining completion work is explicit:

1. Resumable mixed future-card tails and optional/modal arrival decisions, including DB2-040/169 and DB2-030. The bounded core refuses such typed bindings before payment. DB2-030 itself remains unread with an empty program; no synthetic successful compiler reading is claimed.
2. Delayed captures of a resolving-card occurrence and deferred token switches require binding/lifecycle extensions.
3. Declared/keyword paths still have their prior Deflect opportunity suppression and need the same source-backed correction.
4. Replacement-application play timing (including Turles Combo replacements) needs source-correct ownership; applying a replacement is not a new Auto activation. This patch does not claim that path is covered by delayed/hook scopes.
5. Pending arrival source departure and negation are proved. A Counter changing the source's shown face/skill-index identity still needs a captured-program investigation; the bounded witness does not claim to repair all historical Auto identity.
6. Battle Card invocation payment remains the separate owner decision tracked for R439; R420 and this patch do not decide it.

## R423 protection prerequisite

The final entry audit exposed a pre-existing area loss: an explicit any-area beNegated prohibition compiled without its area and the own-prohibition reader ignored it outside Battle. R388's protected fixture passed because its protection was checked after arrival. R423 preserves the existing `fromArea:any` field, reads only that typed self Permanent in the own-prohibition path, and evaluates partial negation protection before arrival just as full negation already did. Actor/source restrictions remain mandatory. `negation-area-5` has 52 both-seat checkpoint/contract checks for printed BT14-085, DB1-021 and P641 protection lines, contrasting ordinary Battle-only protection, own versus opponent actors, and red Garlic Jr. versus wrong-color/wrong-character sources. The ordinary native scope suite also exercises full/partial entry and pending-Auto creation for both protection areas. R388's existing 48 cases still pass.

P474's old original-skills-only reading incorrectly protected all skills; it is intentionally restored to unread rather than widened. DB3-028's this-skill-only clause remains unread. These need a future per-skill protection contract. Stale records missing the area or retaining the overbroad original-only operation are blocked in all review statuses. No runtime printed-text reconstruction or general out-of-play Permanent admission is added.

R423 full corpus adds exactly 13 changed records: `BT14-085#10`, `DB1-021#20`, `BT11-139#0`, `BT14-060#10`, `BT11-140#0`, `BT11-136#0`, `BT14-117#10`, `BT14-027#10`, `BT11-147#0`, `P-641#0`, `P-642#0`, `DB1-087#10` gain only the any-area field (and its narration); `P-474#0` becomes unread instead of overbroad immunity. The resulting dependency-base totals are 12,961 read / 1,003 unread. All thirteen were reviewed against print. A subsequent targeted 37-record narration refresh changes only the twelve area descriptions; its operations are identical to the full snapshot. Combined artifact: `/tmp/arena-support5/triggers/after-negation-area-reviewed.json`; full operation diff: `negation-area-diff.json`; narration-only receipt: `negation-area-narration-diff.json`. New rows have zero played-card or negation-area contract gaps. P474 remains explicitly queued for original-skill protection support.
