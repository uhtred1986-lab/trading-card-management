---
title: Arena F1 tracking — Fusion World: the four launch starter decks
issue: 1193
milestone: Arena F1 — Fusion World: the four launch starter decks
labels: epic, backlog, area:arena-rulesets, phase:fusion-world
stage: fusion-world
priority: P2
tracking: true
---
The arena plays the four Fusion World launch starters (FS01 Son Goku, FS02 Vegeta, FS03 Broly, FS04
Frieza) by the Fusion World rule manual, on the existing rules engine, as a second ruleset directory —
the "worked hypothetical" of `docs/arena-ruleset-spec.md` §5 made real.

**Plan:** `docs/arena-fusion-world-plan.md` (scope, the rule table, where `dbs` is still hard-wired, the
issue graph, the gate, the rulings to record). **Card text:** `docs/arena-fusion-world-starters.md`.

**Exit criterion:** a hot-seat game and a game against the local policy between any two of the four
starters, created from owner decks with `game = "fusion"`, plays to life-out on the rules engine with
every one of the 64 cards' skills `done` by rule health; `npm test` carries a Fusion World suite;
`npm run arena:fuzz -- 200` on the starters is clean; the original game's `arena:fuzz`, `verify-arena`
and policy fixtures are unchanged.

**Order:** F1-01 → F1-02 → (F1-03, F1-04, F1-05, F1-06 in parallel, grouped by hot file per
`docs/arena-backlog.md` §7) → F1-07 → F1-08 → F1-09. A `/code-review` pass on Opus before F1-03 and
F1-07 merge; everything else is sized for Sonnet or Haiku.

**Out of scope for the milestone:** FB booster sets; [Barrier], [Counter], [Rush] and the energy-icon
activation price (no starter prints them); offline packs and the policy evaluation harness for Fusion
World; a Fusion World tutorial; any Neon write by an agent.

Child issues:

{{children}}
