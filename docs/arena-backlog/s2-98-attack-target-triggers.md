---
title: Arena: "when this card attacks a Leader Card / a Battle Card" fires on every attack
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, ready-for-agent, enhancement, area:arena-compiler, phase:rules-stage2, model:opus-5
issue: 536
stage: 2
touches: src/lib/arena/text/triggers.ts, src/lib/arena/vm/triggers.ts, src/lib/arena/glossary.ts
---
**Source:** owner's card review of 4 Oct 2026 (session rulings stored on each `card_rules` row, `explanation` starting `Wrong (phone review) · WHEN`). Rule manual: an [Auto] answers only to the event it names.

**Problem.** `autoTriggerMatches("attacks")` takes "When this card attacks a Leader Card" and "When this card attacks a Battle Card" as a plain `attacks` trigger. The record keeps `trigger: ["attacks"]` and drops the attack target, so the skill fires on every attack — the card draws, untaps or discards when it shouldn't.

Flagged cards, all in the owner's decks: SD5-01 (front #0), BT3-031 (front #0), SD13-01 (#10, "attacks a Leader Card"), EX03-19 (#0), BT6-014 (#40, "attacks a Battle Card"), BT6-015 (#30, "attacks a Battle Card").

**Build.**
1. Read the attack target into the record: either a new trigger name (`attacksLeader`/`attacksBattle`), or `attacks` plus a condition on the attack target. Use whichever both engines can check when the attack is declared. Every trigger name in use is listed in `rulesets/hooks.ts`.
2. Leave the awakened back sides that print a plain "When this card attacks" (SD5-01 back, BT3-031 back) as they are.
3. Glossary entry (`src/lib/arena/glossary.ts`).

**Out of scope.** "When this card is attacked by …" and the opponent-side triggers.

**Acceptance.**
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run arena:fuzz 40`.
- `scripts/verify/readings.ts`: SD5-01 front draws when attacking the Leader and not when attacking a Battle Card, on both engines. BT6-014 #40 untaps only after attacking a Battle Card.
- `arena:readings` diff: every moved card listed and signed off. The owner re-drafts the six cards above (`arena:draft --card …`).
