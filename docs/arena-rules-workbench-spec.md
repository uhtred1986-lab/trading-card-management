# Arena — rules as records: the Rules Workbench

**Status: phase 1 (§3) built 8 Sep 2026, PR #56; phase 2 (§4) built 8 Sep 2026, PR #57; phase 3 (§5, the probe) built 8 Sep 2026, PR #58. What each phase found, and what it changed about the plan, is in `docs/arena-history-lessons.md` — "Done: rules as records" and "Done: the catalog and the patterns".** Written to be executed by Claude Code in this repository.
Companion prototype: `docs/arena-rules-workbench-prototype.html` (open it in a browser; it is the
UX target, not code to copy).

The engine's rules are hard to review, hard to read and hard to correct by hand. This brief moves the
rules out of the compiler's memory and into records — one per skill, per card — that the workbench
shows, the owner confirms or corrects, and the engine reads. **The interpreter, the flow, the
keywords and the triggers stay. The runtime compile-and-memoise layer, the runtime-only referee and
the text-typing rules page go.**

---

## 0. How to run this

### 0.1 Put the brief in the repo

Save as `docs/arena-rules-workbench-spec.md`, the prototype as
`docs/arena-rules-workbench-prototype.html`, commit both.

### 0.2 Start the session

From the repo root, `claude`, then paste:

> Read `docs/arena-rules-workbench-spec.md` and open the prototype next to it. Implement phase 1
> only, including the cleanup ledger in §3.8 — this is a slimming pass as much as a feature. Plan first and show me the plan — in particular the `OP_SCHEMA` table in §3.2, the
> migration in §3.4 and the removal list in §3.8 — before you edit anything. Do not touch `engine.ts` flow, `triggers.ts` or the
> keyword handling except where §3.5 says so.

Plan mode for the first turn. Phases 2 and 3 are separate sessions, each starting from a clean
`main`.

### 0.3 What to watch in the diff

- **The engine reads `card_rules` and nothing else.** If `compileCardCached` is still imported
  anywhere under `src/lib/arena/engine/` after phase 1, the point was missed.
- **One schema, many consumers.** `validateProgram`, `describeScript`, `EFFECT_LANGUAGE` and the
  block editor must all derive from `OP_SCHEMA`. A diff that adds a new op in four hand-written
  places is the old way.
- **Human rows are never overwritten by a script.** `arena:draft` may only *add* drafts and *flag*
  changes. Grep the script for `update` on rows whose status is `confirmed` or `corrected`; there
  must be none.
- **`compile.ts` shrinks or stays; it does not grow a UI.** The compiler is a drafter now.

---

## 1. What is wrong today, precisely

1. **Nothing to look at.** A skill's program exists only as the return value of
   `compileCardCached` at load time. There is no row to open, diff, sort or count. `/arena/rules`
   recomputes it per request and only for cards in your decks; the catalog's other ~13,000 skills
   are invisible except as aggregate numbers from `arena:gaps`.
2. **Three sources, one store, no state.** `card_scripts` holds referee rulings and hand-set
   programs; compiled programs are never stored. So "what does the engine know about this card"
   has three answers depending on when you ask, and none of them carries *reviewed by a human*.
3. **Correcting means re-wording.** The rules page asks you to retype the printed text until the
   compiler reads it. That is the compiler's UX, not a rule editor's. It cannot express anything the
   compiler cannot parse, which is exactly the case where you need to correct something.
4. **Every op is wired in five places** (`Op` union, interpreter switch, `OP_NAMES`/
   `validateProgram`, `EFFECT_LANGUAGE`, `describeScript`) and the worklist says so. A sixth place
   (the editor) on top of that is not acceptable; the fix is to collapse them.
5. **The referee is invisible.** A runtime ruling by Claude plays the card for the rest of the game
   and lands in `card_scripts` with `source: "user"` — indistinguishable from something you set,
   and never reviewed.

