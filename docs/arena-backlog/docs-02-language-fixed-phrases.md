---
title: Arena docs: one worked example per §20 fixed phrase in the language doc
milestone: Arena M14 — Rules language and ruleset documentation
labels: backlog, ready-for-agent, documentation, area:arena-docs, phase:rules-docs, model:sonnet-5
stage: docs
---
**Source:** the plan's Docs section ("one example per §20 phrase"); rule manual `docs/rules/rulemanual.txt` §20 Fixed Phrases; `npm run arena:tally -- --show "<wording>"` to find a real card per phrase.

**Problem.** The person fixing a card in the text view has the printed text in one hand and needs, in the other, "this is how that phrase is written in the language". §20 is the manual's own list of the phrases cards use; a table with one real card and its rule per phrase is the reference that turns a correction from guesswork into lookup.

**Build.** A §4b table in `docs/arena-rules-language.md`: §20 number, the phrase, a card that prints it, the record as text (from `printRule` of the card's confirmed or drafted rule), and "unreadable — see issue #…" where the language cannot yet say it. Generate the printed rules with a small script so they cannot drift (`scripts/arena-readings.mts` already prints a rule beside its text; reuse it), and check them in `npm test` the way the §4 examples are.

**Acceptance.** Every §20 phrase has a row; every rule in the table parses; the unreadable rows each name an open issue.
