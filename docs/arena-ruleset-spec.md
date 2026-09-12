# Arena ruleset spec — the interpreter contract and the definition files

Written 12 Sep 2026 (issue #114). This is the document that says **what the rules engine is**:
which part of the arena is a declaration a person can edit, which part is an algorithm only code
can carry, and what has to be true before either is believed.

It is the companion to `docs/arena-rules-language.md`, which specifies the *grammar* the
declarations are written in. That doc says how a rule is spelled; this one says what a rule is
allowed to mean, where the meanings live, and how a new one is added.

Three sections here (§2, §3, §4) are deliberately headings with a single line under them: they are
filled by the stage issues that produce their content, and checked back against this document when
they land. The other four (§1, §5, §6, §7) are written now, so those issues have somewhere to
write.

---

## 1. Configuration versus interpreter

The arena is being converted to a **configuration-based rules engine** (owner's decisions of
9 Sep 2026, recorded in `docs/arena-backlog.md` §1). The aim, in the owner's words: *fix each card
by setting the right DSL statement*. Four decisions shape everything below.

**One language, three uses.** A card's rule (`card_rules`), a game's definition
(`src/lib/arena/rulesets/<game>/*.rules`) and the referee's answers are all written in the same
language, with one parser, printer and validator in `src/lib/arena/lang/`, table-driven from
`OP_SCHEMA`/`COND_SCHEMA` in `src/lib/arena/engine/script-schema.ts`. The round-trip promise
`parse(print(x)) = x` is what makes a text view of a stored record safe to edit. There is no
dialect per use.

**Rules are configuration, algorithms are the interpreter.** The line runs like this:

| Declared, in `*.rules` and `card_rules` | Code, in the interpreter |
|---|---|
| Zones and what may be seen of them | The flow runner and the turn loop |
| Card attributes and their types | The append-only event log |
| Phases and their order | Prompt mechanics (ask, resume, replay) |
| Actions, their legality clauses and their costs | Selector evaluation and filtering |
| Keywords, as macros over fixed hook points | Effect layering and duration bookkeeping |
| Triggers — the moments a rule may answer to | Payment search over energy and colours |
| Win, loss and draw conditions | The seeded RNG |
| The words shown for all of the above | The language itself (lexer, parser, printer) |
|  | The drafter — text → a rule record |

A new *mechanism* is one primitive: an interpreter case plus a schema row. Once it exists, every
game that declares it has it. **Per-game TypeScript modules were rejected explicitly** — a game is
files, not code, and the moment a game needs code the primitive is missing.

**Beside, not in place.** `src/lib/arena/engine/` is frozen (bug fixes only). The new engine is
`src/lib/arena/vm/`, behind the shared `Engine` interface in `src/lib/arena/engines.ts`;
`arena_games.engine` is `legacy | rules`, chosen per game, default `legacy` until the owner flips
it (Stage 9). Until then the legacy engine is the **oracle** — see §6.

**Shared `card_rules`, two vocabularies.** One table serves both engines. A row edited with a new
primitive is valid for the rules engine; the legacy engine treats an op it does not know as
*unread* and hands it to the referee. So a row can move forward without any card getting worse.

Why this shape and not a bigger engine: a hand-written engine's rules are only readable by reading
it, and every new mechanism costs a search through 23k lines for the places that must agree. A
declaration is checkable — the loader can prove a game declares everything the interpreter needs,
and the interpreter can prove it implements everything a game declares.

---

## 2. The primitives and the expression language

*Filled by #130* (Stage 2's primitive-or-macro table, `OP_CLASS`/`COND_CLASS` beside the schemas,
and the expression grammar). Until then the operations and conditions are the schema rows
themselves: `OP_SCHEMA` (45 ops) and `COND_SCHEMA` (18 conditions) in
`src/lib/arena/engine/script-schema.ts`, with the closed word lists `SIDES`, `SPECIAL_TARGETS`,
`AREAS`, `DURATIONS` and `KEYWORD_NAMES` above them, and the grammar in
`docs/arena-rules-language.md` §3.

---

## 3. The definition files

*Filled by #132 and #133–#135* (the loader and `Vocabulary`, then one section per
`src/lib/arena/rulesets/dbs/*.rules` file — `game`, `attributes`, `zones`, `triggers`, `keywords`,
`words`, `prompts`, `costs`, `battle` — saying what each declares and which sections of
`docs/rules/rulemanual.txt` it encodes). Nothing under `src/lib/arena/rulesets/` exists yet, and
the `DEFINE` grammar those files are written in is Stage 3's first issue.

