# Arena backlog — tracking the rebuilt compiler against the design

Rewritten 9 Sep 2026. This document says **what the finished design is**, in stages, and how every
piece of remaining work is filed so progress against it can be read off GitHub. The issue bodies
themselves live in `docs/arena-backlog/*.md` (one file per issue, front matter + body, see
`docs/arena-backlog/_README.md`); `scripts/import-arena-backlog.ps1` creates or updates the
milestones, labels and issues from them.

## 1. The design being tracked

The arena is being converted to a **configuration-based rules engine** driven by one rules
language (owner's decisions of 9 Sep 2026; `docs/arena-rules-language.md`, the archived Stage 0+ entries
in `docs/arena-history-lessons.md`, the living handover in
`docs/arena-next-session-prompt.md`). The aim, in the owner's words: **fix each card by setting the
right DSL statement**. Four decisions shape every issue:

1. **One language, three uses** — a card's rule (`card_rules`), a game's definition
   (`src/lib/arena/rulesets/dbs/*.rules`), the referee's answers. One grammar, parser, printer and
   validator in `src/lib/arena/lang/`, table-driven from `OP_SCHEMA`/`COND_SCHEMA`; the round-trip
   promise `parse(print(x)) = x` is what makes a text view of a record safe.
2. **Rules are configuration, algorithms are the interpreter.** Zones, attributes, phases, actions,
   costs, keywords, triggers and win conditions are declared; the flow runner, event log, prompt
   mechanics, selectors, effect layering, payment search and RNG are code. A new mechanism is one
   primitive (interpreter case + schema row) and then every game has it; keywords are macros over
   fixed hook points. Per-game TypeScript modules were rejected explicitly.
3. **Beside, not in place.** `src/lib/arena/engine/` is frozen (bug fixes only). The new engine is
   `src/lib/arena/vm/` behind the shared `Engine` interface; `arena_games.engine` is `legacy | rules`,
   chosen per game, default `legacy` until the owner flips it. The legacy engine is the **oracle**:
   same seed + same actions must give the same events (`npm run arena:diff`).
4. **Shared `card_rules`, two vocabularies.** A row edited with a new primitive is valid for the
   rules engine; the legacy engine treats an op it does not know as unread and hands it to the
   referee, so no card gets worse.

The programme runs in stages, each with a recommended model and an exit criterion, and each stage
is a GitHub milestone with a tracking issue whose task list is the stage's progress:

| Stage | Milestone | Exit | Model | State (9 Sep 2026) |
|---|---|---|---|---|
| 0 | — | engine selector, safety net, DB-free tally | Sonnet 5 | **done**, PR #62 |
| 1 | — | the language over today's schema, workbench text view, editable WHEN/COST, engine honours the row's trigger | Opus 5 | **done** |
| 2 | Arena M1 — Rules correctness and parser coverage | every gap-table primitive built or explained as a macro; no known wrong reading unlisted | Opus 5 | in progress, 5 increments merged |
| 3 | Arena M6 — Definitions in the language | `DEFINE` grammar; DBS written as declarations; completeness proven against the legacy unions | Opus 5 | not started |
| 4 | Arena M7 — Rules engine core | `vm/` plays turn to turn with pass/concede; renders on the board | Opus 5 | not started |
| 5 | Arena M8 — Rules engine actions and costs | `arena:diff` green on staged games; engine selectable | Opus 5 | not started |
| 6 | Arena M9 — Rules engine battle | battle suites green on both engines | Opus 5 | not started |
| 7 | Arena M10 — Keywords as macros | all 39 keyword bodies written; keyword suite green on both | Opus 5 | not started |
| 8 | Arena M11 — Everything else from config | words, prompts, primer, probes, AI and the game page from the definition | Sonnet 5 | not started |
| 9 | Arena M12 — Parity and the flip | every saved game replays identically; default engine → rules | Opus 5 review | not started |
| 10 | Arena M13 — Retire the legacy engine | `engine/` gone; old games handled per the owner's ruling | Sonnet 5 | not started |
| docs | Arena M14 — Rules language and ruleset documentation | the language doc complete; `docs/arena-ruleset-spec.md` written; in-app reference; the owner's guide | Sonnet 5 / Opus 5 | partly (language doc §1–§8 exist) |

