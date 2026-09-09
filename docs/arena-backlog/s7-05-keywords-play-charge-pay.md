---
title: Arena: keywords.rules bodies — hook group D — playing, charging and alternative payment
milestone: Arena M10 — Keywords as macros (Stage 7)
labels: backlog, ready-for-agent, enhancement, area:arena-vm, area:arena-rulesets, phase:rules-stage7, model:opus-5
stage: 7
---
**Source:** plan Stage 7; the hook contract issue (this depends on it); hooks in this group: **playRefused, chargeLimit, altPayment**; `src/lib/arena/glossary.ts` for each keyword's meaning and the engine's current approximation; rule manual §22; `scripts/verify/keywords.ts`.

**Candidate keywords** (confirm against the inventory — a keyword belongs to the group whose hooks its body needs, and some need two groups; move it to the later one): [Energy-Exhaust], [Offering], [Evolve], [Union], [Over Realm], [Swap], [Spirit Boost], [Empower] (markers on arrival and the carry prompt).

**Problem.** Each keyword in the group is inline code in the legacy engine. Its body must be written in the language against the group's hooks so it plays the same on the rules engine — and where the legacy engine *approximates* (the glossary's `partial` badges), the body follows the manual and the difference is recorded, not copied.

**Build.**
1. One body per keyword in `rulesets/dbs/keywords.rules`, the §22 section on each; parameters bound from the printed keyword (`[Strike x: 3]`).
2. Remove the matching `NotYet` in `vm/`; the legacy engine is untouched.
3. Glossary: each keyword's `engine` line says what the rules engine does; a difference from legacy is named as such.
4. Probes: `npm run arena:probe -- --engine rules` for one card per keyword; a probe answer that moves against the stored legacy probe is either a legacy bug (fix both) or an approximation removed (recorded).

**Acceptance.**
- Gate; `verify/keywords.ts` cases for these keywords green on the rules engine; `arena:diff` on the saved games that use them (`--all --engine rules`) shows no divergence, or every divergence is explained by a recorded ruling.
- `arena-fuzz 40 --engine rules` 0 crashes.
