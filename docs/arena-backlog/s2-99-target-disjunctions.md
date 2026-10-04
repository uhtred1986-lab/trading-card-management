---
title: Arena: "A or B" target and filter phrases are merged into one filter
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, ready-for-agent, enhancement, area:arena-compiler, phase:rules-stage2, model:opus-5
issue: 537
stage: 2
touches: src/lib/arena/text/filters.ts, src/lib/arena/compile/targets.ts, src/lib/arena/glossary.ts
---
**Source:** owner's card review of 4 Oct 2026 (rulings on each `card_rules` row, `Wrong (phone review) · DO · wrong target`). Related: `docs/arena-backlog/s2-95-or-disjunction.md`.

**Problem.** When a target is two alternatives, the compiler either keeps only the first (usually the Leader) or merges both into one filter that a card must meet in full. A qualifier attached to one alternative (a colour, a cost, a keyword) lands on both, or gets lost. The owner ruled each case below; all are in their decks.

1. **"your Leader Card(s) or Battle/Unison Cards" read as the Leader only:** BT3-010 #20, BT3-030 #20, DB1-019 #0, SD13-03 #0 ("Leader Cards or green Unison Cards" — green belongs to the Unison), SD13-04 #10.
2. **"<A> card or red <B> card": the colour goes onto both.** It should apply to B only: BT6-009 #0 (Veku: Br / red Son Goku: Br), BT6-005 #0 (Veku: Br / red Vegeta: Br), BT6-004 #0 (Gogeta: Br / red Vegeta: Br), BT6-008 #0 (Gogeta: Br / red Son Goku: Br).
3. **Two whole alternatives merged into one filter:**
   - BT29-029 #10: a "blue ≪Cooler's Armored Squadron≫ card not in a battle" OR a "blue Extra".
   - BT29-035 #10 and BT29-039 #10: blue <Cooler>, blue ≪Cooler's Armored Squadron≫, or blue Extra **with an energy cost of 0**. The cost applies to the Extra only (owner's ruling).
   - BT31-119 #20: white <Cell> cards OR white Extras.
   - SD13-04 #0: green Unison with a specified cost of 2 OR green ≪Frieza's Army≫ costing 4 or less.
4. **A qualifier dropped:**
   - BT29-032 #10: "an energy cost of 1 or 5" read as cost 1.
   - BT29-036 #10 and BT29-029 #10: "that's not in a battle" dropped.
   - BT4-095 #0: "and [Swap]" dropped.
   - BT5-119 #10: "with an energy cost less than or equal to your current energy" dropped.
   - SD15-01 #0 and #10: "with a specified cost of 2" dropped (#10 also has no target on its trigger; see s2-101).
5. **Condition grouping.** "if your Leader is A or B and C" is (A or B) and C, not A or (B and C): BT30-096 #10, BT31-128 #30.

**Build.** Read each alternative as its own selector (`choose` takes a list of selectors, or a union filter if the language already has one; check `s2-95` first). A qualifier binds to the noun it is printed with. For case 5, fix the `and`/`or` precedence in the condition reader. Glossary entry.

**Acceptance.**
- Gate: `typecheck`, `lint`, `test`, `build`, `arena:fuzz 40`.
- `scripts/verify/readings.ts`: one assertion per numbered case above, using the card's own text.
- `arena:readings` diff signed off by card; the owner re-drafts the listed cards.
