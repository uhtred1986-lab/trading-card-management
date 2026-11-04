# Chosen keyword negation follow-up (4 Nov 2026)

Bounded follow-up to notes-S: BT2-048#0 and DB1-093#20 now require choosing one available keyword. “Up to 1” still offers None. The optional `mandatory` field preserves absent/false stored rules and survives primitive lowering in both rulesets and language round-trips. Larger-count keyword-negation pairs are refused before generic card choice can misread them; supported “choose all keyword skills” remains supported.

R-400 records RM 5-2-3/4/6 and 9-1-5. R-401 records official Q&A BT2-048, DB1-093 and BT6-057: a keyword on a Barrier card can be chosen, including Barrier itself, because the skill is chosen. No matching official errata exists. Barrier bypass is local to this operation, including legacy stored operations; normal card choices retain their ruleset protection, and beNegated prohibitions still apply. This runtime correction can change play without changing a corpus reading. Fusion has no Barrier hook; both games still test macro lowering and the operation contract.

## Per-instance continuation in PR #1249

Those same Q&As require only one instance of a keyword to be negated and allow a newly granted instance afterwards. The continuation in the same PR now carries printed skill indexes, timed grant IDs and standing grant IDs through the menu and saved frame. It applies the existing `negateSkill` or `negateGrantedSkill` effect to that one instance. Other copies and later grants remain active. Parameterized keywords use their actual names (Double Strike, Triple Strike), and duplicate grants show their source and duration.

Printed face identity prevents a front-side index from silencing an unrelated back-side skill; copied indexes retain their own identity across a target's flip. A saved new menu revalidates the original instance, card incarnation and Hidden/Revealed transition count instead of silently choosing a replacement. Hooks retain the actual printed index, including when Bond removes an earlier same-name instance; selectors honor per-index printed negation. Existing board effect fields still show the affected keyword. `ScriptFrame.keywordChoices` and `ContinuousEffect.skillSide` are optional engine-state fields; the client Snapshot shape is unchanged.

Legacy pending menus retain their old name-based index order when their complete options still match, selecting one live instance for that name; a changed legacy menu does nothing rather than shifting to a different choice. Already-resolved old `negateKeyword` effects remain name-wide because they contain no selected-instance identity to recover. Standing grant IDs retain their existing format; new chosen effects carry optional grant-source Hidden/Revealed provenance, while older resolved grant-negation effects preserve their saved behavior. Explicit named-keyword negation also keeps its existing name-wide behavior.

BT22-037#0's follow-up “it gains that skill” remains unread. This batch does not add that separate choose-and-copy operation. Continue with the remaining selector findings in notes-S after integration; do not reopen the now-addressed duplicate/later-grant defect.

## Evidence

`audit-keyword-negation-4` uses isolated fixture definitions and stored rules: 72 runtime combinations cover alias/primitive, both games, absent/false/true, both seats, selecting Barrier and Blocker, exact/optional legal menus, forged decline rejection, JSON reload, no candidates, negation prohibition, immutable input operations and duration cleanup. Compiler controls cover mandatory real cards, optional BT6-057, unsupported counts and the supported all-keyword form.

Baseline snapshot: `/tmp/arena-round4/catalog.json`, compiled on main `1d3962e4` into `/tmp/arena-round4/before.json`. Final artifacts: `/tmp/arena-keyword4/after.json` and `diff.md`. Batch checks and corpus results are recorded with the commit handoff; no production data is changed.

### Initial mandatory-choice/Barrier batch receipt

Implementation: `cdf3dd6a`, based on main `1d3962e4`. The frozen public Deckplanet catalog was shaped with repo errata; it is not a production database snapshot. Across 6,597 cards / 13,964 skills, totals remain 12,953 read and 1,011 unread. Full JSON comparison (including readings of partially unread skills) found exactly two changed records, only their reading sentences: BT2-048#0 and DB1-093#20 now say “choose 1” instead of “choose up to 1”. No read/unread transitions. BT22-037#0 and BT27-070#10 are unchanged. See [the complete reading diff](keyword-negation-readings.md).

Snapshot SHA-256: `dcfba11b09fe10746a5f86176511bc9edd85c6156f239508a301326440339fb4`; baseline compilation: `c0733390cd26937aa63fd9019b76d99a791016b26ee7a80a6cbcec13ecb4e511`; final compilation: `a0555fdc7e8973e1ef113b75192268dd4c721330d583d39f7f0e30d60736a8f5`.

Passed: typecheck; changed-file eslint (existing unused `SAME_CHARACTER_AS_PLACED` warning); focused 72-scenario suite; keywords then wordings; audit-effects-2; rulesets; lang; language; rulings. The compiler controls also protect BT27-070 and all-keyword negation. Fusion fixture fuzz completed 40/40 games with zero crashes, interruptions or action-limit failures. All checks used no database.

Teach's existing prompt-size assertion still fails: 40,146 characters against 40,000, versus 40,104 on the base. The prompt-budget correction is in draft PR #1248 and must accompany integration. The full gate and full arena run belong to combined integration per the batch process; they were not run for this independent batch. Only language fixtures were regenerated; the Snapshot shape did not change.

Independent review caught the unsupported-count fallback, a vacuous immutability assertion and an overbroad refusal guard; all were corrected and checked. No remaining blocker for this bounded batch. No new pending owner ruling. After integration, deliberately refresh BT2-048 and DB1-093 records for mandatory choice; no production records were changed here. The instance-identity continuation is recorded above and validated below.

### Per-instance continuation receipt

Implementation: `1cb07aef`, continuing the same branch and PR #1249. `keyword-negation-instances.ts` passes 64 scenarios across both games and seats, including actual battle damage after duplicate/parameterized negation, printed/timed/standing/copy identities, later grants, source/duration labels, saved prompts, legacy menus, face changes, target/source Hidden/Revealed transitions and expiration/reentry. The existing `audit-keyword-negation-4.ts` 72-scenario suite also passes. Both use isolated fixture definitions and persisted rules.

Final typecheck and changed-file eslint passed (existing unused `canPayPriceProgram` warning in host.ts). Compatibility checks passed: keywords then wordings, granted-heroic-602, granted-absorb-930, quoted-grants-1166, keyword-param, mechanism-3, mechanism-4, contract, rulesets, lang, language and rulings. The final Hidden/Revealed provenance correction was checked again with both focused suites, granted-heroic, typecheck and lint. Teach still fails its existing 40,000-character assertion at 40,146; use the fix already in PR #1248 at integration.

The final runtime passed another 40 Fusion fixture games: 40 completed, zero crashes, interruptions or action-limit failures (`/tmp/arena-keyword4/instance-fuzz-final.json`). Independent adversarial probes confirmed actual damage, Bond-filtered hook index, legacy identical-label menus, both hide/reveal cases and preserved legacy resolved standing negation with a nonzero hidden count. No remaining review blocker.

Compiler output and reading sentences did not change in this continuation, so the complete frozen-catalog comparison above remains the reading evidence; no redundant corpus compilation was run. Only language documentation fixtures were re-emitted. Client Snapshot fields are unchanged; the standalone contract check passed. Full integration checks remain deferred to the combined batch, and no production records were read or written.
