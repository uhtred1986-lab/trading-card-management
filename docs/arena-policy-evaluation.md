# Evaluating the local policy (#651, O2-06)

How strong, how safe and how fast the complete local policy is, measured the same way every time.
"The local policy" is `localPolicy()` (`src/lib/arena/policy/combat.ts`): the #645 shortcuts, the
#646 Main Phase and payments, the #647 battle windows and the #650 constrained choices, with a
fallback that interrupts rather than guesses (versions: main v1, combat v1, choices v1). No database,
provider or network is involved anywhere on this page.

```
npm run arena:policy-eval -- --check                 # the regression gate in `npm test` (about 15 s)
npm run arena:policy-eval -- --games 40 --json       # fixtures, every baseline (about 25 min; run one baseline at a time)
npm run arena:policy-eval -- --audit --fixtures AvA,AvB,BvA,BvB --games 20 --baselines uniform
npm run arena:policy-eval -- --determinism --games 10 --baselines uniform
npm run arena:policy-browser                         # latency in headless Chrome (needs Chrome)
```

## Method

**What is played.** Seeded games through `localStep` (`policy/boundary.ts`): the restricted
observation, the policy under the cycle guard, the move applied. `scripts/verify/arena-policy-duel.ts`
is the loop, shared with the `npm test` strength checks. Two kinds of arena:

- five synthetic, database-free fixtures: `641` (#641's pinned game), `644`, `646`, `647`, `650`
  (small decks of invented cards built for each layer), and
- with `--audit`, the two audited Masters starter decks of #649 (`A` = SD15 Pride of the Saiyans,
  `B` = SD5 The Crimson Saiyan; `docs/arena-offline-deck-audit.md`) in all four ordered matchups
  `AvA AvB BvA BvB`.

**Baselines** (the opponent; the local policy always plays the other seat):

| name | opponent |
|---|---|
| `uniform` | `uniformPolicy` everywhere: a random legal answer, no shortcuts |
| `shortcuts` | the #645 shortcuts, uniform everywhere else |
| `main646` | the #646 policy: shortcuts and Main Phase, uniform battle windows and choices |
| `combat647` | the #647 policy: everything but the #650 constrained choices, which are uniform |
| `selfplay` | the local policy against itself |
| `control` | `shortcuts` against `shortcuts`: no local policy at all, only the seat and the seeds |

**Seeds and seats.** A game is (fixture, seed index k). The engine seed is `fixtureSeed * 1000 + k`
(`scripts/verify/arena-policy-seeds.ts`), and each k is played **twice, once from each seat**, so the
two games share the deal. `--games 40` is 20 seeds x 2 seats per fixture and baseline; the policy's own
RNG seed differs per game and is never the game's. The tables below use k = 0..19 (fixtures) and
k = 0..9 (audit decks).

**Seed sets.** `dev` is k = 0..999 and is what everything here uses; tune against it freely.
`holdout` is the same range at an offset of 10,000,000: **reserved for O5**. Nothing in the repository
runs it, the CLI refuses it without `--allow-holdout`, no result from it is recorded here, and
`verifySeedSets` fails any evaluation in which the two ranges could meet. An O5 improvement claim is to
be judged on the holdout, once, after tuning on `dev`.

**What a result is.** `wins` and `losses` are games the local policy won or lost; `draws` are drawn
games; a game that **stopped short** is none of these and is counted by kind: `illegal` (the engine or
the contract refused the policy's answer), `interrupted` (a window no handler reads, a referee question,
or a guard with no exit; each distinct detail is printed), `notAsked`, `noSeat`, `limit` (3,000
moves). The win rate is `wins / (wins + losses)` with a 95 % Wilson interval and its sample size.
Damage is Life cards removed. Guard trips are decisions the cycle guard replaced (`main.ts`).

**Seat bias** is the first seat's share of decided games, whoever plays the policy, with its interval;
50 % means none. The `control` baseline is the reference: it shows what the seat and the fixture do by
themselves. **Seed pairs** (W/S/L) take the two games of one deal: the policy won both, split them (the
seat decided it) or lost both. Only "won both" and "lost both" are evidence about the policy; a split
pair says the seat won.

**Hidden-state variants.** At every 4th decision of the local seat (2 games per fixture), the position is replaced by an equivalent information set
(`permutedFor`, `arena-policy-permute.ts`): every card the seat cannot see is swapped for another card
of the same owner, the fully hidden areas (both decks' order, both Life Areas, the opponent's hand and
Z-Deck) are reordered, and those cards' instance ids are permuted through the state and the beat history.
The policy must see the **same observation and decisions**, give the **same answer** from the same RNG
state, and that answer must play on the twin. "State changed" counts the positions where the twin
really differed from the original, so the check cannot pass on identical states.

