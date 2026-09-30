# Architecture: the arena and its tooling

Read before touching anything under `src/lib/arena/` or `src/components/arena/`. Start with the `arena-work` skill, `docs/arena-tooling.md` and `docs/arena-code-map.md`. Moved unchanged from `CLAUDE.md` (issue #382); the text is verbatim, so a comment that says "see CLAUDE.md" means this file.

- **Arena rules engine** (`src/lib/arena/engine/`): a game is a `GameState` plus an event log;
  `apply()` is the only mutator. `legalActions()` offers only skills the engine can pay for **and**
  resolve, and drives both the UI and Claude's move menu. Doc: `docs/arena-code-map.md`.
- **The compiler's glossary** (`src/lib/arena/glossary.ts`, `/arena/rules/keywords`): the only
  written record of what the compiler understands per keyword — part of the compiler, not
  documentation about it (Conventions below: touch the compiler, update the glossary). Doc:
  `docs/arena-code-map.md`.
- **Two engines, chosen per game** (`src/lib/arena/engines.ts`): the config-driven `rules` engine
  (`vm/`) is the **default** since 20 Sep 2026 (#166); `legacy` (`engine/`, frozen) stays the
  oracle, is what Settings → Arena engine puts new games back on, and is what a **1 v 1** is made
  on either way (`engineForMode`, #162 — never a refusal of the default path). A game keeps the
  engine it was made on — `engineFor(id)` is the one switch, and `engineOr`'s own fallback is
  `FALLBACK_ENGINE`, not the default, because an unreadable stored value is an old legacy row.
  **One rejection per card per action type, except an activation, which is one per skill line**
  (§3.2). Doc: `docs/arena-code-map.md`.
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
- **The record's WHEN is the engine's WHEN** (`skillAnswersTo`, `engine/triggers.ts`): an [Auto]
  skill's trigger comes off `card_rules.trigger`; only a skill with no record falls back to the
  printed text. Doc: `docs/arena-code-map.md`.
- **Arena UI** (`/arena`, `src/components/arena/`, `docs/arena-client-contract.md`): phone-first
  board driven entirely by `legalActions()` and one `Snapshot` — no client evaluates a rule.
  **Everything the board says about who is acting reads `live.waiting`, never the `snapshot`
  prop.** Doc: `docs/arena-code-map.md`.
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
- **The probe** (`src/lib/arena/probe.ts`): says what the engine *does* with a rule, not what it
  should. Pure — no database, no network, and **no compiler**: `draft.ts` stays the only module
  that compiles card text. Doc: `docs/arena-code-map.md`.
- **Explaining a card** (`src/lib/arena/ai/clarify.ts`): plain-language explanations become a
  draft rule. **A ruling given in conversation goes to `card_rules.explanation` first** (`npm run
  arena:rule`), and the code change is made afterwards, deliberately. Doc: `docs/arena-code-map.md`.

## Working efficiently on the arena

Before opening arena docs or engine source for a specific question, start with
`docs/arena-tooling.md` (what each verify/probe/tally script proves) and
`docs/arena-next-session-prompt.md` (current state, priority order) — both are short and meant
as the entry point. There are 20+ other `docs/arena-*.md` files (several 400–900+ lines); grep
them for the term you need rather than reading multiple specs end to end. `src/lib/arena/engine/`
is large: the compiler implementation now lives under `src/lib/arena/engine/compile/`,
`compile.ts` is its stable public barrel, and `engine.ts`, `script.ts` + `script-schema.ts`,
`state.ts` are each 1,800–4,600 lines — grep for the symbol first and read a line range, don't
open these files whole. For iterating on pure rule
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
npm run arena:reprobe  # Re-run every probe a rule carries and list the ones whose answer moved (--write)
npm run arena:tally    # Compiler coverage over the live deckplanet catalog, with op/cond usage and unread
                       # clause shapes — no database needed (--misses N, --show "<a wording>")
npm run arena:specified # The specified (coloured) half of a play's price: proves the catalog feed carries
                       # no cost orbs, lists the X-cost cards whose baseline is therefore refused (--all),
                       # and — with DATABASE_URL — says per card whether one was entered, ruled on or is unknown
npm run arena:readings # The other half: what the compiler reads every skill to *mean*, printed text
                       # beside the program in words. Diff it before and after a compiler change — a
                       # clause that compiles and reads wrongly moves no coverage number (--grep, --unread)
npm run arena:diff     # Replay a saved game's action log from its seed and compare with the row
                       # (-- <gameId> [--engine legacy|rules] | --all): the oracle check between the engines
```

`npm test` needs no database or network. Everything else needs `DATABASE_URL` in `.env.local`,
except `android:test`, which needs Docker and nothing else — the Kotlin toolchain lives in a
container (`android/Dockerfile`) because the machine has no JDK, no Gradle and no Android SDK.
There is no test framework — both scripts are plain `assert` scripts run with `tsx`; extend them in
the same style. **`docs/arena-tooling.md` explains every arena instrument** — what `arena:readings`
and `arena:tally` prove and how to diff them, which of `verify-arena`'s twelve suites means what
when it fails, when `contract:emit` and the oracle `arena:diff` are required, and the practices
learned the expensive way. Read it before changing the compiler or the engine.