What is *not* wrong: the effect language itself, the interpreter, the flow/prompt design, the
manual-cited keyword implementations, the fuzzer, `arena:gaps`. At 72.6 % catalog coverage with
tests per section of the manual, ripping those out would cost a month to get back to the same place.
The pain is entirely in the layer around them.

## 2. Decisions

1. **A rule is a record.** Table `card_rules`, one row per `(card_id, side, skill_index)`, holding
   the program in the existing `Op` language plus its trigger, cost, hoisted top-level condition,
   provenance, status and version. The engine loads rules from this table. Nothing compiles at
   game time.
2. **The compiler is a drafter, not the engine's parser.** `npm run arena:draft` compiles the whole
   catalog offline and upserts *drafts*. It is the AI-extraction step of the TSHC workbench, in
   deterministic form: it proposes, a person confirms. Improving the compiler still pays off across
   the catalog — through re-drafting, with a diff, never by silent replacement.
3. **Four states, three sources.** `status ∈ {open, draft, confirmed, corrected}`,
   `source ∈ {compiler, claude, user}`. `open` = no program (the engine plays the skill as blank
   and *says so* in the log). `draft` = compiler wrote it, nobody looked. `confirmed` = a person
   accepted the draft as-is. `corrected` = a person or Claude wrote a program that differs from the
   compiler's. A confirmed or corrected row belongs to the person; scripts may add a
   `compiler_diff` to it, never change it.
4. **The referee persists.** A runtime ruling becomes a `card_rules` row with `source: claude`,
   `status: draft`, `explanation: <the ruling's why>`, and shows up in the worklist like any other
   draft. It is still used for the rest of that game. Nothing Claude decides is ever invisible again.
5. **One op schema.** `OP_SCHEMA` in `script.ts` is a table: for each op, its fields, each field's
   type (`amount | ref | selector | side | area | duration | cond | ops | enum(...) | string |
   number | boolean`), whether it is required, and a one-line sentence template. `validateProgram`,
   `describeScript`, the `EFFECT_LANGUAGE` prompt and the block editor all read this table. Adding
   an op becomes: one interpreter case, one schema row.
6. **Edit is structured first, JSON second.** The record is shown as WHEN / COST / IF / DO with one
   chip per op (prototype). Chips are edited inline from the schema. A JSON view of the same
   program is always one click away and round-trips through the same validator. There is no
   free-text-to-program path in the editor; that is what "Explain to Claude" is for, and its answer
   is a draft.

   **Amended 9 Sep 2026 (Stage 1 of the rules-language programme).** There is now a third view of
   the same record, shown in the workbench as the **text view** (§3.6): the **rules language**
   (`src/lib/arena/lang/`, `docs/arena-rules-language.md` §2 — the round-trip promise),
   a closed grammar isomorphic to the program — `parse(print(x))` is `x`, checked over every op,
   condition, selector, filter and keyword in `scripts/verify/lang.ts`. It is *not* the free-text
   path this decision rules out: nothing is guessed, and a word the grammar does not know is an
   error with a line and a column, never a widening. It exists because WHEN and COST have no chip
   editor and are not getting one, and they now need editing — the engine reads the row's trigger
   (`skillAnswersTo` in `engine/triggers.ts`), so a WHEN a person changes is a WHEN the engine
   matches. The skill tag in brackets stays read-only: it comes off the card.
7. **Patterns stay first-class.** The number of sibling cards with the same wording is on every
   record, and correcting a compiled draft asks "fix this card" or "fix the pattern" (the latter
   files a compiler brief, as `/arena/backlog` does today). The workbench must not make it easy to
   hand-fix 400 cards one by one.
8. **New cards get a rule at sync, not later.** The catalog sync (CardTrader import, and the
   errata scrape) is the moment a card's text arrives or changes. Right there the drafter runs
   for exactly those cards, and for every skill the compiler cannot read, Claude proposes a program
   in the step language. The card is never "unknown" to the arena for longer than one sync. §3.9.
9. **Probe, not simulate.** A probe runs the pure engine on a synthetic state built for the rule's
   trigger and prints the event log as Input → Applied rule → Result → Assumptions — the TSHC trace,
   applied to a card. Phase 3. The prototype's right pane is what it looks like.