**Determinism.** The same cell is played twice in one process; every game's record (result, moves,
turn, damage, stop, and a hash of every decision and the engine events it caused) must be identical.
The tables below were also produced twice, in separate processes (before and after adding the
seed-pair column), with identical wins, losses and damage in every cell.

**Latency** is the wall time of one `localStep` (observation, policy, move applied) for the local
policy's decisions only, by window. Node numbers are from the evaluation runs on this machine
(Windows 11, Node 24, desktop CPU, other work running); browser numbers are from
`npm run arena:policy-browser` (below).

## Results

Local policy as the tested side, `dev` seeds, 13 Oct 2026, main v1 + combat v1 + choices v1.

### Strength on the synthetic fixtures (40 games per cell: 20 seeds x 2 seats)

| baseline | all fixtures W-L | win rate (95 % CI) | seed pairs W/S/L | 641 | 644 | 646 | 647 | 650 |
|---|---|---|---|---|---|---|---|---|
| `uniform` | 169-31 (n=200) | 85 % (79-89) | 69/31/0 | 55 % | 100 % | 100 % | 98 % | 70 % |
| `shortcuts` | 178-22 | 89 % (84-93) | 78/22/0 | 57 % | 100 % | 100 % | 100 % | 88 % |
| `main646` | 177-23 | 89 % (83-92) | 77/23/0 | 53 % | 100 % | 100 % | 98 % | 93 % |
| `combat647` | 113-87 | 56 % (50-63) | 14/85/1 | 50 % | 78 % | 50 % | 50 % | 55 % |
| `selfplay` | 100-100 | 50 % (43-57) | 0/100/0 | 50 % | 50 % | 50 % | 50 % | 50 % |
| `control` | 95-105 | 48 % (41-54) | 14/67/19 | 50 % | 50 % | 43 % | 50 % | 45 % |

The per-fixture intervals are wide (n=40: 100 % is 91-100 %, 50 % is 35-65 %). Full per-fixture rows,
seat splits and the exact intervals are in the JSON the commands above print.

### Strength on the audited Masters decks (20 games per matchup: 10 seeds x 2 seats)

| baseline | all matchups W-L | win rate (95 % CI) | seed pairs W/S/L | AvA | AvB | BvA | BvB |
|---|---|---|---|---|---|---|---|
| `uniform` | 75-5 (n=80) | 94 % (86-97) | 35/5/0 | 85 % | 95 % | 95 % | 100 % |
| `shortcuts` | 79-1 | 99 % (93-100) | 39/1/0 | 95 % | 100 % | 100 % | 100 % |
| `main646` | 73-7 | 91 % (83-96) | 34/5/1 | 85 % | 90 % | 90 % | 100 % |
| `combat647` | 44-36 | 55 % (44-65) | 6/32/2 | 50 % | 60 % | 50 % | 60 % |
| `selfplay` | 40-40 | 50 % (39-61) | 0/40/0 | 50 % | 50 % | 50 % | 50 % |
| `control` | 46-34 | 57 % (47-68) | 13/20/7 | 60 % | 75 % | 40 % | 55 % |

### What these numbers do and do not say

- **The heuristic clearly beats random and shortcut-only play**, on both kinds of arena, with the
  interval clear of 50 % (lower bounds 79 %, 84 %, 83 % on the fixtures; 86 %, 93 %, 83 % on the audit
  decks) and almost no seed pair lost on both seats (one against `main646` on the audit decks, one against `combat647` on the fixtures). The expectation block in
  the CLI output prints these three checks as met or not met; they are reported, not gated, because a
  small run cannot meet them.
- **Baseline strength is not ordered the way the layers are.** On the audit decks `shortcuts` loses more
  often to the local policy (99 %) than `uniform` does (94 %): the shortcut-only opponent declines and
  passes where random play sometimes does something useful. A baseline's name is not its strength; read
  each row against the `control`.
- **No measurable gain from #650's constrained choices.** Against `combat647` (identical but for the
  #650 handlers) the local policy scores 56 % (50-63) on the fixtures and 55 % (44-65) on the audit
  decks. On 641, 646 and 647 the two policies make the same decisions (no constrained choice is asked
  there), so every seed pair splits by construction; the 78 % on 644 is the one cell where #650's layer
  matters. This is a baseline for O5, not a goal.
