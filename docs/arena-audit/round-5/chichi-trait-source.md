# BT4-089: restore the missing Earthling trait

The frozen source for **Dynasty's Solace Chi-Chi (BT4-089)** lists only `Goku's Lineage`. Bandai's official image prints **Earthling/Goku's Lineage**. The complete original card, its sole Auto record, all three supplied normalized FAQs, and image provenance are frozen in `scripts/verify/fixtures/chichi-trait-source-5.json`.

Official image: https://www.dbs-cardgame.com/images/cardlist/cardimg/BT4-089.png

SHA-256: `d623c4ff5c28c048d6db4ade3c476ee251181f2858ec89f246a1040aa35ba0d6`

Worker and coordinator personally inspected the image. It also shows Yellow, cost 1 with one Yellow orb, power 5000, and character Chi-Chi. This correction changes **only the trait list**; it does not add a specified-cost correction or modify skills, names, characters, colors, costs or power.

## Exact correction and wiring

The existing `FIELD_CORRECTIONS` API now accepts a typed traits pair. BT4-089 changes only when the source list equals exactly `["Goku's Lineage"]`, in that order and spelling. The result is `["Earthling", "Goku's Lineage"]`. Applying it again is idempotent. Other lists, including already-corrected, differently ordered, differently cased and unrelated traits, remain untouched. Mismatch reporting exposes an upstream-fixed or otherwise changed list rather than silently claiming the original source still matches. Missing trait input is also reported for this correction.

Traits remain optional on the shared field-input type for backward compatibility with existing name/character-only callers. Actual catalog shaping, raw sync mismatch collection and `scripts/arena-snapshot-compile.mts` all provide traits. The shaper uses the corrected result; the offline snapshot compiler passes it into `cardDefFrom`. All repository call sites were reviewed: those two production paths plus the existing `errata-official-2` verification calls. The coordinator owns the separate recovery/full-snapshot.mts scratch tool and will update it outside this repository commit.

No correction is applied by similarity or generic punctuation normalization. Fusion IDs remain separate. No database write was made: the ordinary future catalog sync will apply this source correction through the established errata path.

## Proof and scope

`chichi-trait-source-5.ts` builds a Deckplanet-format row from the complete frozen source and runs the actual `shapeCatalog` function. It asserts both corrected traits and every other available source field unchanged; actual `cardDefFrom` receives both traits. It covers repeat correction and repeat shaping, input purity, isolated output arrays, absent source, upstream-fixed source, unexpected source lists, missing optional input, another Masters card, Fusion shaping, and all five pre-existing name/character corrections through both the API and catalog shaper.

The source-only commit eb405a89 preserved the full original Auto row after shaping and loading and added no `look.upTo` admission. The separate R532 admission now changes exactly the optional flag and narration. The source suite still deep-compares complete records before/after trait correction, then checks the full frozen row with only those two reviewed admission changes. See [the separate admission receipt](incremental-look-chichi.md). Bio-Man's Dr.Uiro/Dr.Kochin identity-spacing issue remains a separate source review. No VM, rules compiler, glossary, ruling, registry or runner is changed here.

Verification: `chichi-trait-source-5.ts`, `npx tsc --noEmit`, touched-file ESLint and whitespace diff check all pass. No full scan, full gate, build, dependency installation, database use or push.