The UI, Android and capability-gap work that predates the programme keeps its milestones
(M2–M5). It is not on the compiler's critical path, but two of its items are precondition
for compiler work (`move()` replacement prompting, #107) or are engine bugs (#108).

## 2. Milestones

| Milestone | Source |
|---|---|
| Arena M1 — Rules correctness and parser coverage | Stage 2: `docs/arena-next-session-prompt.md`, `docs/arena-side-scope.md`, the archive's Stage 2 entries |
| Arena M2 — Gameplay UX/HUD completion | `docs/arena-hud-spec.md`, `docs/arena-workflow-spec.md` |
| Arena M3 — Battle staging and inspector | `docs/arena-battle-staging-spec.md` — **largely built**; its three issues are verify-and-close |
| Arena M4 — Android client enablement | `docs/arena-android-spec.md`, `docs/arena-client-contract.md` |
| Arena M5 — Engine capability gaps and advanced mechanics | `docs/arena-move-replacement-scope.md`, `docs/arena-markers-stage-scope.md` |
| Arena M6 — Definitions in the language (Stage 3) | plan Stage 3 |
| Arena M7 — Rules engine core (Stage 4) | plan Stage 4 |
| Arena M8 — Rules engine actions and costs (Stage 5) | plan Stage 5 |
| Arena M9 — Rules engine battle (Stage 6) | plan Stage 6 |
| Arena M10 — Keywords as macros (Stage 7) | plan Stage 7 |
| Arena M11 — Everything else from config (Stage 8) | plan Stage 8 |
| Arena M12 — Parity and the flip (Stage 9) | plan Stage 9 |
| Arena M13 — Retire the legacy engine (Stage 10) | plan Stage 10 |
| Arena M14 — Rules language and ruleset documentation | plan "Docs" |

## 3. Labels

**Area** — `area:arena-compiler` (the drafter, `compile.ts`/`filters.ts`), `area:arena-engine`
(the legacy engine), `area:arena-vm` (the rules engine), `area:arena-lang` (`src/lib/arena/lang/`),
`area:arena-rulesets` (`rulesets/*.rules` and the loader), `area:arena-workbench`, `area:arena-ui`,
`area:arena-contract`, `area:arena-android`, `area:arena-docs`.

**Phase** — `phase:rules-stage2` … `phase:rules-stage10`, `phase:rules-docs`, and the older
`phase:hud-workflow`, `phase:battle-staging`, `phase:android-client`, `phase:capability-gap`.

**Workflow** — `backlog`, `ready-for-agent`, `needs-owner-ruling`, `blocked`, `epic` (a stage's
tracking issue).

**Model** — `model:opus-5`, `model:sonnet-5`: the plan's recommendation for who should run the
issue (Opus for grammar, engine and keyword work, where a wrong reading of the manual costs a
subsystem; Sonnet for mechanical ports, UI and documentation). Each stage ends with a
`/code-review` pass on Opus before merge.

## 4. The issue set

One row per file in `docs/arena-backlog/`; the body is the file. Titles are the key the import
script matches on — change a body freely, keep the title.

### Stage 2 — Arena M1 (tracking: `s2-00`)

| File | Title | Kind |
|---|---|---|
| s2-93 | Arena: run clause near-miss audit and fix wrong readings | audit, repeatable |
| s2-94 | Arena: implement structural side parsing fix in parseTarget | bug |
| s2-95 | Arena: fix OR disjunction handling in parseConditionClause | bug |
| s2-96 | Arena: implement specified-cost reducer mechanics | engine |
| s2-97 | Arena: implement skill-cost reduction family (orbTotals + scope safety) | primitive `costModifier` |
| s2-01 | Arena: fix 'areas other than' inversion and 'non-X and non-Y' filters (BT7-129, BT16-088) | bug |
| s2-02 | Arena: refuse, then read, the pile under another card (23-2) | bug → reading |
| s2-03 | Arena: bind X across cost and effect, and grow amounts into expressions (20-5) | primitive |
| s2-04 | Arena: copySkills primitive (20-18) | primitive |
| s2-05 | Arena: counted and conditional prohibitions — forbid with uses and unless (20-14) | primitive |
| s2-06 | Arena: replace(event) primitive for 'instead' clauses (9-10) | primitive |
| s2-07 | Arena: control and skip primitives (20-9, 20-13) | primitive |
| s2-08 | Arena: payWith — use a card as energy (20-19) | primitive |
| s2-09 | Arena: the immunity family (20-4) | primitive |
| s2-10 | Arena: keyword-timing triggers as data (22-5, 22-10) | triggers |
| s2-11 | Arena: decide primitive or macro for every op — modifyAttr | design table |

### Stages 3–10 — Arena M6–M13 (tracking: `s3-00` … `s10-00`)

Stage 3: `DEFINE` grammar · loader and `Vocabulary` · DBS `game/attributes/zones` · `triggers` ·
`keywords/words/prompts` · `verify/rulesets.ts` · `DEFINE OP` macros and the one word list.
Stage 4: `vm/` skeleton and the `Engine` interface · attributes and zones · flow runner ·
events and triggers · effects and prompts · `--engine` on every script.
Stage 5: `ACTION` declarations and generic legality · charge/endMain/pass/concede · play family ·
activate · `costs.rules` · parity and `available`.
Stage 6: `battle.rules` · combo/damage/life/Z-Energy · battle suites on both engines.
Stage 7: hook contract from the inline-site inventory · four keyword hook groups · keyword suite on both.
Stage 8: words from config · primer/prompts/view · probes from config · AI on the rules engine ·
`/arena/rules/game`.
Stage 9: replay every saved game · reprobe/fuzz/suites on both · flip the default.
Stage 10: retire `engine/` · saved legacy games (**needs owner ruling**).

### Documentation — Arena M14 (tracking: `docs-00`)

Expression grammar and Stage 2 primitives in the language doc · one example per §20 fixed phrase ·
the `DEFINE` grammar section · `docs/arena-ruleset-spec.md` · a generated reference page at
`/arena/rules/language` · the owner's guide to fixing a card · amendments to the workbench spec,
`CLAUDE.md`, the client contract and `docs/arena-tooling.md`.

### UI, Android and capability gaps — Arena M2–M5 (existing issues #98–#110, bodies rewritten)

Review of 9 Sep 2026: **#101, #102, #103 (battle staging) and #108 (the [Empower] carry prompt)
appear to be built already** — `DuelBand.tsx`, `Takeover.tsx`, `BattleParts.tsx`, `staging.ts`,
`view.battle.counters/contributions`, the `skill` beat's `inBattle` and an `empowerCarry` prompt
kind are all in the tree. Their bodies now say *verify and close*. #106 and #110 are `blocked`
(on #105, and on a card that prints the two-colour form).

## 5. Rule for future work (mandatory)

Arena work is not left as chat-only notes. For every new bug, feature or ruling follow-up:

1. Add a file to `docs/arena-backlog/` (or open the issue with the `Arena backlog item` template
   and add the file afterwards — the file is the reviewed copy).
2. Link the exact source of truth: a `docs/...` section, a rule-manual section, a replay id,
   card ids.
3. At least one `area:*` label, one `phase:*` label, one milestone, and a `model:*` label.
4. Acceptance checks as commands plus one scenario proof; the gate for compiler and engine work
   is `typecheck`, `lint`, `test`, `build`, `arena-fuzz 40`, `contract:emit` reviewed, and for a
   compiler change the gap-set and readings diffs signed off by card.
5. `ready-for-agent` only when an agent that has read `CLAUDE.md` could start without asking.
   Otherwise `needs-owner-ruling` or `blocked`, naming the missing decision.
6. A ruling given in chat is stored with `npm run arena:rule` first, then filed.

## 6. Import script

```powershell
pwsh -File scripts/import-arena-backlog.ps1                         # create what is missing
pwsh -File scripts/import-arena-backlog.ps1 -DryRun                 # say what would happen
pwsh -File scripts/import-arena-backlog.ps1 -UpdateExisting         # also rewrite existing bodies, labels, milestones
pwsh -File scripts/import-arena-backlog.ps1 -Repo owner/name        # another repository
```

Needs the GitHub CLI (`gh`) and an authenticated session (`gh auth login`). Windows PowerShell 5.1
works (`powershell -File …`). The script is idempotent: it matches issues by exact title, creates
milestones and labels only when absent, and rebuilds every tracking issue's task list from the
current issue numbers on each run.