- **Seat bias is real on some fixtures and the evaluation must be read through it.** `control`
  (random play after the shortcuts) gives the first seat all 40 wins on 641 (100 %, 91-100) and the
  second seat 34 of 40 on 647 (85 %); pooled over the five fixtures it is 55 % (48-61), no bias
  detectable. With the deterministic heuristic on both sides the fixtures decide by seat: `selfplay`
  gives the first seat 83 % (77-88), and every one of the 100 seed pairs splits. On the audited decks
  there is no detectable bias in any baseline (45-54 %, intervals all containing 50 %), except `control`
  on BvA (second seat 16 of 20). So the 641 rows (50-57 %) say "seat decides", not "policy is weak":
  against `uniform` it wins 20-0 from the first seat and 2-18 from the second. Win rates pooled over
  the fixtures mix very different fixtures and are an average, not a property of any deck.
- **The games of a seed pair are not independent**, so the Wilson intervals (which treat each game as
  independent) are somewhat too narrow. The seed-pair column is the conservative reading.
- **Strength here is about decks that the layers were built for.** The fixtures are synthetic
  (invented cards that exercise one layer each, the shipped DBS ruleset, tiny decks), so 100 % cells
  mostly show that the layer does the thing it was written to do. The audit decks are real but are two
  starter decks, 80 games per baseline. Nothing here is a claim about play strength against people.

### Safety, over 1,200 fixture games and 480 audit-deck games (every baseline, both seats)

| check | result |
|---|---|
| illegal decisions (engine or contract refusals) | **0** |
| games that stopped short (interruption, unsupported window, no seat, move cap) | **0** of 1,680; no unexplained interruption to report |
| cycle-guard trips by the local policy | **0** |
| game termination | every game ended with a winner, none drawn, none hit the 3,000-move cap |
| hidden-state variants | 1,212 fixture positions and 1,068 audit-deck positions checked (2 games per cell, every 4th decision); the twin state differed in every one; **0** observation, answer or playability differences |
| determinism | identical records on replay in every cell tried (10 games x 5 fixtures x `uniform`+`selfplay`; 6 games x 4 audit matchups x `uniform`); identical wins, losses and damage across the two full runs |

An interruption is an honest outcome (the policy cannot read a window and says so); none occurred on
these fixtures and decks. Where one does occur, the CLI prints the seat, reason and detail, and `--check`
fails on it.

### Latency of the local step, Node (local policy's decisions only, ms)

| window | n | p50 | p90 | p95 | p99 | max |
|---|---|---|---|---|---|---|
| all, fixtures (`uniform` baseline) | 13,757 | 5.5 | 10.3 | 12.6 | 19.1 | 54 |
| `main` | 6,220 | 6.4 | 11.1 | 13.4 | 19.5 | 54 |
| `combo` | 4,728 | 5.5 | 10.4 | 13.3 | 21.3 | 47 |
| `charge` | 1,415 | 4.0 | 6.0 | 7.5 | 10.8 | 20 |
| all, audit decks (`uniform` baseline) | 6,524 | 13.3 | 32.4 | 42.5 | 76.5 | 590 |
| `main` | 2,913 | 16.6 | 41.2 | 53.4 | 89.3 | 590 |
| `combo` | 2,025 | 13.4 | 28.1 | 36.3 | 53.4 | 135 |
| `charge` | 536 | 8.0 | 16.5 | 22.8 | 31.2 | 52 |
| `payCost` | 79 | 15.0 | 29.9 | 32.8 | 58.1 | 206 |

The other windows (mulligan, chooseCards, blocker, counter, ...) are cheaper; the CLI prints every
window. The slowest decisions are Main-Phase choices and payments, at the audited decks' larger hands;
the 590 ms maximum is one decision in 6,524; the audit-deck maximum of the four other baselines was 365-510 ms, so a
single slow decision per few thousand is typical here, and some of it is GC or scheduler stalls on a loaded machine.

### Latency in the browser (`npm run arena:policy-browser`)

Headless Chrome 154 on the same machine. The same jobs (the local policy against `uniform`, both seats,
2 seeds) are played in Node, in a module Web Worker and on the page's main thread under
`Emulation.setCPUThrottlingRate` 4 (a **simulated** slow phone; Chrome refuses that throttle on a
worker, so the throttled run is on the main thread, as in `docs/arena-worker-budgets.md`). In all three
the winner, move count and decision/event hash of every game are identical (`browser == Node`), so the
browser plays the same games.

