---
title: Arena: reprobe 0 moved, fuzz 200 clean and verify-arena on both engines in npm test
milestone: Arena M12 — Parity and the flip (Stage 9)
labels: backlog, ready-for-agent, enhancement, area:arena-vm, phase:rules-stage9, model:sonnet-5
stage: 9
---
**Source:** `npm run arena:reprobe`, `scripts/arena-fuzz.mts`, `scripts/verify-arena.ts`; `docs/arena-tooling.md` §2, §4.

**Build.**
1. `arena:reprobe --engine rules` against the stored probes: 0 moved (or each move a recorded ruling).
2. `npx tsx --env-file-if-exists=.env.local scripts/arena-fuzz.mts 200 --engine rules`: 0 crashes; crashes fixed in `vm/` with a `verify/*` case each.
3. `npm test` runs `verify-arena` on **both** engines by default (`test:rules` folded in); `docs/arena-tooling.md` updated; `CLAUDE.md`'s gate line updated.

**Acceptance.** The three commands above clean, numbers in the history archive.