## 3. The work — phase 1: records, drafting, engine reads rows

### 3.1 Schema — `src/db/schema.ts`

```ts
export const cardRules = pgTable("card_rules", {
  id: serial("id").primaryKey(),
  cardId: text("card_id").notNull(),
  side: text("side").notNull(),                 // "front" | "back"
  skillIndex: integer("skill_index").notNull(),
  // What the record is about — copied at draft time so the row is readable on its own.
  printed: text("printed").notNull(),           // the skill line as printed
  kind: text("kind").notNull(),                 // "Auto" | "Activate: Main" | "Permanent" | ...
  trigger: jsonb("trigger"),                    // Trigger, as parseSkills/types.ts already define it
  cost: jsonb("cost"),                          // parsed skill cost, or null
  cond: jsonb("cond"),                          // top-level Cond hoisted from a wrapping `if`, or null
  ops: jsonb("ops").$type<Op[]>().notNull().default([]),
  // Provenance and state.
  status: text("status").notNull(),             // open | draft | confirmed | corrected
  source: text("source").notNull(),             // compiler | claude | user
  unread: jsonb("unread").$type<string[]>().notNull().default([]),  // clauses the compiler could not read
  pattern: text("pattern"),                     // compiler pattern key that produced the draft, if any
  explanation: text("explanation"),             // the owner's or Claude's words, when source != compiler
  reads: text("reads").notNull().default(""),   // describeScript(ops), regenerated on every write
  version: integer("version").notNull().default(1),
  compilerDiff: jsonb("compiler_diff").$type<{ ops: Op[]; unread: string[]; at: string } | null>(),
  confirmedAt: timestamp("confirmed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [uniqueIndex("card_rules_skill").on(t.cardId, t.side, t.skillIndex), index("card_rules_status").on(t.status)]);
```

`card_scripts` is migrated (§3.4) and then dropped. `card_text_notes` stays for now (patterns and
briefs live there); phase 2 folds it in.

### 3.2 `OP_SCHEMA` — `src/lib/arena/engine/script.ts`

Write the table first, then make the four consumers read it:

```ts
type FieldType = "amount" | "ref" | "selector" | "side" | "area" | "duration" | "cond" | "ops" | "string" | "number" | "boolean" | { enum: readonly string[] };
export interface OpField { name: string; type: FieldType; required?: boolean; default?: unknown }
export interface OpSpec { fields: OpField[]; sentence: string; doc?: string }   // sentence: "KO {target}", "{side} draws {n}"
export const OP_SCHEMA: Record<Op["op"], OpSpec> = { ... };
```

- `validateProgram` walks `OP_SCHEMA` instead of `OP_NAMES` + ad-hoc checks. Keep the existing
  tests passing; add one that every `Op` variant has a schema row (type-level: `Record<Op["op"],…>`
  already enforces it).
- `describeScript` renders `sentence` with the field describers you already have
  (`describeAmount`, `describeSelector`, `describeRef`). Keep the special cases that exist today
  (counted amounts read "+5000 power for each …") as per-field describers, not per-op prose.
- `EFFECT_LANGUAGE` in `ai/opponent.ts` is generated from `OP_SCHEMA` at module load. Diff the
  generated prompt against the current hand-written one and keep the hand-written *examples*
  section; only the operation list is generated.
- `compile.ts` is untouched by this except that its output type gains nothing — it still returns
  `{ ops, unsupported }`.

### 3.3 The drafter — `src/lib/arena/draft.ts`, CLI `scripts/arena-draft.mts`

`npm run arena:draft [--card BT16-042] [--set BT16] [--only-open]`

For every card, side and skill (`parseSkills`, `skillLines`, same as `rules.ts` today):

1. Compile with `compileSkill`. Skills the engine handles natively (keywords with no text, per
   `rules.ts` today) get **no row**.
2. No row yet → insert: `status: unsupported.length ? "open" : "draft"`, `source: compiler`,
   `unread`, `pattern` (see below), `reads: describeScript(ops)`.
