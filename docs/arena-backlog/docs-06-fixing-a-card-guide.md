---
title: Arena docs: 'Fixing a card in the text view' — the owner's guide
milestone: Arena M14 — Rules language and ruleset documentation
labels: backlog, ready-for-agent, documentation, area:arena-docs, area:arena-workbench, phase:rules-docs, model:sonnet-5
stage: docs
---
**Source:** the programme's aim ("fix each card by setting the right DSL statement"); `docs/arena-rules-workbench-spec.md`; `docs/arena-rules-language.md` §6–§7; the probe pane (`src/lib/arena/probe.ts`); `npm run arena:rule`.

**Problem.** Everything written so far is for the agent building the compiler. Nothing tells the owner, on a phone or at the PC, how to take a card that plays wrongly and fix it: open the record, read the probe, switch to text, change the WHEN or the price, save, re-probe, confirm — and when to use Explain to Claude instead, when to record a ruling, and what a refusal in the editor means.

**Build.** `docs/arena-fixing-a-card.md`, under 1,500 words, three worked corrections with screenshots: a wrong trigger (WHEN), a wrong price (COST), and an unread clause fixed by typing the program; a fourth showing "prefer unread to wrongly read" — deleting a wrong step and leaving the skill to the referee. Link it from `/arena/rules` and from `CLAUDE.md`'s workbench paragraph.

**Acceptance.** The four walkthroughs reproduce on `main`; the owner has read it.
