# First combined full-support batch — 4 Nov 2026

This checkpoint continues the owner’s complete-support request in PR #1249. It is not completion of that request. The remaining queue continues in separate worktrees.

## Changes and sources

- **Condition grammar, R-384 (`33aeeba7`):** retain a missing punctuation boundary on BT25-133; distribute the mono-red predicate over BT13-020’s Leader and energy; preserve the names, colour, controller and Battle Area of BT20-017/019’s host; recognize current-play subjects and their replacement effects on BT27-073 and BT21-149. The shared active-voice replacement correction also repairs BT18-140. BT27-073’s leading condition keeps its existing scope over both effects; BT21-149’s self-play precedes its separate additional condition. BT13-020’s original-cost/free-Counter restriction remains unread and is not claimed as complete.
- **Observational count conditions, R-385 (`671975c6`):** checking whether cards exist does not choose or affect those cards. Boolean count conditions now include Barrier, cannot-be-chosen and immune cards while preserving side, area and filter requirements. Actual choices and the default selector API still enforce protections. This runtime change affects existing compiled rules without record changes, as the earlier numerical-count correction did. Sources: RM 3-1-2, 20-4-1 and 22-16.
- **Turn-end and Arrival triggers, R-360/R-361 (`1aa146ce`):** BT12-014, BT16-014 and BT16-015 require this occurrence to have been played from hand this turn and remain in the valid area at turn end. The BT16 cards’ own Q&A excludes a source that has gone to Drop. BT20-001’s back, BT20-032 and BT20-137 watch successful Arrival plays of the specified multicolour Battle Card. Existing successful-entry memory is reused; a replaced play does not trigger them. BT20-032 can be heard in Combo because its printed Auto pays itself from there; ordinary Combo watchers do not gain a blanket permission. RM 22-29 supplies the Arrival procedure. No new event or serialized field is introduced.
- **Catalog source correction (`8b2d3742`):** Bandai’s printed BT26-031 front supplies the omitted number three in its Z-Energy Awaken threshold. This corrects source text only; the payment parser is being worked separately.

The under-host reader also changes six existing full programs whose narration is unchanged: EX25-11#0, EX25-12#20, BT17-092#0, BT17-100#0, BT20-091#10 and BT20-092#0. Each now retains its printed Battle Area restriction, plus “your” where printed. The Piccolo pair’s power target retains that same restriction. These records belong in the eventual refresh list even though a reading-only diff misses them.

## Verification

Combined head `1aa146ce`: all 62 actual trigger scenarios, 52 condition/Counter scenarios and eight stored count-condition scenarios passed in one process. Earlier combined checks also passed the seven known condition corrections and the 22 counted-cost scenarios. Typecheck passed. Changed-file eslint and applicable older suites passed on the reviewed workers, including audit-triggers-3, union-played-other-930, audit-conditions-2, delayed-replacement-1, phrasing-batch-8, pile-permanents, audit-effects-1, audit-triggers-2, fixed-host-price-1123, phrasing-batch-3, audit-selectors-3, lang, language, Teach and rulings. The existing unused import warning in effects.ts remains; no lint error was introduced.

Trigger proof includes real declared Arrival with payment, Counter: Play replacement, failed or departed sources, Combo-origin payment, both seats and turn owners, and protected subjects. Condition proof includes live static bonuses, host/controller/area controls, actual Counter: Play replacement and power/cost boundaries. Stored rule and language roundtrips are checked. No database, paid API or dependency installation was used.

Fusion fixture fuzz on the combined runtime completed 40/40 games with zero crashes, interruptions or action-limit failures (`/tmp/arena-support5/combined/fuzz-first.json`). This is a regression check, not exhaustive Masters deck qualification.

## Corpus and continuing work

The final full-record artifact is `/tmp/arena-support5/combined/first-full.json`, SHA-256 `6670b1021cd4f9edf532e8c902843e26eacc9556176b71d8a16c2595ecfa474e`. Against the condition-port checkpoint `29326703`, exactly 20 full records change: eleven newly readable skills, two other reading changes, six host-scope changes with identical narration, and the source correction. All changed records were checked against their print. A three-way comparison with both worker artifacts confirms there is no unexplained combined program change; the source correction is the only root-only difference. [Full changed-field evidence](support-first-program-diff.json).

Totals: 13,964 skills, **12,967 readable / 997 unread**, with no read-to-unread transition. Additional explicit runtime gaps remain tracked separately. No production rules have been refreshed. The full integration gate remains for the combined deliverable; continue the payment and invocation mechanisms rather than treating this checkpoint as completion.
