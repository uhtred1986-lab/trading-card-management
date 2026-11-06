# Energy-cost bounds from area counts (4 Nov 2026)

Continuation in PR #1249 after the Battle Area skill-ban fix.

## Reading and implementation

R-404 teaches one Battle Card whose energy cost is at most the number of cards in a named area. BT22-127#0 counts the controller’s Z-Deck and sends the chosen opponent’s Battle Card to Warp, ignoring Barrier. P-300#20 counts the opponent’s hand and KOs the chosen opponent’s Battle Card, ignoring Barrier. BT20-064#10 counts mono-green Saiyan cards in the controller’s Drop and KOs the chosen opponent’s Battle Card, retaining its green Son Goku: GT Leader gate and ordinary Barrier restrictions.

The compiler reuses `sumAtMost` with an existing numeric count expression: for exactly one target, its sum is its individual energy cost. It reads current cost and the current area count at resolution. The shared numeric energy-cost reader also now applies the specified-cost minimum required by RM 1-2-5, including after cost changes; this corrects existing numeric energy-cost expressions as well as the new bounds. There is no new serialized rule field, Snapshot field or database migration. The older per-card repetition reader also excludes this cost comparison, so mandatory “choose 1” remains one mandatory target rather than becoming a count of targets. Multiple-target bounds, complex unions and unsupported comparators stay unread; BT17-147, BT17-149 and BT15-145 are not claimed as supported.

Sources: RM 1-2-5 (effective energy cost), 3-1-2 (area counts are public), 20-4-1/20-4-1-1 (immunity and direct targets), and 22-16 (Barrier protects choices). The local official card-Q&A and errata snapshots contain no specific answer or correction for these three lines. The compiler keeps target side separate from counted side and refuses filtered hidden-area counts.

## Numerical counts and protections

Review exposed an existing prerequisite: numeric count expressions reused target selection and could omit cards protected from being chosen or affected. Numeric amounts now observe matching cards without applying Barrier, cannot-be-chosen or immunity exclusions. Actual choices still apply all three protections. Area, identity, filter and visibility rules remain in force. The internal observation mode propagates through alternative areas and under-card host lookup.

This runtime correction also affects existing numerical count expressions with unchanged compiled records. The frozen corpus contains 126 existing records with such expressions in their operations; a corpus diff alone cannot prove their runtime behavior. The independent regression exercises BT28-022’s existing power reduction with an immune counted card, on both seats. Prior summed-cost choices, undefined X costs and captured subject information also verify the specified-cost minimum. Boolean count conditions keep their existing path and are outside this change.

## Corpus and validation

The baseline is `e0c68445` using the previous full-record artifact with SHA-256 `eba20918c78a6183316c13ab6e4d0c4c98f3d98cb36fc1e719eaa2d89f47bcb8`. The frozen public Deckplanet catalog, shaped by repository errata, has SHA-256 `dcfba11b09fe10746a5f86176511bc9edd85c6156f239508a301326440339fb4`. No production data is accessed.

Full-record comparison changes only the three named skills. All become readable: totals are 13,964 skills, 12,956 read and 1,008 unread, with no read-to-unread regressions. Prices, triggers, usage and printed wording are preserved. BT20-064’s condition is materialized alongside its newly compiled body. The changed operations, readings, patterns and unread lists are recorded in the accompanying structural diff.

Implementation: `9ee4a7f1`. Passed: `counted-cost-bound-4` (22 runtime scenarios across both seats, stored-rule and language roundtrips, unsupported grammar guards), typecheck, changed-file eslint (zero errors; the existing unused `SAME_CHARACTER_AS_PLACED` warning remains), and capability inventory (72 sites). Compatibility passed: audit-selectors-1 (60 records, 6 VM scenarios), audit-selectors-2 (77 records, 12 VM scenarios), phrasing-batch-8 (26 records, 36 both-seat scenarios), energy-bound-979-980, energy-relations-1011, lang, language, Teach, keywords then wordings, readings and rulings (174 rulings, zero pending, 62 cited). The older honest-gap assertions for Cumber and Chilled now assert the supported reading; unsupported neighbors remain guarded.

Independent adversarial review reran the final 22-scenario suite, printed-cost-filter-1097 and counter-cost-907 (76 scenarios), and checked existing numerical amounts, undefined X and captured subject costs. No remaining review blocker. Tests execute stored bodies after the existing activation/trigger and payment boundary; they do not claim new payment or activation mechanics. Existing costs/triggers are checked structurally across the full corpus.

The runtime source completed 40/40 Fusion fixture fuzz games with zero crashes, interruptions or action-limit failures (`/tmp/arena-count4/fuzz.json`). The later compiler-only mandatory-choice guard passed its focused and compatibility checks. No new language or Snapshot field means no fixture emission was needed.

Final full-record artifact: `/tmp/arena-count4/after-full-final.json`, SHA-256 `2284c8aa822b4cf781fc0338e377bd777eef35abfca28a5d5c5d7eff512fcac7`. [Changed-field evidence](counted-cost-program-diff.json) preserves all three printed skills and before/after structures. The final mandatory-choice parser fix only renames each new choice binding from `c1` to `c0` relative to the pre-review artifact, with its references updated consistently. The complete PR now changes fourteen readings from branch point `1d3962e4`.

After combined integration, add these three cards to the deliberate refresh list and respect confirmed records. No production records were read or changed. Full gate and full arena run remain for combined integration under the batch process.
