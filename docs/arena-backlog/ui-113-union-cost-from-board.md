---
title: Arena: BT31-001 — pay a red Veku/Gogeta [Union] cost from the Battle Area or the Drop
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: enhancement, backlog, area:arena-compiler, phase:capability-gap, area:arena-vm, model:opus-5, needs-owner-ruling
issue: 541
stage: ui
touches: src/lib/arena/vm/script-schema.ts, src/lib/arena/glossary.ts
priority: P1
status: closed
---
**Source:** owner's ruling of 4 Oct 2026 on BT31-001 #0 (Son Goku & Vegeta leader, Gogeta Situation Reversal deck), stored on the row.

**Card.** "[Permanent] You can choose the specified Battle Cards in your Battle Area or your Drop when choosing cards to use with the [Union] skill of a red <Veku> or <Gogeta> card from your hand. If you do, send the chosen cards to their owner's Warp."

**Problem.** The draft reads it as a one-off choice that warps your own Union cards. It's a standing permission that widens where a [Union] cost may be paid from.

**Build.** A [Permanent] that adds the Battle Area and the Drop to the zones a [Union] payment may pick from, for red <Veku>/<Gogeta> played from hand. Cards picked from those zones go to the Warp. Hook it where the [Union] keyword resolves its specified cards; the keyword's macro may already take an "areas" list. Compile BT31-001 #0, then the glossary entry.

**Acceptance.**
- Gate: `typecheck`, `lint`, `test`, `build`, `arena:fuzz 40`.
- `scripts/verify/keywords.ts`: with BT31-001 as leader, a red <Gogeta> [Union] played from hand can take one specified card from the Drop, and that card ends in the Warp. Without the leader, the Drop isn't offered.

## Delivery reconciliation — 11 Oct 2026

**Priority:** P1. **Depends on:** None for its bounded scope.

Keep this card-specific Union payment from Battle Area/Drop issue; no duplicate generic Union implementation ticket. Coordinate payment hot files with #549/#550; preserve the owner's exact BT31-001 ruling.

Execution order and hot-file ownership: `docs/arena-delivery-plan.md`. Full review: `docs/arena-playability-review.md`.

## Scope clarification — 12 Oct 2026

The source/manual audit found that the acceptance case is Fusion while Union also includes Potara. Rule 22-13-5-2-1-1 normally stages expanded-area Potara materials into Battle Area before stacking; BT31-001 sends selected materials to Warp. The existing canonical interpretation sends hand selections to normal Fusion Drop and expanded-area selections to Warp. The owner clarification pending in the active chat is Fusion-first with a separate Potara follow-up versus waiting for a full Union ruling. The source trace and concrete state/cost/event/reload test matrix are prepared; no implementation relies on a guessed ruling.