| run | decisions | p50 | p90 | p95 | p99 | max |
|---|---|---|---|---|---|---|
| worker, 20 fixture games | 1,375 | 4.9 | 10.4 | 12.8 | 18.6 | 31.5 |
| main thread, 4x throttle, fixtures | 1,375 | 59.0 | 116.2 | 137.9 | 216.4 | 433.7 |
| worker, 16 audit-deck games | 1,276 | 7.8 | 17.0 | 23.1 | 35.4 | 58.1 |
| main thread, 4x throttle, audit decks | 1,276 | 120.2 | 273.6 | 374.3 | 543.7 | 828.0 |

(Browser `performance.now()` is coarsened to 0.1 ms. The Node run of the same jobs in the same script was
slower than the worker here, p95 25.8 ms on the fixtures, against 12.6 ms in the evaluation run above: Node
timings move by tens of percent between runs and the cause was not isolated.) The worker
holds the local step well under the 100 ms response ceiling used in `docs/arena-worker-budgets.md`, at
the 99th percentile. **On the simulated 4x-throttled main thread the audit decks exceed it** (p95 374 ms):
the local policy must run in the worker on a phone, not on the main thread. This is a desktop-Chrome
measurement; no physical device was used and no budget has been added for the policy (those budgets are
the engine's, #643).

## The regression gate

`npm run arena:policy-eval -- --check` (in `npm test`, before `ai-agent-sdk.ts`; about 15 s) plays 2
games on each of 646, 647 and 650 against `uniform` (one seed from each seat), runs the hidden-state
check on 2 games per fixture (every 10th decision) and replays one cell. It exits 1 on any of: an
illegal decision; a cycle-guard trip; any game that stopped short or did not finish; any observation,
answer or playability difference between a position and its hidden-state twin; any difference on replay;
a dev/holdout seed overlap; a twin that never differed (the check proving nothing); or a local policy
that does not win more games than it loses against `uniform`. That is a tripwire for breakage, not a
strength measurement: 6 games say nothing about strength. (Run with `--max-moves 30` to watch it fail.)

## Limits

- Synthetic fixtures plus two starter decks. No tournament-level deck, no other colours or mechanics
  than those two decks and the fixtures contain, no real-player benchmark and no human game data. A
  high win rate against random or shortcut-only play is a floor, not evidence of competitive play.
- Sample sizes are 80-200 decided games per row; per-fixture cells have n=20-40. Intervals are Wilson
  intervals that ignore the pairing of seeds. Differences of a few points are not detectable.
- The hidden-state check swaps and reorders what the seat cannot see; it cannot show that the policy
  never *infers* anything from visible state it should not (it is given only the restricted
  observation, which `arena-policy-contract.mts` proves by construction and by permutation).
- Tactical expectations (a lethal attack is blocked, no chump block while life allows, an exact payment
  keeps a colour, ...) are proven on staged positions by `arena-policy-main.mts`,
  `arena-policy-combat.mts` and `arena-policy-choices.mts` in `npm test`; this evaluation measures
  outcomes over whole games and does not re-assert them.
- Browser timing is one headless desktop Chrome on a loaded workstation; the throttled run is a
  simulation. Node timings move by tens of percent between runs.
- The engine's ruleset coverage bounds all of this: a window or card text the compiler does not read
  stops the policy (`interrupted`), and these games met none. Unsupported cards outside the two audited
  decks are not sampled here (`docs/arena-offline-deck-audit.md` lists them).
- Online (provider-backed) behaviour is untouched and not compared; no paid model comparison was made.

## Reading and extending

- `scripts/arena-policy-eval.mts` is the CLI (flags in its header); `scripts/verify/arena-policy-seeds.ts`
  the seed sets; `scripts/verify/arena-policy-fixtures.mts` the fixture list;
  `scripts/verify/arena-policy-duel.ts` the game loop (`stopKind`, per-step windows and the trace hash
  were added for this issue); `scripts/arena-policy-browser.mts` with `arena-policy-browser-jobs.ts` and
  `arena-policy-worker.ts` the browser run.
- Before setting an improvement goal (O5), rerun the baselines above on `dev`, tune against `dev`, and
  only then run the holdout with `--allow-holdout` once.
- A new baseline is one entry in `allBaselines`; a new arena is a fixture in `loadFixtures()` or another
  matchup in `loadAuditFixtures()`.