---

## 4. The hook contract

*Filled by #153* (Stage 7's inventory of the fixed hook points a keyword macro may attach to —
choosing, immunity, enter and leave, battle, play/charge/pay — each with one example body written
in the language). The inventory is taken from the inline keyword sites in the legacy engine; until
it exists, `src/lib/arena/glossary.ts` is the only written account of what each keyword means and
what the engine actually does with it.

---

## 5. Adding a primitive, adding a game

Two checklists. Both are complete lists: if a step is skipped the omission shows up as a stale
document rather than a failing test, which is why they are written down.

### Adding a primitive

A primitive is a new operation or condition — a mechanism no existing op can express, decided
against the primitive-or-macro table (§2) rather than added on sight.

1. **Interpreter case** — one case in the evaluator (`stepScript`, `src/lib/arena/engine/script.ts`
   line 629, for the legacy engine; the `vm/` evaluator once it exists).
2. **`OP_SCHEMA` row** (or `COND_SCHEMA` row) in `src/lib/arena/engine/script-schema.ts` — the
   fields, their types and the plain reading. The schema is what the validator, the printer, the
   referee's prompt and the workbench's chip editor all read, so the row is the definition.
3. **`OP_CLASS` row** (`COND_CLASS` for a condition) — primitive or macro, per #130. The `Record`
   type forces a row per op, so a new op without a decision fails `npm run typecheck`.
4. **Doc row** — the table in §2 of this document, and the grammar in
   `docs/arena-rules-language.md` if the printed form is new.
5. **Glossary** — `src/lib/arena/glossary.ts`, in the same commit, whenever what the engine
   understands or does with card text changes (`CLAUDE.md`, Conventions).
6. **`npm run contract:emit`** — an `OP_SCHEMA` change changes what the referee is told and what
   the fixtures say; regenerate and review the diff (`docs/arena-tooling.md` §3).
7. **Tally and readings** — `npm run arena:tally` and `npm run arena:readings` before and after, so
   the wording the primitive unlocks is measured rather than assumed.

### Adding a game

The test of the configuration claim: a second game is files, a drafter and words — no engine code.

1. **`src/lib/arena/rulesets/<id>/*.rules`** — the definition files of §3, one per concern.
2. **Drafter** — how this game's card text becomes rule records: its own wording rules over the
   shared language, not its own language.
3. **Vocabulary** — the words the loader exposes for this game: zone names, phase names, prompt
   wording, keyword names.
4. **`GAME_INFO`** — the row in `src/lib/catalog/games.ts` already exists for both games; the
   arena's own gate is `deckInputFor` and the deck lists asking for `game: "dbs"`.

