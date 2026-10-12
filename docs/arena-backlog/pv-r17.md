---
title: [P0] Arena: Resolve card-specific combo Autos at the combo-entry checkpoint
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, enhancement, area:arena-vm, phase:capability-gap, model:opus-5
stage: ui
issue: 672
status: closed
priority: P0
touches: src/lib/arena/text/triggers.ts, src/lib/arena/vm/triggers.ts, src/lib/arena/vm/battle.ts, src/lib/arena/rulesets/dbs/triggers.rules
---
Before #672, a normal card-specific “when you combo with this card” Auto was bound to `comboed`, which both engines emitted during Combo-to-Drop cleanup. Its power, removal and draw effects therefore arrived after damage. The #573 review reproduced BT3-043 at 15,000 attack power (10,000 Leader + printed 5,000 combo), missing the conditional 10,000 combat bonus; its Auto draws only at cleanup.

Source: `docs/rules/rulemanual.txt` §§5-7-5-2/3 and 5-7-6 (Combo entry then checkpoint), versus the distinct §8-5-10-1 end-of-battle wording. Owner-reviewed BT3-043 wording: #539. The original boundary and corrected current-DSL behavior are recorded in `scripts/verify/grouped-readings-573.ts`; the independent entry proof is `scripts/verify/combo-entry-672.ts`.

Build: distinguish ordinary combo-entry self Autos from the explicit “at the end of the battle after you combo with this card” family. Preserve source, master, paid costs and per-occurrence identity through prompts/reload. Ensure the ordinary Auto resolves before the player adds another combo or damage is calculated. Preserve #670 hand-origin/end-of-battle behavior and #609's separate cleanup ordering ownership. Honor pinned older rule records without rewriting confirmed database rules.

Verified files: `src/lib/arena/text/triggers.ts`, `src/lib/arena/vm/triggers.ts`, `src/lib/arena/vm/battle.ts`, `src/lib/arena/rulesets/dbs/triggers.rules`, legacy `src/lib/arena/engine/engine.ts`/`triggers.ts`, glossary and dedicated independent verification. The delivered touch set also includes shared Trigger types/vocabulary, generated ruleset files, payCost actor validation, suite registry, contract vocabulary fixture and structured capability metadata. Serialize with #671's pending selection integration and #609's battle writer. No live DB/paid calls/new dependencies/production settings.

Acceptance:
- [x] BT3-043 with blue Leader/life ≤4 supplies its printed combat bonus and return/draw at combo entry; red Leader/life >4 does not. State, power, zones and events are explicit before damage.
- [x] Hand and legal Battle Area combos, multiple copies/both players, invalid/stale answers, costs, actual-area/source-departure guards and JSON reload fire exactly once per genuine entry. Existing replacement-route applicability and its evidence limit are stated below.
- [x] Explicit end-of-battle Autos remain late, bind hand origin correctly and do not also fire at entry. Z-Energy/Drop departures cannot cause duplicate ordinary combo triggers.
- [x] Exact prior stored rule records remain correctly interpreted; public projections do not leak hidden sources or private metadata. Legacy oracle preservation or any intentional rules-only parity change is explicitly reviewed.
- [x] Typecheck, lint, focused scenarios, full tests, build, language/contract generation and capability checks pass. Owner-run catalog reading diff/fuzz limits are explicit.

Priority P0: this changes combat and affects playable card skills. #573 continues to own the grouped/shared-condition compiler reading; #609 remains the later cleanup checkpoint issue. This ticket owns neither offline work nor speculative catalog-wide coverage.

**Delivered scope and proof.** `scripts/verify/combo-entry-672.ts` exercises genuine legal hand and Battle Area entry, ordinary/compound/Super Combo wording, BT3-043 conditions and 25000 combat power, both players and copies, paid/reloaded/invalid/stale answers, explicit late Autos, Z-Energy/Drop departures, prior stored records and missing hand-origin refusal. `grouped-readings-573.ts` now asserts the corrected current rules-engine entry and combat result while preserving the legacy 15000/cleanup expectation. `payCost` rejects a player answering another player’s payment atomically. The language fixture adds only the entry trigger vocabulary; the legacy probe digests remain unchanged.

Current DBS DSL adds `comboUsed` while retaining `comboed` as the stored legacy alias. Older confirmed ordinary rows bridge to entry under the current DSL without database rewrites; legacy runtime and archived older DSL retain their historical timing. Explicit end-of-battle wording remains late. Printed hand qualification uses captured actual entry source, with an explicit guarded interruption when provenance is absent. #609 remains the distinct later cleanup checkpoint limitation.

**Replacement evidence limit.** Current `leaveRoute` treats Combo as a held host zone, so an ordinary Battle-to-Combo declaration does not use the existing leaving-play replacement route. No applicable real Combo-entry replacement was found or manufactured. The actual-area guard is tested with a missing/forged arrival; the claim is only that a self Auto cannot pend without genuine Combo occupancy. Future replacement routing would need its own applicable scenario.

**Validation.** `DATABASE_URL=''` typecheck, lint, full tests and production build passed on the integrated source. Lint retains five prior prototype warnings. The capability generator records 29 narrow scenarios, four named runtime gaps and 29 VM sites. Exact final combined-head checks are recorded in the delivery PR. Local fixtures prove these bounded behaviors; live catalog reading-diff/fuzz-40 and production save/device checks remain owner-run. No confirmed rules, live database or production settings were rewritten, and no paid calls or new dependencies were introduced.
