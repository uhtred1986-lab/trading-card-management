---
title: Arena: "choose N … If you do" lets the player choose fewer than N
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, ready-for-agent, enhancement, area:arena-compiler, phase:rules-stage2, model:opus-5
issue: 538
stage: 2
touches: src/lib/arena/compile/targets.ts, src/lib/arena/glossary.ts
---
**Source:** owner's card review of 4 Oct 2026 (BT3-109's ruling: "exactly 5 … with fewer the cost cannot be paid").

**Problem.** "you may choose 5 cards from your Warp and place them in the Drop Area. If you do so, …" compiles as `choose upTo: true, count: 5`, followed by `if chose`. Moving even one card then pays for the payoff. BT3-109 #20 (SS3 Bardock) wipes the opponent's board after warping a single card.

Flagged: BT3-109 #20 (5 from the Warp), BT6-062 #10 (2 from hand), SD8-03 #10 (2 from hand). Related: BT6-063 #10 says "choose **1 or 2** cards from your life", a range the player picks from, which the draft reads as exactly 1.

**Build.** "you may choose N … If you do" is an optional exact choice: `may` around `choose count N` (not up to), and the follow-up depends on the `may` being taken. With fewer than N candidates the offer isn't made. "choose 1 or 2" is a choice with min 1 and max 2. Glossary entry.

**Acceptance.**
- Gate: `typecheck`, `lint`, `test`, `build`, `arena:fuzz 40`.
- `scripts/verify/readings.ts`, on both engines: BT3-109 with 4 Warp cards offers nothing and the opponent's board stays; with 5 it warps their board. BT6-063 accepts 1 or 2 life cards.
- `arena:readings` diff signed off.
