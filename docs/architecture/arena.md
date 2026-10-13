# Architecture: the arena and its tooling

Read before touching anything under `src/lib/arena/` or `src/components/arena/`. Start with the `arena-work` skill, `docs/arena-tooling.md` and `docs/arena-code-map.md`. Moved unchanged from `CLAUDE.md` (issue #382); the text is verbatim, so a comment that says "see CLAUDE.md" means this file.

- **Arena rules engine** (`src/lib/arena/vm/`, behind the `Engine` interface in `engines.ts`): a
  game is a state plus an event log; `apply()` is the only mutator. `legalActions()` offers only
  skills the engine can pay for **and** resolve, and drives both the UI and Claude's move menu.
  **What the engine is built on has its own home**: the vocabulary in `types.ts`, card
  text in `text/` (`cards.ts`, `filters.ts`, `triggers.ts` — the printed-trigger fallback for a
  skill with no record), the compiler in `compile.ts` + `compile/`, the record interpreter
  (`stepScript`) and `OP_SCHEMA`/`COND_SCHEMA` in `vm/script.ts`/`vm/script-schema.ts`, the
  `ScriptHost` interface in `vm/script-host.ts`, the RNG in `vm/rng.ts`, and the state-free helpers
  (`programsOf`, token ids, `redirectOf`, `IllegalAction`, …) in `vm/common.ts`. There is one engine: the hand-written legacy engine (`engine/`) was deleted by #118. Doc: `docs/arena-code-map.md`.
- **What the rules engine keeps between reads** (the performance pass of 2 Oct 2026): a skill
  text's parse (`parseSkills`, per text) and a card's printed attributes (`attrsOf`, per
  definition) are memoised and **frozen**, so a caller that mutates one throws instead of
  corrupting every later read. The statics (`statics()` in `vm/program.ts`) are kept only for
  the length of one `readingBoard(...)` call — `legalActions`, `rejectedActions`, `boardView`,
  `candidatesOf`, `comboEligible` — so **nothing inside a `readingBoard` may change the state it
  was handed in place**; try a move on a copy, as `restedAlready` and `apply` do. Measure an
  engine change with a saved game replayed offline (load it once, then `engine.apply` its
  `actions` from its `seed`) and compare every output before and after. Saved games
  (`games.ts`): `loadGame` reads cards and rules in one round, keeps the art, and works
  `legal` out on first read; `applyToGame` takes a game the caller already loaded and is
  still guarded by its `version`.
- **The compiler's glossary** (`src/lib/arena/glossary.ts`, `/arena/rules/keywords`): the only
  written record of what the compiler understands per keyword — part of the compiler, not
  documentation about it (Conventions below: touch the compiler, update the glossary). Doc:
  `docs/arena-code-map.md`.
- **One engine** (`src/lib/arena/engines.ts`): the config-driven `rules` engine (`vm/`) plays every
  mode; `engineFor` and the legacy adapter are gone (#118, 13 Oct 2026). `ENGINE_IDS` is
  `["rules"]` and the `engine` column stays (no destructive schema change) but only `rules` is
  written or read. **Saved legacy games were deleted** (owner's ruling of 13 Oct 2026):
  migration `0050_arena_retire_legacy_engine.sql` removes every `arena_games` row whose `engine`
  column and whose state's top-level `engine` are both not `rules`, with their decisions,
  per-game AI receipts, advance leases and flags; lobby matches, feedback and bug reports keep
  their own rows and lose only the game id. A stray legacy row that slips through fails closed:
  `loadGame` throws `LegacyGameRetired` and the API answers 410 "gone".
  **One rejection per card per action type, except an activation, which is one per skill line**
  (§3.2). Doc: `docs/arena-code-map.md`.
- **The browser-safe rules entry** (`src/lib/arena/browser.ts`, #641): create a game on a pinned
  replay bundle, apply moves, list legal moves and project one seat's masked `Snapshot`, with only
  the rules engine, `replay-core.ts` and the engine-neutral cores (`snapshot-core.ts`,
  `view-core.ts`, `beats-core.ts`, `engine-ids.ts`) — never `engines.ts`. **A new
  import into that graph must stay portable**: `scripts/verify/arena-browser-boundary.mts`
  (`npm test`) fails on any server, package, Node-builtin or `process.env` import
  reached from it; `arena-browser-engine-browser.mts` plays the scenario in a real worker.
- **Hidden instance ids** (`src/lib/arena/conceal.ts`, 13 Oct 2026): an instance id is a decklist
  position, so **no `Snapshot` carries the id of a card its viewer may not read** — on either
  engine, for every viewer. `buildSnapshotWith` conceals last, over the whole snapshot: a
  positional alias (`?p2:hand:3`, valid on that revision's board only) everywhere but the beats,
  `?` in the beats (an unwatchable move loses its card even when the card is public now), and
  `?shown:<k>` for a secret [Auto] declared from a hidden area (#549). The REST client acts by
  index; a whole `Action` from the web board (`act`) or the gameplan preview is resolved back by
  `session.ts`'s `resolveForViewer`, refusing a foreign or stale alias and a raw hidden id. A test
  that looks a hidden card up on a board looks it up by `hiddenAliases(state, viewer)[id]`.
  `scripts/verify/arena-snapshot-conceal.mts` (`npm test`) proves no leak and permutation
  invariance for both seats on both engines. Contract: `docs/arena-client-contract.md` §3.7.
- **The local policy boundary** (`src/lib/arena/policy/`, #644): a local opponent sees one seat's
  `PolicyObservation` (`observation.ts`, a restriction of that seat's masked `Snapshot` — own hand
  and decklist counts, the public boards, counts of hidden zones, the beat history, its own prompt)
  and its `PolicyDecisions` (`contract.ts`: each engine legal move as a **menu** decision with a
  stable id, plus one **compound `pick`** for a "choose (up to) N" question, played as the engine's
  one-card answers), and draws on its own `PolicyRng` (`rng.ts`). **Instance ids of cards the seat
  cannot read never reach a policy** — an id is a decklist position — they are positional aliases
  (`?p2:hand:3`, the table `conceal.ts` builds for the online board too) on the board and in
  decisions and `?` in beats. Only `boundary.ts` reads a
  `PinnedMatch`; it keeps the `DecisionKey`, and `applyDecision` refuses malformed, foreign, stale
  and unknown answers. **The policy layer imports nothing outside `policy/`** and names no engine
  state, seed or ambient randomness: `scripts/verify/arena-policy-contract.mts` (`npm test`) fails
  otherwise, and proves no leak, permutation invariance and round trips on the #641/#642 fixtures.
  The online Claude opponent (`ai/`) does not use the contract itself, but **its free choices are
  this layer's** (#645): the "cannot go wrong" shortcuts — one legal move, the coin flip, mulligan,
  charge, Z-Energy, [Empower] markers — are pure functions in `policy/shortcuts.ts` over the
  observation + decisions (ties go to the first of the tied decisions in the order listed; no RNG
  is drawn). `ai/shortcut-input.ts` is the online adapter: it reads the engine's state (either
  engine) into the shortcuts' input and maps the decision back to the menu index; `opponent.ts`
  keeps no copy of the rules. `scripts/verify/arena-policy-shortcuts.mts` (`npm test`) holds the
  adapter to origin/main's choices at 3,153 positions (`scripts/verify/fixtures/arena-policy-shortcuts/before.json`).
  **A new shortcut goes in `shortcuts.ts`, never in `opponent.ts`.**
  **The local Main Phase is `policy/main.ts`** (#646): a bounded, deterministic scorer of the open
  plays, activations, attacks and `endMain` (plus the `payCost` energy question, resting the energy
  that keeps the rest of the hand payable) from the observation and decisions alone — no search, no
  RNG drawn, ties by canonical id, a counted work bound (`MAIN_LIMITS`), an activation at most once
  per card per turn (read off the public beats). `mainPolicy(fallback)` is #646's stack (shortcuts →
  Main Phase → `fallback`), kept for comparison. `guardedDecide` carries a small
  serialisable memory per seat (policy RNG included) and ends a turn that runs past
  `TURN_GUARD.decisions` or revisits one position more than `TURN_GUARD.repeats` times (`endMain`,
  else `pass`, else a battle window's "don't block"/"don't counter", else an explicit
  interruption); `boundary.ts`'s `localStep` is one whole local decision. The online opponent does
  not load it. Proof: `scripts/verify/arena-policy-main.mts` (`npm test`).
  **The local battle is `policy/combat.ts`** (#647): the blocker, counter and combo windows, judged at
  the current totals from the engine's public `stakes` (attacker wins ties, [Strike], [Critical],
  [Victory Strike], lethal) and the seat's own hand and field — never a guess at the other hand. Each
  option is costed (life by how low it leaves the seat, a KO'd card by its board value, a card or
  energy spent): a block or counter is taken when it costs less than what the battle threatens (the
  counter timing comes before the blocker window on this engine, so a blocker still to be asked is
  an alternative to a counter), and combos (and readable "+N power" battle activations) cover the
  deficit with the cheapest set that is exactly enough, only when the battle is worth that set.
  Bounded by `COMBAT_LIMITS` (a counted branch-and-bound cover search), no RNG drawn.
  `combatPolicy(fallback)` is #647's stack (shortcuts → Main Phase → battle → `fallback`), kept for
  comparison. Proof: `scripts/verify/arena-policy-combat.mts` (`npm test`).
  **The constrained choices are `policy/choices.ts`** (#650): a card pick is answered as one compound
  `pick` (validated by the contract, played card by card through the boundary), sized and ranked by
  whose cards they are and what the resolving skill's sentence does to them (hurt the opponent or
  help the seat: as many as allowed, most valuable first; a cost: the fewest it must, least valuable
  first; "different names" and a 22-30-3 colour cover honoured); modes, replacements (9-10), Auto
  prices, [Offering] and "you may" are scored option by option; simultaneous Autos resolve in trigger
  order. `WINDOW_HANDLERS` maps every `DECISION_WINDOWS` kind to the layer that answers it (a missing
  kind fails to compile); `optionalCost` and `offering` were legacy-engine prompt kinds; the rules
  engine asks them as `chooseMode`. `localPolicy(fallback = interruptingPolicy)` is shortcuts → Main Phase
  → battle → choices → `fallback`, and the default fallback throws `PolicyInterruption`, which
  `guardedDecide`/`localStep` return as `interrupted` — a question no handler reads stops the session
  rather than being guessed. Proof: `scripts/verify/arena-policy-choices.mts` (`npm test`: the coverage
  matrix, named scenarios on synthetic cards, every position of the fixture games and the two #649
  audit decks); strength: `npm run arena:policy-eval` (`combat647` is the #647 baseline, `--audit`
  adds the #649 decks).
  **Evaluation (#651)**: `docs/arena-policy-evaluation.md` — seeded games across both seats and every
  baseline with intervals, seat bias against a control, hidden-state variants, determinism, latency in
  Node and Chrome; `npm run arena:policy-eval -- --check` is the gate in `npm test`;
  `npm run arena:policy-browser` needs Chrome. The `holdout` seed set is reserved for O5.
- **Offline deck packs** (`src/lib/arena/local/pack.ts`, #655): one deck pair as a versioned,
  content-hashed pack — a #640 replay bundle (both faces' definitions and programs, art references,
  ruleset files, interpreter revision) plus decklists, token/generated dependencies, a transitive
  completeness manifest, missing inputs and the audit's blockers with issue links. Validation
  recomputes the manifest and `qualification`; `playable` is true only when no blocker for its
  decks is open, nothing is missing and no required program has an unread clause. Built at build
  time by `scripts/build-arena-offline-pack.mts`; a runtime never compiles or fetches. Proof:
  `scripts/verify/arena-offline-pack.mts` (`npm test`).
- **The local match worker** (`src/lib/arena/local/protocol.ts`, `worker.ts`, `worker-entry.ts`,
  #652 / O3-02): one dedicated module Web Worker owns one local match — the pinned game, the AI
  seat's memory and RNG, the journal of decisions and the request receipts — and sends the page only
  the human seat's projected `Snapshot`. Messages are typed and versioned (`dbs-arena-local-match`
  v1): `start`/`resume`/`read`/`apply`/`advance`/`cancel`/`dispose` with a request id and the
  page's session id, answered by `result`/`error`, plus `snapshot` and `interrupted` events.
  Mutations follow the online rules: receipt first (a duplicate replays, another payload is a
  conflict), then `basedOn` against the revision, then the seat, then the move (aliases resolved
  against that revision). `advance` plays the local policy in bounded batches, yields between them
  and commits a batch only if no `cancel`/`dispose` arrived meanwhile, so a dropped batch leaves the
  game, the RNG and the journal untouched. A pack is validated and qualified by the worker itself;
  another interpreter or policy version, an unqualified pack and an AI question the policy cannot
  answer (`interrupted`) fail by name — no network, provider or invented outcome. The journal stays
  in the worker, which keeps it in IndexedDB (next bullet); `resume` replays it, asking the policy again
  for every AI decision, and refuses one that does not reproduce. The page side is
  `src/components/arena/session/local.ts`, an `ArenaSession` with `advance` (not wired to the board
  until O3-05); its value graph reaches no engine. Proof: `scripts/verify/arena-local-worker.mts`
  (`npm test`), and in Chrome `npm run arena:local-worker-browser`.
- **Local matches on the device** (#653, `src/lib/arena/local/storage.ts`): the worker entry journals
  into IndexedDB (`dbs-arena-local`, per origin, browser-only): a `matches` header per match (pack
  hash, decks, seat, game and AI seeds, interpreter revision, policy version, revision, AI memory with
  its RNG, receipts, trace, status, two digests) and a `decisions` record per committed decision,
  chained. One commit (a human move, an AI batch, a status change) is one transaction over both
  stores, and the worker only advances its in-memory match after it completed, so an abort, exhausted
  quota or a killed worker leaves the last commit intact and the page hears `storage`. Reads check
  record schema (`newer`), shape (`corrupt`), digests and chain (`tampered`) and completeness
  (`truncated`), refused as `journal`/`newer`; a commit never rewrites history (`rewrite`); a resume
  re-saving what it read writes nothing. Schema steps are `MIGRATIONS`, additive, run in the
  version-change transaction (a failing one leaves the old version and data); a newer database is
  refused untouched. Nothing but the journal is stored — no board, engine state, pack content,
  account or collection data; a local match id may not be all digits (a server `games` id). Proofs:
  `scripts/verify/arena-local-storage.mts` (`npm test`, on a labelled fake IndexedDB) and in Chrome's
  real one `npm run arena:local-storage-browser` (reloads, kills inside an open transaction, real
  quota exhaustion, damage, upgrade). One writer per match across tabs is #654, below.
- **One writer per local match, and worker recovery** (#654, `src/lib/arena/local/{ownership,recovery}.ts`):
  schema version 2 adds an `owners` store — one writer lease per match (holding tab id, a fencing
  `epoch` raised by every grant, heartbeat, released). Every commit carries the writer's fence
  (`writer` on `start`/`resume`, optional, protocol still v1) and reads the lease in its own
  transaction: a superseded or suspended writer's commit is refused (`fenced`, wire code
  `busy-elsewhere`) with nothing written, so the history stays linear whatever the timers believe.
  Where `navigator.locks` exists an exclusive Web Lock per match coordinates (the browser frees it
  when a tab closes or crashes, so a waiting tab takes over at once); without it the lease alone
  (`LEASE_TTL_MS` 8 s, `HEARTBEAT_MS` 2 s). A `BroadcastChannel` carries hints only. The page holds
  a `LocalMatchSupervisor` (an `ArenaSession`): the owner tab plays; another tab is *watching* — a
  read-only resume (`readOnly`, every move `busy-elsewhere`) that refreshes on the holder's commits
  and takes over when it lets go, or on `takeOver()` ("play here instead", which fences the old
  holder). A worker that fails, or stays silent past `hungMs` (15 s; `openMs` 120 s for an open; an
  idle ping every 5 s) is terminated, a new epoch claimed for the same tab, a new worker resumed from
  the device at the last commit; a human move is resent with its request id (applied once, or
  answered from its receipt as a duplicate), an AI advance re-issued (the lost batch recomputed from
  the journalled AI memory and RNG). States `opening/owner/watching/recovering/storage/failed/stopped/closed`
  are reported (`onState`, and to the board as connection states); `stop()`/`retry()` cancel and
  restart; after `maxRestarts` (3) deaths in a row it stops as `failed`. `dispose()` releases the
  lease and lock and stops every worker, timer and channel. Proofs: `scripts/verify/arena-local-ownership.mts`
  (`npm test`; in-process killable workers, the fake IndexedDB, Node's Web Locks) and two real Chrome
  tabs `npm run arena:local-ownership-browser`. Not yet wired to the board (O3-05).
- **The rules language** (`src/lib/arena/lang/`, `docs/arena-rules-language.md`): one closed
  grammar for a card's rule. `npm test` holds it to `parse(print(x)) === x` for every op,
  condition, selector and filter. Doc: `docs/arena-code-map.md`.
- **A game is files, not code** (`src/lib/arena/rulesets/`): `loadRuleset` reads a game's `.rules`
  declarations into one `GameDefinition`; `npm run arena:rulesets` regenerates the generated
  constant — nothing reads a file at request time. Doc: `docs/arena-code-map.md`,
  `docs/arena-ruleset-spec.md`.
- **The specified-cost baseline is a column a person writes** (`cards.specified_cost`, issue
  #255): the feed carries no cost orbs, so an X-cost card's coloured price is entered by hand. The
  catalog upsert must `coalesce` this column — remove that and the next sync erases every entry.
  Doc: `docs/arena-code-map.md`.
- **The record's WHEN is the engine's WHEN** (`answersTo`, `vm/triggers.ts`): an [Auto] skill's trigger comes off
  `card_rules.trigger`; only a skill with no record falls back to the printed text
  (`autoTriggerMatches`, `text/triggers.ts`). Doc: `docs/arena-code-map.md`.
- **Arena UI** (`/arena`, `src/components/arena/`, `docs/arena-client-contract.md`): phone-first
  board driven entirely by `legalActions()` and one `Snapshot` — no client evaluates a rule.
  **Everything the board says about who is acting reads `live.waiting`, never the `snapshot`
  prop.** Doc: `docs/arena-code-map.md`.
- **Rule review on the phone** (`/arena/rules/review`, #472): a deck's open and draft skills one at
  a time, text first. **A span is never guessed** (`src/lib/arena/rule-review.ts`): the record
  keeps no clause → printed-words link, so only its own text found exactly once on the line is
  underlined (an `unread` clause or the cost's `text`, or a WHEN/IF/DO reading printed word for
  word); every other clause is listed under the text. Wrong writes `explanation` (prefix
  `Wrong (phone review)`), never the program; a flagged draft leaves the queue and Confirm all.
- **1 v 1** (mode `versus`, `src/lib/arena/matches.ts`): two people, two devices, one game. A 1 v 1
  belongs to its two seats and nobody else, over as well as playing. Doc: `docs/arena-code-map.md`.
- **Claude as the arena opponent** (`src/lib/arena/ai/`): your hand, life and decklist are
  **never** in the request. `opponent.ts` picks from the legal-move list, so an answer can be wrong
  but never illegal. Doc: `docs/arena-code-map.md`.
- **Arena debug** (`src/lib/arena/ai/debug.ts`, `/arena/[id]/debug`): every server decision is
  logged to `arena_decisions`. What the compiler cannot read is `card_rules.unread` on the rule
  itself, not a second list. Doc: `docs/arena-code-map.md`.
- **Rules are records** (`docs/arena-rules-workbench-spec.md`): the engine plays from `card_rules`
  and **never compiles card text at game time**; a row a person confirmed or corrected is never
  rewritten by a script. Doc: `docs/arena-code-map.md`, and for the owner's own walkthrough of
  correcting a record, `docs/arena-fixing-a-card.md`.
  **A stored program has no key the engine does not know** (3 Oct 2026, BT31-132's `from` for
  `fromVar`): `programProblem` (`vm/script-schema.ts`) refuses a stray key on a step, condition,
  selector, ref, amount, mode or filter by name and path, and `validateRule`/`validateProgram`
  answer with it. A *partial* filter is accepted and stored whole (`completeFilters`, applied by
  `readRule` and `saveRule`), and `describeFilter`/`printFilter` read one without crashing.
  `saveRule` re-validates every write, so no writer — workbench, Explain to Claude, the
  referee's drafts — can skip the gate.
- **The board talks to a session, not to the server** (`src/components/arena/session/`, #648 / O3-01):
  `ArenaStage` takes an `ArenaSession` (`contract.ts`) — `act`, `watch` (snapshots in, connection
  status), `refresh`, and optional `advance`/`abandon`/`rematch`/`flag`/`preview`/`chooseSkin`/
  `chooseStaging`/`reportBug`, whose presence is the `capabilities` the board hides controls by. The
  online transport (server actions, the revision/beat long poll, `router.refresh` on a stale
  rejection) is `online.ts`, wrapped for the server-rendered game page as `OnlineArenaStage`; the
  fixture preview builds its own session from stubs. **The board's value-import graph reaches no
  `@/app` action and no `next/navigation`** — the local worker session (`local.ts`, O3-02; wired in
  O3-05) is another implementation of the same interface. `LiveGameCore` (also in `contract.ts`, wrapped by
  `useLiveGame`) is the reconcile logic: it adopts only a newer revision of *its own* game, takes a
  beats-only advance at the same revision, and refuses stale and cross-session snapshots.
  Proved by `scripts/verify/arena-session-648.mts` (graph, conformance on an in-memory session,
  server-render of the board over it); the click-through half is browser-driven
  (`arena-advance-browser-evidence.mts`, `npm run arena:shots`).
- **The block builder** (`src/lib/arena/lang/blocks.ts`, `components/arena/rules/Blocks.tsx`,
  `/arena/rules/build/[id]`, #469): a rule spelled out as WHEN · COST · IF · THEN blocks, **generated
  from the schema** — what a clause may hold comes off `OP_SCHEMA`/`COND_SCHEMA`/`whenMoments()`/
  `COST_ITEMS`, each blank's control off its `FieldType`, so a new row needs no builder change. One
  component for the phone route and the workbench record; every edit goes through a `RulePath`
  (`lang/path.ts`) into the one `Rule`. Proved by `scripts/verify/blocks.ts`; `/arena/rules/build/preview`
  shows it on fixtures without a database (dev only).
- **The probe** (`src/lib/arena/probe.ts`): says what the engine *does* with a rule, not what it
  should. Pure — no database, no network, and **no compiler**: `draft.ts` stays the only module
  that compiles card text. Doc: `docs/arena-code-map.md`.
- **Try it → fix it** (`src/lib/arena/tryit.ts`, panel `components/arena/rules/tryit/`, actions
  `app/arena/rules/probe-actions.ts`, #470): the builder's unsaved rule, probed on the boards its
  trigger and condition call for, on the rules engine. Each beat carries
  the `RulePath` of its block, so a wrong row opens that block. **`probe()`'s own default stays
  `FALLBACK_ENGINE`**: Try it passes the engine explicitly. The owner's judgements are
  `card_rules.expectations`. Doc: `docs/arena-tooling.md`.
- **Explaining a card** (`src/lib/arena/ai/clarify.ts`): plain-language explanations become a
  draft rule. **A ruling given in conversation goes to `card_rules.explanation` first** (`npm run
  arena:rule`), and the code change is made afterwards, deliberately. Doc: `docs/arena-code-map.md`.

## Working efficiently on the arena

Before opening arena docs or engine source for a specific question, start with
`docs/arena-tooling.md` (what each verify/probe/tally script proves) and
`docs/arena-next-session-prompt.md` (current state, priority order) — both are short and meant
as the entry point. There are 20+ other `docs/arena-*.md` files (several 400–900+ lines); grep
them for the term you need rather than reading multiple specs end to end. The compiler lives
under `src/lib/arena/compile/` (`compile.ts` is its stable public barrel); `vm/script.ts` +
`vm/script-schema.ts` are each 2,000–3,300
lines — grep for the symbol first and read a line range, don't open these files whole. For iterating on pure rule
logic, `npx tsx scripts/verify-rules.ts` and `npx tsx scripts/verify-arena.ts` are much faster than
full `npm test` (which also runs `verify-db.mts`, spinning up PGlite + migrations every time); run
the full suite before finalizing. Never run `sync:catalog`/`sync:prices` just to inspect state —
they hit real network endpoints and take 30–50s.


## Arena and tooling commands

```powershell
npm run contract:emit  # rewrite contract/fixtures/*.json after a deliberate Snapshot shape change
npm run android:test   # Kotlin round-trip of those fixtures, in Docker — no JDK on the machine
npm run arena:draft    # Compile the catalog offline into card_rules drafts (--card, --set, --only-open, --review)
npm run arena:rulesets # Rewrite src/lib/arena/rulesets/<game>/files.ts from the .rules files beside it
                       # (--check fails instead of writing); the loader itself reads no filesystem
npm run arena:probe    # Try stored rules on a board built for each (--card, --set, --all, --limit, --fill)
npm run arena:reprobe  # Re-run every probe a rule carries and list the ones whose answer moved (--write),
                       # then every board the owner judged: "expected fired, now didNotFire"
npm run arena:tally    # Compiler coverage over the live deckplanet catalog, with op/cond usage and unread
                       # clause shapes — no database needed (--misses N, --show "<a wording>")
npm run arena:specified # The specified (coloured) half of a play's price: proves the catalog feed carries
                       # no cost orbs, lists the X-cost cards whose baseline is therefore refused (--all),
                       # and — with DATABASE_URL — says per card whether one was entered, ruled on or is unknown
npm run arena:readings # The other half: what the compiler reads every skill to *mean*, printed text
                       # beside the program in words. Diff it before and after a compiler change — a
                       # clause that compiles and reads wrongly moves no coverage number (--grep, --unread)
npm run arena:diff     # Replay a saved game's action log from its seed and compare with the row
                       # (-- <gameId> | --all): replays a saved game from its seed on the rules engine
```

`npm test` needs no database or network. Everything else needs `DATABASE_URL` in `.env.local`,
except `android:test`, which needs Docker and nothing else — the Kotlin toolchain lives in a
container (`android/Dockerfile`) because the machine has no JDK, no Gradle and no Android SDK.
There is no test framework — both scripts are plain `assert` scripts run with `tsx`; extend them in
the same style. **`docs/arena-tooling.md` explains every arena instrument** — what `arena:readings`
and `arena:tally` prove and how to diff them, which of `verify-arena`'s twelve suites means what
when it fails, when `contract:emit` and the oracle `arena:diff` are required, and the practices
learned the expensive way. Read it before changing the compiler or the engine.

