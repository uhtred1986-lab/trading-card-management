# Each-name and either-player Awaken gates — 4 Nov 2026

Intermediate checkpoint in PR #1249, source head `85d08957`. Complete support remains in progress.

**R-394** restores four native Awaken payment conditions under RM 22-2-3 and the printed cards:

- SD18-01: either player's life is at most four, or either player individually has at least three Z-Energy. Counts are not summed across players.
- BT22-002: own life at most four, or at least one each of red Gamma 1: SH and red Gamma 2: SH in play. The printed count and color apply independently to each character.
- BT14-032: own life at most four, or both a blue Minotia and a blue Tapion in the own Drop Area.
- BT20-002: own life at most four, or at least one each of red Koitsukai, Panchia and Bollarator across the own energy, Z-Energy, Battle Area and Drop.

The price reader's each-slot refusal exempts only the exact existential named-pair condition, optionally following the life alternative. Unsupported each-slot action payments remain refused. Counts observe protected cards without targeting them. The merge retains R-442's dash-separated SD22 alternative.

Combined verification passes **460 scenarios**: new gates 102, previous Awaken 146, combo replacement 84, explicit mill 46 and invocation 82. Tests independently vary names, colors, area, side and thresholds, include duplicates/multicolor and protected cards, exercise both seats through stored rules, and verify native flip/draw/life effects. Typecheck, changed-file lint and rulings (198, zero pending) pass. Worker compatibility also covers audit conditions 3, phrasing 6/9, shared price readers, disjoint sends, typed payments, language and Teach. Fixture fuzz completes **40/40**, zero crashes, interruptions or action limits. Fusion fuzz remains shared-runtime regression coverage, not exhaustive card support.

The full-record comparison changes exactly **SD18-01#20, BT22-002#10, BT14-032#10 and BT20-002#10**, only payment readability and its condition. All other payment fields, effects, printed text, usage, trigger and narration remain unchanged. Every record equals the reviewed worker output, and SD22's full record remains identical. [Full changed-field evidence](support-eighth-program-diff.json). Narration-only diffs do not expose these four required refreshes.

Totals remain **12,981 readable / 983 unread**, with no readability regression. Additional readable-record runtime gaps fall from 40 to **36**; broader additional reasons are 352, with 2,559 contextual unknowns. Snapshot `/tmp/arena-support5/combined/eighth-awaken-full.json`, SHA-256 `23b4335a763a29f19cd6d415e7afe89e85ded721dc01200799436877bb7e41a9`. Fuzz: `/tmp/arena-support5/combined/fuzz-eighth-awaken.json`.

Shared Counter timing and its all-area negation-protection prerequisite continue. Z-Awaken needs procedure checks before more action prices are admitted, including Main/Battle timing, per-turn usage and placement rather than ordinary play. Replacement-play response timing and the Battle invocation owner decision remain open. No production refresh, database change, deployment or merge occurred; the full integration gate remains deferred until the complete combined deliverable.