**Fusion World as the worked hypothetical.** Fusion World is the honest test: same publisher, same
card shapes, different zones (no Z-Deck), different colour rule (off-colour is illegal, not a
warning), a numeric energy cost, its own keyword set. Nothing in that list is an algorithm. If
adding Fusion World needs an interpreter change, the change is a *missing primitive* and belongs in
the first checklist — that is the diagnostic, and the reason the arena's `dbs`-only limit
(owner's decision, 4 Sep 2026) is a scope choice and not an architectural one.

---

## 6. The oracle protocol

Two engines exist until Stage 10, and the older one is the measurement. Nothing about the rules
engine is believed because it looks right; it is believed because it agrees with the engine that
has been playing games.

**The instruments** (all described in `docs/arena-tooling.md` §4):

- **`npm run arena:diff`** — replays a saved game's action log from its seed and compares with the
  stored row, on either engine (`-- <gameId> [--engine legacy|rules]`, or `--all`). A game is
  reproducible from seed plus actions, so a divergence *is* a behaviour change. This is the oracle
  itself. Not in `npm test`: it needs a database and real saved games.
- **`npm run arena:reprobe`** — re-runs every probe stored on a confirmed rule and lists the rules
  whose answer moved. The regression suite the rules never had. Its blind spot: the staged board is
  built in the card's favour and stages only what `stage()` has been taught, so a new mechanism
  needs a new staging or the probe cannot see it.
- **`npx tsx --env-file-if-exists=.env.local scripts/arena-fuzz.mts 40`** — plays 40 random
  complete games and reports crashes. The standing gate; 200 for anything touching movement,
  payment or flow. It proves only that nothing threw.
- **`npm test`** — `verify-rules.ts` plus `verify-arena.ts`'s twelve suites plus the PGlite
  migration suite. A new suite is one `import "./verify/<name>"` line in `scripts/verify-arena.ts`.

**What "green" means, per stage.** Each stage's exit is a claim, and the claim is the check:

| Stage | Green means |
|---|---|
| 3 — definitions | The `DEFINE` files load, and the loader proves every legacy union (`Area`, `Phase`, `Trigger`, `Prompt`) is covered by a declaration — `scripts/verify/rulesets.ts` |
| 4 — core | `vm/` plays turn to turn with pass and concede, renders on the board, and the fuzz gate passes on `--engine rules` |
| 5 — actions and costs | `arena:diff` is clean on staged games on both engines; the engine is selectable in the form |
| 6 — battle | The battle suites pass on **both** engines from the same test bodies |
| 7 — keywords | All 39 keyword bodies are written as macros and the keyword suite passes on both |
| 8 — from config | Words, prompts, primer, probes and the AI read the definition, with no new snapshot field |
| 9 — parity | **Every** saved game replays identically on the rules engine (`arena:diff --all`), reprobe moves nothing unexplained, fuzz is clean — then the default flips |
| 10 — retirement | `engine/` is gone; saved legacy games are handled per the owner's ruling (still needed) |

**The two-engines rule until Stage 10.** A game keeps the engine it was made on: `state` is that
engine's shape and `actions` replay only on it. `engineFor(row.engine)` is the one switch, and
nothing that plays a saved game may import `./engine` directly for the purpose. That is exactly
what keeps the oracle available — the moment the two engines are entangled there is nothing left to
compare against.

**The gate on every commit** (from `docs/arena-backlog.md` and the stage issues):
`npm run typecheck && npm run lint && npm test && npm run build`, then the fuzz run. A change to a
schema row, a harness card or what the referee is told also needs `npm run contract:emit` and a
reviewed `contract/fixtures/` diff.

---

## 7. What stays code and why

Everything in this section is deliberately *not* configurable. Each is an algorithm whose
correctness is a property of the algorithm, not of any game's rules — declaring it would move a
decision nobody can make from a place that is tested to a place that is not.

- **The flow runner** (`exec`, `src/lib/arena/engine/engine.ts` line 222, over `state.flow`). The
  turn is a data step list, but *running* it — resuming after a prompt, unwinding nested scripts,
  deciding when a game is storable mid-decision — is one algorithm. A game declares its phases;
  it does not declare how a phase is executed.
- **The event log.** Append-only, and the source of both the board's beats and the replay. Its
  ordering guarantees are what make the oracle possible; a game cannot be allowed to reorder it.
- **Prompt mechanics.** How a question is asked, how a partial answer is held, how `min`/`max`/
  `step`/`cost` bound it, and how the same question re-asks after a replay. A game declares the
  prompt's *words* (Stage 8); the machinery is shared.
- **Selector evaluation** (`resolveSelector`, `src/lib/arena/engine/state.ts` line 416) and the
  filter grammar in `filters.ts`. A card's rule names *what* it wants; finding it — over hidden
  zones, with visibility rules and per-viewer masking — is code, and getting it wrong leaks
  information rather than misplaying a card.
- **Payment search** (`paymentOptions`, `src/lib/arena/engine/state.ts` line 1675). Choosing which
  energy pays a specified cost is a search with a bound, not a rule. A game declares costs and
  colours; the search is the interpreter's.
- **The RNG** (`src/lib/arena/engine/rng.ts`). Seeded and reproducible, because seed plus actions
  must reproduce a game exactly. Configurable randomness is unreproducible randomness.
- **The language** (`src/lib/arena/lang/`). The lexer, parser, printer and validator are the thing
  every declaration is written in, so they cannot themselves be declared. The round-trip promise is
  asserted over every op, condition, selector, filter, keyword, every compiled program and every
  drafter record (`scripts/verify/lang.ts`).
- **The drafter** (`src/lib/arena/draft.ts`, over `engine/compile/`). Reading English card text into
  a rule record is inference, not rules: it is allowed to be wrong, which is why its output is a
  *draft* a person confirms, and why it is the only module that calls the compiler in production.
  The engine plays records, never text.

The test for anything proposed as configuration is the one in §5: if a game needs it and cannot say
it in the language, the answer is a new primitive — not a per-game module, and not a special case
in the interpreter.
