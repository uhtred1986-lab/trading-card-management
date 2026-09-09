---
title: Arena: probe fixtures from the definition; arena:probe and arena:reprobe on the rules engine
milestone: Arena M11 — Everything else from config (Stage 8)
labels: backlog, ready-for-agent, enhancement, area:arena-vm, area:arena-workbench, phase:rules-stage8, model:sonnet-5
stage: 8
---
**Source:** plan Stage 8; `src/lib/arena/probe.ts` (`familyOf`, the ten families, the staged boards built "in the card's favour"); `card_rules.probe`; `contract/probe-digests.json`.

**Problem.** The probe stages a board per family with hand-written DBS cards and zones. On the rules engine the staging must come from the definition (which zones exist, what a Leader is, what a body with a keyword looks like), and the stored probe digests become the regression suite for *both* engines.

**Build.**
1. The probe's staging helpers read zones and attributes from the definition when `--engine rules`; the ten families unchanged.
2. `card_rules.probe` keeps one digest per engine (or the digest records the engine); `npm run arena:reprobe --engine rules` lists rules whose rules-engine answer differs from the stored legacy one — each is a bug on one side or a recorded ruling.
3. `scripts/verify/probe.ts` compares both engines to `contract/probe-digests.json`.

**Acceptance.** Gate; `arena:probe --all --engine rules` sweeps the catalog in comparable time (~70 s legacy) and the moved list is empty or explained.
