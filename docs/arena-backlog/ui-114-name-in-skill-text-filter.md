---
title: Arena: BT30-084 — a filter for "a card whose name is in the text of a skill on the chosen card"
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: enhancement, backlog, area:arena-compiler, phase:capability-gap, area:arena-vm, area:arena-lang, model:opus-5, blocked
issue: 542
stage: ui
touches: src/lib/arena/vm/script-schema.ts, src/lib/arena/text/filters.ts, src/lib/arena/glossary.ts
priority: P1
---
**Source:** owner's ruling of 4 Oct 2026 on BT30-084 #0 (Support Broadcast, Universe 2 Maiden Squadron deck), stored on the row.

**Card.** "[Activate: Main/Battle]{1}, if your opponent has 2 or more energy and you choose 1 of your black ≪Maiden Squadron≫ Battle Cards: Play up to 1 Battle Card whose card name is in the text of a skill on the chosen card from your Warp on top of the chosen card."

**Problem.** The draft plays `$c0`, but nothing binds `$c0`: the cost's choice of the Maiden is missing, and there's no filter for "card name appears in that card's skill text".

**Build.**
1. The cost: choose 1 of your black ≪Maiden Squadron≫ Battle Cards as `c0`.
2. A selector filter `nameInSkillTextOf: ref`: the candidate's name, in `{…}` or bare, appears in the printed skill text of the referenced card. The loader has the card text, so the check runs on the record's referenced card, never by compiling at game time.
3. `play onto: $c0` from the Warp. Rules-language syntax, glossary entry.

**Acceptance.**
- Gate: `typecheck`, `lint`, `test`, `build`, `arena:fuzz 40`, `contract:emit` reviewed.
- `scripts/verify/readings.ts`: with BT30-082 (whose skill names {Support Broadcast}) chosen, only cards named in BT30-082's skills are offered from the Warp, and the played card lands on top of BT30-082.

## Delivery reconciliation — 11 Oct 2026

**Priority:** P1. **Depends on:** #550

Keep the name-in-skill filter and BT30-084 regression here; shared cost-established binding is #550. Wait for that contract before integrating c0/play-onto behavior; do not duplicate the filter in a generic cost issue.

Execution order and hot-file ownership: `docs/arena-delivery-plan.md`. Full review: `docs/arena-playability-review.md`.
