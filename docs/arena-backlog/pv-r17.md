---
title: [P0] Arena: Resolve card-specific combo Autos at the combo-entry checkpoint
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, enhancement, area:arena-vm, phase:capability-gap, model:opus-5
stage: ui
issue: 672
priority: P0
touches: src/lib/arena/text/triggers.ts, src/lib/arena/vm/triggers.ts, src/lib/arena/vm/battle.ts, src/lib/arena/rulesets/dbs/triggers.rules
---
A normal card-specific “when you combo with this card” Auto is currently bound to `comboed`, which the two engines emit during Combo-to-Drop cleanup. Its power, removal and draw effects therefore arrive after damage. The #573 review reproduced BT3-043 at 15,000 attack power (10,000 Leader + printed 5,000 combo), missing the conditional 10,000 combat bonus; its Auto draws only at cleanup.

Source: `docs/rules/rulemanual.txt` §§5-7-5-2/3 and 5-7-6 (Combo entry then checkpoint), versus the distinct §8-5-10-1 end-of-battle wording. Owner-reviewed BT3-043 wording: #539. Executable current-behavior boundary will be recorded in `scripts/verify/grouped-readings-573.ts` by #573.

Build: distinguish ordinary combo-entry self Autos from the explicit “at the end of the battle after you combo with this card” family. Preserve source, master, paid costs and per-occurrence identity through prompts/reload. Ensure the ordinary Auto resolves before the player adds another combo or damage is calculated. Preserve #670 hand-origin/end-of-battle behavior and #609's separate cleanup ordering ownership. Honor pinned older rule records without rewriting confirmed database rules.

Verified files: `src/lib/arena/text/triggers.ts`, `src/lib/arena/vm/triggers.ts`, `src/lib/arena/vm/battle.ts`, `src/lib/arena/rulesets/dbs/triggers.rules`, legacy `src/lib/arena/engine/engine.ts`/`triggers.ts`, glossary and dedicated independent verification. Actual touch set must be audited before implementation. Serialize with #671's pending selection integration and #609's battle writer. No live DB/paid calls/new dependencies/production settings.

Acceptance:
- [ ] BT3-043 with blue Leader/life ≤4 supplies its printed combat bonus and return/draw at combo entry; red Leader/life >4 does not. State, power, zones and events are explicit before damage.
- [ ] Hand and legal Battle Area combos, multiple copies/both players, invalid/stale answers, costs, replacement/source departure and JSON reload fire exactly once per genuine entry.
- [ ] Explicit end-of-battle Autos remain late, bind hand origin correctly and do not also fire at entry. Z-Energy/Drop departures cannot cause duplicate ordinary combo triggers.
- [ ] Exact prior stored rule records remain correctly interpreted; public projections do not leak hidden sources or private metadata. Legacy oracle preservation or any intentional rules-only parity change is explicitly reviewed.
- [ ] Typecheck, lint, focused scenarios, full tests, build, language/contract generation and capability checks pass. Owner-run catalog reading diff/fuzz limits are explicit.

Priority P0: this changes combat and affects playable card skills. #573 continues to own the grouped/shared-condition compiler reading; #609 remains the later cleanup checkpoint issue. This ticket owns neither offline work nor speculative catalog-wide coverage.
