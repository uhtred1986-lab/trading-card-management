---
title: Arena: verify/keywords.ts green on both engines and the keyword page true of both
milestone: Arena M10 — Keywords as macros (Stage 7)
labels: backlog, ready-for-agent, enhancement, area:arena-vm, area:arena-workbench, phase:rules-stage7, model:sonnet-5
stage: 7
---
**Source:** `scripts/verify/keywords.ts`; `/arena/rules/keywords` (rendered from `src/lib/arena/glossary.ts`); `CLAUDE.md`'s glossary rule.

**Problem.** After the four hook groups land, the keyword suite must run as one on both engines, and the glossary — the only written record of what the engine does with a keyword — must say which engine does what.

**Build.**
1. `npm run test:rules` runs `verify/keywords.ts` with no skipped case; `npm test` runs it on legacy as before.
2. `KEYWORDS` in `glossary.ts` gains a per-engine `engine` line (or a note where they agree); `/arena/rules/keywords` shows both; `npm test` still checks every tag is a spelling `keywordOf` reads.
3. `docs/arena-tooling.md` §2 updated.

**Acceptance.** Gate; `test:rules` green end to end; the page lists no keyword whose rules-engine line is empty.
