---
title: Arena: DBS declarations — keywords.rules, words.rules and prompts.rules (declarations only)
issue: 135
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

---

## Built 12 Sep 2026 — keywords.rules only; words.rules and prompts.rules still wait on #131

Only the first of the three files landed. `DEFINE WORDS` and `DEFINE PROMPT` are not in the eleven
`DEFINE_SCHEMA` kinds §3b of `docs/arena-rules-language.md` fixed, and adding either needs the
owner's word — raised as #131's closing question — on whether the words table and the prompt
questions are declarations of their own or fields of `DEFINE GAME`. Until that lands, `words.rules`
and `prompts.rules` cannot be written; this file (and the issue) stays open rather than `status:
closed`.

What is built:
- `src/lib/arena/rulesets/dbs/keywords.rules`: one `DEFINE KEYWORD` per `KEYWORD_NAMES` entry (39,
  `engine/script-schema.ts`), in that list's order. `TAKES` is the parameter arity `KeywordSkill`
  (`engine/types.ts`) carries and `keywordOf` (`engine/cards.ts`) reads back; `text:` is
  `KEYWORDS[name].meaning` (`glossary.ts`), copied verbatim; the manual section is a `--` comment
  above the declaration, not the `section:` field, per the review's step 1; every body ends with a
  `-- Stage 7 (#153–#157)` comment in place of a `HOOK` line — Stage 7 fills those in.
- `PROMPT_KINDS` added beside `KEYWORD_NAMES` in `engine/script-schema.ts`, with the same
  `never`-check, over all 18 of `Prompt["kind"]` (`engine/types.ts`) — one more than the review's
  own count named, which listed 17; the extra is a mis-count in the review text, not a kind added
  here. It exists so `prompts.rules` and the union cannot drift once `DEFINE PROMPT` is answered,
  even though the file itself is not written yet.
- `scripts/verify/rulesets.ts` (part of `npm test`): `loadDbs()` now carries 39 declarations rather
  than none, and a new section checks `keywords.rules` against `KEYWORD_NAMES` both ways — every
  name declared, no name declared that `KEYWORD_NAMES` does not have — plus a hand-written
  `KEYWORD_ARITY` table (`Record` over `KEYWORD_NAMES`' own element type, so a keyword missing from
  either list fails `npm run typecheck`) asserting each declaration's `TAKES` against the shape
  `keywordOf` actually builds.

What is still open, tracked by the still-open **Build** section above: `words.rules`, `prompts.rules`,
and the `verify/rulesets.ts` growth that checks them (part of #136's own scope, not repeated here).
