---
title: Arena: support keyword parse for [Empower XY/ZY]
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, blocked, enhancement, area:arena-compiler, phase:capability-gap, model:sonnet-5
stage: ui
---
**Source:** `docs/arena-markers-stage-scope.md` §2 item 2 and §4 step D; rule manual 22-45-3-1; `keywordOf` in `src/lib/arena/engine/cards.ts` (~line 217, `^empower(?: ([a-z]+))?(?: (\d+))?$`).

**Problem.** The two-colour form `[Empower XY/ZY]` fails on the slash. 22-45-3-1 defines it and says the player chooses one of the colours when the keyword resolves.

**Blocked, on purpose:** no card in the catalog prints it. Confirm with `npm run arena:tally -- --show "Empower"` before doing anything; if it still returns no two-colour form, leave a comment on the regex naming this issue and stop. Build it the day a card needs it.

**Build, when unblocked.**
1. `keywordOf` reads `[Empower XY/ZY]` into `{ name: "Empower", colors: [X, Z], x: Y }` (the keyword's parameters are in `KeywordSkill`); `KEYWORD_NAMES` unchanged; the language literal `[Empower color: …]` grows a list form and `scripts/verify/lang.ts` round-trips it.
2. The colour choice is a prompt at resolution (same place as #108's count), answered by the AI without an API call.
3. Glossary entry updated; `npm run contract:emit` reviewed.

**Acceptance.** `npm test` with a `verify/keywords.ts` case for the two-colour form; the tally shows the card(s) compiled.
