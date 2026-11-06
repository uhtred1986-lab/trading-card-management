# Battle Area skill bans and Teach budget (4 Nov 2026)

Continuation in PR #1249 after the explicit-area fixes.

## Teach check repaired

Commit `766971a3` includes the isolated prompt-budget correction directly in this PR. `teachSystem` reserves space for its introduction and separator before asking for the language reference. The existing renderer drops optional detail rather than language rows. On this branch the complete prompt falls from 40,146 to 20,955 characters, below the existing strict 40,000-character check.

`scripts/verify/teach.ts` and changed-file eslint pass. Teach was checked again after the skill-ban describer changes, with the same passing result and size. This PR no longer requires another draft PR to make that check pass; PR #1248 retains its separate condition work and the same isolated budget correction.

## P-093 activation scope

P-093#20 says the opponent cannot activate skills on Battle Cards for the turn. RM 20-1-2 defines an otherwise unspecified Battle Card as one in the Battle Area. The card's own official Q&A explicitly permits Combo and Drop Area Autos and says Permanent skills are not activations. R-020 establishes that Blocker counts as an activated skill; it does not override the area restriction.

The previous compiler applied `fromArea: "battle"` only to `activateSkill`, while emitting a separate unscoped `activateCounter` prohibition. It therefore incorrectly banned a Battle Card's Counter activated from hand. R-403 applies the same area to all three projections: ordinary activation, Counter and Blocker. Explicit “in any area” wording and direct Counter bans retain their broader behavior. The existing runtime already enforces `fromArea`; no new VM mechanic or schema field was needed. The reading now names the Battle Area restriction on the Counter and Blocker parts too.

The focused stored-rule suite checks both players: an actual hand Counter negates the attack and plays itself, global controls still reject it, the controller and Extra Counters remain unaffected where appropriate, Combo/Drop Autos resolve, Permanent power applies, and the ban expires. Runtime prohibition queries also check a Battle Area Counter is prohibited. The engine currently enumerates hand Counter candidates only, so a rejected forged Battle Area Counter action is not evidence of otherwise-supported Battle Area Counter activation; this change does not add that capability.

## Corpus method

The baseline is the preceding full-record snapshot `/tmp/arena-life4/after-full.json`, SHA-256 `c5a6ef70aab360c7f2a865b849cd29a024130240c6e1a2e5bc93f59aca919504`. Teach changes no compiled rule. The same frozen public catalog and full `SkillRecord` comparison used in [the area receipt](on-board-area-followup.md) checks conditions, costs, operations, triggers, usage, validity and unread clauses as well as readings. No database is accessed.

## Final receipt

Implementation: `543b3953`. Full comparison found exactly one changed record, P-093#20: `ops[1].fromArea` and `ops[2].fromArea` are now `battle`, and the reading reports both restrictions. Sparking 10, cost, trigger, usage, other operations and unread clauses are unchanged. Every other record is identical, including explicit any-area cards. [Changed-field evidence](battle-skill-ban-program-diff.json) includes the printed wording and both structures. Final artifact `/tmp/arena-ban4/after-full.json` has SHA-256 `eba20918c78a6183316c13ab6e4d0c4c98f3d98cb36fc1e719eaa2d89f47bcb8`. Totals remain 13,964 skills, 12,953 read and 1,011 unread, with no support-status transitions.

Passed: `battle-skill-ban-4.ts` (8 scenarios across both seats), typecheck, changed-file eslint (zero errors; pre-existing unused `SAME_CHARACTER_AS_PLACED` warning), prohibition-catalog-4, audit-selectors-3, prohibition-catalog-3, u1b-prices-757, keywords then wordings, rulesets, language, lang and rulings. The old prohibition-catalog-4 assertion that banned a hand Counter was corrected; the new suite proves actual hand-Counter activation and resolution. The rulings ledger has zero pending decisions. Independent review checked all full-record differences and the gameplay controls, with no remaining blocker.

Final-source Fusion fixture fuzz completed 40/40 games, zero crashes, interruptions or action-limit failures (`/tmp/arena-ban4/fuzz.json`). Teach passed again on the final source at 20,955 characters. No new fixture emission or VM/schema shape change was needed. Full gate and full arena run remain for combined integration under the batch process.

The complete PR now changes eleven reading records from its main branch point. After integration, include P-093 in the deliberate record refresh alongside the prior ten affected records; respect confirmed records. No production records were read or changed in this work.
