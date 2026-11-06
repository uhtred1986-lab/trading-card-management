# R527: incremental private deck inspection

This first slice supplies the runtime and read-only preview. It does not yet change compiler records or claim additional card coverage. The next reviewed slice is limited to BT1-061 skill 0 and EX02-01 skill 10; P-045 front and the wider look family remain outside this admission.

## Source and behavior

The complete raw cards, compiled baseline records and official FAQs are frozen in `scripts/verify/fixtures/incremental-look-5.json`. BT1-061's five FAQs allow stopping after each inspected card without declaring a number first; its corrected text requires shuffling afterward. The official card image confirms the native play cost of two energy including one Green. EX02-01's four FAQs likewise allow stopping after each card and require all leftovers at one selected end, rather than splitting them. Its unfiltered hand addition is private. Comprehensive rules 20-12-1 through 20-12-3 keep looked-at cards in their original area and private to the skill master, with shuffle unless another handling instruction applies.

The initial prompt exposes zero cards. Next exposes one additional card, Stop uses exactly that prefix, and reaching the available limit requires Continue so the last nonmatching card remains inspectable. Inspection never moves cards or advances RNG. After selection Gohan shuffles, including when zero cards were inspected. Trunks chooses a common end and orders the leftovers, with the first selected card nearest that end.

Source capture comes from the original ordinary free Auto pending record. Saved state binds the original script and source, exact deck occurrences and definitions, inspected prefix, historical character eligibility, native choice and mode history, and arrange order. Source departure after activation remains valid. Copied, taxed, paid and specialized producers remain explicitly bounded. Invalid or absent receipts, forged candidates, modes, orders and Hand move continuations refuse before projection or execution. Legacy nonoptional look expansion remains unchanged; raw incremental reveal is restricted to private, unfiltered single-deck inspection.

## Verification and staged admission

The native harness first compares every compiler row to the frozen baseline, then stages `upTo` and the reviewed Trunks arrange tail. Setup supplies the source in hand and the resources; subsequent play, payment, Auto declaration, counter windows and choices use native actions. This is a kernel proof, not compiler adoption.

The focused suites cover both seats, actual Gohan energy payment and Trunks Over Realm 3, stop at zero/one/maximum, empty and short decks, top/bottom and own/opponent inspection, limits above 100, source departure, JSON save/resume, deterministic replay, input purity, malformed receipts, exact filtered choices, common-end ordering permutations and Trunks end-turn Warp. They also check full snapshot equality under unseen suffix substitutions for both viewers. Read-only previews use authenticated CardViews; generic concealed IDs stay masked. No unvalidated receipt is exposed through the context-free reveal helper.

`incremental-look-5.ts --emit` (also `--emit-inspection`) refreshes native empty-prefix and final-nonmatching-prefix snapshots. Images are deliberately absent: the preview includes name, printed text, colors, cost, power and combo values. Parent verification owns both skins at desktop/mobile widths and the final combined gate.

## Discovered tail defect

The existing exact EX02-01 compiler output moves leftovers to a common end without an order prompt. The approved second slice replaces each terminal move with `arrange` on the same original leftover target: those cards already remain in the deck, so no preceding move is needed. This changes tail operations, pattern and read summary; it is not a byte-identical tail preservation. The generic top-or-bottom and bottom-any-order parsers remain follow-up work requiring separate source review.
