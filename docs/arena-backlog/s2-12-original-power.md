---
title: Arena: read a card's original (pre-skill) power and skill-less state — "original power", "originally skill-less" (20-3)
milestone: Arena M1 — Rules correctness and parser coverage
labels: done, enhancement, area:arena-compiler, area:arena-lang, phase:rules-stage2, model:sonnet-5
stage: 2
status: closed
closed_at: 2026-09-13
issue: 238
---
**Item type:** Feature

**Source references:** `docs/rules/rulemanual.txt` §20-3 "Original"; found while writing §4b of `docs/arena-rules-language.md` for issue #112; real cards P-295 ("an original power of 500"), BT23-106/BT22-085/BT22-088 ("originally skill-less").

**Problem statement.** 20-3-1: "Original refers to the situation described by a card before any skill effects are applied." Cards print filters on a card's *original* power or *original* skill-less-ness — distinct from its current (possibly modified) state. `CardFilter`/`CardAttr` (`src/lib/arena/engine/script-schema.ts`) has no way to say "as printed, ignoring markers/skills" — a filter written `costMin`/`powerMin`-style today reads *current* power, and "originally skill-less" has no reading at all. Today `npm run arena:tally -- --show "original power"` and `--show "originally skill-less"` compile these clauses without flagging them unsupported — the compiler silently reads "original power of 500" as "power of 500", which is a *wrong* reading (CLAUDE.md: "a clause that compiles and reads wrongly moves no coverage number and breaks no test" — this is exactly that case), not a missing one. Measure the real extent with those two `--show` queries before starting.

**Expected behavior/outcome.** A filter/expr can ask for a card's printed power (ignoring `power` layers added by markers/skills, per the `layers:` order in `DEFINE ATTRIBUTE power`) and whether it currently carries no *compiled* skill lines beyond what was printed — narrow enough to say "originally skill-less" without claiming to know whether a skill was granted afterward.

**Scope boundaries.**
In scope:
- A filter field (e.g. `originalPower`/`originalPowerMin`/`originalPowerMax`) and/or an `attr(...)`-style expression flag reading the printed value before the `markers`/`skills` layers apply.
- A `skillLess`/`originallySkillLess` filter or condition for "no skill printed on this card".
- Compile patterns for the motivating wordings; `sentence`/glossary entries citing 20-3.
Out of scope:
- Re-deriving "original" for continuous effects that have already changed a card's colour/traits/characters (`gains`, 20-1) — this issue is about power and skill-less state only, the two wordings actually seen in the catalog.

**Acceptance checks.**
- `npm run typecheck && npm run lint && npm test && npm run build`.
- `scripts/verify/lang.ts` round-trips the new filter/expr field.
- `verify/compiler.ts`: a harness card with "power" raised by a marker still reads "original power of X" against its printed value, not the raised one.
- `docs/arena-rules-language.md` §4b gains a real worked example (P-295 or similar) in place of the "unreadable" placeholder this issue closes.

**Required triage metadata.**
Area labels: area:arena-compiler, area:arena-lang
Phase labels: phase:rules-stage2
Milestone: Arena M1 — Rules correctness and parser coverage

**Ready for agent pickup:** this issue is specific enough for a future agent to implement without extra clarification.