3. Row exists with `status ∈ {open, draft}` and `source: compiler` → replace ops/unread/reads
   (it is still the compiler's row). Bump `version` only if `ops` changed.
4. Row exists with `status ∈ {confirmed, corrected}` or `source ≠ compiler` → **never touch
   ops**. If the fresh compile differs from `ops`, set `compilerDiff = { ops, unread, at }`;
   if it now matches, clear it. That is what surfaces "the compiler changed its mind" in the
   worklist without losing the human decision.
5. Print the same numbers `arena:gaps` prints today, from the rows: open / draft / confirmed /
   corrected, per set and for the owner's decks.

`pattern`: `compileSkill` does not currently say which rules fired. Add a cheap `trace: string[]`
to the compile context (push a short key when a pattern matches, e.g. `"play→choose→ko"`,
`"delay:turnEnd"`) and store `trace.join(" · ")`. Sibling counts in the UI group by `pattern`
for drafts and by the first unread clause's shape for open rows (`noteUnreadText` already
normalises that).

### 3.4 Migration

One-off script `scripts/arena-migrate-scripts.mts`, run once, kept in the repo:

- every `card_scripts` row → `card_rules` with `status: corrected`, `source: user` if
  `explanation` is set and `meaning` reads like the owner's words, else `source: claude`;
  `explanation` and `reads` carried over. Ambiguous rows: `source: claude` (safer — they show
  up for review).
- then `arena:draft` over the whole catalog.
- then drop `card_scripts`. Keep `cannotAttack` as an alias in the validator until the migrated
  rows have been re-saved once through the editor; the drafter rewrites it to `forbid`.

### 3.5 The engine reads rows — `src/lib/arena/load.ts`, `engine.ts`

- `scriptsFor(defs)` builds `EngineContext.scripts` from `card_rules` rows for the cards in both
  decks — `ops` when `status ≠ open`, and for `open` rows an empty program **plus a log line**
  `"<card> [skill n]: no rule stored — played as blank"` the first time it would have fired.
  Remove the `compileCardCached` fallback from the game path. Tests and the fuzzer get a helper
  `rulesFromCompiler(defs)` that builds the same context in memory so they still need no database.
- The referee path (`referee?: boolean`): when it rules, `saveRule({ …, source: "claude",
  status: "draft", explanation: ruling.why })`. Remove the `source: "user"` write in `clarify.ts`
  for Claude-written programs; the owner's explanation stays in `explanation`, the source is
  `claude`.
- `engine.ts` otherwise unchanged. If anything in the flow needs a change to read from rows rather
  than from a compile call, stop and say so — that is a sign the layer was not as separate as
  §14 of the design proposal claims.

### 3.6 The workbench — `src/app/arena/rules/`

Replace the page. Three panes on desktop, stacked on the phone (prototype):

**Worklist (left).** Rows from `card_rules`. Segments: All / Open / Drafts / Confirmed /
Corrected. Chips: My decks (default on), each deck, and mechanism buckets for open rows (reuse the
`MECHANISMS` table from `arena-gaps.mts` — move it to `src/lib/arena/gaps.ts` so page and script
share it). Sorted open → draft → corrected → confirmed, then by how many of the owner's decks the
card is in. Each row: name, id, kind, the `reads` line (or `could not read: …`). KPIs in the header
come from a single grouped count query.

**Record (centre).** Exactly the prototype: crumbs, name, deck usage + sibling count, status badge
+ provenance line, the printed line with the unread clause marked, then the rule block:

- WHEN — `kind` and the trigger sentence (`describeTrigger`, new, from `types.ts` Trigger).
- COST — the parsed cost as a sentence (`describePayment` exists).
- **Text view** *(added Stage 1 of the rules-language programme, 9 Sep 2026)* — the whole record
  printed and read back in the rules language (`docs/arena-rules-language.md` §2), and the only
  place WHEN and COST can be changed; the chips above have no editor for either and are not
  getting one. It is a closed grammar isomorphic to the program, not a free-text page: nothing is
  guessed, and a word the grammar does not know is a `LangError` with a line and column. Read on
  leaving the box, at which point the chips above follow; the bracketed skill tag stays read-only.
