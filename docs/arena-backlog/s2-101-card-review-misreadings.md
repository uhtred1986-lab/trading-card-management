---
title: Arena: card review 4 Oct 2026 — single-card misreadings and missing triggers
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, ready-for-agent, enhancement, area:arena-compiler, phase:rules-stage2, model:opus-5
issue: 539
stage: 2
touches: src/lib/arena/text/triggers.ts, src/lib/arena/compile/targets.ts, src/lib/arena/glossary.ts
---
**Source:** owner's card review of 4 Oct 2026. Each card's ruling is on its `card_rules` row (`explanation`, prefix `Wrong (phone review)`); `npm run arena:rule -- --list` prints them. The pattern families are tracked separately: attack-target triggers (s2-98), "A or B" targets (s2-99), exact-count "if you do" (s2-100).

**[Auto] skills with no trigger recorded** (`trigger: []`, so they may never fire):
- BT7-003 #10 and SD8-09 #10: "when your opponent switches energy to Active using a non-[Awaken] skill during their turn".
- XD1-01 #10: "when a blue or yellow ≪Universe 6≫ card is played in your Battle Area".
- BT31-116 #0: "when your white <Cell>/<Cell Jr.> card costing 3 or more is played". The effect is right; the owner ruled that activating the Extra from hand is free.
- SD15-01 #10: has `opponentAttacks`, but should only answer an attack on your red Unison Card with a specified cost of 2.

**End of a battle after a combo from hand:** BT6-010 #0 and BT2-010 #0 read as any `battleEnd`. They should be "at the end of a battle in which you comboed with this card from your hand" (BT6-010: during your opponent's turn).

**Single wordings:**
- BT3-043 #10: the blue-Leader-and-life-4-or-less condition covers all three parts (the +10000, the return and the draw).
- BT2-001 #10: 10 or more `<Son Goku>` and `<Vegeta>` in the Drop **in total**.
- BT2-012 #20: +5000 for each `<Son Goku>` and `<Vegeta>` in your Drop, not each card.
- BT2-009 #10: place cards from the top of your deck under {Majin Buu's Sealed Ball} until there are 5.
- BT3-084 #20: all of the opponent's Battle Cards **and** all their energy go to Rest Mode.
- BT3-085 #30 and BT3-101 #0: can't switch to Active **during the opponent's next Charge Phase** only. A skill may still untap the card later that turn.
- BT2-004 #20: +5000 until the **beginning of your next turn**.
- BT31-090 #20: "with a combined total energy cost of 8 or less" should be the #508 sum bound. A re-draft may already read it; check before changing the compiler.
- SD7-01 #10 (choose one): the second mode activates the [Activate: Main] skill of a ≪Desire≫ card **in your hand** with cost ≤ your current energy.
- SD7-01 #10 (rest): shuffle the deck (and the life area if it was looked through) afterwards.

**Build.** Fix the wording behind each one (several share a reading: a missing trigger, a Charge-Phase-only duration, a "total of X and Y" count). Glossary entry per reading rule. Split into follow-up issues if one part turns out bigger than the rest.

**Acceptance.**
- Gate: `typecheck`, `lint`, `test`, `build`, `arena:fuzz 40`.
- A `scripts/verify/readings.ts` assertion per bullet above that the PR fixes.
- `arena:readings` diff signed off; the PR lists any bullet left for later.
