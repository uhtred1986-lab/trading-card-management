# SPRT harness measurements, 8 November 2026

The first runs of `npm run arena:sprt` ([protocol](../../../arena-policy-sprt.md)), on the
development seed block `sprt-dev` (engine seeds 60,000,000 + deal, policy seeds 560,000,000 + deal).
They measure the harness, not a candidate: the dev block is never evidence of strength, and no gate
block was used. Each file is the runner's own `--out` report: configuration, source pin, the
decision, W-D-L, pentanomial, LLR, Elo with its interval, integrity counts, and one line per pair
(seeds, fixture, points, and per game the candidate's seat, winner, moves, stop and trace hash). No
private game state is in them.

| file | run | outcome |
|---|---|---|
| [aa-heuristic.json](aa-heuristic.json) | `--candidate heuristic --baseline heuristic --max-games 400 --workers 3`, commit `6259a06` (clean) | 400 games, all 200 pairs split (each pair the same game twice), LLR −59,353.5, no decision without informative pairs: **inconclusive at the cap, H1 not accepted**; 0 integrity failures, 2,295 hidden-twin checks; 1,289 s wall |
| [heuristic-vs-uniform.json](heuristic-vs-uniform.json) | `--candidate heuristic --baseline uniform --max-games 400 --workers 3`, commit `548ecd7` (clean) | **H1 accepted** at pair 20 (the minimum), 40–0, LLR +4,397; 0 integrity failures, 141 twin checks; 43 s wall |
| [ladder-heuristic.json](ladder-heuristic.json) | `--ladder --candidate heuristic --pairs 12 --workers 3`, commit `548ecd7` (clean) | uniform 24–0, shortcuts 24–0, heuristic 12–12 (all split); 0 integrity failures; 100 s wall |

The host was a 4-vCPU cloud machine shared with other agents' test runs (load average 4–5 during the
A/A run, 2–3 during the others); the `run` section of each report records the load, the wall time
and the time per game. The A/A report predates the per-matchup breakdown (`byFixture`, `bySeat`,
added in `548ecd7`); its per-pair lines carry the same information.