- IF — chips from `cond` (top-level only; nested `if` stays a DO chip).
- DO — one chip per op from `OP_SCHEMA`: the `sentence` template with each field rendered as a
  read-only value, or in edit mode as the control for its `FieldType` (`side`/`area`/`duration`/
  enum → select; `number` → number input; `amount` → number, or "for each …" selector; `ref` →
  it / this card / the attacker / the guard / a bound name; `selector` → side + area + count +
  upTo + filter text; `cond` → the small condition form; `ops` → nested chips, indented).
  "+ step" adds an op from a select of `OP_SCHEMA` keys. Remove = ×. Reorder = phase 2.
- The plain reading (`reads`) under the block, regenerated live in edit mode.

Actions: **Confirm** (draft → confirmed, `confirmedAt`), **Correct by hand** (edit mode; save →
`status: corrected`, `source: user`, `version++`), **Explain to Claude** (textarea → the
`clarifyCard` path, answer lands as `source: claude`, `status: draft`, shown immediately in the
block for confirmation), **Show program (JSON)** (textarea bound to the same ops; validated with
`validateProgram` on blur; invalid JSON keeps the last valid program and shows the error),
**Show as text** (the text view above; same last-valid-on-error contract as the JSON view),
**Mark as does nothing** (empty ops, `corrected`). When a row has `compilerDiff`, a strip above
the block shows "the compiler now reads this differently" with the two `reads` lines and
**Take the compiler's** / **Keep mine**.

**Pattern strip.** Sibling count, five sibling ids, and the fork: for an open row **Write the
compiler brief** (existing `clarifyCard` brief path); for a compiled draft being corrected, a
choice on save — *only this card* or *the pattern is wrong* (files a `card_text_notes` brief with
the corrected program as the expected reading).

**Right pane** in phase 1: History (a `card_rule_events` table is overkill; derive from
`version`, `source`, `confirmedAt`, `compilerDiff.at`, `updatedAt`) and, for open rows, the
mechanism and what it would need (the `needs` text from `MECHANISMS`). The probe box is phase 3;
render its place with the empty-state text from the prototype.

All server actions in `src/app/arena/actions.ts` beside the existing ones: `confirmRule`,
`saveRule` (ops + explanation + source), `blankRule`, `takeCompilerDiff`, `keepMine`. Every write
regenerates `reads` and files an `arena_feedback` row of kind `rule` as today, so
`arena:feedback` keeps working.

### 3.7 New and changed cards at sync — `src/lib/catalog/sync.ts` (or wherever the import lives)

After the catalog upsert, collect the card ids that were **inserted** or whose `skill` /
`back.skill` text **changed** (errata, corrected scrapes). Then, in the same job:

1. `draftCards(ids)` — the drafter from §3.3 as a library function (`src/lib/arena/draft.ts`;
   `scripts/arena-draft.mts` becomes a thin CLI over it). Changed text on a confirmed/corrected
   row → `compilerDiff` and a worklist entry, never an overwrite; changed text on a compiler row →
   re-draft in place.
2. `reviewOpenRules(ids, { budget })` — for every row left `open` by step 1, ask Claude for a
   program through the existing `clarifyCard` path with **no owner explanation** (the prompt
   variant "read the card yourself"). The answer is saved as `source: claude`, `status: draft`,
   `explanation: ruling.why`. A parse or validation failure leaves the row `open` with the
   attempt noted in `arena_feedback`. Every call goes through `recordRun` as today, so cost is
   visible in `ai_runs`.
3. `budget` defaults to 400 calls per sync run and is a setting, not a constant in the code; a
   full-catalog backfill is `npm run arena:draft --review --budget 0` (unlimited) run by hand,
   never by the sync. `--no-review` exists for both.
