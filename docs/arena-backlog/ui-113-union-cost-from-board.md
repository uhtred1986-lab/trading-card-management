---
title: Arena: BT31-001 — pay a red Veku/Gogeta [Union] cost from the Battle Area or the Drop
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, ready-for-agent, enhancement, area:arena-vm, area:arena-compiler, phase:capability-gap, model:opus-5
issue: 541
stage: ui
touches: src/lib/arena/vm/script-schema.ts, src/lib/arena/glossary.ts
---
**Source:** owner's ruling of 4 Oct 2026 on BT31-001 #0 (Son Goku & Vegeta leader, Gogeta Situation Reversal deck), stored on the row.

**Card.** "[Permanent] You can choose the specified Battle Cards in your Battle Area or your Drop when choosing cards to use with the [Union] skill of a red <Veku> or <Gogeta> card from your hand. If you do, send the chosen cards to their owner's Warp."

**Problem.** The draft reads it as a one-off choice that warps your own Union cards. It's a standing permission that widens where a [Union] cost may be paid from.

**Build.** A [Permanent] that adds the Battle Area and the Drop to the zones a [Union] payment may pick from, for red <Veku>/<Gogeta> played from hand. Cards picked from those zones go to the Warp. Hook it where the [Union] keyword resolves its specified cards; the keyword's macro may already take an "areas" list. Compile BT31-001 #0, then the glossary entry.

**Acceptance.**
- Gate: `typecheck`, `lint`, `test`, `build`, `arena:fuzz 40`.
- `scripts/verify/keywords.ts`: with BT31-001 as leader, a red <Gogeta> [Union] played from hand can take one specified card from the Drop, and that card ends in the Warp. Without the leader, the Drop isn't offered.
