# Fresh paired holdout results — #899

Execution pins: runner `a6cbd383c2c89e408a02e6018a604ac6b6d4f078`, interpreter `b8899bd73864ef506d3c68c6315690bf84baddc5`, freeze `38831361ad90d52b368861f10768b81d3daa8ed38f56b62db949f5daddc25755`. Results retain these original pins after PR integration.

All 320 scheduled attempts were consumed; 320 completed. The current typed heuristic recorded 162 wins, 158 losses and 0 draws against the exact pre-#1026 combat/choice policy on the same frozen engine.

Among 160 paired deals: 14 won both assignments, 12 lost both, 134 split, 0 contained a draw and 0 were incomplete. The decisive-pair Wilson 95% interval is 35.5–71.2% across 26 decisive pairs.

Predeclared statistical gate: **not passed**. No default or difficulty promotion is made. Worker latency and retained-heap gates remain unmeasured; shared-host Node timings cannot establish them.

## Ordered matchup cells

Index 0/1 denotes A/B within starters (SD15 Pride of the Saiyans / SD5 The Crimson Saiyan), and Gogeta/Paragus within BT6.

| Cell | Current wins/losses/draws | Won-both/lost-both/split | Decisive-pair 95% CI |
|---|---|---|---|
| starters-0v0 | 21/19/0 | 2/1/17 | 20.8–93.9%; underpowered |
| starters-0v1 | 18/22/0 | 1/3/16 | 4.6–69.9%; underpowered |
| starters-1v0 | 20/20/0 | 2/2/16 | 15.0–85.0%; underpowered |
| starters-1v1 | 18/22/0 | 0/2/18 | 0.0–65.8%; underpowered |
| bt6-0v0 | 24/16/0 | 6/2/12 | 40.9–92.9%; underpowered |
| bt6-0v1 | 21/19/0 | 2/1/17 | 20.8–93.9%; underpowered |
| bt6-1v0 | 21/19/0 | 1/0/19 | 20.7–100.0%; underpowered |
| bt6-1v1 | 19/21/0 | 0/1/19 | 0.0–79.3%; underpowered |

Game-wise intervals are descriptive because paired observations are dependent. A cell with fewer than 20 decisive pairs cannot establish archetype-specific strength. Pooled results do not certify every matchup.

## Candidate archetypes

A is SD15 Pride of the Saiyans; B is SD5 The Crimson Saiyan.

| Recipe | Wins/losses/draws | Descriptive game-wise 95% CI | Paired interval for matchups involving recipe |
|---|---|---|---|
| A | 34/46/0 | 32.3–53.4% | 21.3–72.0% |
| B | 43/37/0 | 42.9–64.3% | 10.8–60.3% |
| bt6-gogeta-br-fusion | 56/24/0 | 59.2–78.9% | 46.8–91.1% |
| bt6-paragus-broly-recovery | 29/51/0 | 26.6–47.2% | 23.1–88.2% |

The involving-recipe pair interval includes the other deck in each ordered fixture; it is not an isolated causal effect of that recipe.

## Candidate physical seats

| Seat | Wins/losses/draws | Descriptive 95% CI |
|---|---|---|
| p1 | 75/85/0 | 39.3–54.6% |
| p2 | 87/73/0 | 46.6–61.9% |

## Integrity and scope

Illegal answers: 0; interruptions: 0; move limits: 0; crashes: 0; other outcomes: 0; privacy failures: 0; input/RNG purity failures: 0; cycle-guard trips: 0. Unknown privacy-check attempts: 0; unknown guard-metric attempts: 0.

Fixed-schedule hidden twins sampled the candidate 528 times and baseline 525 times, including 528 and 525 nontrivial twins. The policies and exact frozen source remained unchanged throughout all four disjoint shards. No optional stopping or replacement seeds occurred. The holdout runner made no database reads/writes or paid calls. Separately approved metadata migrations used isolated tools and did not alter the frozen corpus files, policy or interpreter.

Node whole-step timings: p95 789.15 ms, maximum 25581.71 ms, n=71971. These are descriptive measurements under four-process contention; Worker performance and memory are unverified.

The unaffordable-defense combo waste remains unchanged: spending a combo may delay loss without preserving the defender through both attacks. The experiment measures the combined delivered-policy change, not duration-only causal attribution. The starter programs are preserved compiler controls, while BT6 uses the qualified actual stored programs. This is not a full White Cell deck-strength claim or a certification of current starter database rows.

[Public result receipt](results.json) retains summary intervals and content hashes. [Allowlisted manifest](manifest.json) contains all 320 result metrics, the 160 consumed engine seeds and both physical-seat policy RNG initializations. The committed freeze retains the complete predeclared schedule. Raw journals, private state/action traces and notes remain outside the repository. Results have not been imported into the database.
