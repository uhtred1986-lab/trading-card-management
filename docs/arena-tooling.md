# The arena's instruments — what each one proves, and how to use it

Written 9 Sep 2026. Companion to `docs/arena-next-session-prompt.md`, which says
*what* to work on; this says *how to know whether you broke something*.

There is **no test framework**. Every check is a plain `assert` script run with
`tsx`. That is deliberate and worth preserving: a check is a paragraph of prose
followed by an assertion, and the prose is the point — most of these scripts
read as an argument about the rules with the assertion as its full stop. Extend
them in the same style.

---

## 1. The two measurements

These are not tests. They are **instruments**: they tell you what the compiler
currently reads, so you can see what your change did. Nothing else in the
project answers that question.

### `npm run arena:readings`

Prints, for all ~13,500 skills in the catalog: the **printed** card text and
what the compiler **reads** it to mean, in words. No database, no network, ~8 s.

```
BT7-110#0 counter:play
  printed: [Counter: Play] … choose all Battle Cards with energy costs of 2 or less …
  reads:   … choose all card with an energy cost of 2 or less in each player's battle …
```

`-- --grep "<wording>"` narrows to one wording; `--unread` adds the clauses that
did not read at all.

**This is the only check on a clause that compiles and reads wrongly**, which is
the failure mode that matters (see §3 of the next-session document). Coverage
numbers cannot see it: a clause that reads the wrong thing is still a clause
that compiled.

**How to diff it.** Key by card and skill, never line by line — the file is
40,000 lines and any insertion shifts everything after it:

```
key() { awk '/^[A-Z0-9]/{k=$0} /^  reads:/{print k" || "$0}' "$1" | sort; }
diff <(key read-before.txt) <(key read-after.txt)
```

**How to sign it off.** Every moved line, by hand, against the printed text —
until there are too many, at which point prove a **property** and then still
check one named card by hand. Properties that have been used and have caught
real problems:

- *"Every moved line differs from its predecessor only by the phrase I added."*
  Strip that phrase from both sides and assert equality. Used for a change that
  moved 120 lines; it found none of them had changed in any other way.
- *"Every surviving reading is a strict prefix of the one it replaced."* Used
  for a change that refused the tail of 270 skills; 268 held, and the two that
  did not were modal options where a *branch* lost its tail — the same property
  one level down.

**The trap.** An instrument can be blind to the change it is measuring. A new
`Selector` field once compiled correctly but had no words in `describeSelector`,
so the first readings diff came back clean *by accident*. If your diff is
suspiciously empty, check that the reading can express your change at all.

### `npm run arena:tally -- --misses 100000`

The gap set: every clause shape the compiler could **not** read, with counts,
plus headline coverage.

```
cards 6493, fully compiled 4678 (72.0 %)
unread clauses 3455 over 2416 distinct shapes
```

`-- --show "<a wording>"` prints the actual cards behind a shape — **use it
before believing any count**, including one in a document. Needs the network
(it fetches the live catalog) and **fails transiently**: a result of about
fourteen lines is a fetch error. Three separate work streams have been fooled by
an intermediate run whose deltas did not reproduce on a clean re-fetch.

**How to diff it.** Strip the counts so a shape that merely changed frequency
does not look like a new one:

```
strip() { sed -E 's/^ *[0-9]+ +//' "$1" | sort; }
diff <(strip gap-before.txt) <(strip gap-after.txt)
```

Shapes that **appear** matter as much as shapes that vanish — an appearing shape
is usually a clause you correctly refused. A falling coverage number is often
the change working.

---

## 2. `npm test` — what it actually runs

In order. All must pass; none needs the network. `verify-arena.ts` runs **once**, on the rules
engine, the only engine there is: #118 (13 Oct 2026) deleted the legacy engine (`src/lib/arena/engine/`),
its adapter and `engineFor`, the `--engine`, `--rules-only` and `test:rules*` lanes, the legacy-call
guard and `probe-rules-parity.json`. Passages below that say "on both engines", "the legacy run" or
`--engine` describe the history; the suites themselves now assert on the rules engine only, and a case
the rules engine cannot yet prove is still a named `rulesGap`, listed at the end of the run.
The probe digests in `contract/probe-digests.json` are now the rules engine's own record (they were
the legacy engine's).

