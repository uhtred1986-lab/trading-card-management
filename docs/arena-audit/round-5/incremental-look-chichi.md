# R532: Chi-Chi's exact played Auto

This admission follows the independent source-trait correction commit **eb405a89**. The full source, sole Auto record, all three normalized FAQs and official-image provenance are frozen in `fixtures/chichi-trait-source-5.json` and the shared ordinary-play fixture. [The source receipt](chichi-trait-source.md) records the verified Earthling/Goku's Lineage traits. No source or identity normalization is introduced by this admission.

The exact admitted line is:

> [Auto] When you play this card, look at up to 3 cards from the top of your deck, choose up to 1 ≪Goku's Lineage≫ from among them and add it to your hand, then shuffle your deck.

BT4-089 has no back face or sibling skill. Its native definition passes through `correctCardFields`, retaining the complete printed skill and both corrected traits. Native play pays the image-verified one Yellow energy. The genuine matching target is **BT4-082 Kakarot**, whose complete frozen catalog identity and printed text are retained; the target is not played, and its unspecified cost/combo defaults are not pricing claims.

## Rule and record boundaries

The own FAQs allow stopping before three without declaring N, forbid inspecting unrelated Deck/Life cards, and require revealing the chosen Hand addition. RM20-12 keeps inspection private and in the original area before shuffling; RM3-1-7 requires the specified Hand addition's reveal; RM5-2-7 permits declining the search. Existing R527/R529/R530 receipts, historical eligibility and candidate-equivalence guards implement this exact line without a runtime change.

Only `ops[0].upTo` and `reads` differ from the entire frozen original Auto row. The source-specific suite separately compares full records with old and corrected trait lists, proving that the trait correction itself changes no compiled skill. It then compares the full frozen row with exactly the two R532 admission changes. The original fourteen R531 cards retain the same complete-row assertions and native scenarios. No generic look wording, producer or identity filter is newly admitted, and Bio-Man remains outside this slice for its separate source-spacing review.

## Native evidence

The shared `incremental-look-played-5.ts` matrix now covers fifteen cards. Chi-Chi contributes **28 cases**: both seats, authentic paid Hand play and original free pending Auto, stop0/1/3, choose0/1, final nonmatching face before Continue, exact ordered prefix, no Deck/RNG changes during Next, actual selected Hand addition and shuffle, genuine Kakarot match, complete public/private event and Snapshot checks, JSON replay and input purity, short Deck, and native empty-Deck loss before inspection. Forged/unseen/nonmatching choices refuse. Case-normalization/whole-trait/Extra-card controls and the saved active-source departure are explicitly synthetic identity and movement-primitive controls, not additional printed cards or concurrent legal actions. Four near-match lines changing maximum, trait, tail or played producer to attacks do not gain admission. Both corrected source traits are asserted directly in the native context.

**422 total cases pass**: R531's existing394 plus Chi-Chi28. The focused source-correction suite also passes after the full-row proof update. Counted stop0 variants publish no chooser, and empty native Deck cases prove ordinary deck-out rather than manufacturing an impossible empty-deck played Auto. Existing R527 contract tests retain empty-prefix primitive coverage.

Compatibility passes: Gohan/Trunks48, saved/empty contracts86, language22, Babidi29 and Cheelai53, with zero filtered-reveal failures. Final `tsc --noEmit`, touched-file ESLint, whitespace check and rulings validation pass (303 on this worker; the separately integrated R528 adds one on the parent head). No VM, source correction, Snapshot schema, UI, registry or runner changes. No database, dependency, full scan, full gate, build or push was performed; parent owns integration and final registration.