4. The sync's summary line gains: `n cards new · n text changed · n drafted · n reviewed by Claude ·
   n still open`. That last number goes to the worklist header as "open since last sync".

Rows Claude drafted this way count as *readable* for the coverage numbers but are listed under a
"Claude drafted — unconfirmed" chip in the worklist so they can be reviewed in one sitting.

### 3.8 Cleanup ledger — what leaves the codebase, and the rules for the diff

This brief is also a slimming pass. The rule for the whole session: **`src/lib/arena` ends with
fewer lines than it started, and every line that stays has one owner.** Claude Code keeps a
running list in the PR description of what was removed and why; the list below is the minimum.

Remove:

- `src/lib/arena/rules.ts` — `previewRule`, `rulesForDecks`, `removeRule`, `RulePreview`,
  `RuleRow`; replaced by the worklist query and the row store.
- `src/app/arena/rules/RuleEditor` (the text editor) and the actions `checkRule`,
  `saveEmptyRule`, `clearRule`.
- `src/lib/arena/scripts.ts` → renamed and reduced to `rules-store.ts` (`loadRules`, `saveRule`,
  `confirmRule`, `blankRule`, `setCompilerDiff`). No other module writes `card_rules`.
- `compileCardCached` and the memo map from the game path (`load.ts`, `engine.ts`,
  `EngineContext.scripts` building). It survives only in `draft.ts` and in the test helper
  `rulesFromCompiler`.
- `OP_NAMES` and every hand-written per-op list that `OP_SCHEMA` now covers, including the
  operation list in `EFFECT_LANGUAGE` and the `switch` in `describeScript` (replaced by the
  template renderer). The interpreter `switch` in `stepScript` stays — it is the one place with
  behaviour.
- The `cannotAttack` alias after the migration has rewritten every row (assert in the migration
  script that none remain, then delete the alias in the same PR).
- `card_scripts` table, its Drizzle definition and migration.
- `MECHANISMS` duplicated between `scripts/arena-gaps.mts` and any page — one copy in
  `src/lib/arena/gaps.ts`.
- `scripts/arena-gaps.mts` reporting logic that recomputes coverage by compiling: it now reads
  `card_rules` and only keeps the per-mechanism grouping.
- Dead exports: run `npx ts-prune` (or `knip`) on `src/lib/arena` at the end and delete what it
  reports, unless a test imports it.

Structure, so the next person can find things:

```
src/lib/arena/
  engine/        pure rules: types, state, engine, triggers, script (+ OP_SCHEMA), filters, cards
  compile.ts     the drafter's parser — text in, {ops, unread, trace} out; imports engine/ only
  draft.ts       draftCards / reviewOpenRules — the only module that calls compile.ts in production
  rules-store.ts card_rules reads and writes; the only module that touches the table
  gaps.ts        MECHANISMS and the grouping used by the worklist and the CLI
  probe.ts       (phase 3)
  ai/            opponent, referee, clarify, review — unchanged shape, EFFECT_LANGUAGE generated
  load.ts        decks and defs for a game; rules come from rules-store
