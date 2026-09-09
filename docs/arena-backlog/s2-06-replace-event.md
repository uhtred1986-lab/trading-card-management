---
title: Arena: replace(event) primitive for 'instead' clauses that redirect more than the card (9-10)
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, ready-for-agent, enhancement, area:arena-compiler, area:arena-engine, phase:rules-stage2, model:opus-5
stage: 2
---
**Source:** plan Stage 2 gap table, rows "remove it from the game instead" (18 clauses) and BT3-051 ("all cards under it to the Drop instead"); rule manual 9-10; `docs/arena-next-stage-spec.md` §6.4; `docs/arena-move-replacement-scope.md` §1.5.

**Problem.** `replaceLeave` redirects *the card itself* to another area and nothing else; `resolvingPlay` is a second special case. Clauses that replace a different event (the pile under a card, a KO by damage becoming a removal, "instead of drawing") have no primitive. The 13 "you may … instead" cards that need a *prompt* are blocked on the `move()` refactor (#107) and stay correctly refused; this issue is the deterministic majority.

**Build.**
1. New op `replace(event: leave | ko | draw | …, with: { ops })`, registered in the same `replacementFor` table `replaceLeave` uses today; re-express `replaceLeave` and `resolvingPlay` as instances (keep the old spellings parseable — Stage 3's macro rule decides what the printer emits).
2. A replacement whose `with` block would need a prompt is **refused at validation** (`validateProgram`) with a message naming #107, so no prompt is silently lost inside `move()`.
3. Compile patterns for the deterministic wordings only; glossary entry stating exactly which events can be replaced.

**Out of scope.** Prompting inside a replacement (#107); "if declared" (20-15).

**Acceptance.**
- Gate + `contract:emit` reviewed.
- `verify/keywords.ts` / `verify/compiler.ts`: a BT3-051-shaped harness card sends the pile to the Drop instead of under the new card; a KO-to-removed replacement leaves the card in `removed`.
- `npm run arena:reprobe` = 0 moved for every rule that used `replaceLeave` before.
- Tally and readings deltas recorded; language doc example added.
