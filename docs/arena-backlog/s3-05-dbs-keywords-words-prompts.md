---
title: Arena: DBS declarations — keywords.rules, words.rules and prompts.rules (declarations only)
milestone: Arena M6 — Definitions in the language (Stage 3)
labels: backlog, ready-for-agent, enhancement, area:arena-rulesets, phase:rules-stage3, model:sonnet-5
stage: 3
---
**Source:** plan Stage 3; `KEYWORD_NAMES` (39) in `src/lib/arena/engine/script.ts` and `src/lib/arena/glossary.ts` (the written record of what each keyword means and what the engine does); `src/lib/arena/wording.ts`, `narration.ts`, `view.ts` (`questionFor`, `comboQuestion`), `ai/view.ts` (`RULES_PRIMER`); rule manual §22.

**Problem.** Three more things about the game are code today: the keyword list, the words the board uses, and the questions a prompt asks. Stage 7 fills keyword *bodies*; Stage 8 reads words and prompts from the definition. Stage 3 declares all three so their **names and parameters** are settled and complete before anything reads them.

**Build.**
- `keywords.rules`: `DEFINE KEYWORD name (params) { HOOK … }` for all 39, parameters typed (`[Strike x]`, `[Empower color, x]`), the manual §22 section on each, **bodies empty** with a `-- Stage 7` comment; the glossary's `meaning` line copied in as the description so `/arena/rules/keywords` can render from it later.
- `words.rules`: `DEFINE WORDS` — zone display names, colour names, mode names, the vocabulary `wording.ts`/`narration.ts` use for a `Requirement`, a beat and a rule in force. Declare only; the tables stay in TypeScript until Stage 8.
- `prompts.rules`: one `DEFINE PROMPT kind` per `Prompt` kind in `types.ts`, with the question template `questionFor` uses today.

**Out of scope.** Any keyword semantics; any consumer of the words.

**Acceptance.**
- Gate; the files load; `verify/rulesets.ts` finds every `KeywordSkill["name"]` and every `Prompt["kind"]` declared.
- A test that every `KEYWORD_NAMES` entry has a `keywords.rules` declaration with the same parameter arity as `keywordOf` reads (the same guard `npm test` has for the glossary today).