| script | needs | proves |
|---|---|---|
| `scripts/verify-rules.ts` | nothing | the pure rules helpers (deck legality, reservations, scan matching) |
| `scripts/verify-arena.ts` | nothing | the arena — the suites below — on the rules engine, with every case a suite could not assert listed by name |
| `scripts/verify-db.mts` | nothing (PGlite in memory) | the migrations apply, and the reservation rules hold against real SQL |
| `scripts/verify/arena-scenario-runner.mts` | nothing | the focused scenario runner (`npm run arena:scenario`, §5b): setup, battle and pending-choice scenarios are deterministic, and a mismatch exits non-zero |
| `scripts/verify/arena-policy-shortcuts.mts` | nothing | the online opponent's free choices (#645, `policy/shortcuts.ts` via `ai/shortcut-input.ts`): at 2,017 positions (#641's game, every #642 scenario, #644's fixture over 8 seeds, a mixed-cost deck over 16 seeds, three [Empower] carries) the adapter picks the menu index and words origin/main's `freeChoice` picked (`fixtures/arena-policy-shortcuts/before.json`, recorded before the move) and declines wherever it declined; through `policyTurn` the same rule picks the same engine move; swapping hidden cards and moving the game's seed/RNG changes no choice; golden cases per rule (empty menu, no match, ties, thresholds); a shortcut needs no provider and makes no request, anything else still reaches it once |
| `scripts/verify/arena-policy-contract.mts` | nothing | the local policy boundary (#644, `src/lib/arena/policy/`): the policy layer imports nothing outside `policy/`; at every position of #641's game, #642's scenarios and two policy-played games on `arena-policy-fixture.ts`, for both seats, no hidden id or reveal epoch reaches the policy, permuting hidden identities/order/ids changes nothing it sees or answers, every legal move is one decision that plays identically, compound picks play as the engine's one-card answers, and stale/foreign/malformed answers are refused |
| `scripts/verify/arena-policy-main.mts` | nothing | the local Main-Phase policy (#646, `policy/main.ts`, wired as `boundary.ts`'s `localStep`): a pure policy-layer module; named scenarios staged on real engine states (`arena-policy-main-fixture.ts`) — the dearest affordable development play, plays and a payment that keep the colour another card needs, a favourable attack and none that loses, `endMain` when nothing is worth doing, an unlimited free activation used once; the cycle guard ends a looping policy's turn and interrupts when it cannot; at every Main-Phase/payment position of #641's game, the #642 scenarios and 18 strength games the choice plays, is deterministic, draws no RNG, stays in the work bound and survives two permuted hidden states; Node cost against the #643 budgets; the 18 games won more than lost against shortcuts + uniform. The larger strength run is `npm run arena:policy-eval` (not in `npm test`) |
| `scripts/verify/arena-policy-combat.mts` | nothing | the local battle policy (#647, `policy/combat.ts`, the third layer of `localPolicy`): a pure policy-layer module the online opponent does not load; named battles staged on real engine states (`arena-policy-combat-fixture.ts`) and fought to their end through `localStep`, each checking the cards, energy and life actually spent — a lethal attack blocked, no chump block while life allows, a surviving blocker used, a tied attacker passing (8-4-6) while the defender combos the cheapest card that is enough, an offensive combo exactly enough, no combo on a lost battle on either side, [Critical]/[Double Strike] turning a taken hit into a defended one, a negating counter taken only when it is worth it (and not when a blocker will do), a "+5000 power" battle activation used instead of a card, the same from p1's chair; the cycle guard's battle exits; at every blocker/counter/combo position of the staged battles, the #642 scenarios and 16 strength games the choice plays, is deterministic, draws no RNG, stays in the work bound and survives two permuted hidden states; Node cost; strength against the #646 policy (reported) and shortcuts + uniform (asserted to win more than it loses). `npm run arena:policy-eval` adds the #646 policy (`main646`) as a baseline and the #647 fixture |
| `scripts/verify/arena-offline-pack.mts` | nothing | the versioned offline deck pack (#655, `src/lib/arena/local/pack.ts`, built by `scripts/build-arena-offline-pack.mts` from the #649 snapshot): two builds byte-identical; removing a token card, a Leader's second face, a program, an art item or a ruleset file fails validation even with every hash recomputed; tampering, a forged `playable`, an unsupported format/VM version, a foreign interpreter and an unread program keep it unplayable; the blocker register equals `arena-offline-deck-audit.md`'s; a validated pack instantiates SD15/SD5 in both seats through `browser.ts`; exact field sets (no account/collection data); `offlinePackRule` import boundary with sabotaged copies |
| `scripts/verify/arena-policy-choices.mts` | nothing | the constrained choices and the complete local policy (#650, `policy/choices.ts`, the fourth layer of `localPolicy`, whose default fallback interrupts): a pure policy-layer module the online opponent does not load; the coverage matrix (`WINDOW_HANDLERS` names a layer for every `DECISION_WINDOWS` kind, and each is answered by it — never the fallback — at a named fixture: real rules-engine positions for the fourteen kinds that engine asks, contract-built inputs with the legacy engine's answers for `optionalCost`/`offering`, which the rules engine asks as `chooseMode`); named scenarios on synthetic cards (`arena-policy-choices-fixture.ts`) played through `localStep` — an optional pick of the best target and an empty one at low life, a required two-card KO as one compound pick, a required discard of the least valuable, a priced Auto paid, a printed mode, [Offering] at 7 and 3 life, Auto order, [Empower] at the maximum, an exact payment keeping a colour, a Life card replaced to the hand, a KO substitute paid with the least valuable card; typed interruptions (an unreadable window, a referee question, a refused pick); at every position of the scenarios, the #641/#644/#647/#650 fixture games and one game per ordered #649 audit matchup (SD15/SD5) the strict policy answers without its fallback, plays, is deterministic, draws no RNG, stays in its work bound and survives permuted hidden states; Node cost; strength against the #647 policy (`combat647`, reported). `npm run arena:policy-eval -- --audit --baselines combat647` is the larger run |
| `scripts/arena-policy-eval.mts --check` | nothing | the local policy's regression gate (#651, `docs/arena-policy-evaluation.md`; about 15 s): 6 games on three fixtures against `uniform` (both seats) fail on any illegal decision, cycle-guard trip, unfinished game or unexplained interruption; hidden-state twins (unseen cards swapped, hidden areas reordered, ids permuted) of every 10th decision must give the same observation, answer and a playable move; a replay must give the identical record (trace hash included); the dev and reserved holdout seed sets must not meet; the policy must win more than it loses. A tripwire, not a strength measurement. The full evaluation (`--games 40`, `--audit`, `--determinism`, seat bias against a `control`) and the browser latency run (`npm run arena:policy-browser`, Chrome) are in the doc and are not in `npm test` |
| `scripts/verify/arena-local-worker.mts` | nothing | the local match worker protocol (#652, `src/lib/arena/local/{protocol,worker,worker-entry}.ts`, page client `src/components/arena/session/local.ts`; about 30 s): behind an in-process channel that clones every message and delivers each as its own task, the page client plays a whole match of the audited SD15/SD5 pair (staged to qualify, test-only) against the local policy in batches; on the way a foreign session, the AI's seat as actor, a stale revision, hidden and out-of-date aliases, malformed and other-version messages are refused, a duplicate request is answered from its receipt and a reused id with another payload is a conflict (online semantics), and forged worker messages (unknown request, other session, older revision, other game, other version, extra field) never reach the board — the journal byte-identical after each; every posted message has exactly the protocol's fields, names no card the human may not read, and every snapshot is the projection of the host's state and survives permuted hidden state (#644/#719, unconcealed control); the same match in batches of 1, cancelled every AI turn, disposed mid-advance and resumed from the journal ends in the identical game (board, trace, AI memory/RNG); an unqualified pack, another interpreter or policy version, a tampered/unknown-format pack, an unknown deck, a busy worker, a doctored or foreign journal fail by name; an AI question the policy cannot answer stops the session as `interrupted` with nothing played or invented; the worker entry's graph obeys `offlinePackRule` and the client's reaches no engine (sabotaged copies). The real-Worker half is `npm run arena:local-worker-browser` (Chrome, not in `npm test`; `docs/arena-worker-budgets.md`) |
| `scripts/verify/arena-local-storage.mts` | nothing | local matches journalled in IndexedDB (#653, `src/lib/arena/local/storage.ts`; about 40 s), on `scripts/verify/fake-indexeddb.ts` — a **fake** IndexedDB written for this proof (no IndexedDB package is installed), implementing only what the store uses with IndexedDB's commit/abort/version-change semantics: the plain scripted match posts byte-identical messages on the store and in memory, and #652's run "b" ends in the same game; saved during a human choice and during an AI turn, closed and resumed by a new host on a new connection, the state, board (legal actions), AI memory, journal and next policy decision are identical, and play on to the identical end; an aborted transaction, exhausted quota (a human move and an AI batch) and a crash inside a commit each leave the device at the last committed revision (equal to the host's journal), are reported as `storage`, and the match continues to the same end; 13 damaged saves (corrupt, truncated, tampered header/decision, newer record schema, a forged save with recomputed digests that the replay refuses) and another pack/interpreter are refused by name; a commit never rewrites history; no IndexedDB is `storage`/unavailable; schema 1 → 2 upgrade keeps the save, a failing migration keeps version and data, an older build refuses the newer database untouched; stored records have exactly the journal's fields and no board, state, pack, account or email; an all-digit (server) match id is refused; no network call; `storage.ts` passes `offlinePackRule`. The real-IndexedDB half is `npm run arena:local-storage-browser` (Chrome, not in `npm test`, about 1 minute): the real Worker killed at rest and inside an open commit transaction (AI batches and a human move, via the test-only `scripts/verify/arena-local-storage-worker.ts`), page reloads, an injected abort, Chrome's real quota exhaustion (`Storage.overrideQuotaForOrigin`), damaged saves, the schema upgrade path, every board compared with the Node reference |
| `scripts/verify/arena-local-ownership.mts` | nothing | one writer per local match and recovery of interrupted workers (#654, `src/lib/arena/local/{ownership,recovery}.ts`; about 75 s): "tabs" are `LocalMatchSupervisor`s with their own holder ids and connections to one database on the fake IndexedDB (which now serialises overlapping transactions and queues opens behind a version change, as IndexedDB does), with Node's own Web Locks and `BroadcastChannel`; "workers" are hosts behind an in-process port that can be killed, hung, or killed just before/after a commit is persisted. Five simultaneous claims (lease alone, and Web Locks) grant exactly one; two workers at one revision under an old and a new fence race the same human move and AI turn — one accepted revision, the other `busy-elsewhere`, one linear history on the device; an unfenced resume is refused while the match is held; a second tab watches (read-only board following the holder's broadcast commits, its moves refused, nothing written) and takes over when the holder vanishes (at once with Web Locks, after the lease ages without), resuming the identical board; a frozen owner's lease ages, another tab takes over and plays, the woken tab's move is refused and it watches the new history; "play here instead" steals a live (or frozen, Web Locks) holder's lock and fences it; the worker killed before/after persisting a human move (applied once / answered as a duplicate) and an AI batch (recomputed), hung inside a commit, failing with `error`, dying while idle (ping) — each restarted and resumed at the last commit, the game ending on the reference board decision for decision with the AI memory/RNG unchanged; a worker that dies on every open is `failed` after `maxRestarts` and `retry()` recovers; `stop()` cancels a hung open; a full device is `storage` and recovers; reloads mid-choice and mid-AI-turn; `dispose()` leaves no worker, timer, channel, lock or unreleased lease. The two-tab Chrome half is `npm run arena:local-ownership-browser` (not in `npm test`, about 2 minutes): simultaneous claims, a watcher, a takeover racing a long AI advance, the holder's tab closed, the worker killed mid-AI-batch and mid-move (before and after persistence), a frozen owner (`Page.setWebLifecycleState`) fenced in lease-only mode, cleanup, every board compared with the Node reference |

`verify-arena.ts` imports fourteen suites from `scripts/verify/`, each on its
own, and reports **pass / skipped / failed per suite** rather than stopping at
the first — only a real failure exits non-zero. Knowing which one failed (or
skipped) tells you what you broke:

- **`harness.ts`** — the foundation the others build on: synthetic cards, a
  staged game, and the assertion helpers. Not a suite of its own so much as the
  vocabulary. **Read this first** if you are writing a new check. Since #152 it
  is two vocabularies in one file: `game()`/`arena()`/`play()`/`find()`/
  `labels()` still read `GameState` directly and still narrow every suite that
  imports them (through `legacyState`) to legacy-only — that half is unchanged,
  and every suite below except `battles`/`workflow` still uses it. Beside it is
  the **state interface**: `arenaG`/`playG`/`findG`/`labelsG`/`gameG`/
  `assertDisjointG`/`addEffectG`/`placeUnderG`/`powerOfG`/`rejectedActionsG`, and
  the field-level seam `zoneOf`/`leaderOf`/`unisonOf`/`energyMarkersOf` for the
  one thing the two engines keep under a different shape (`players[p][area]`
  against `sides[p].zones[area]`; a scalar Leader/Unison against a single-entry
  zone). Everything else — `prompt`, `battle`, `winner`, `overReason`, `phase`,
  `turn`, `turnPlayer`, `effects`, and `cards[id].{mode,markers,under,flipped,
  faceUp,hidden,battledThisTurn}` — is the same field on both `GameState` and
  `VmState` and is read directly off `EngineState`, no seam needed. Only
  `battles.ts` and `workflow.ts` use the `G` half today; a third suite reaching
  for it finds the vocabulary already there rather than growing its own copy of
  `verify/vm.ts`'s original local `stage`/`atMain` (§23/§24, still there,
  unchanged — the two are allowed to diverge in staging *strategy*, see the
  state-interface section's own header comment: the legacy branch of `arenaG`
  is `arena()` unchanged, real `move()` and all; the rules branch is a raw
  relabel-and-splice, no moment fired, the same simplification `vm.ts`'s own
  `stage` always was).
- **`text.ts`** — how card text is read before any game exists: the skill
  parser, keyword recognition, the errata corrections.
- **`setup.ts`** — the seed and game setup (§6-2). A failure here usually means
  determinism broke, which invalidates every other suite.
- **`battles.ts`** — combos, blockers, counters, the keywords that decide a
  battle. **Runs on both engines since #152**, and since #156 every case is
  a real assertion on `--engine rules` too: the keyword cases it used to skip
  by name are built ([Awaken], [Critical], [Double Strike], [Victory Strike],
  [Dual Attack] and [Revenge] by #156, [Indestructible] by #154, [Unique] and
  [Evolve] by #157, [Z-Stack] by #155, whose case stages its Z-Energy
  directly on `rules` because 8-5-2's Z-Energy offer is still #151's). Proves, on the rules engine as much as the legacy one:
  combo power deciding a battle and combo cards reaching the Drop, [Blocker]
  redirecting an attack and resting, [Counter: Attack] negating one before the
  Offense Step, what `view.battle` says about counters and contributions,
  8-1-2-1/8-1-2-2's memory of having battled (`VmCard.battledThisTurn`, #152),
  Unison play/growth/the missing Defense Step against one, 23-2's placing a
  card under another including the two piled-card cases (23-2-5/23-2-6, also
  #152 — see `vm/zones.ts`'s `moveCard` and `vm/host.ts`'s `placeUnder`), and
  the WIN checkpoint on battle damage, deck-out and concession. `verify/vm.ts`
  §23/§24 remain the place a *new* rules-engine battle fact is proven first,
  against the oracle, before a suite meant to run unchanged on both engines
  takes it for granted.
- **`compiler.ts`** — the largest: what a printed line becomes, and what the
  interpreter does with it. Most compiler changes that break something break
  here.
- **`keywords.ts`** — the §22 keywords as engine rules, and a good deal of
  general §9/§20 mechanism besides. **Runs on both engines since #158**,
  through the same state-interface layer `battles.ts`/`workflow.ts` use
  (`arenaG`/`playG`/`findG`/`labelsG`/`actsG`/`canActivateG`/
  `rejectedActionsG`, `zoneOf`/`leaderOf`/`unisonOf`). Two readers this suite
  needed that neither of those had reached for yet are on `harness.ts`
  alongside them: `hasG`/`skillNegatedG` (a keyword or a skill in force,
  off `vm/program.ts`'s `hasKeyword` and `vm/effects.ts`'s `skillNegated`)
  and `masterOfG` (3-1-6, bound to the `GameDefinition` the way `powerOfG`
  already is); `stageMoveG` is a new test-only fixture rig beside
  `stageOnRules`'s own, for relocating a card into a zone as pure setup
  (no event, no moment) where `move(CTX, …)`'s reason and event log are not
  what the case is testing. Three gate functions name what is still skipped
  on `--engine rules`, each printing the reason rather than doing nothing:
  `keywordGap` (a keyword's own `DEFINE KEYWORD` carries no `HOOK` body for
  what the case needs — most of the 39, `docs/arena-backlog/s7-0{2,3,4,5}-
  *.md`; a fourth, `staticGap`, left with its last cases at #154, which reads
  a [Permanent]'s `immune` op as #148 reads `altCost` and `payWith`),
  `lifeGap` (9-10's `life` event, #272 — gone with REVEALER, its last case,
  once the rules engine's battle damage asked per life card; the rest of the
  9-10 family, `replaceGap`'s six cases, went on 1 Oct 2026), and
  `notYetGap` for everything else
  found empirically rather than guessed at from a doc. Since #439 it holds
  two cases, both about the harness rather than the engine: a multi-card
  prompt staged on the legacy-only `continuations` field, and TAKER2's
  legacy-only `koCard` helper. What #439 closed, each found by running the
  ported case and reading what actually happened: 20-13's skip list and the
  [Permanent] skip read live at a battle step (`vm/skips.ts`; SKIPPER,
  NODEFENSE, SKIPNOW, INBATTLE, ATKSKIP, TURNSKIP, SPANSKIP); "when you use
  a card in a combo" resolving before the next combo offer (COMBOWATCH); a
  Unison's refusal, which was there all along under `playUnison` (GOTEN); an
  X price on a skill line (XDRAW); 9-1-5 negation taking a printed keyword
  away (MUTER); a copied [Permanent], [Auto] and keyword (COPYCAT); control
  keeping a card's markers and the loan walking it back (TAKER); a
  [Counter]'s alternative price and [Invoker] in the counter window (CFREE);
  and a skill-cost reduction reaching a [Counter]'s orbs (SKILLCHEAP).
  Earlier passes closed [Spirit Boost]'s marker amount (#157: `DEFINE COST
  spiritBoost`, which contradicted an earlier note that it needed no hook
  at all), "switched to Rest Mode by one of your skills" (#157's
  `modeSwitched(by: …)`) and an [Activate: Battle] skill reaching the menu
  from hand during the combo step. Every one was found by running the
  ported case and reading what actually happened, not by trusting a claim
  already on file. The suite still reports `ok` on both
  engines; what moved is *how much of it* is a real assertion on `rules`
  today, printed at the top of the run.
- **`readings.ts` / `wordings.ts`** — the wordings learned after the keywords.
  Together ~3,000 lines, and the closest thing to a regression corpus for the
  compiler.
- **`workflow.ts`** — every rule as a visible workflow: what is refused and why,
  in the words a client shows. Asserts the "one rejection per card per action
  type" promise. **Runs on both engines since #152**, and since #458 it skips
  nothing on `rules`: `PRICED`'s action price (4-3-3), the last case it
  skipped, is charged there ([Unique] and [Swap], the keyword bodies it used to
  skip, are built since #157). It also holds the 1 v 1 masking checks (#458):
  each seat's board, masked beats and move list hide the other seat's hand,
  both decks and face-down cards, on both engines. The four non-keyword gaps the
  porting pass found are closed: the combo, counter and blocker prompts have
  their rejected lists (`battleRejectedActions`, `vm/battle.ts`, with the combo
  prompt's [Activate: Battle] lines), and so does a `chooseCards` prompt
  (`vm/index.ts`); a counted prohibition spends its `uses` (`spendProhibitionUse`,
  `vm/program.ts`); and `vmBoardView` draws `you.choices` for a deck search,
  `them.rules` for a player-level prohibition, and a chooseCards prompt's own
  words, count and step. Every exact **label** string
  (`"Play BIG (5)"`, a `LegalAction.cost.describe`) is checked on the legacy
  engine only (`assertLabelOnLegacy`) — the rules engine's own labels are a
  generic builder over `actions.rules`' declared `label:`, and matching the
  legacy engine's bespoke wording word for word is Stage 8's, not this suite's.
  The suite still reports `ok` on both engines; what moved is *how much of it*
  is a real assertion on `rules` today, printed at the top of the run.
- **`contract.ts`** — the beats and the snapshot both clients render.
- **`language.ts`** — the effect language as one table, the drafter's records.
- **`lang.ts`** — the round-trip promise: `parse(print(x)) === x` over every op,
  condition, selector, filter and the language document's own examples.
- **`describe.ts`** — the plain-English readers' nouns and area words (#478):
  "3 or more blue cards in your Drop Area", never "3 or more blue in your
  drop"; and `ZONE_NOUNS` held to `words.rules`.
- **`rulesets.ts`** — the loader's own guarantees (a dangling reference, a
  duplicate declaration, an unknown hook point, each a pointed `LangError`)
  and, once the DBS `.rules` files exist, that the ruleset declares exactly
  what the legacy engine's unions declare — a zone, a phase, a trigger, a
  keyword or a card attribute the definition forgot (or invented) fails here,
  by name, before Stage 4 ever fails to play the card that needed it. Every
  completeness check prints `skipped: … not yet written` and passes trivially
  while its file is still empty, so this suite stays green through #133–#135
  landing one at a time.
- **`probe.ts`** — a rule tried on a board built for it, compared against stored
  digests. That comparison needs every earlier suite to have added its own
  cards to `DEFS`, so it only runs when `ENGINE` is `legacy` — see below.
- **`vm.ts`** — the engine switch itself: `engineFor` resolves both ids, the
  rules engine deals the same opening board as the legacy one from the same
  seed, and every call it cannot make yet throws `NotYet` naming the issue that
  builds it. It is also where the rules engine is held to the older one move for
  move, because the harness's own fixtures cannot stage a rules game yet
  (`EngineMismatch`, below): §16 the turn and the declared moves, §17 the
  prices against `planPayment`, §18 the play family — the same board built on
  both engines, then the same play, Unison play and Z-card play asserted event
  for event, and every play refusal compared by `Requirement` *and* by the
  sentence `wording.ts` makes of it — and §19 the activation, which is the same
  comparison one level down: a card's skill *lines*, each offered or refused on
  its own, the same first `Requirement` per line on both engines, three lines
  answered three times, and `contract/fixtures/activate.json`'s own board played
  to the same events and the same rules in force. Runs the same regardless of
  `--engine`, on purpose (below).

### One engine (#118)

`scripts/verify/harness.ts` exports the rules engine's vocabulary (`arenaG`, `playG`, `stagedG`,
`zoneOf`, …); there is no `ENGINE`, no `--engine` and no `--rules-only` any more. `npm test` runs
`verify-arena.ts` once. `vm.ts` no longer compares against a second engine: it asserts the rules
engine's six calls, the opening board, and the fixed records under `scripts/verify/vm-*-459.*`.

### Two things that will bite you

**A failing test is sometimes the bug, not a description of it.** Three
assertions have been rewritten this year because they encoded the *old*,
incorrect behaviour — each expected an effect to survive its own refused
condition. If a test fails and the new behaviour is more faithful to the printed
card, change the test and **say why in the commit**.

**`lang.ts` samples, it does not enumerate.** Adding a new shape to a union
(`Amount`, `Selector`, an `Op` field) gets **no round-trip coverage unless you
add it** — `sumPower` and `handUpTo` sat uncovered for months for exactly this
reason. A change can pass typecheck, lint, test and build while the new shape
has never been printed or parsed once.

---

## 3. `contract:emit` — the generated fixtures

`npm run contract:emit` regenerates `contract/fixtures/*` and
`contract/probe-digests.json`. These are the contract the planned Android client
reads, and the probe digests are a regression corpus for card rules.

It runs `verify-arena.ts --emit` once, on the rules engine, and writes every fixture: the snapshot
fixtures (`versus.json` included), `probe-digests.json` (the rules engine's own record since #118;
it was the legacy engine's golden record, and `probe-rules-parity.json` is gone), `state-text.txt`
and the deck and language fixtures.

Run it when you change a harness card, an `OP_SCHEMA` row, or what the referee
is told. **Review the diff** — expect exactly the cards you touched. One digest
of ~145 changing is normal for a single card's behaviour; twelve files changing
with *empty* diffs is the CRLF artifact (fixtures are written LF, checked out
CRLF): confirm the content is unchanged, then `git checkout -- contract/`.

In a merge, do **not** hand-merge these files — take either side and re-run
`contract:emit` on the merged tree.

---

## 4. The engine checks

### `arena-fuzz.mts` — the crash net

```
npx tsx --env-file-if-exists=.env.local scripts/arena-fuzz.mts 40
```

Plays N random complete games and reports crashes. **40 is the standing gate**;
use 200 for anything touching the movement, payment or flow machinery, and
**200 is #165's own gate** (0 crashes, checked into the
history archive). It proves only that nothing threw — it says nothing about
correctness — but it is the cheapest possible check that the engine still
runs to completion, and it has caught real breakage. It plays whole games through
the rules engine's own menu (`charge`, `play`/`playUnison`/`playZ`, `activate`,
the native `attack`/`block`/`counter`/`combo`, `pass`, `endMain`, `concede`)
and checks the same invariant after every move (every card in exactly one
place, 3-1); a card whose skill needs a mechanism the rules engine does not
build yet ends its game as a clean `NotYet` draw rather than a crash (`Abandon
this game …`, `vm/flow.ts`'s `stepProgram`) — that is expected and is not
counted against the 0-crashes gate.

### `arena:diff` — the oracle

Replays a saved game's action log from its seed and compares with the stored
row. This is the strongest correctness check available, because a game is
reproducible from seed plus actions: if a replay diverges, behaviour changed.
Use it for **any engine change**. It is not part of `npm test` because it needs
a database and real saved games (`npm run arena:diff -- <gameId> | --all`). A row a
legacy engine wrote no longer exists (migration 0050) and is reported, not replayed.

**Reading the `--all` report (#164).** A single `<gameId>` still prints one line, its own
verdict. `--all` does not: dumping one line per game buried the signal in fifty lines that mostly
say "same state", so it groups instead — `scripts/lib/arena-diff-report.ts` is the pure module
that does the grouping (covered by `scripts/verify/diff-report.ts` on synthetic outcomes, no
database needed to exercise the logic itself), `scripts/arena-diff.mts` only feeds it the
per-game outcomes its own `replay()` already computes.

1. **Games whose deck was edited since they were played come first, listed individually, never
   folded into a cause group.** Their shuffle differs from the one the game was actually dealt
   with, so any divergence there says nothing about the engine — `replay()`'s own `deckChanged`
   flag (comparing the deck's current card count against what the game's zones account for) is
   what decides this, not a guess from the divergence text.
2. **Every other divergence is clustered by its "why" text** — the first differing prompt or
   refused action `replay()` already reports for a single game (`refused: …`, `threw: …`, or
   `after every action, state.<path>: … against … on the row` when every action replayed clean
   but the final state still disagrees). Two games hitting the *same* bug produce the *identical*
   text, so grouping on it verbatim turns "38 divergent games" into "1 cause, 38 games" without
   guessing at what the cause actually is — the largest cluster is printed first, ties broken by
   the cause text so the order is stable across runs.
3. **The closing tally** (`N of M stable-deck games replay to the same state`) counts only the
   deck-unchanged games — a deck-changed game that happens to replay to the same state anyway is
   still reported in its own section, not folded into `N`.

Fixing what a cause group names is issue #164's own build step 2: one `vm/` fix (or a recorded
ruling plus a fix on both engines, when the *legacy* engine turns out to be the one that's wrong)
should collapse a whole cluster's game ids to zero on the next run — a cluster that shrinks by
fewer than its full count is the sign the fix did not cover every game it claimed to.

### `arena:probe` / `arena:reprobe`

A probe builds a game around one card's rule, stages the board its moment needs,
plays the move, and reports Input / Applied rule / Result / Assumptions with a
digest over the conclusion. `arena:reprobe` re-runs every stored probe and lists
the rules whose answer *moved* — the regression suite the rules never had.
Since #118 the board is always the rules engine's (built from the loaded definition, through
`engine-state.ts`'s zone seam). `probe()` never throws: a rule the rules engine cannot play yet comes
back as outcome `error` (a `NotYet`) or as a different conclusion, and `arena:reprobe` lists those as
moved. Stored probe rows from before #118 may still say `engine: "legacy"`; re-run `arena:reprobe` (needs the database; the owner's) to refresh them.difference (`npx tsx scripts/verify-arena.ts --explain` prints them).

**Try it and the owner's judgements (#470).** `scenariosFor` now ends with a met / not-met pair
of boards for every condition a rule carries (`probe-edges.ts`: a count's n and n − 1, a life
threshold and one past it, your turn and theirs, the parts of an `all`/`any`/`not`), keyed
`attack|cond=3`; board 0 never moves, so stored digests do not either. `probe(…, { trace: true })`
hands the engine the program with a `note` marker after every step (`probe-trace.ts`) and tags
each `applied` line with the `RulePath` of the block that made it — a traced run concludes exactly
what an untraced one does, which `scripts/verify/tryit.ts` holds every fixture to. A traced run
also plays the rule's WHEN off the record rather than the printed text, as a game does.
`lib/arena/tryit.ts` tries an unsaved rule on `DEFAULT_ENGINE` and `FALLBACK_ENGINE` and names the
gate a rule that did not fire stopped at. The owner's ✓/✗ per board are kept in
`card_rules.expectations`; after the digests, `arena:reprobe` re-runs those on the engine they were
judged on and lists, separately, the ones the rule no longer meets — "expected fired, now
didNotFire". `--write` never touches them.

**Its blind spot is worth knowing**: the staged board is built in the card's
favour, and it only stages what it has been taught to stage. It staged no
markers at all until someone added that, so it could not distinguish a working
marker rule from a broken one. If you add a mechanism, ask whether `stage()`
knows how to set it up.

### `arena:playthrough`, `arena:coverage`, `arena:draft`, `arena:vs`

`playthrough` plays a whole game through the database (integration, needs a DB)
and plays through `startGame` on the rules engine; `arena:vs`'s `sparring` tier still refuses
(`assertEngineForMode`, `games.ts`) because Claude's side is not built for the rules engine yet —
pass `hotseat` as its tier. `coverage` reports how much card text the compiler reads; it never
creates a game.
`draft` compiles the catalog offline into `card_rules` drafts — **the only
module that calls the compiler in production is `draft.ts`**; the engine
reads rows.

### `arena:specified` — what the feed does not say

```
npm run arena:specified            # the report, loudest cards first
npm run arena:specified -- --all   # every X-cost card with no baseline
```

Needs the network; the database is optional and changes what it can say. A play's price has two halves — the total, and
the **specified cost**, meaning how much of that total must be paid in a named
colour. The engine fills a fixed cost's orbs by convention (`specifiedCostOf`:
one per colour, capped by the total) and **refuses to invent them for an X
cost**, because the catalog carries none: this script is that refusal, checked
rather than asserted. It reads the deckplanet feed the catalog sync imports,
prints every distinct value of the cost field so the claim can be seen, and
lists the cards left without a baseline — the seven printing a specified-cost
clause first, since those have a rule that reads correctly and changes nothing
(BT19-039, BT19-040, BT15-063, BT20-118, P-673, P-600, BT25-004). Run it before
believing a specified-cost rule is inert for any other reason, and run it again
if a future feed starts spelling orbs in the cost field, which is the one thing
that would turn this refusal back into a parsing job.

**Where a baseline is known, it was entered by hand** (issue #255, owner's
decision of 13 Sep 2026): `cards.specified_cost`, one column on `cards`, in the
language's orb notation (`{u}{u}` = two blue), written from the rules record on
the workbench (`/arena/rules` → the record's *specified cost* box, which reads
*Incomplete — specified cost unknown* on every X-cost card without one) or
seeded by a migration on a ruling (0034 enters BT19-039 as `{u}{u}`). The
column reaches the engine through `cardDefFrom` → `parseSpecifiedCost`
(`src/lib/arena/specified-cost.ts`) onto `CardDef.specifiedCost`; nothing else
was taught anything. **The hazard the column carries:** `sync:catalog` upserts
every card column, so the upsert `coalesce`s this one like `image_url` — an
entry survives a sync by that line and nothing else, and the sync warns about
an entry whose card no longer prints an X cost or a specified-cost clause
(`staleSpecifiedCosts`, the self-check errata's `unmatchedCorrections` cannot
be here, since the feed has nothing to compare against). With `DATABASE_URL`
set (`.env.local` is read), the report says per card where its baseline
stands — *entered* with the orbs and their reading, *ruling on file* when a
rule of the card carries an explanation mentioning the specified cost
(`npm run arena:rule`), or *still unknown* — and lists the stale entries.
Without it, it says so and reports the feed alone.

The probe has the matching board: a [Permanent] that relaxes its *own*
specified cost from hand (BT19-039 and the six phrased like it) gets a
`permanent:reduced` scenario — the card in hand, the condition's card staged,
and one energy of each colour the relaxed requirement still demands — whose
reading says whether the play is legal with the rule *and* whether it would
have been refused without it, naming the colour. On a card whose baseline is
unknown every board of every rule carries the assumption that the engine
demands no colour for it, so a lenient price is never mistaken for the card's.

---

## 5a. Seeing the board — `arena:shots` and `arena:contrast`

The redesign is visual, and development keeps off Neon, so neither needs a game
in the database. Both draw the real `ArenaStage` from a `contract/fixtures/*.json`
snapshot through **`/arena/preview`** (dev-only: `notFound()` when
`NODE_ENV === "production"`, so `npm run build` ships nothing reachable). The
route takes `?fixture=play|attack|ko|…`, `?skin=anime|night`, `?staging=` and
`?pace=step`; `?admin=0` draws the board as a player sees it (admin is the default, as with Basic Auth off) and `?referee=1` marks your first Battle Card as referee-ruled so the REF badge can be shot (#350); the board's two server actions are stubbed (`ArenaStage`'s
`server` prop), so a tap goes nowhere. Both scripts drive the installed Chrome
over the DevTools protocol (`scripts/lib/cdp.mts`, Node's built-in WebSocket) —
no Playwright dependency. Set `CHROME_PATH` if yours is somewhere unusual.

**Neither is in `npm test`**: both need `npm run dev` running and a browser.

### `npm run arena:shots`

Proves what the board *looks like*, for a review to set beside the frames in
`docs/arena-redesign/`. Shoots fixtures x {anime, night} x {phone 390x844 with
touch emulation, desk 1440x900} into `docs/arena-redesign/current/` (ignored by
version control), named like the reference frames: `phone-play-anime.jpg`,
`desk-ko-night.jpg`.

```
npm run arena:shots                                   # play, attack, ko
npm run arena:shots -- --fixtures play,over --skins anime --viewports phone
npm run arena:shots -- --all                          # every Snapshot fixture
npm run arena:shots -- --fixtures play --tap "[data-arena-card]" --tag review
npm run arena:shots -- --fixtures play --hover "[data-arena-card]" --tag hover   # desktop only
npm run arena:shots -- --fixtures play --rclick "[data-arena-card]" --tag pin     # right-click (pins the inspector)
npm run arena:shots -- --fixtures hand --drag '[aria-label="Your hand"] [data-arena-card]' --to '[data-arena-zone="p1:battle"]' --tag drag   # a drag held in progress
npm run arena:shots -- --full --base http://localhost:3001
```

`--drag "<selector>" --to "<selector>"` presses on the first match (a finger on the
phone, the mouse on desk), carries the pointer to the target's middle and **stays
down** for the shot (`--release` lets go instead). A target above the fold is chased the
way a hand would: the pointer goes to the top edge, where the board scrolls the page
under a dragged card. The preview's stubbed `act` records what the board sent in
`window.__arenaSent`, so a scripted drag can prove a drop played (one `play`) or was
refused (nothing). Two fixtures exist for it: `hand` (Main Phase, two energy active, a
hand with three cards you can afford and two you cannot) and `charge` (Charge Phase).

`--tap "<selector>"` taps the first match (touch on the phone, mouse on desk)
before shooting — a card's review, an opened sheet. `--hover` and `--rclick` do the same with the pointer on
desktop (a phone has none): the docked inspector filled, or pinned. `arena:contrast` takes `--hover` too,
so a state that exists only under the pointer can be audited. `--tag` is appended to the
file name so an opened state does not overwrite the plain one.

An effect caught mid-animation (rd-07): the preview takes a preview-only
`?fx=reveal|damage|damage-you|ko|attack|clash-hit|clash-ko|clash-held|over`, which mounts the fixture's
board without its beats and then delivers one beat (or, for `ko`, the fixture's own) so the beat
player walks it. Pair it with `--on "<selector>"` (wait until the effect is on the page),
`--freeze <ms>` (pause every animation and set each to that time) and a small `--settle 50`:
`--fixtures play --query fx=damage --on ".arena-boom" --freeze 250 --tag fx-boom`. The default
`?pace=step` holds on the beat, so the frame is deterministic. A fixture is one
moment; a state no fixture holds is added to `scripts/verify/contract.ts`, not
faked here. Card art is `null` in fixtures, so cards show their text face. The
skin is set both as `?skin=` (the board) and as the `arenaSkin` cookie (the page
behind it, which the root layout skins) — set both by hand if you open the URL
yourself.

### The preview, as a player sees it (#447)

`/arena/preview` is **full-bleed** like `/arena/<id>` (`isFullBleed`, `src/lib/navigation.ts`): no
app header, no bottom tabs, so a shot of it is the board a player gets. Four fixtures exist for
the design frames that had none, all written by `npm run contract:emit` from the harness:
`defend` (frame 07: Claude attacks you; you are asked to combo), `attack-life` (frame 09: an
unblocked attack takes a life, so a pip shatters), `refusal` (frame 05: a card you cannot
afford) and `empower` (a Unison replaced, its markers carried: the [Empower] flight; legacy
engine only, like the case it comes from). `?fx=defend|victory|finish` still work.

`?replay=1` plays a fixture's own beats from the start: the board mounts with an empty queue
and the beats are delivered 500 ms later, as a later snapshot would. Without it a fixture is a
still moment, its beats already seen. `?fx=` wins when both are given.

### `npm run arena:record`

The motion twin of `arena:shots`: a clip of `?replay=1` per fixture x skin x viewport, for a PR
that has to *show* an animation. Written to `docs/arena-redesign/clips/` (ignored by version
control) as `phone-attack-life-anime.webm`, named like the shots.

```
npm run arena:record                                   # attack-life, anime + night, phone + desk
npm run arena:record -- --fixtures attack-life --skins anime,night --viewports phone,desk
npm run arena:record -- --fixtures defend,empower --skins anime --duration 8000
npm run arena:record -- --fixtures play --query fx=reveal   # a preview effect instead of the replay
```

It drives the same CDP driver as `arena:shots` (`Page.startScreencast`, so no Playwright and no
new dependency) and encodes the frames with an ffmpeg it finds at run time: `FFMPEG_PATH`, then
`ffmpeg` on the PATH, then Playwright's own copy (`$PLAYWRIGHT_BROWSERS_PATH` or
`/opt/pw-browsers/ffmpeg-*/ffmpeg-linux`, which writes VP8 only, as the encoder here asks).
With none of them it stops and says where it looked. The clip starts when the board is up, so
the dev compile is not in it; `--duration` (default 12000 ms, a whole attack at normal pace) is how long it runs after that,
`--pace` defaults to `normal`. Like `arena:shots` it needs `npm run dev` running; neither touches
the database. To look at a clip, pass `--frames`: a JPEG every 250 ms lands in `<clip>-frames/`
(Playwright's ffmpeg decodes VP8 but has no image encoder, so extracting frames from the clip
afterwards only works with a full ffmpeg).

### `npm run arena:contrast`

Proves the board's text is **legible** (WCAG 1.4.3: 4.5:1, 3:1 for large text),
in both skins, phone and desk. axe-core cannot resolve a background through a
gradient and the anime sky is made of them, so this walks each text node's
ancestors, composites every translucent fill — and **every gradient stop**,
worst case — down from the first opaque ground, and reports the lowest ratio.
A card face carries an opaque dark ground (`docs/arena-skin-spec.md` decision
4), so text inside one is judged against the card, not the sky.

```
npm run arena:contrast                  # prints a table; writes current/contrast.json
npm run arena:contrast -- --strict      # exit 1 on any failure
npm run arena:contrast -- --fixtures play --skins anime --json /tmp/c.json
```

What a pass does **not** cover: text over photo art (judged against black and
white, flagged), `text-shadow`, `backdrop-filter`, pseudo-element fills; and
text with a `-webkit-text-stroke` of 1 px or more is judged by its outline
colour. Dimmed states (a card that is not a legal target, a disabled control)
are measured at their dimmed opacity and do show up; decide per finding whether
WCAG's inactive-component exemption applies. Animations are finished before the
measurement so an entrance fade is not read as low contrast.

## 5b. Focused scenarios — `arena:scenario`

One command plays a named scenario on the pinned rules engine, asserts state, events and legal
actions, and prints a compact record. No database, no network, no full suite (#642):

```powershell
$env:DATABASE_URL=''; npm run arena:scenario                         # setup, battle, pending-choice
$env:DATABASE_URL=''; npm run arena:scenario -- battle               # one scenario
$env:DATABASE_URL=''; npm run arena:scenario -- pending-choice --seed 641 --revision a641000000000000000000000000000000000641
$env:DATABASE_URL=''; npm run arena:scenario -- --browser            # also in a headless-Chrome module worker, offline
$env:DATABASE_URL=''; npm run arena:scenario -- --bundle bundle.json # a replay bundle with decks (see --write-bundle)
npm run arena:scenario -- --list                                     # ids, seeds, descriptions
```

- **Scenarios** live in `scripts/verify/arena-scenarios.ts` as data: `setup` (first player, both
  mulligans, the opening charge prompt), `battle` (a leader attack, both combo steps passed, the hit
  resolved, back to the main step) and `pending-choice` (a combo card's `payCost` question, then the
  attacker's `zEnergyFromCombo` choice: only the listed cards are legal, wrong answers are refused).
  `mismatch-demo` is deliberately wrong and runs only when named; it proves the failure path.
  A step picks a move from the engine's own legal list (type and field match, never a fixed
  instance id) or advances with a preference list until a prompt/legal condition holds, then
  asserts `phase`, `turn`, a subset of `prompt`, the legal types/count, zone sizes by seat
  (`$turn`/`$other` resolve against the turn player), the step's events (in order) and actions
  the engine must refuse. To add one, add an entry to `SCENARIOS`.
- **Inputs are explicit.** `--seed` (default: the scenario's own, 641), `--revision` (default: the
  fixture's pinned revision; it must equal the bundle's, or the run is refused), `--bundle`. Without
  `--bundle` it uses the synthetic fixture of `scripts/verify/arena-browser-fixture.ts` (the
  compiler's own rules for eight made-up cards and the shipped DBS ruleset). The scenarios are
  pinned to that fixture and seed: another seed or bundle may legitimately reach other prompts, and
  then fails with a diagnostic naming the step rather than skipping it.
- **Output** (stdout) is one JSON object per scenario: `scenario`, `seed`, `engine`,
  `interpreterRevision`, `bundleHash`/`rulesetHash`/`catalogHash`/`programsHash`, `pass`, `moves`,
  `checked`/`steps`, `final` (phase, turn, prompt), `hashes` (state, last step's events, legal moves,
  each seat's projected snapshot, the action list), `diffs` and `omitted`; then
  `{"summary":{scenarios,passed,failed,browser}}`. Nothing in a record varies between runs or
  machines. A failing run stops at the first failing step and lists at most six differences
  (`step`, `field`, `expected`, `actual`, values cut at 100 characters), repeated on stderr as
  `FAIL <id> (seed N): …`.
- **Exit codes:** 0 all pass; 1 any expectation, engine/bundle refusal (wrong revision, hash) or
  Node/browser disagreement; 2 usage error.
- **`--browser`** launches Chrome via `scripts/lib/cdp.mts` (`CHROME_PATH` to pick a binary), serves
  the repo's TypeScript as native ES modules (`scripts/lib/module-server.mts`), loads
  `scripts/verify/arena-scenario-worker.ts` in a module worker, takes the page offline, sends the
  bundle in a message and requires each scenario's *whole* record to equal Node's; the record gains
  `browser: {userAgent, agrees, differs}`. It needs Chrome, so it is not in `npm test` (the engine
  itself is covered in a browser by `scripts/verify/arena-browser-engine-browser.mts`).
- **In `npm test`:** `scripts/verify/arena-scenario-runner.mts` (before `ai-agent-sdk.ts`) runs the
  three scenarios twice, in reverse order and alone (identical records), checks the import graph is
  browser-safe, edits one expectation to prove it bites, and drives the CLI for exit 0 (all),
  exit 1 (`mismatch-demo`, a wrong revision) and exit 2 (unknown id/flag).

**Worker latency, responsiveness and memory budgets (#643):** `npm run arena:worker-bench -- --check`
times the same engine in a browser worker (per-decision latency, main-thread long tasks, payload,
memory, a simulated 4x phone) and exits 1 when a budget in `scripts/lib/worker-budgets.ts` is
exceeded. It needs Chrome, so it is not in `npm test`; its budget logic and the table's agreement with
`docs/arena-worker-budgets.md` are (`scripts/verify/arena-worker-budgets.ts`). Numbers, method and
limits: `docs/arena-worker-budgets.md`.

Not covered: scenarios on real catalog cards (the fixture is synthetic; a real bundle comes from an
admin replay export), and any
scenario needing the database. Run them on real data only when the owner asks.

---

## 5. Recording a ruling

```
npm run arena:rule -- <cardId> "<the ruling>"      # writes card_rules.explanation
npm run arena:rule -- --list                        # read them all back
```

When a rules question is settled in conversation, **it goes here first** and the
code change is made afterwards, deliberately, against every card sharing the
wording. This is not bookkeeping: one recorded ruling *corrected its own first
version*, and only the row shows that. Check `docs/rules/rulemanual.txt` and
Bandai's Q&A before asking a human, and validate the answer against them
afterwards — both recorded rulings were, and the manual confirmed one and
sharpened the other.

---

## 6. Best practices, learned the expensive way

1. **Measure before you edit.** Both instruments, every time. A change whose
   readings diff you did not take is a change you cannot defend.
2. **Prefer unread to wrongly read.** A gap costs tokens; a wrong reading loses
   games. Refusing a family is a legitimate outcome, and the coverage number
   going *down* can be correct.
3. **Prove a property when the diff is large, then check one card by hand.**
   Neither alone is enough — the property can be satisfied by a broken change,
   and one card cannot speak for 270.
4. **Verify a claim before repeating it**, including from a colleague's report
   and including your own earlier documents. Counts have been overstated by 6×;
   a card offered as a *control* was itself broken; a scope document once said a
   feature did not exist when most of it did.
5. **Scope guards narrowly.** `splitClauses` is the most load-bearing function
   in the compiler; several fixed bugs came from changing how it cuts, and one
   attempt to generalise a stale-antecedent guard silenced ~30 unrelated shapes.
6. **When a mechanism produces its third bug, stop patching it.** Write the
   structural fix up as its own piece of work — `docs/arena-side-scope.md` is
   that document for the side test, written at exactly that point.
7. **Never write engine source through `node -e`**: `\b` in a shell-quoted
   string becomes a backspace and silently kills a regex.
8. **Touch the compiler, update `glossary.ts`.** Including when what you did was
   *refuse* a family — `glossary.ts` is part of the compiler, not documentation
   about it, and a description that has quietly become untrue is worse than no
   description.
