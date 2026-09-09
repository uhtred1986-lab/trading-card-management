---
title: Arena: vm/hooks.ts — the hook contract, from an inventory of the legacy engine's inline keyword sites
milestone: Arena M10 — Keywords as macros (Stage 7)
labels: backlog, ready-for-agent, enhancement, area:arena-vm, phase:rules-stage7, model:opus-5
stage: 7
---
**Source:** plan Stage 7 (the fifteen hook names); the `has(` / `keyword(ctx, s, card, "…")` sites in `src/lib/arena/engine/engine.ts` and `state.ts`; `src/lib/arena/glossary.ts` (what each keyword does, and where the engine approximates); rule manual §22.

**Problem.** The keywords are implemented where they are needed — 27+ inline sites, some per keyword, some per moment. Before a single body can be written the **moments** the interpreter must expose have to be named, and the only honest way to name them is to list every site, the keyword it serves and the moment it hooks.

**Build.**
1. The inventory: a table in `docs/arena-ruleset-spec.md` — file:line, keyword, moment, what it reads, what it changes — for every inline site. This is the deliverable that makes the rest of Stage 7 mechanical.
2. `vm/hooks.ts`: the contract, one typed hook per moment the inventory needs, with its inputs and what a body may return (a boolean, an attribute delta, a replacement, a prompt). Group them as the plan does so the later issues can take a group each.
3. The `HOOK` grammar in `keywords.rules` bodies (Stage 3 declared `KEYWORD name { HOOK … }` with empty bodies): a hook body is a program in the language with the hook's inputs bound as `$` variables.
4. `scripts/verify/rulesets.ts`: every hook a body names exists in the contract; every hook in the contract is called from exactly one place in `vm/`.

**Out of scope.** Any keyword body.

**Acceptance.** Gate; the inventory covers every inline site (a grep count in the PR description); the contract is documented with one example body per hook.
