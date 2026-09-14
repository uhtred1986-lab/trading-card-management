---
title: Arena docs: slim CLAUDE.md to rules and pointers — the arena narrative moves to arena-next-session-prompt.md
milestone: Arena M14 — Rules language and ruleset documentation
labels: backlog, ready-for-agent, documentation, area:arena-docs, phase:rules-docs, model:opus-5
stage: docs
issue: 282
---
**Source:** the orchestrator's token review of 13 Sep 2026; `CLAUDE.md` (8,700 words, of which ~6,700 are the arena paragraphs under **Architecture**, most of them a dated changelog of Stage 4–5 PRs: "since 12 Sep 2026", "#146", "state version 6"); `docs/arena-next-session-prompt.md` and `docs/arena-tooling.md` (the two entry points the `arena-work` skill reads first); `.claude/skills/arena-work/SKILL.md`.

**Problem.** `CLAUDE.md` is loaded into every turn of every session, so its size is the largest recurring token cost in the programme — five parallel sessions each pay it hundreds of times. Most of its arena text is history rather than rules: which PR built what, in what order, with which section numbers. That belongs in the session-prompt doc, which is read once per session and only by arena work. What must stay in `CLAUDE.md` is what an agent needs before touching anything: the invariants ("never fix an erratum with an UPDATE", "reservations are computed, never stored", "touch the compiler, update the glossary", the one-rejection-per-card rule, the `live.waiting` rule), the commands, the data-source quirks, and pointers to where the rest lives.

**Build.**
1. Move every arena paragraph that narrates *how* something came to be built (the Stage 4–5 bullets: the turn as a program, a move and its refusal, playing a card, using a skill, a price, reductions, moments, the interpreter, the language, the ruleset files, rules as records, the probe, explaining a card, the UI/HUD/lighting/1v1/AI/debug detail) into `docs/arena-next-session-prompt.md` (or a new `docs/arena-code-map.md` it links), keeping every sentence that states a rule or an invariant — those are the ones a future agent is held to.
2. Replace each moved block in `CLAUDE.md` with at most three lines: what the module is, the one rule to keep, and the doc to read. Target under 3,500 words total; measure before and after and put the numbers in the PR.
3. Keep the non-arena sections (what this is, commands, data sources, environment, conventions) as they are, minus duplication.
4. Read every open PR's `CLAUDE.md` diff (the 13 Sep wave adds paragraphs) and carry those sentences into the new home so nothing lands twice or is lost; merge `main` before the final push.
5. Update the `arena-work` skill if the reading order changes.

**Out of scope.** Changing any rule's meaning; the backlog code map (its own issue).

**Acceptance.**
- `wc -w CLAUDE.md` under 3,500; the PR lists every invariant sentence that moved and where it now lives.
- `npm run typecheck && npm run lint && npm test` green (no code change expected).
- A reviewer can find, from `CLAUDE.md` alone, the doc that explains each arena module in one hop.
