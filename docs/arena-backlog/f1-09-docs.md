---
status: closed
closed_at: 2026-10-26
title: "Arena F1-09: docs — the arena plays two games (CLAUDE.md, architecture/arena.md, code map, games.ts, arena-CURRENT)"
issue: 1192
milestone: Arena F1 — Fusion World: the four launch starter decks
labels: backlog, ready-for-agent, area:arena-docs, phase:fusion-world, model:haiku-4-5
stage: fusion-world
priority: P3
touches: CLAUDE.md, docs/architecture/arena.md, docs/arena-code-map.md, docs/arena-CURRENT.md, docs/arena-client-contract.md, docs/arena-ruleset-spec.md, src/lib/catalog/games.ts
---
Tracking: Arena F1. Last in the milestone, after F1-07 is merged. Priority P3, size S, Haiku.

## Why

Six documents and one source comment state that the arena plays the original game only. Once it does
not, each is a sentence that has gone untrue — the thing `CLAUDE.md`'s glossary rule exists to prevent.

## Build

Edit exactly these sentences; keep each document's voice and do not reflow surrounding text:

- `CLAUDE.md` "What this is": "Only the arena is `dbs`-only." → the arena plays the games flagged
  `arena` in `GAME_INFO` (`dbs` and `fusion`), each by its own ruleset directory.
- `docs/architecture/arena.md`: a bullet "**Two rulesets**" after "One engine": `rulesets/dbs/` and
  `rulesets/fusion/`, `rulesetFor(game)`, the state's game from the deck, the per-game verifier rows,
  the two rule differences F1-03 carries natively and why.
- `docs/arena-code-map.md` line ~23 ("it does not play Fusion World", `deckInputFor` returns null):
  rewrite to the `arenaPlays` gate.
- `docs/arena-CURRENT.md` line "Arena plays Masters (`dbs`), not Fusion World." → both; add the F1
  milestone to the current-work paragraph with its exit criterion.
- `docs/arena-client-contract.md` §1 and the line ~759 about a Fusion World deck being listed but not
  playable.
- `docs/arena-ruleset-spec.md` §5 "Fusion World as the worked hypothetical": one closing sentence
  that it was done in Arena F1, with the date, and which parts needed engine code after all (from
  F1-03's PR) — that is the honest answer to the section's own diagnostic.
- `src/lib/catalog/games.ts` header comment: F1-05 rewrote it; verify it matches the above.
- `docs/arena-fusion-world-plan.md` §1: a "Done" line with the merge dates.

## Out of scope

Any code change; the Android contract doc beyond the one line.

## Acceptance

- `npm run checks` (lint covers Markdown links if configured; otherwise `npm run build`).
- `grep -rn "only plays\|dbs.only\|not Fusion World" docs CLAUDE.md src/lib/catalog/games.ts` returns
  nothing that is still a claim of the old scope; paste the grep in the PR.
- `npx tsx scripts/sync-arena-backlog.mts --check` passes (every `**Source:**` path exists).