scripts/         thin CLIs only: arena-draft, arena-gaps, arena-feedback, arena-fuzz, verify-arena
```

Rules for the diff:

- No new abstraction without a deleted one in the same commit. A helper introduced "for later"
  is out of scope.
- Comments cite the manual section or say *why*; comments that describe *what* the next line does
  are removed when touched.
- Every commit message names the numbers: rows drafted, tests, lines in/out for `src/lib/arena`.
- Commits are small and in this order: schema + store → OP_SCHEMA consumers → drafter + migration
  → engine reads rows → workbench → sync hook → cleanup ledger → docs. The cleanup commit is
  where `ts-prune` runs.

### 3.9 Definition of done — phase 1

- `npm run arena:draft` fills `card_rules` for the whole catalog; counts match `arena:gaps`
  within ±1 % (differences are keyword-only skills; print them).
- A game loads rules from rows only; a hot-seat game with no API key runs the fuzzer's 100 games
  with 0 crashes on the row-backed context.
- The workbench shows every open and draft skill of the owner's decks; confirming, correcting by
  hand, JSON round-trip, "does nothing" and "explain to Claude" all write rows and the next game
  uses them.
- `OP_SCHEMA` is the only definition of op fields; `validateProgram`, `describeScript`,
  `EFFECT_LANGUAGE` and the editor read it. Adding a fake op in a test requires touching exactly
  the interpreter switch and the schema.
- A sync of one set (`--set BT18` against the import) drafts every new skill, sends the unread
  ones to Claude within the budget, and the worklist shows them under "Claude drafted".
- `src/lib/arena` has fewer lines than on `main`; the PR description lists what was removed
  (§3.8) and `ts-prune` reports nothing under `src/lib/arena`.
- `npm test`, `lint`, `typecheck` clean. `docs/arena-history-lessons.md` gains a dated
  history entry with the numbers.

## 4. Phase 2 — the catalog and the patterns *(built, PR #57)*

- "All cards" tab: the same worklist over the full catalog, filter by set and mechanism, bulk
  **Confirm all drafts in view** with a count and an undo (sets them back to draft).
- "Patterns" tab: rows grouped by `pattern` (drafts) and by unread-clause shape (open), each with
  count, five examples, the current brief if any, and **Confirm the pattern** which confirms every
  draft in the group. This is where 7,759 phrasing-only clauses get worked down, and it is the page
  that replaces `/arena/backlog`. Fold `card_text_notes` into it.
- Chip reordering, and nested `if`/`chooseMode`/`delay` editing (phase 1 shows them read-only
  inside the chip and allows editing via JSON).

**What it took that this list did not say.** Open rules had to be grouped by *mechanism* first —
by clause shape alone they are 1,654 groups for 2,183 rows. The 1,136 drafts with no pattern key
(1,089 of them keyword lines the engine plays without a program) needed keys of their own before
the page could show them at all. Editing conditions as chips needed `COND_SCHEMA`, the same table
`OP_SCHEMA` is for operations — without it the IF row and every nested `if` stay JSON-only. And a
bulk confirm needed somewhere durable to keep what it moved (`arena_feedback.batch`), or Undo can
only guess.

## 5. Phase 3 — the probe *(built, PR #58)*

- `src/lib/arena/probe.ts`: `probe(rule, scenario) → { log, prompts, result }`. Scenarios are
  built per trigger kind from a small table: `play` (card in hand, 6 energy, opponent has two
  Battle Cards, one with [Barrier]), `combo` (mid-battle, leader colours from the card), `attack`,
  `activateMain`, `permanent` (opponent activates a KO skill at it), each with two or three edge
  variants (no legal target, skills negated, opponent's turn). Use `createGame` with two minimal
  decks and `apply` the scripted actions; the engine is pure, so this needs no database.
- The right pane runs it on demand and prints the event log grouped as Input / Applied rule /
  Result / Assumptions (the last from `note` ops and the compiler's known approximations, which
  `compile.ts` should start emitting as `note` ops rather than comments).
- Confirming a rule records the last probe result on the row, so a later engine change can re-run
  every confirmed probe (`npm run arena:reprobe`) and list the ones whose result changed — the
  regression suite the rules never had.

## 6. Risks

- **13,000 rows is fine; 13,000 drafts nobody confirms is not.** The worklist defaults to the
  owner's decks and the Patterns tab exists so confirmation happens in groups. Coverage numbers must
  count `draft` as readable (it plays) and `confirmed` separately, or the numbers will look worse
  than today for no reason.
- **The block editor can grow without bound.** Phase 1 edits only flat fields and the `selector`
  form; nested programs are edited as JSON. Ship that, then decide from use whether the nested
  editor is worth it.
- **Persisting referee rulings could persist wrong rulings.** They land as drafts, not as
  confirmed, and the log says a ruling was used; a bug report from the board already carries the
  card id, so the row is one click away.
- **`compile.ts` improvements no longer reach the engine by themselves.** That is deliberate;
  `arena:draft` after each compiler change, and the `compilerDiff` strip, is the price of having
  rules a person has actually looked at.
