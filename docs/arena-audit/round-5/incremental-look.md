# R527: incremental private deck inspection

The kernel slice supplies the runtime and read-only preview. The second slice admits only the exact complete BT1-061 skill 0 and EX02-01 skill 10 compiler lines; P-045 front and the wider look family remain outside this admission.

## Source and behavior

The complete raw cards, compiled baseline records and official FAQs are frozen in `scripts/verify/fixtures/incremental-look-5.json`. BT1-061's five FAQs allow stopping after each inspected card without declaring a number first; its corrected text requires shuffling afterward. The official card image confirms the native play cost of two energy including one Green. EX02-01's four FAQs likewise allow stopping after each card and require all leftovers at one selected end, rather than splitting them. Its unfiltered hand addition is private. Comprehensive rules 20-12-1 through 20-12-3 keep looked-at cards in their original area and private to the skill master, with shuffle unless another handling instruction applies.

The initial prompt exposes zero cards. Next exposes one additional card, Stop uses exactly that prefix, and reaching the available limit requires Continue so the last nonmatching card remains inspectable. Inspection never moves cards or advances RNG. After selection Gohan shuffles, including when zero cards were inspected. Trunks chooses a common end and orders the leftovers, with the first selected card nearest that end.

Source capture comes from the original ordinary free Auto pending record. Saved state binds the original script and source, exact deck occurrences and definitions, inspected prefix, historical character eligibility, native choice and mode history, and arrange order. Source departure after activation remains valid. Copied, taxed, paid and specialized producers remain explicitly bounded. Invalid or absent receipts, forged candidates, modes, orders and Hand move continuations refuse before projection or execution. Legacy nonoptional look expansion remains unchanged; raw incremental reveal is restricted to private, unfiltered single-deck inspection.

## Verification and exact admission

The native harness compares every compiler row to the frozen baseline with an explicit allowlist: `upTo` and narration on both Auto rows, plus the Trunks arrange tail, pattern and narration. The Over Realm sibling stays identical. Setup supplies the source in hand and the resources; subsequent play, payment, Auto declaration, counter windows and choices use native actions. The first kernel commit staged these differences; the second uses actual compiler output, without staging. Primitive tests alone override the admitted look operation to exercise other sides, ends and limits.

The focused suites cover both seats, actual Gohan energy payment and Trunks Over Realm 3, stop at zero/one/maximum, empty and short decks, top/bottom and own/opponent inspection, limits above 100, source departure, JSON save/resume, deterministic replay, input purity, malformed receipts, exact filtered choices, common-end ordering permutations and Trunks end-turn Warp. They also check full snapshot equality under unseen suffix substitutions for both viewers. Read-only previews use authenticated CardViews; generic concealed IDs stay masked. No unvalidated receipt is exposed through the context-free reveal helper.

`incremental-look-5.ts --emit` (also `--emit-inspection`) refreshes native empty-prefix and final-nonmatching-prefix snapshots. Images are deliberately absent: the preview includes name, printed text, colors, cost, power and combo values. Parent verification owns both skins at desktop/mobile widths and the final combined gate.

## Discovered tail defect

The existing exact EX02-01 compiler output moves leftovers to a common end without an order prompt. The second slice replaces each terminal move with `arrange` on the same original leftover target: those cards already remain in the deck, so no preceding move is needed. This changes tail operations, pattern and read summary; it is not a byte-identical tail preservation. The generic top-or-bottom and bottom-any-order parsers remain follow-up work requiring separate source review.

Final native acceptance also covers Trunks stop0/stop1 and choose1 after inspecting two cards, both seats and either end. The private Hand card is visible only to its owner in full snapshots including beat projection. Each Next asserts no inspected IDs in events or opposing snapshot/beat projection.

Checked for the exact admission slice: 48 native/visibility cases, 86 saved/empty contracts, 22 language/expanded-native and near-match cases, TypeScript, targeted ESLint, and rulings. The existing `audit-effects-1` suite reaches an unrelated stale BT19-093 under-activation assertion on the inherited head; the coordinator owns updating that expectation with the corresponding under-activation work. No database, full coverage scan, build or push was run in this worker.
