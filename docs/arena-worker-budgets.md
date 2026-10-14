# Arena browser worker: measured latency, responsiveness, payload, memory and budgets

Issue #643 (Arena O1-05), plan `docs/arena-offline-plan.md` section O1. Recorded 13 Oct 2026 with
`npm run arena:worker-bench` (`scripts/arena-worker-bench.mts`). The rules engine runs in a browser
module worker through `src/lib/arena/browser.ts` (#641); this page says how fast that is on the
pinned fixture, what the main thread feels while it runs, and which numbers a regression must not
cross. **Everything here was measured on one development machine in headless Chrome. No physical
phone was measured; that is out of an agent's reach and is explicitly unverified (see the end).**

## Run it

```bash
DATABASE_URL='' npm run arena:worker-bench                      # record: prints the distributions, exit 0
DATABASE_URL='' npm run arena:worker-bench -- --check           # gate: exit 1 on any budget violation
DATABASE_URL='' npm run arena:worker-bench -- --json out.json   # also write the full report
```

It needs Chrome (found by `findChrome()` in `scripts/lib/cdp.mts`; `CHROME_PATH` overrides) and no
database. It is **not** part of `npm test`; the budget logic and the table are
(`scripts/verify/arena-worker-budgets.ts`, which also fails if this page stops naming a budget).
Defaults: 20 fixture games, 5 cold starts, 24 sweep seeds, two configurations, about 3 to 3.5 minutes.
Flags: `--runs N`, `--cold N`, `--sweep N`, `--configs desktop-1x,phone-sim-4x[,phone-sim-6x]`,
`--phase-timeout S` (default 120), `--total-timeout S` (default 900), `--budget-scale F`.
Exit codes: 0 within budget (or no `--check`), 1 a budget was exceeded, a phase or the whole run timed
out, or a metric a budget names was not measured, 2 usage error or no Chrome.

## What is measured, and on what

| | |
|---|---|
| Browser | HeadlessChrome 154.0.0.0 (`--headless=new`), the installed `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| Device | Windows 11 (10.0.26300), Intel Core i7-1355U (12 logical cores), 16 GB, Node v24.21.0. A laptop; **not a phone** |
| Fixture | the #641 pinned bundle (`scripts/verify/arena-browser-fixture.ts`: 8 synthetic cards, the compiler's rules, the shipped DBS ruleset, two 51-card decks), bundle hash `40398033bdf32e016abbacb6fe6efb5576d7349c4b0d9f4eda11e3497e8e07bb`, seed 641, interpreter revision `a641000000000000000000000000000000000641` |
| Game | the #641 move policy `pick()` (exported from `arena-browser-scenario.ts`), 120 moves = 121 states, still in progress at the end; the #642 scenarios `setup`, `battle`, `pending-choice` |
| Worst case | a **24-seed sweep** (seeds 642 to 665) for the largest legal-move list (12 moves, found at step 105 of seed 661); that state is then re-measured 200 times: `legalMoves`, the move taken from it (`applyMove`) and `projectSnapshot` |
| Page | served by `scripts/lib/module-server.mts` as native ES modules (76 modules, unbundled, transpiled per file and memoized), cross-origin isolated (COOP/COEP headers) so timers are fine-grained and `measureUserAgentSpecificMemory` exists |
| Configurations | `desktop-1x`: 1440x900, no throttling. `phone-sim-4x`: **a simulated phone** - 390x844 touch viewport and `Emulation.setCPUThrottlingRate` 4 on this same machine. `phone-sim-6x` exists behind `--configs`, unrecorded |
| Samples (per configuration) | 20 fixture games x 120 decisions = 2,400 timed calls of each kind; 5 cold starts (fresh page, HTTP cache off); 15 match starts and 1,800 main-thread round trips (3 games on each of 5 pages); 60 scenario runs (20 of each); frame intervals over every game; 600 decisions on the main thread (5 games) as a control |
| Timing | `performance.now()` around each engine call inside the worker; main-thread numbers are page-side `performance.now()` |

Metrics, in the order the tool prints them:

- **Cold worker start**: `new Worker()` to the worker's "ready" message, fresh page, cache disabled
  (`coldWorkerStartMs`, page side) and the worker's own `performance.now()` at the end of module
  evaluation (`moduleLoadMs`). The module server is warmed first, so its TypeScript transpile (about 5
  s the first time) is excluded; what remains is 76 requests to localhost plus Chrome's parse, compile
  and run. A production bundle is not this; it is a ceiling for the unbundled dev graph.
- **Per-decision latency**: `legalMoves`, `applyMove`, `projectSnapshot` (one viewer) and their sum
  `decisionMs`; `createMatchMs` (bundle hash validation plus `createGame`); `decisionLateMs` is the
  sum over steps 90 to 120.
- **Round trip**: the page posts "step", the worker applies the move, lists the legal moves, projects
  the snapshot and posts it back; `roundTripMs` includes both structured clones. `matchStartMs` is the
  same for "game-init", which sends the 195 KB pinned bundle.
- **Main-thread responsiveness while the worker plays**: `PerformanceObserver` `longtask` entries
  (>= 50 ms), requestAnimationFrame intervals, with a 200 ms pause between games as a player would
  pause. A long task that overlaps a match start is reported apart (`longTaskAtMatchStartMaxMs`). The
  observer is **proved alive first**: a 140 ms busy loop must be reported, otherwise `longTaskObserverWorks`
  is 0 and the long-task metrics are `null`, not "0 long tasks".
- **Control**: the same engine code run on the page's main thread (`thread.*`), which is what the
  worker saves and the only place CDP CPU throttling actually bites (next section).
- **Payload**: bytes of one viewer's snapshot as JSON, the events and legal list of a step, the
  pinned bundle, and the 76 served modules (raw and gzip, from re-fetching each).
- **Memory**: the worker's V8 heap through its own DevTools session (`Runtime.getHeapUsage`, before
  and after a forced `HeapProfiler.collectGarbage`), the main thread's heap, and
  `performance.measureUserAgentSpecificMemory()` for page plus worker.

### What is simulated, unsupported or different from a phone

- **`phone-sim-4x` is not a phone.** It is this machine with the page's CPU slowed. A phone differs in
  memory bandwidth, thermal throttling, big/little cores, browser build and background load.
- **Chrome refuses CPU throttling on a worker** (`Emulation.setCPUThrottlingRate` on the worker's
  session returns "Operation is only supported for pages, not workers", recorded in the report). The
  throttle therefore slows the *main thread only*. The worker-side numbers of `phone-sim-4x` are the
  unthrottled worker's again (they match `desktop-1x` within noise: decision p95 8.0 and 11.1 ms vs
  10.3 and 14.4 ms), and the `thread.*` control is where a slow CPU shows. Worker compute on a slow
  phone is therefore **not measured**; the throttled thread is the best available stand-in.
- Throttled numbers are erratic: CDP throttling is a duty cycle, so very short calls inflate by more
  than the nominal rate (the control's decision p50 was 27.7 ms in one recording and 6.6 ms in the
  next). Read them as a pessimistic bound, not a prediction.
- Memory: `measureUserAgentSpecificMemory` worked here because the page is cross-origin isolated; in a
  page that is not, it does not exist and the tool reports the metric as `null`/unsupported. V8 heap
  figures are Chrome-only. Safari and Firefox were not run.
- Headless Chrome, no GPU, no real rendering of the board: frame intervals measure main-thread
  availability, not paint cost, and do not include React.

## Recorded distributions

Two recordings on the same machine, a few minutes apart (13 Oct 2026, 01:33 and 01:39 UTC). Each cell
is p50 / p95 / max; the second recording ran while other sessions were using the machine, which is why
its tails are heavier. All times in milliseconds.

Two more full runs followed with the budgets in place (`--check`, same machine). The third showed the
limit of a 5-sample p95: on `phone-sim-4x` one of five cold starts took 3,170 ms (module load 3,012
ms) against a median of 700 ms and failed the cold-start p95 budget as first written, so cold start
is now gated on the median plus a loose max. Everything else in that run was inside the recorded
ranges (decision p95 8.9 and 14.7 ms, round trip p95 19.3 and 16.5 ms, one 86 ms long task on the
throttled page). The fourth, on the final 46 budgets, exited 0.

### Worker engine, 2,400 timed calls per kind (identical code path in both configurations)

| Metric | desktop-1x, run 1 | desktop-1x, run 2 | phone-sim-4x, run 1 | phone-sim-4x, run 2 |
|---|---|---|---|---|
| `legalMoves` | 0.33 / 2.2 / 26.3 | 0.36 / 2.8 / 59.2 | 0.27 / 1.7 / 10.0 | 0.29 / 2.1 / 24.1 |
| `applyMove` | 1.4 / 4.8 / 13.8 | 1.5 / 5.9 / 57.2 | 1.1 / 3.7 / 16.4 | 1.2 / 4.6 / 18.5 |
| `projectSnapshot` | 1.5 / 5.4 / 12.9 | 1.5 / 7.4 / 101.0 | 1.2 / 3.8 / 24.5 | 1.3 / 5.4 / 27.2 |
| decision (sum of the three) | 3.6 / 10.3 / 32.7 | 3.8 / 14.4 / 127.3 | 2.9 / 8.0 / 30.5 | 3.3 / 11.1 / 36.0 |
| decision, steps 90 to 120 | 3.9 / 10.8 / 20.8 | 3.7 / 16.2 / 127.3 | 3.0 / 8.3 / 18.0 | 3.3 / 10.1 / 36.0 |
| worst state (12 legal moves): `legalMoves` | 0.7 / 2.0 / 4.1 | 0.9 / 2.9 / 11.9 | 0.7 / 2.0 / 3.7 | 2.2 / 5.2 / 11.8 |
| worst state: `applyMove` | 1.7 / 4.0 / 8.0 | 2.2 / 7.4 / 50.4 | 1.8 / 4.0 / 5.1 | 5.0 / 10.4 / 26.0 |
| worst state: `projectSnapshot` | 1.9 / 4.8 / 9.9 | 2.7 / 7.8 / 30.1 | 2.0 / 4.9 / 6.5 | 6.5 / 15.0 / 50.2 |
| `createMatch` (20 games) | 31 / 44 / 45 | 22 / 88 / 170 | 22 / 39 / 94 | 26 / 51 / 92 |
| slowest decision over the 24-seed sweep | 30.2 | 94.2 | 23.5 | 76.9 |
| scenario run, whole (60 runs) | 32 / 50 / 59 | 48 / 110 / 163 | 93 / 159 / 361 | 58 / 113 / 146 |

The first game of a run (cold JIT) is not slower in a way that matters: its decisions are p95 8.3 to
17.0 ms.

### Start-up (5 cold starts, 15 match starts)

| Metric | desktop-1x, run 1 | desktop-1x, run 2 | phone-sim-4x, run 1 | phone-sim-4x, run 2 |
|---|---|---|---|---|
| `coldWorkerStartMs` (p50 / max) | 572 / 684 | 799 / 1175 | 573 / 669 | 708 / 927 |
| `moduleLoadMs` (p50 / max) | 552 / 660 | 769 / 1127 | 543 / 636 | 676 / 906 |
| `matchStartMs` (p50 / p95 / max) | 29 / 73 / 73 | 30 / 111 / 111 | 31 / 145 / 145 | 45 / 132 / 132 |

### Main thread while the worker plays (1,800 round trips)

| Metric | desktop-1x, run 1 | desktop-1x, run 2 | phone-sim-4x, run 1 | phone-sim-4x, run 2 |
|---|---|---|---|---|
| `roundTripMs` | 4.0 / 10.1 / 30.8 | 5.0 / 12.6 / 49.5 | 9.1 / 16.0 / 82.8 | 8.2 / 17.6 / 83.6 |
| `frameIntervalMs` (samples) | 16.7 / 16.7 / 16.7 (734) | 16.7 / 16.7 / 16.7 (874) | 16.7 / 16.7 / 66.7 (1,284) | 16.7 / 16.7 / 83.3 (1,230) |
| frames over 50 ms | 0 | 0 | 2 | 2 |
| long tasks >= 50 ms (count, longest) | 0, - | 0, - | 1, 73 ms | 1, 55 ms |
| longest long task at a match start | none | none | 73 ms | none |

### Control: the same engine on the main thread (600 decisions)

| Metric | desktop-1x, run 1 | desktop-1x, run 2 | phone-sim-4x, run 1 | phone-sim-4x, run 2 |
|---|---|---|---|---|
| `thread.decisionMs` p50 / p95 / max | 2.4 / 5.6 / 20.8 | 2.9 / 6.7 / 30.1 | 27.7 / 86.0 / 251.1 | 6.6 / 50.5 / 131.4 |
| longest main-thread task for the whole run | 4.4 s | 5.9 s | 40.6 s | 27.7 s |

Playing the same games on the main thread blocks it for seconds in one task (the run is one
uninterrupted loop, so this is the extreme, not what play looks like) and every individual decision is
slower under throttling; in the worker the same work produced at most one 73 ms long task and 2 slow
frames in about 1,300.

### Payload (identical in every run; the fixture is deterministic)

| | Size |
|---|---|
| One viewer's snapshot (JSON) | p50 33.3 KB, max 45.8 KB |
| Events of one step (max) / legal list of one step (max) | 1.5 KB / 1.1 KB |
| Pinned bundle sent at match start | 194.7 KB |
| 76 served modules | 2.00 MB raw, 606 KB gzip |

### Memory

| Metric | Recorded |
|---|---|
| Worker V8 heap, after load | 1.85 MB |
| Worker V8 heap, after 20 games plus the sweep, before GC | 7.0 to 27.9 MB (varies with when the collector ran) |
| Worker V8 heap, after a forced GC | 5.6 MB (all four recordings) |
| Main-thread V8 heap | 1.7 to 2.2 MB |
| `measureUserAgentSpecificMemory`, page plus worker | 21.7 to 21.9 MB |

Retained heap is flat at 5.6 MB across 20 games, so there is no growth per game in this fixture.

## Budgets

Rule: a ceiling is at least 2x (usually 3x) the larger of the two recordings, rounded to a tidy
number, because one recording on a shared laptop moved a max by 4x (decision max 32.7 ms, then 127.3
ms). Tail maxima get a loose ceiling; the tight, meaningful gates are p95. Cross-checks against
perceptual anchors: the 50 ms long-task definition, the 100 ms "feels instant" response ceiling (held
at p95: decision p95 <= 30 ms, round trip p95 <= 50 ms) and the 16.7 ms frame. A floor ("at least")
makes sure the run measured what it claims (all 120 moves played, the long-task observer alive, the
worst-case list really large, the #642 scenarios passing). A budget the tool cannot measure is a
violation, not a pass.

Units are in the table. "both" means both configurations; the `thread.*` rows differ by configuration
because the control is an order of magnitude slower on the throttled thread.

| Metric | Config | Budget | Why |
|---|---|---|---|
| `legalMovesMs.p95` | both | at most 8 ms | worker call p95, >= 2.5x the larger of two recordings |
| `applyMoveMs.p95` | both | at most 15 ms | worker call p95, >= 2.5x the larger of two recordings |
| `projectSnapshotMs.p95` | both | at most 16 ms | worker call p95, >= 2.5x the larger of two recordings |
| `decisionMs.p95` | both | at most 30 ms | apply + legal + project, 2.1x the larger recorded p95 (14.4 ms); well under the 100 ms response ceiling |
| `decisionMs.max` | both | at most 300 ms | worst of 2,400 decisions; a shared machine gave 33 ms and 127 ms in two recordings (GC/scheduler stalls), so ~2.4x; the 100 ms response ceiling is held at p95 |
| `decisionLateMs.p95` | both | at most 40 ms | steps >= 90 of the 121-step game: a late-game state is no slower |
| `createMatchMs.p95` | both | at most 200 ms | bundle hash validation + createGame; recorded 44 to 88 ms |
| `worstLegalMovesMs.p95` | both | at most 12 ms | largest legal list found (12 moves), re-measured 200 times |
| `worstApplyMoveMs.p95` | both | at most 25 ms | the move taken from the worst state |
| `worstProjectSnapshotMs.p95` | both | at most 30 ms | the snapshot of the worst state |
| `sweepSlowestDecisionMs` | both | at most 300 ms | slowest single decision over a 24-seed sweep; recorded 23 to 94 ms |
| `scenarioMs.p95` | both | at most 500 ms | one #642 scenario end to end, ~3x the throttled-page p95 |
| `scenarioMs.max` | both | at most 1500 ms | ~4x the recorded max |
| `coldWorkerStartMs.p50` | both | at most 1500 ms | typical cold start of the unbundled 76-module graph, cache off; recorded medians 0.57 to 0.80 s (about 2x); a production bundle should beat it |
| `coldWorkerStartMs.max` | both | at most 6000 ms | worst of 5 cold starts (a 5-sample p95 is its max); recorded 0.67 to 3.17 s, one outlier in three recordings |
| `moduleLoadMs.p50` | both | at most 1500 ms | same, as the worker itself reports it; recorded medians 0.54 to 0.77 s |
| `moduleLoadMs.max` | both | at most 6000 ms | same; recorded 0.64 to 3.01 s |
| `matchStartMs.p95` | both | at most 450 ms | bundle sent to the worker + createGame, ~3x the throttled p95 |
| `roundTripMs.p95` | both | at most 50 ms | one decision, message and clone included; ~3x the larger recorded p95 (17.6 ms, throttled page) |
| `roundTripMs.max` | both | at most 250 ms | ~3x the throttled max |
| `frameIntervalMs.p95` | both | at most 34 ms | two 60 Hz frames |
| `framesOver50Ms` | both | at most 6 | of ~1,300 sampled frames; recorded 2 on the throttled page |
| `longTaskCount` | both | at most 3 | main-thread tasks >= 50 ms while the worker plays; recorded 0 to 1 |
| `longTaskMaxMs` | both | at most 150 ms | 3x the 50 ms long-task threshold; recorded 55 to 73 ms |
| `longTaskAtMatchStartMaxMs` | both | at most 250 ms | cloning the pinned bundle to the worker; recorded 73 ms |
| `thread.decisionMs.p95` | desktop-1x | at most 20 ms | same code on the unthrottled main thread, ~3.5x p95 |
| `thread.decisionMs.max` | desktop-1x | at most 80 ms | same, ~4x max |
| `thread.decisionMs.p95` | phone-sim-4x | at most 250 ms | same code on the 4x-throttled thread (a SIMULATED phone), ~3x p95 |
| `thread.decisionMs.max` | phone-sim-4x | at most 800 ms | same, ~3x max |
| `snapshotBytes.max` | both | at most 80 KB | one viewer's projected snapshot as JSON; recorded 45.8 KB |
| `snapshotBytes.p50` | both | at most 60 KB | recorded 33.3 KB |
| `bundleBytes` | both | at most 300 KB | the fixture bundle (8 cards, shipped DBS ruleset); recorded 195 KB. A real card pool is larger: re-measure |
| `moduleBytes` | both | at most 2.6 MB | 76 transpiled modules, uncompressed; recorded 2.0 MB |
| `moduleGzipBytes` | both | at most 800 KB | the same, gzipped; recorded 606 KB |
| `workerHeapRetainedBytes` | both | at most 16 MB | worker V8 heap after a forced GC; recorded 5.6 MB |
| `workerHeapAfterBulkBytes` | both | at most 64 MB | worker V8 heap before GC after 20 games; recorded 7 to 28 MB (garbage not yet collected) |
| `userAgentMemoryBytes` | both | at most 64 MB | measureUserAgentSpecificMemory for the whole page and worker; recorded 22 MB |
| `mainHeapBytes` | both | at most 8 MB | main-thread V8 heap; recorded 2.0 MB |
| `gameSteps` | both | at least 120 | the pinned game plays its full 120 moves (121 states) |
| `interactiveSteps` | both | at least 120 | the round-trip game plays its full 120 moves |
| `longTaskObserverWorks` | both | at least 1 | a 140 ms busy loop must be reported, or zero long tasks proves nothing |
| `worstLegalCount` | both | at least 10 | the worst-case state really is a large legal list (recorded 12) |
| `sweepMaxLegalCount` | both | at least 10 | the seed sweep finds large legal lists (recorded 12) |
| `scenario.setup.pass` | both | at least 1 | the #642 scenario still passes in the worker |
| `scenario.battle.pass` | both | at least 1 | the #642 scenario still passes in the worker |
| `scenario.pending-choice.pass` | both | at least 1 | the #642 scenario still passes in the worker |

The table is generated from `BUDGETS` in `scripts/lib/worker-budgets.ts`; that file is the authority,
and `scripts/verify/arena-worker-budgets.ts` fails `npm test` if a budget there is not named on this
page.

## Board budgets (#782: the real app, not the O1 page)

The budgets above were set on a page that runs the engine in a Worker and draws nothing. The offline
release matrix (`npm run arena:offline-release`, `docs/arena-offline-release.md`) measures the real app:
a production build, the React board, the installed SD15/SD5 pack and its art, cold-launched in airplane
mode, 8 matches played to the end. On that page the O1 numbers for the main thread cannot hold (the board
renders, lays out and paints), so the owner decided on 14 Oct 2026 to **re-derive the budgets measured on
the real board, but keep "no long task over 150 ms" as a release blocker and fix it**. These are the
**board budgets**: `BOARD_BUDGETS` in `scripts/lib/worker-budgets.ts`, the only ones
`arena:offline-release` judges. They do not replace the O1 table, which still gates
`arena:worker-bench` on its fixture page.

### Method

- **Runs.** Three recordings of the whole desktop matrix (`arena:offline-release -- --record`, 8 cases
  each) at one commit (`a5cc5b4`, the long-task fix below), 14 Oct 2026, HeadlessChrome 141, the 4-vCPU
  cloud container of `docs/arena-offline-release.md` section 2, run one after another.
- **Percentile.** A run's figure is computed exactly as the release script judges it: the worst of the 8
  cases (longest task, most long tasks, most slow frames, largest heap), or for a latency the p95 of the
  run's samples (`roundTripMs.p95`: the worst case's p95 of its human moves; `matchStartMs.p95`: the
  nearest-rank p95 of the 8 cases, which with 8 samples is their max).
- **Headroom.** The limit is the worst of the three runs times **1.25** for a time or a size and times
  **1.5** for a count (a count of 4 or 14 moves more from run to run), rounded **up** to the next 10 ms,
  1 MB or whole count.
- **Only where the board misses.** Where the O1 limit already holds the board with that headroom, the O1
  limit stays: the Worker's own figures (decision, cold start, Worker heap), which the board does not
  change, and the slowest human move all keep theirs. No board budget is tighter than its O1 budget.
- **Not derived.** `longTaskMaxMs` stays **150 ms** (owner) and `longTaskAtMatchStartMaxMs`, a long task
  too, is held to the same 150 ms (O1 had 250). `frameIntervalMs.p95` stays 34 ms: intervals come in
  16.7 ms steps and every run measured 33.4 ms (two frames), so 1.25x would have allowed a third frame
  for nothing.
- **Not measurable.** `userAgentMemoryBytes` is not a board budget: `performance.measureUserAgentSpecificMemory`
  exists only on a cross-origin-isolated page (COOP/COEP) and the app is not one, so the browser does not
  offer it. The run prints it as `NOT MEASURABLE` with that reason (`BOARD_UNMEASURABLE`); it is never
  counted as a pass. The page heap (`mainHeapBytes`) and the Worker heap stand in for it.
- **A missed budget still fails the run.** `OVER` or `NOT MEASURED` on any board budget makes
  `arena:offline-release` exit 1 (unless `--record`, which still prints it).
- **Desktop only.** `--phone-emulated` is judged against the same desktop budgets and misses several
  (below); emulation gets no budgets of its own, and the physical phone's are the owner's to record.

### The three runs and the budgets

| Metric | Budget | O1 budget | Run 1 / 2 / 3 | Why |
|---|---|---|---|---|
| `roundTripMs.p95` | at most 60 ms | 50 ms | 39.5 / 42.8 / 47.5 | re-derived, 1.25x 47.5; still under the 100 ms "feels instant" ceiling |
| `roundTripMs.max` | at most 250 ms | 250 ms | 76.1 / 74.2 / 75.0 | O1 kept |
| `decisionMs.max` | at most 300 ms | 300 ms | 77.5 / 84.7 / 82.3 | O1 kept (the Worker's) |
| `coldWorkerStartMs.p50` | at most 1500 ms | 1500 ms | 121.5 / 115.2 / 116.0 | O1 kept (the Worker's) |
| `coldWorkerStartMs.max` | at most 6000 ms | 6000 ms | 140.5 / 153.7 / 142.8 | O1 kept (the Worker's) |
| `matchStartMs.p95` | at most 710 ms | 450 ms | 566.3 / 535.7 / 527.5 | re-derived, 1.25x 566.3: Start click to the first board, the board's first render and layout included |
| `frameIntervalMs.p95` | at most 34 ms | 34 ms | 33.4 / 33.4 / 33.4 | O1 kept (two frames) |
| `framesOver50Ms` | at most 21 | 6 | 13 / 11 / 14 | re-derived, 1.5x 14; a match has 1,400 to 2,500 frames |
| `longTaskCount` | at most 6 | 3 | 4 / 4 / 4 | re-derived, 1.5x 4 |
| `longTaskMaxMs` | at most 150 ms | 150 ms | 99 / 110 / 116 | owner: never relaxed |
| `longTaskAtMatchStartMaxMs` | at most 150 ms | 250 ms | 99 / 110 / 116 | held to the 150 ms ceiling |
| `workerHeapRetainedBytes` | at most 16 MB | 16 MB | 7.4 / 7.2 / 7.2 MB | O1 kept (the Worker's) |
| `workerHeapAfterBulkBytes` | at most 64 MB | 64 MB | 22.4 / 23.0 / 20.5 MB | O1 kept (one match, not 20) |
| `mainHeapBytes` | at most 18 MB | 8 MB | 14.4 / 12.6 / 13.7 MB | re-derived, 1.25x 14.4 MB: the page heap WITH the React app |
| `userAgentMemoryBytes` | not measurable | 64 MB | not measurable | see Method |

Recordings: `docs/arena-backlog/evidence/782/release-after{1,2,3}.json`. The derivation was then checked
on a fourth, fresh run of the final commit with no `--record` (`docs/arena-offline-release.md` section 6),
which must exit 0.

### The long task, found and fixed

A CDP trace and CPU profile of each match (`arena:offline-release -- --trace DIR`, source-mapped with a
`PROFILE_SOURCEMAPS=1` build; `scripts/lib/long-task-trace.mts`) showed the longest task of every case is
the board's **first render**, the React commit that mounts `ArenaStage` when the first snapshot arrives,
with two more tasks of 60 to 80 ms right after it (the first frame's paint and raster, and the next render
with the layout animations measuring the new cards). Inside the first render, before the fix (one traced
case, 152 ms):

| Under | ms | What |
|---|---|---|
| `StageZones.tsx` `useOverflows` (a layout effect reading `scrollWidth`) | 50 | the board's first layout, forced there; in it about 28 ms of font look-ups (`FontCache::GetFontPlatformData`, a Linux font-service round trip per face and size) |
| `lighting.ts` `colourOf` → `board-words.ts` `dbsWords()` → `rulesets/dbs` `loadDbs()` | 25 | **parsing every DBS `.rules` file on the main thread** to read the board's words |
| `ArenaCard.tsx` | 16 | the cards' first render |
| React itself, motion, the rest | 60 | |

The ruleset parse is the waste: it computed, in the browser, a constant table. **Fix:** `npm run
arena:rulesets` now also writes `src/lib/arena/rulesets/dbs/board-words.ts`, `wordsFromRuleset` over the
loaded definition, and `dbsWords()` returns it; `scripts/verify/board-words.ts` (`npm test`) fails when
the table and `words.rules` disagree, so a renamed zone or a deleted phrase is still a broken build. Same
words, same sentences, on either engine and online. The layout is the board's real first layout (it
would happen in the next frame anyway, so moving it would only move the counter); its font cost is the
platform's. Nothing in the engine, the Worker or the Snapshot contract changed.

Before and after, desktop, three matrix runs each (24 matches):

| | Before (`03a5aa3`) | After (`a5cc5b4`) |
|---|---|---|
| Longest task of a run | 108 / 122 / 137 ms | 99 / 110 / 116 ms |
| First-render task, mean / median of 24 | 98 / 96 ms | 86 / 84 ms |
| Long-task time per match, mean | 229 ms | 202 ms |
| Emulated phone (EMULATION, 4x page throttle), longest task | 493 ms | 379 ms |

The 202 ms of `docs/arena-offline-release.md` (#661) was the same build as "before" on a busier host;
this host's three "before" runs stayed under 150 ms, so the margin, not a pass, is what changed on the
desktop. Profiles: `docs/arena-backlog/evidence/782/` (`long-tasks-before.json`, `long-tasks-after.json`).

## Regression procedure

1. `DATABASE_URL='' npm run arena:worker-bench -- --check --json worker-bench.json` on a machine with
   Chrome, ideally otherwise idle. It prints the distributions and every violation, and exits 1 on
   any.
2. **If it fails, run it once more.** The recordings above show a shared machine moving a tail by 4x;
   a real regression fails both runs on the same metric, a noisy one does not. A violation of a p95
   or a memory/payload number is not noise.
3. A `MISSING` line means the metric was not measured (a phase timed out, the browser lacks the API):
   fix the run, do not loosen the budget.
4. When a change legitimately moves a number (a bigger ruleset, a richer snapshot), re-record twice,
   edit `BUDGETS` and this page together in the same PR, and keep the 2x to 3x headroom rule.
5. Before any real card pool ships to a browser, run the tool against a bundle built from it (the
   fixture is 8 synthetic cards and a 195 KB bundle) and re-derive the engine, `createMatchMs`,
   `matchStartMs`, `bundleBytes` and memory budgets from that.
6. `--budget-scale 0.01` multiplies every ceiling by 0.01; it exists to prove the gate trips.

### The gate cannot hang, and says so when a budget is exceeded

- Every phase (worker start, bulk, main-thread control, scenarios, each game, memory) has a hard
  timeout (`--phase-timeout`, 120 s); a phase that does not answer is recorded as `timeout` and the run
  moves on. The whole run has a watchdog (`--total-timeout`, 900 s) that kills Chrome and exits 1.
- Observed 13 Oct 2026: `--check --runs 2 --cold 1 --sweep 2 --configs desktop-1x --budget-scale 0.01`
  printed 32 `OVER`/`UNDER` lines (44 budgets then) and exited 1 in 42 s; the same with
  `--phase-timeout 1` printed 40 `TIMEOUT`/`MISSING`/`UNDER` lines, exited 1 after 15 s; an unknown `--configs` value exited 2.
- A run within budget exits 0: the final 46-budget table passed `--check` on a fresh run, and the two
  recordings above also pass it when replayed through `evaluateBudgets`. Two earlier failures were
  real noise findings and are why the table gates tails loosely: `decisionMs.max` (127 ms on a busy
  machine, ceiling was 100) and the 5-sample cold-start p95 (3.17 s outlier).

## The local match worker (#652)

`npm run arena:local-worker-browser` (`scripts/arena-local-worker-browser.mts`; Chrome, no database,
about 1 to 2 minutes, not in `npm test`) plays the #652 protocol's scripted match against the real module
Worker (`src/lib/arena/local/worker-entry.ts`) through the page client
(`src/components/arena/session/local.ts`): the audited SD15/SD5 pack of #655, **staged to qualify for the
test only** (282 KB, 41 real cards), the local policy for the AI seat, every human move a round trip. It
checks behaviour first (the Worker's 136 messages are byte-identical to the Node host's, and a second
cold page that cancels, disposes and resumes ends on the identical board) and then gates the budgets
above that measure the transport, `desktop-1x`, unthrottled. Recorded 13 Oct 2026 on the machine above
while other sessions were using it (p50 / p95 / max, ms):

| Metric | Recording 1 | Recording 2 | Budget |
|---|---|---|---|
| `coldWorkerStartMs` (Worker to `ready`, cache off, one sample) | 907 | 702 | p50 at most 1500 |
| `matchStartMs` (`start` to its result: pack validated, game created, first board) | 458 (the larger of 2) | 327 | p95 at most 450 |
| `roundTripMs` (a human move to its result, snapshot included; n=42) | 21.7 / 43.8 / 52.7 | 16.2 / 27.5 / 79.3 | p95 at most 50, max at most 250 |
| AI decision, page-measured (an advance's round trip over the decisions it committed; n=20) | 45.2 / 80.9 / 110.6 | 37.6 / 62.6 / 71.6 | max at most 300 (`decisionMs.max`) |
| main-thread long tasks while the match plays (observer proved alive) | 0 | 0 | count at most 3, longest at most 150 |
| one snapshot as JSON | 37.8 KB p50, 81.1 KB max | the same | (fixture budget, below) |

Three earlier recordings during development gave a match start of 353, 434 and 382 ms. **The match
start sits at its ceiling on the real pack**: one recording of five went over (458 ms), and the
regression procedure's rerun passed. It validates the 282 KB pack (hashing it and its card bundle) and
the bundle again in `createPinnedMatch`; the 450 ms ceiling was set for the 195 KB 8-card fixture.

**With the journal in IndexedDB (#653)** the worker entry also opens the database (warmed at boot) and
writes the match header before answering `start`, overlapped with the pack's validation. Recorded
13 Oct 2026 on the same machine, busy with other sessions, alternating the two stores in the same
session: IndexedDB 404, 420, 464, 466, 471, 497, 573 and 580 ms; the in-memory store 300, 323, 347,
382 and 607 ms. The database itself costs about 50 ms to create and open on a fresh profile and 1 to
3 ms per commit (measured in the page); the rest is the machine's noise on a one-sample metric. The
ceiling stays 450 ms: **matchStartMs fails it on some runs now**, as it did once in five before; the
other gated metrics passed on every run. Re-deriving that budget from a quiet machine is #643's table.

**Liveness limits of the page's supervisor (#654, `src/lib/arena/local/recovery.ts`)** are not budgets
of the worker's work but how long the page waits before it calls a worker dead: `hungMs` 15 s of
silence while a request waits (an AI batch posts a snapshot per commit, so a live advance is never
silent that long), `openMs` 120 s for a `start`/`resume` (which validates the pack and replays the whole
journal), an idle ping every 5 s, and `maxRestarts` 3 deaths in a row before `failed`. Writer leases:
`HEARTBEAT_MS` 2 s, `LEASE_TTL_MS` 8 s (used only where Web Locks are missing). They are defaults,
chosen above every recording on this page with a wide margin, not measured on a phone. In
`npm run arena:local-ownership-browser` (13 Oct 2026, this machine) a closed holder's tab was replaced
by the waiting tab in about 2 s, which is the resume (pack validation and replay of 33 decisions), and
a frozen holder in lease-only mode in about 2.5 s (the 1.5 s TTL the proof sets, plus the resume).

Not gated, because #643 set them on its 8-card fixture's content and its procedure (step 5) re-derives
them from a real card pool — a change to this table that belongs with that re-recording, not here:
`snapshotBytes.max` is **81.1 KB against 80 KB** on the real cards (p50 37.8 KB against 60 KB), and the
AI's whole local step (observation, policy, guard, move, on real cards) is **p95 62.6 to 80.9 ms
against the engine-only `decisionMs.p95` of 30 ms**. The tool prints both as `info`.

## What this does not show (unverified, and why)

- **Physical devices.** No phone, tablet or low-end laptop was measured. The only phone evidence is
  `phone-sim-4x`, a throttled desktop whose throttle does not reach the worker. A named phone target
  (the issue asks for methodology for one) is not chosen here: that needs the owner's device and a
  remote-debugging session, and the owner's decision on a target. The methodology to apply on a real
  device is this tool's: serve the same modules to the phone over the LAN (or a Cloudflare tunnel, as
  `CLAUDE.md` describes), attach through Chrome remote debugging, and run the same phases; budgets for
  that device must come from those recordings, not from this page.
- **A real card pool.** The fixture has 8 cards; skills, triggers and replacement effects of real
  cards cost more per decision and bloat the bundle. The budgets here guard the fixture against
  regression; they are not a promise for the shipped game.
- **Production bundling and caching.** The graph is 76 unbundled modules from a localhost server;
  `coldWorkerStartMs` is cache-off and without a service worker. A built bundle, compression and the
  HTTP/service-worker cache will change it, mostly for the better.
- **Other engines.** Chrome only; Safari (iOS) and Firefox were not run and do not expose the same
  memory or throttling interfaces.
- **UI cost.** React rendering, painting and animation are not part of this; for the board's frame
  behaviour see `docs/arena-perf-baseline.md` (`npm run arena:perf:browser`), which measures the
  preview page.
- **Sustained play.** A 120-move game and 20 repeats; thermal and battery behaviour over long
  sessions is unmeasured.
- **The local policy's own cost (#646).** The bench plays the #641 `pick()` moves, not a policy. The
  Main-Phase policy is measured in Node only, by `scripts/verify/arena-policy-main.mts`: the policy
  alone at well under a millisecond p95 (asserted at most 5 ms, a sixth of `decisionMs.p95`), and the
  whole local step — `policyTurn` (alias table, snapshot, legal list), policy, guard and move — at
  about a third of the 30 ms `decisionMs.p95` budget on an unthrottled laptop. Its deterministic
  bound is the work counter (`MAIN_LIMITS.work`), not a clock. The whole local policy in a real
  Worker, on real cards, is measured by `npm run arena:local-worker-browser` (#652, section above). The battle policy (#647, `policy/combat.ts`) is measured the same way by
  `scripts/verify/arena-policy-combat.mts` (asserted at most 5 ms p95 and 100 ms max per decision in
  Node), with its own deterministic bound (`COMBAT_LIMITS.work`).
