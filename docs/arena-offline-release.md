# Arena offline MVP: release matrix and support statement

Issue #661 (Arena O4-06), plan `docs/arena-offline-plan.md` section O4. Recorded 14 Oct 2026 against `main` at
`708b6fbf43ebdedfbddd16730fe69813d1f10bd0` (after #660). Nothing here touched a database, a provider or a live
write. **This page does not release the offline MVP.** It says what was run, what passed, and what is a release
blocker or still open. No budget was relabelled, and no emulation stands in for a phone.

## 1. Verdict

| | Result |
|---|---|
| Desktop: both curated decks, both seats, each played to the END from a prepared app cold-launched with no network | **Plays: 8 of 8 matchups finish, each equal to the same match played in Node, decision for decision.** Card art shows from the installed pack (RB-1 resolved by #780: every image on every final board loads from a `blob:` URL, none addressed to a card CDN), so the bullet "no missing art" is **met on desktop**. |
| Desktop: reload, Worker recovery, storage failure (in the prepared, offline app) | Pass (recovery case, section 5). |
| Desktop: update | Partly. A failed shell update leaves the working shell; a pack update keeps a pinned pack (Node proof). A successful update to a NEWER build in a real browser was **not** run (open item OP-3). |
| Desktop: latency, responsiveness and memory | **Within the board budgets** (#782, section 6.1): no long task over 500 ms, the owner's accepted ceiling of 14 Oct (longest 116 ms, the first render of the board, after the fix of #782), and every re-derived board budget met; `userAgentMemoryBytes` recorded as not measurable. Against the O1 no-UI budgets (section 6.2, history) the board missed RB-2 to RB-5. |
| Physical phone | **OPEN. Nothing was measured on a phone.** Steps and an empty results table: section 8. |
| Emulated phone (390 px touch viewport, 4x CPU throttle on the page) | Plays 8 of 8 and the recovery case; **misses the desktop board budgets** (longest task 379 ms, match start 1,163 ms, section 6.1). **Emulation, not a phone**; the throttle does not reach the Worker. |

Release blockers: RB-1 (art) is **resolved** (#780, section 5.2). RB-2 (match start), RB-3 (main-thread long tasks and frames while the board
plays) and RB-4 (main-thread heap) are **resolved on the desktop** by #782: the longest task is cut and stays under 150 ms (the owner has since accepted up to
500 ms), and the other budgets were re-derived on the real board and are met (section 6.1). RB-5 is **recorded, not passed**:
`userAgentMemoryBytes` cannot be measured on this page, and is printed as not measurable with the reason. The physical phone
(OP-2) is still open, and the emulated phone misses the desktop board budgets. OP-1 to OP-5 are open items, not failures.

## 2. Versions and machine

| | |
|---|---|
| App build | `main` at `708b6fbf43ebdedfbddd16730fe69813d1f10bd0`, `GITHUB_SHA` set to it for `npm run build` (the shell's interpreter revision) and for every browser proof; shell version `91477027d219dc27` |
| Proof scripts | the PR head of #661 (`scripts/arena-offline-release-browser.mts`, `scripts/lib/cdp.mts` gained an `args` option) |
| Pack | SD15 `[Starter] Pride of the Saiyans` (deck A) and SD5 `[Starter] The Crimson Saiyan` (deck B), pack hash prefix `f6079ceed4b5`, 43 images, `qualification.playable` true |
| Browser | HeadlessChrome 141.0.0.0, `/opt/pw-browsers/chromium`, `--headless=new` |
| Machine | a cloud container: Linux 6.18 x86_64, 4 vCPU, 16 GB, Node v24.21.0. Other sessions share the host, so tails move between recordings |
| Phone | none. No physical device was available to the author |

## 3. What is supported, and what is not claimed

- **Supported by this release candidate (if the blockers close): exactly two decks**, the SD15 and SD5 starter
  decks of the pack above, in any of the four pairings (A v B, B v A, A v A, B v B), the human in either seat,
  against the built-in computer player, on one device, with no account.
- **Only the original game.** No Fusion World. No full catalog. No other Masters deck, no player-built deck, no
  owner deck. No online play offline. No sync of an offline match to the server.
- **No card has a card-level scenario** (`docs/arena-offline-deck-audit.md` section 1): most skill lines are
  compiled-only. "Plays to the end" here means the engine finished the match with no refusal, no interruption and a
  journal equal to the Node reference, not that every card text was exercised.
- **Browser**: Chrome (desktop, headless) is the only browser run. Safari/iOS and Firefox are not run.
- **Opponent strength**: the human side in these runs is a deterministic pseudo-random legal move (`humanPick`), so
  the computer won all eight; this says nothing about difficulty.

## 4. Repeat it (desktop)

```bash
/opt/node22/bin/npm ci --no-audit --no-fund               # Node 22's npm; then run everything below on Node 24
export PATH=/usr/local/bin:$PATH
export GITHUB_SHA=<the commit you build>                  # 40 hex; the same value for the build and the proofs
env -u DATABASE_URL npm run build
env -u DATABASE_URL npm run arena:offline-release -- --record --out matrix.json   # the matrix (about 6 min)
env -u DATABASE_URL npm run arena:offline-release -- --record --phone-emulated --out matrix-emulated.json  # EMULATION
env -u DATABASE_URL npm run arena:offline-shell-browser   # 47 checks, about 35 s
env -u DATABASE_URL npm run arena:local-browser           # about 65 s
env -u DATABASE_URL npm run arena:pack-store-browser      # 12 checks, about 6 s
env -u DATABASE_URL npm run arena:local-storage-browser   # about 45 s
env -u DATABASE_URL npm run arena:local-ownership-browser # about 50 s
env -u DATABASE_URL npm run arena:local-worker-browser    # about 15 s
env -u DATABASE_URL npm run arena:worker-bench -- --check # the O1 fixture gate, about 3.5 min
```

`arena:offline-release` (this issue) does, with no database and no sign-in:

1. starts `next start` on the build and, in a first Chrome, presses "Prepare for offline play" on `/arena/offline`
   (shell, the SD15/SD5 pack, every image). The sandbox answers the `/_next/image` requests with placeholder PNGs,
   as `arena:offline-shell-browser` does; **the real card art download is not exercised**;
2. stops the server and quits Chrome. Every later Chrome is launched with
   `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost` (nothing resolves, including the service worker's own
   requests) and its tab is emulated offline: airplane mode, in a desktop browser;
3. for each of 8 cases (deck A or B on each side x human first or second) launches a NEW Chrome on the same profile,
   opens `/arena`, which must land on the cached shell, picks the decks and seat in the page, presses Start match
   and plays to the end through the board's own `act` and `advance`. It compares the end with the same match played
   in Node: replay hash, final revision, the device's journal decision for decision, one request id per human move;
4. runs the recovery case (section 5);
5. prints every figure and compares it with the **board budgets** (#782: `BOARD_BUDGETS` in `scripts/lib/worker-budgets.ts`,
   derived in `docs/arena-worker-budgets.md` "Board budgets"). An `OVER` or a budget it could not measure (`NOT MEASURED`) is a
   failure unless `--record` is given, and is printed either way; `userAgentMemoryBytes` is printed `NOT MEASURABLE` with its reason
   and is never a pass. `--trace DIR` also records a CDP trace and CPU profile of each case and a breakdown of every task of 50 ms
   or more (for attribution; tracing slows the page, so a traced run's figures are not for the budgets).

## 5. Desktop results

### 5.1 The matrix: airplane mode, cold launch, whole match (recording of 14 Oct 2026, 05:23 UTC)

Every case: a new Chrome process, `/arena` landed on the cached shell with the panel "Ready for offline play",
no API route, server action or other host was asked (0 denied requests in the page and in the Worker), the match
reached `over`, and the final board and journal equal the Node match. Times are milliseconds, page-measured.

| Case (your deck v opponent's deck, your seat) | Revisions | Human moves | Computer decisions | Cold launch to shell | Start to board | Human move rtt p95 / max | Result | Card images on the final board |
|---|---|---|---|---|---|---|---|---|
| A v B, first | 93 | 45 | 47 | 242 | 610 | 31.4 / 40.9 | ended, equals Node | **0 of 7 loaded** |
| A v B, second | 125 | 59 | 65 | 218 | 362 | 32.6 / 65.7 | ended, equals Node | **0 of 9** |
| B v A, first | 111 | 56 | 54 | 185 | 462 | 37.6 / 48.5 | ended, equals Node | **0 of 8** |
| B v A, second | 173 | 89 | 83 | 206 | 435 | 33.7 / 64.7 | ended, equals Node | **0 of 7** |
| A v A, first | 190 | 94 | 95 | 203 | 374 | 33.7 / 65.6 | ended, equals Node | **0 of 5** |
| A v A, second | 77 | 42 | 34 | 195 | 376 | 30.0 / 39.7 | ended, equals Node | **0 of 5** |
| B v B, first | 98 | 49 | 48 | 192 | 352 | 31.8 / 60.3 | ended, equals Node | **0 of 8** |
| B v B, second | 133 | 57 | 75 | 178 | 356 | 35.0 / 44.7 | ended, equals Node | **0 of 11** |

(The case names are what was chosen in the form: "Your deck", "Opponent's deck", "Your seat". The raw JSON has
`decks.p1` / `decks.p2` and the human's seat for each case. "A v A" and "B v B" are mirror matches, in the same pack.)

Server/model requirement: none. Unresolved mechanics: no refusal and no interruption in any of the nine matches (a refused step or an
`interrupted` session would have stopped the case); this is the engine's finish, not a card-by-card claim (section 3).
**Missing art: every card image on every final board failed to load** (RB-1 below).

### 5.2 RB-1: the board showed no card art in airplane mode (RESOLVED by #780, 14 Oct 2026)

**Resolution.** The local board now draws the installed pack's own images. `loadLocalArt`
(`src/lib/arena/local/art-urls.ts`) reads the pack's images from the pack store (`PackStore.art`, each re-checksummed from
the device) into object URLs keyed by the catalog URL; `LocalBoard` (`deps.art`) swaps those URLs into every
snapshot it hands the board (`snapshot`, and each snapshot delivered through `watch`). The engine, the Worker, the
journal, the Snapshot contract and every shared board component are untouched, and online `/arena/[id]` has no map,
so its path is byte-identical. The object URLs live while the same pack is played ("Play again" reuses them) and are
revoked when another pack is chosen or the page unmounts. A pack that cannot be read from the store plays as before
(catalog URLs). `/arena/local` (a pack chosen from a file, no store) is unchanged.
**Evidence** (`npm run arena:offline-release`, true airplane mode by host-resolver block, the build at the PR head):
before the change `A-v-B first: 10 images on the final board, 0 loaded, 10 missing or broken (0 from blob: URLs, 10
addressed to a card CDN)` and the run FAILED; after it, all 8 final boards load every image (16 to 26 each, all from
`blob:` URLs, none addressed to a card CDN) and the recovery case's board after its failures loads 20 of 20. The script
now also fails on any image addressed to a card CDN and checks the recovery case's board. The Node-equality checks
compare the Worker's own snapshot (the page-side art swap is display only). `arena:offline-shell-browser` (47 checks) and
`arena:local-browser` pass. The section 6 numbers were recorded before this change; the run with it is still over budget on RB-2 to RB-5 (not changed or addressed here).

**History of the blocker (kept):**

The preparation stores the 43 images in the pack store (verified, decoded: `arena:pack-store-browser`,
`arena:offline-shell-browser`), but the board addresses each card by its catalog URL
(`https://storage.googleapis.com/deckplanet_card_images/SD15-01.png` and so on), which only the service worker's
`dbs-card-art-v1` cache can answer, and preparation does not put those URLs in it. `docs/architecture/arena.md`
already says "the board still shows art by its catalog URLs, not the pack store's images"; `PackStore.artUrls()`
(device-local object URLs) exists and nothing on the board uses it. With the host unreachable, 0 of 5 to 11 images
load in all 8 cases and in the recovery case's board.
**Mistake to avoid when repeating this:** with page-level offline emulation only, the service worker's own fetches
still reach the network, the CDN answers, and the art appears. Three earlier desktop recordings of this matrix (the first had one image still loading at its check, which the script
now waits for) showed art for exactly that reason; they are kept as "art through the network" in
section 6 because they measure the cost of a board WITH art, and are not airplane-mode evidence.


### 5.3 The recovery case, in the prepared offline app (same recording)

One match, A v B, human first, cold-launched offline, with these failures in order, each checked against the Node
reference at the revision it happened (hash and legal actions):

| Step | What was done | Result |
|---|---|---|
| Reload / relaunch | the whole browser quit at a human choice, relaunched cold and offline; "Continue" on the saved-match card | ok: same revision and legal actions as before the quit, the board equals the reference, nothing added or lost on the device |
| Worker recovery | the match Worker terminated at a human choice, then the human moves | ok: restarted once, the move accepted and written once, board equals reference |
| Storage failure (quota) | every IndexedDB write in the Worker throws `QuotaExceededError` and the human moves | ok: refused with the device-full notice and "Try again"; board and journal unchanged; after the fault is cleared and "Try again" the move is accepted once |
| Storage failure (abort) | every write transaction aborted during the computer's turn | ok: refused with an actionable notice; board and journal unchanged; "Try again" recovers |
| End | played on to the end | ok: ended at revision 121; the device's journal (120 decisions) and the final board equal the uninterrupted Node match; 0 match/provider requests |

Storage faults are injected into the Worker's IndexedDB calls, not a really full disk; Chrome's quota override does
not bite on localhost headless (`arena:local-browser` header). A real full disk and an OS-killed tab are phone
items (section 8).

### 5.4 The existing browser proofs, run on the same build (14 Oct 2026)

| Proof | Result |
|---|---|
| `arena:offline-shell-browser` | 47 checks passed, 34 s. Includes: an unprepared device downloads no shell; a pack for another interpreter revision is refused; an update whose install fails leaves the prepared shell and its cache whole; cold launch offline lands on the shell, its JS/CSS/fonts and the match Worker load from the cache; every shell cache audited; removal and "remove everything" |
| `arena:local-browser` | ok, 63 s. Reload at a choice / at an AI turn / mid-advance, Worker killed at a choice and mid-advance, duplicate and stale messages, quota and abort, two tabs racing Continue, then a take-over; the journal equals the Node reference |
| `arena:pack-store-browser` | 12 checks passed, 6 s |
| `arena:local-storage-browser` | ok, 44 s (33 ok lines) |
| `arena:local-worker-browser` | ok, 16 s; AI decision p95 32.4 ms vs the engine-only 30 ms (informational, as `docs/arena-worker-budgets.md` records) |
| `arena:local-ownership-browser` | **one run failed one check, the next passed** (49 s each): `7. C (the owner) released the lease on dispose`. 31 other checks passed in the failing run. Treat as a flake until an owner of #654 shows otherwise (OP-4) |
| `arena:worker-bench -- --check` | 46 budgets checked, 0 violations (the O1 fixture gate, still green on this Chrome) |

## 6. Budgets

### 6.1 The board budgets (#782, 14 Oct 2026): the gate from now on

Later on 14 Oct 2026 the owner accepted the current performance ("under 500 ms is ok and a longer match start is
also ok, until I report slowness"): the long-task ceilings are now **500 ms**. Earlier that day the owner had decided
to re-derive the budgets on the real board and to keep "no long task over 150 ms"
as a release blocker and fix it. What #782 did, in short (the full method, runs and profile are in
`docs/arena-worker-budgets.md` "Board budgets"):

- **The long task.** A CDP trace and profile (`--trace`) showed the longest task of every case is the board's first
  render. A quarter of it was the board parsing the whole DBS ruleset on the main thread to read its words
  (`dbsWords()`); that table is now generated with the ruleset (`npm run arena:rulesets`), so the browser never parses
  it. Desktop, three matrix runs each: longest task 108 / 122 / 137 ms before, 99 / 110 / 116 ms after; first-render
  task mean 98 ms before, 86 ms after; emulated phone 493 ms before, 379 ms after. The rest of that task is the
  board's real first layout (with the platform's font look-ups) and React's first render of it.
- **The budgets.** Re-derived from five desktop runs (worst run x1.25 for a time or size, x1.5 for a count), only
  where the board misses the O1 limit; `longTaskMaxMs` was held at 150 ms (now 500 ms, owner). `userAgentMemoryBytes` is recorded as not
  measurable (the app is not cross-origin isolated), never as a pass.

**Check run** (`main` + #782 at `42e3a8c`, built and run with that `GITHUB_SHA`, no `--record`): exit 0, every check
passed, 8 of 8 matchups and the recovery case equal to Node. A run just before it, on the same build, **stopped** in
its 7th case: the container's disk was 98% full (other sessions' worktrees; 955 MB free) and the match Worker's
IndexedDB writes were refused ("this game could not be saved on this device"), and in that run `roundTripMs.p95`
was 71.6 ms against 70; after freeing 700 MB of this session's own trace files the rerun passed. Both are in the
evidence (`release-check-pass.json`, `release-check-disk-full.json`).

| Board budget | Limit | Desktop check run | Emulated phone (EMULATION, `a5cc5b4`) |
|---|---|---|---|
| `roundTripMs.p95` | 70 ms | 42.4 ok | 65.3 ok |
| `roundTripMs.max` | 250 ms | 57.8 ok | 80.5 ok |
| `decisionMs.max` | 300 ms | 115.7 ok | 210 ok |
| `coldWorkerStartMs.p50` / `.max` | 1500 / 6000 ms | 125.3 / 143.3 ok | 122 / 139 ok |
| `matchStartMs.p95` | 770 ms | 609.8 ok | **1162.6 OVER** |
| `frameIntervalMs.p95` | 51 ms | 33.4 ok | 50.1 ok |
| `framesOver50Ms` | 38 | 19 ok | **90 OVER** |
| `longTaskCount` | 12 | 5 ok | **44 OVER** |
| `longTaskMaxMs` | 500 ms (owner; first 150) | 116 ok | 379 ok (emulation) |
| `longTaskAtMatchStartMaxMs` | 500 ms | 116 ok | 379 ok (emulation) |
| `workerHeapRetainedBytes` | 16 MB | 7.3 MB ok | 7.3 MB ok |
| `workerHeapAfterBulkBytes` | 64 MB | 20.2 MB ok | 23.1 MB ok |
| `mainHeapBytes` | 20 MB | 13.5 MB ok | 14.3 MB ok |
| `userAgentMemoryBytes` | not measurable | not measurable | not measurable |

The emulated phone is judged against the desktop budgets and misses them: emulation gets no budgets of its own, and
what a phone must meet is the owner's to record on the physical phone (section 8). Evidence:
`docs/arena-backlog/evidence/782/`.

### 6.2 History: the O1 table applied unchanged (#661, before #782)

Rule from that page: a budget the tool cannot measure is a violation, not a pass. The budgets were set on a bare
page that runs the engine in a Worker (no React, no board). They are applied here unchanged to the real app. Where
the measurement differs from the budget's definition it is said in the last column, and the figure is still
judged against the number as written; re-deriving a budget for the real board is a decision for the owner and
#643's procedure (step 5), not something this page does.

"Offline" = the 14 Oct 05:23 UTC recording of 5.1 (no art on screen). "Art through the network" = three
earlier desktop recordings (04:51, 04:55, 05:12 UTC) in which the service worker reached the CDN, so art WAS
on screen and decoded. "Emulated phone" = the same two modes with a 390 px touch viewport and the page
throttled 4x (the Worker is not throttled). All times in ms; worst case of 8 matches unless said.

| Budget | Limit | Desktop, offline | Desktop, art through the network (3 runs) | Emulated phone, offline | Emulated phone, art through the network | Note |
|---|---|---|---|---|---|---|
| `roundTripMs.p95` | 50 | 37.6 ok | 46.9, 49.6, **59.7 OVER** | **62.5 OVER** | **87.1 OVER** | human move: act to result, worst case's p95 |
| `roundTripMs.max` | 250 | 65.7 ok | 66.6, 93, 81.3 ok | 81.9 ok | 91.6 ok | |
| `decisionMs.max` | 300 | 78.6 ok | 82.2, 87, 82.9 ok | 183.6 ok | 286.2 ok | slowest advance / decisions it committed |
| `coldWorkerStartMs.p50` | 1500 | 103 ok | 96, 107, 96 ok | 116 ok | 129 ok | Worker construction to first message, from the cache |
| `coldWorkerStartMs.max` | 6000 | 123 ok | 128, 132, 121 ok | 138 ok | 143 ok | |
| `matchStartMs.p95` | 450 | **610 OVER** | **471, 535, 477 OVER** | **1115 OVER** | **1192 OVER** | Start click to first board, includes React render; 8 samples, p95 = max |
| `frameIntervalMs.p95` | 34 | 33.4 ok | **49.9, 50, 50 OVER** | **49.9 OVER** | **83.4 OVER** | rAF, Start click to end of match |
| `framesOver50Ms` | 6 | **14 OVER** | **30, 29, 30 OVER** | **77 OVER** | **101 OVER** | per match; the budget counts ~1,300 frames, a match here has 1,400 to 2,500 |
| `longTaskCount` | 3 | **4 OVER** | **18, 24, 18 OVER** | **28 OVER** | **55 OVER** | per match |
| `longTaskMaxMs` | 150 | **202 OVER** | 107, 125, 113 ok | **487 OVER** | **507 OVER** | |
| `longTaskAtMatchStartMaxMs` | 250 | 202 ok | 107, 125, 105 ok | **487 OVER** | **507 OVER** | |
| `workerHeapRetainedBytes` | 16 MB | 8.1 MB ok | 8.3, 8.0, 8.2 ok | 8.0 ok | 8.0 ok | Worker heap after forced GC, end of one match |
| `workerHeapAfterBulkBytes` | 64 MB | 21.8 MB ok | 20.3, 24.6, 24.2 ok | 8.8 ok | 21.4 ok | budget is after 20 games; here one match, before GC |
| `mainHeapBytes` | 8 MB | **15.4 MB OVER** | **14.6, 13.9, 14.1 OVER** | **14.9 OVER** | **15.2 OVER** | page heap after forced GC, WITH the React app |
| `userAgentMemoryBytes` | 64 MB | **NOT MEASURED** | NOT MEASURED | NOT MEASURED | NOT MEASURED | `measureUserAgentSpecificMemory` needs a cross-origin-isolated page; the app is not |

Also recorded, no budget: the sum of resident memory of every Chrome process on the profile 1.20 to 1.26 GB
(headless Chrome with a service worker, a Worker and a renderer; it counts shared pages more than once, so an
upper bound, not the page's footprint); one viewer's snapshot up to 120.8 KB (the fixture's info line is 80 KB;
`docs/arena-worker-budgets.md` already records the real pack above it); the computer's advance p95 per decision
45 to 74 ms (info against the engine-only 30 ms); cold launch to the shell 178 to 242 ms and to a startable form
389 to 483 ms on the desktop (1.4 to 2.0 s emulated); a whole match 27 to 49 s of wall time at the driver's pace.

(Superseded on the desktop by 6.1: #782 cut the longest task and re-derived these budgets on the board.)
Release blockers from this table (each stays a blocker until a rerun on a quiet machine, or a re-derived budget
the owner accepts, says otherwise):

- **RB-2 `matchStartMs`**: 610 ms offline (471 to 535 with art) against 450. Already "at its ceiling on the real
  pack" in `docs/arena-worker-budgets.md`; the figure here includes the React render of the board.
- **RB-3 `longTaskCount`, `framesOver50Ms`, `longTaskMaxMs`, `frameIntervalMs.p95`**: the board's own rendering
  makes 4 (offline) to 24 (with art) main-thread tasks of 50 ms or more per match, 14 to 30 slow frames, and
  202 ms at worst (487 to 507 ms emulated) against 3 / 6 / 150 / 34. `roundTripMs.p95` also went over in
  three of the six recordings (59.7 ms desktop with art; 62.5 and 87.1 ms emulated). The O1 budgets measured the engine alone; the board is the
  cost.
- **RB-4 `mainHeapBytes`**: 13.9 to 15.4 MB against 8 MB. The 8 MB was a page with no UI.
- **RB-5 `userAgentMemoryBytes`**: not measurable on this page. The Worker heap (8.1 MB retained) is inside its budget.

Not a blocker: the engine. Per-call and per-decision latency in the Worker, the cold Worker start, and the Worker heap
are inside every budget in every mode, and the O1 fixture gate is still green.

## 7. Open items (not failures, not passes)

| | What | Why open |
|---|---|---|
| OP-1 | Real card art over the network during preparation | the sandbox answers art with placeholder PNGs; the real CDN download is the owner's (`arena:offline-shell-browser -- --real-art`) |
| OP-2 | The physical phone | section 8 |
| OP-3 | A successful update of the shell to a NEWER build while a match is saved, in a real browser | needs two builds served in turn; only the failed-install path (browser) and the unit proofs (`npm test`: `arena-offline-shell`, `arena-pack-store`) exist |
| OP-4 | `arena:local-ownership-browser` flake | one of two runs failed one dispose check |
| OP-5 | Safari/iOS and Firefox | no run; the memory and long-task APIs differ |

## 8. Physical phone: steps for the owner, and the table to fill in

Not run. An emulated phone viewport is not a substitute and is labelled as emulation everywhere above. Pick the
target phone and browser (for example the phone you use at the table and its default browser), write them in the
table, and keep the acceptance bullets about a phone open until every row has a result.

**Set-up (a computer on the same network)**
1. `export GITHUB_SHA=<commit>`; `npm run build` with that commit; `npm start` (no database needed:
   `env -u DATABASE_URL`). The service worker needs HTTPS, so expose it with a tunnel
   (`cloudflared tunnel --url http://localhost:3000`, as `CLAUDE.md` describes). Note the commit and the URL.
2. On the phone note: model, OS version, browser and version, free storage, battery, power-saving mode.

**Prepare (online)**
3. Open `<tunnel>/arena/offline` in the browser. Press "Prepare for offline play". Time it. Wait for "Ready for
   offline play". Note the storage the page reports. Optionally add the page to the home screen.

**Airplane mode**
4. Stop the tunnel and the server. Switch on airplane mode (Wi-Fi and mobile data off). Force-close the browser
   (swipe it away). Open the browser (or the home-screen icon) and go to `/arena`. It must land on the shell and
   say "Ready for offline play". Time from the tap to the form.
5. For each pairing in the table below: choose "Your deck", "Opponent's deck", "Your seat"; press Start match; play
   to the end by hand (any legal moves). Note the time to the first board, any stall or frozen frame you see, any
   error text, and whether every card image shows.
6. Reload the page at a human choice: "Continue" must offer the saved match and restore the same board.
7. Force-close the browser mid-match and reopen it offline: "Continue" again. Do it once during the computer's turn.
8. Storage failure: with the device nearly full (fill it with files until the browser reports little room), press
   a move in a match. Expect the device-full notice with "Try again"; free space; "Try again" must work. If you
   cannot fill the device safely, write `not run` and why.
9. Worker recovery cannot be forced by hand on a phone: background the browser for a few minutes under memory
   pressure (open several heavy apps), return, and note whether the match is intact or "Continue" restores it.

**Latency, responsiveness, memory (phone attached to a computer)**
10. Android Chrome: `chrome://inspect` on the computer; iOS Safari: Web Inspector from a Mac. During one whole
    match record the Performance panel: count of long tasks (50 ms or more) and the longest, frames over 50 ms,
    and the JS heap in Memory after "collect garbage". Compare with the budgets in section 6. If you cannot attach
    a debugger, use a stopwatch for "tap Start to first board" and write what you saw for stalls.

| Row | Result | Notes |
|---|---|---|
| Phone model, OS, browser and version | | |
| Commit built, tunnel URL | | |
| Prepare time, storage shown | | |
| Cold launch in airplane mode lands on the shell (time to the form) | | |
| A v B, human first: played to the end | | |
| A v B, human second | | |
| B v A, human first | | |
| B v A, human second | | |
| A v A, either seat (optional) | | |
| B v B, either seat (optional) | | |
| Every card image shows offline | | |
| Reload at a human choice, Continue | | |
| Force-close mid-match, Continue | | |
| Force-close during the computer's turn, Continue | | |
| Storage failure notice and recovery | | |
| Memory-pressure return | | |
| Start to first board (budget 450 ms) | | |
| Long tasks per match, longest (board budget 12, 500 ms) | | |
| Frames over 50 ms per match (budget 6) | | |
| JS heap after GC, page and Worker (budgets 8 MB, 16 MB) | | |
| Anything else seen | | |

## 9. Acceptance bullets of #661 as of this page

| Bullet | State |
|---|---|
| Prepared app cold-launches in airplane mode and finishes every supported matchup in both seats with no server/model requirement, missing art or unresolved required mechanics | **Open (desktop bullet met; phone and budgets outstanding).** Finishes: yes, 8 of 8 (desktop). Server/model need: none. Unresolved mechanics: none refused. **Missing art: none** (RB-1 resolved by #780: 8 of 8 final boards and the recovery case's board load every image from the pack store). Budgets on the desktop: met since #782 (section 6.1). Still **Open** for the physical phone. |
| Phone and desktop latency/responsiveness/memory meet the recorded budgets or remain explicit release blockers; emulator results do not substitute for a physical phone | **Open.** Desktop: the board budgets are met (#782, section 6.1; `userAgentMemoryBytes` recorded as not measurable). Emulated phone: misses them (labelled emulation). Physical phone: not measured (section 8). |
| Publish versions, devices, repeatable steps and evidence for normal/failure cases; missing hardware stays open; full catalog/Fusion World not claimed | Published here for the desktop; phone rows open; no full-catalog or Fusion World claim. |
| Focused scenario checks plus typecheck, lint, test, build | See the PR. Database-backed fuzz and live-device checks are not run (unavailable to an agent) and are not claimed. |
| Attach scenario-specific evidence and limitations; link an owning issue for a blocker | Evidence JSON: `docs/arena-backlog/evidence/661/`. RB-1 was owned by #780 (resolved); RB-2 to RB-5 by #782 (desktop resolved, RB-5 recorded as not measurable; evidence `docs/arena-backlog/evidence/782/`). |

Evidence files (`docs/arena-backlog/evidence/661/`): `desktop-offline-2026-10-14.json` (5.1, 5.3, the "Desktop,
offline" column), `phone-emulated-offline-2026-10-14.json`, and for the "art through the network" columns
`desktop-art-via-network-2026-10-14.json` (the third run) and `phone-emulated-art-via-network-2026-10-14.json`.
