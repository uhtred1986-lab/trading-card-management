---
title: Arena: vm event log and event-pattern trigger matching (pendTriggers as data)
milestone: Arena M7 — Rules engine core (Stage 4)
labels: backlog, ready-for-agent, enhancement, area:arena-vm, phase:rules-stage4, model:opus-5
stage: 4
---
**Source:** plan Stage 4 ("`pendTriggers` as event-pattern matching"); `triggers.rules` from Stage 3; `src/lib/arena/engine/triggers.ts` (`pendTriggers`, `skillAnswersTo`, `PendingAuto`, checkpoints); rule manual 9-6 and 9-6-9; `docs/arena-rules-language.md` §7.

**Problem.** The legacy engine matches an [Auto]'s moment by trigger *name*, and the names are fired from hand-placed calls inside the engine. The rules engine fires **events** from the generic operations (move, attack, mode change, damage…) and matches the definition's `TRIGGER` patterns against them — so a moment is declared once, and the record's WHEN (which already reads `card_rules.trigger`) means the same thing on both engines.

**Build.**
1. `vm/events.ts`: the append-only event log with the shapes the definition's patterns can name (`moved{card, from, to}`, `attacked`, `modeChanged`, `damaged`, `koed`, `skillResolved`, `phaseEntered`…); `toBeats` reads it.
2. `vm/triggers.ts`: match every `TRIGGER` pattern against each new event, bind the subject, and pend the [Auto]s whose `Script.trigger` names it — with the legacy ordering rules (turn player first, then the other; 9-6-6) and checkpoints so a pended skill resolves at the same points as today.
3. Counter windows from `triggers.rules` open the same prompts the legacy engine opens (the window itself is Stage 6; here it is only the event and the pend).
4. Keyword moments (§22) are **not** read off the row on either engine; they arrive with Stage 7's hooks. Say so in `docs/arena-ruleset-spec.md`.

**Out of scope.** Resolving a skill's program (next issue); battle.

**Acceptance.**
- Gate; `npm test`: a harness card "when played, draw 1" pends and fires on the `rules` engine from a `moved` event into battle (9-6-9-4) and not from a move into energy; two [Auto]s on both sides fire in the legacy order.
- `arena:diff` on a scripted game with one triggered draw: identical events on both engines.
