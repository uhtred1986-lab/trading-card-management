# Arena ruleset spec — the interpreter contract and the definition files

Written 12 Sep 2026 (issue #114). This is the document that says **what the rules engine is**:
which part of the arena is a declaration a person can edit, which part is an algorithm only code
can carry, and what has to be true before either is believed.

It is the companion to `docs/arena-rules-language.md`, which specifies the *grammar* the
declarations are written in. That doc says how a rule is spelled; this one says what a rule is
allowed to mean, where the meanings live, and how a new one is added.

Two sections here (§3, §4) are deliberately headings with a single line under them: they are
filled by the stage issues that produce their content, and checked back against this document when
they land. The rest are written: §1, §5, §6 and §7 since 12 Sep 2026 (#114), and §2 — the
primitive-or-macro decision for every row of the effect language — with #130.

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

Written 12 Sep 2026 (issue #130). Stage 4's engine interprets **primitives**; Stage 3 re-declares
everything else as a `DEFINE OP` macro over them (#137). This section is the decision, one row per
row of `OP_SCHEMA` and `COND_SCHEMA` — so that a mechanism is added once, and a spelling of an
existing mechanism is never added as a case in an interpreter again.

### 2.1 What a primitive is, and what marking a row *macro* does not do

The rule, from the plan: a primitive **says something no combination of the others can**. Anything
else is a macro. Four things follow, and they are the reason the tables below are worth having.

- **A macro is not a deletion.** Every op keeps its name, its `OP_SCHEMA` row, its printed form and
  its stored programs; `parse(print(x)) = x` holds over the macro's *name*, not its expansion
  (#137). `power`, `comboPower` and `gains` are this issue's worked example: `modifyAttr` is added beside
  them, they keep parsing, printing and playing exactly as before, and no card's reading moves.
- **A macro's target may not exist yet.** The table names the primitive as it will be, with today's
  spelling beside it in §2.2. `move` is `moveTo` today; `costModifier`, `negate` and `replace` are
  the general forms of rows the engine already has; `control`, `skip` and `copySkills` are Stage 2
  issues (#126, #123) that will arrive as primitives.
- **Layering and duration are not ops.** The plan's `effect(layer)` row is the interpreter's
  bookkeeping — what `until` means, which effect wins, when it expires (§1, §7). Every op that
  carries a duration uses it; none of them *is* it.
- **A primitive may still be split into readable cases.** The classification says what the language
  needs, not how many `case` labels an interpreter is allowed. What it forbids is the opposite: a
  new *row* for something an existing primitive already says.

### 2.2 The primitive vocabulary

Nineteen primitives carry every row below — fourteen operations and five conditions.

| Primitive | Today | What it says |
|---|---|---|
| `move` | `moveTo` | A card changes area, with a cause. Prohibitions, replacements, and the moments of leaving and arriving hang off this one op. |
| `modifyAttr` | `modifyAttr` | One attribute of one subject, by a delta or by a value, for a duration or for as long as the rule holds. |
| `costModifier` | `costReduction` | What something costs to play, activate or evolve — a whole price, not a number (§2.5). |
| `negate` | `negateSkills` | A rule stops applying: a card's skills, one kind of them, one named keyword, or the skill resolving now. |
| `replace` | `replaceLeave` | An event that is about to happen happens differently, or not at all (9-10, #125). |
| `choose` | `choose` | A player picks cards from a selector; the cards are bound to a name the rest of the program reads. |
| `reveal` | `reveal` | Who has seen a card changes, without the card moving. |
| `shuffle` | `shuffle` | A pile is randomised with the game's seeded RNG. |
| `token` | `token` | A card that was in no deck comes into being. |
| `play` | `play` | The game's own play action is invoked for a card (5-5). |
| `forbid` | `forbid` | A standing rule that an action may not happen, with a budget and an escape (20-14). |
| `permit` | `permit` | A rule of the game is lifted for one card (8-1-1). |
| `immune` | `immune` | A card no skill may touch (9-1-4). |
| `if` | `if` | A branch taken on a condition. |
| `chooseMode` | `chooseMode` | A branch a player picks (20-2). |
| `delay` | `delay` | A program runs at a later declared moment, with the variables bound now. |
| `note` | `note` | A remark in the log. Not a mechanism, and nothing to lower it to. |
| `count` (condition) | `count` | A bound on how many cards a selector finds — the comparison predicate (§2.6). |
| `did` (condition) | `did` | What an earlier step of *this* resolution did (20-16). |
| `not` (condition) | `not` | Negation. |
| `any` (condition) | `any` | Disjunction: the other half of the propositional core. |
| `isTurnPlayer` (condition) | `isTurnPlayer` | Whose turn it is (7-1). |

Two rows in that list are honest about being provisional. `play` is a primitive only until Stage 3
declares the play action itself (§3): which zone the card ends in, whether its text resolves and
which moments fire are that action's steps, and a `move` cannot say any of them. `permit` is the
same layer as `forbid` with the sign flipped and a vocabulary of its own (`attackActive` is not a
`ForbiddenAction`); merging the two into one `permission` primitive would be a rename, not a change
of mechanism, and Stage 3 may do it.

### 2.3 The operations

One row per key of `OP_SCHEMA` (`src/lib/arena/engine/script-schema.ts`). The same decision is
carried in code as `OP_CLASS` beside the schema, and `scripts/verify/language.ts` fails if the two
disagree or if a row is missing from either.

| Op | Class | Why |
|---|---|---|
| `draw` | macro over `move` | *n* from the top of a deck to its owner's hand. Losing on an empty deck is the game's own win condition (§3), not part of the op. |
| `discard` | macro over `choose` + `move` | Already a macro in code: `stepScript` splices a `choose` the *owner* answers and a move to the Drop or the Warp (20-7), rather than teaching the op to prompt. |
| `damage` | macro over `move` | *n* from the top of a Life Area to its owner's hand with the cause `damage` (5-10, 21-3). The cause is the whole difference from `lifeDownTo`, which moves the same cards and is not damage (1-13-2). |
| `mill` | macro over `move` | Top of deck to the Drop, face up, bound to `as`. Naming what moved is the move's own answer, not a second mechanism. |
| `addLife` | macro over `move` | Top of deck to the Life Area. |
| `lifeDownTo` | macro over `move` | "Until you have *n* life" is `count(you.life) − n` cards from life to hand: a move with a computed amount, so it needs the arithmetic §2.6 does not have yet (#122). |
| `shuffle` | primitive | An order nobody chose. No sequence of moves reproduces it, and the RNG is the interpreter's (§7). |
| `energyMarker` | macro over `modifyAttr` | A counter on the **player**, not on a card — the first of the three widenings §2.5 asks for. |
| `choose` | primitive | The only op that binds cards a player picked to a name; every "the chosen cards" downstream reads that binding. |
| `look` | macro over `reveal` | The same act with a narrower audience (20-11): the cards stay where they are and are bound to a name. "The top *n*" is the selector's `TOP n`, "your opponent's hand" its area. |
| `reveal` | primitive | Changes who has seen a card without moving it (20-11-2). Visibility does not follow from position. |
| `ko` | macro over `move` | To the owner's Drop with the cause `ko`. [Indestructible], "can't be KO'd by skills" and the replacement offers belong to `move` — they apply to any departure — so the macro is a destination and a cause. |
| `moveTo` | primitive | This **is** `move`. |
| `play` | primitive | The play action, not a destination (5-5); see §2.2 for why this row is provisional. |
| `switchMode` | macro over `modifyAttr` | Active or Rest is an attribute of the card; "switched to Rest Mode by one of your skills" (1-10) is a trigger on the change and its cause. |
| `modifyAttr` | primitive | One attribute of one card, by a delta (`amount`) or by the values it also counts as (`values`), for a duration or — printed as a [Permanent] — for as long as the rule holds. The row the three below lower to, and the reason they are one mechanism rather than three. |
| `power` | macro over `modifyAttr` | Attribute `power`, by a delta, for a duration. |
| `comboPower` | macro over `modifyAttr` | Attribute `comboPower`. The only difference from the row above is which attribute — which is the argument this table exists to make. |
| `grant` | macro over `modifyAttr` | Attribute `keywords`: the card gains a keyword skill for a duration. What the keyword then does is the hook contract (§4). |
| `negateSkills` | macro over `negate` | Scope: every skill of a card (9-1-5). |
| `negateSkillsOfKind` | macro over `negate` | Scope: one printed skill kind of a card. |
| `negateKeyword` | macro over `negate` | Scope: one named keyword, in every area. |
| `negateOwnSkill` | macro over `negate` | Scope: the skill resolving now, for the turn, the battle or the game. |
| `hidden` | macro over `modifyAttr` | Attribute `hidden`: Hidden Mode and Revealed Mode (23-5). |
| `redirectAttack` | macro over `modifyAttr` | The guard is an attribute of the **battle in progress** (8-1, 22-4-2) — the second widening in §2.5. |
| `comboFrom` | macro over `move` + `negate` | Into the Combo Area with the cause `combo` (5-7), optionally with the card's skills negated. |
| `flip` | macro over `modifyAttr` | Attribute `flipped`: which face of a Leader is in play (22-2-4). |
| `faceUp` | macro over `modifyAttr` | Attribute `faceUp` on a card in a Life Area (3-9-2-1). |
| `addMarker` | macro over `modifyAttr` | Attribute `markers`, by +*n*. The plan's sketch kept `marker` as a primitive of its own; a marker count is a number on a card and behaves like one, so it is not. |
| `removeMarker` | macro over `modifyAttr` | Attribute `markers`, by −*n*; "when a marker is removed" is a trigger on the change. |
| `token` | primitive | Nothing that moves cards can make one (19). |
| `costReduction` | macro over `costModifier` | Which cost (energy, skill, evolve, combo, Z-Energy, specified) is an argument, not six mechanisms — that was #96 and #97's finding before it was this table's. |
| `gains` | macro over `modifyAttr` | Attributes `colors`, `characters`, `traits` and `names`, in every area (20-1). |
| `replaceLeave` | macro over `replace` | Event: a card leaving the Battle Area (9-10). |
| `altCost` | macro over `costModifier` | A price is replaced, not reduced — which is why the primitive takes a price rather than a number (§2.5). |
| `resolvingPlay` | macro over `replace` | Event: the play being resolved, negated or altered (9-6). |
| `negateAttack` | macro over `replace` | Event: the attack in progress resolves to nothing. |
| `negateCounter` | macro over `replace` | Event: the [Counter] this one is answering resolves to nothing (9-7). |
| `forbid` | primitive | A prohibition is not an attribute of a card: it is a rule in force, read by whatever would act (20-14). |
| `immune` | primitive | 9-1-4, and the only rule read by the skill trying to act rather than by the actor — stronger than `forbid: beChosen` for exactly that reason. |
| `permit` | primitive | The one rule of the game a card may lift (8-1-1); provisional, per §2.2. |
| `if` | primitive | A branch on a condition. |
| `chooseMode` | primitive | A branch a player picks (20-2). |
| `may` | macro over `chooseMode` | Two options, the second empty (20-16). The answer has to be bound either way, because "if you do" reads it — which is a requirement on the primitive, not a reason for a second one. |
| `delay` | primitive | The one op that moves work to a later moment with the variables bound now (1-7-2-1-1). |
| `note` | primitive | A remark in the log; nothing to lower it to. |

### 2.4 The conditions

One row per key of `COND_SCHEMA`, carried in code as `COND_CLASS` and checked the same way. The
theme is one sentence long: **most conditions are `count` with the right selector**, once a filter
can name the attributes the engine keeps in code (§2.5).

| Condition | Class | Why |
|---|---|---|
| `count` | primitive | A bound on how many cards a selector finds. §2.6 widens it to a bound on an *expression*, which is what the rest of this table lowers to. |
| `life` | macro over `count` | The cards in a side's Life Area, counted. |
| `lifeVsOpponent` | macro over `count` | Two counts against each other — the one shape §2.6 cannot write yet (#122). |
| `leaderColor` | macro over `count` | `count(1 <colour> card IN you.leader) >= 1`. |
| `leaderMatches` | macro over `count` | The same with a whole filter. `back: true` asks about the Leader's back face, which no selector can name yet (§2.5). |
| `markers` | macro over `count` | `markers(SELECTOR)` is already an expression (§2.6); this row is a bound on it. |
| `inBattle` | macro over `count` | "Attacking", "being attacked" and "in a battle" are roles of the battle in progress; as filter fields they are a count of the cards in the role. |
| `battled` | macro over `count` | "Has been in a battle this turn" is a flag the engine keeps on the card; as a filter field it counts. |
| `every` | macro over `count` + `not` | Every card the first selector finds is also one the second finds: a bound of zero on the difference, plus the bound that makes the empty case false (0-2-4-1) rather than vacuously true. |
| `any` | primitive | Disjunction. A clause list is already a conjunction; nothing else says "or". |
| `all` | macro over `any` + `not` | De Morgan. The interpreter may keep the case for legibility; the language does not need it. |
| `leaderFlipped` | macro over `count` | "Has awakened" is the `flipped` attribute of a Leader (§2.5). |
| `power` | macro over `count` | Filters already carry `powerMin` and `powerMax`, so this is a count of the cards the filter finds. |
| `did` | primitive | The resolution's own record (20-16). No amount of counting the board says whether *this skill* drew a card. |
| `not` | primitive | Negation. |
| `chose` | macro over `count` | How many cards were bound to the named variable: a count over `FROM $var`. |
| `varMatches` | macro over `count` | `count(FROM $var matching the filter) >= 1`. |
| `isTurnPlayer` | primitive | A fact about the game rather than about any card or pile (7-1). Stage 3 declares the turn player as a game attribute, which will make this a comparison like the rest. |

### 2.5 What the tables ask for

Five requirements fall out of the classification. They are what Stage 3 and Stage 4 have to build
for the macros above to be writable; none of them is built by #130, which delivered the table and
`modifyAttr` alone.

1. **`modifyAttr` must reach three kinds of subject** — a card (`power`, `gains`, `markers`, `mode`,
   `hidden`, `faceUp`, `flipped`, `keywords`), a **player** (`energyMarker`) and the **battle in
   progress** (`redirectAttack`). Today's row takes a card `Ref`. The widening belongs with
   `attributes.rules` (#133), which is where each subject's attributes get declared.
2. **`move` must carry a cause.** `damage`, `ko`, `combo`, `effect` and a plain draw are the same
   move with different causes, and the triggers tell them apart by it — the legacy `move()` already
   takes one, so this is a schema field, not a mechanism.
3. **Filters must name the attributes the engine keeps in code.** `flipped`, `markers`, the
   battle's roles and "battled this turn" are what five condition rows lower to. Selectors already
   carry `mode` and `hidden`; filters already carry power, cost, `faceUp`, keywords and type.
4. **A price is not a number.** `costModifier` takes orbs, a life payment or a whole program
   (`altCost`), and the specified cost never touches a total at all (owner's ruling on BT19-039,
   9 Sep 2026). That is why costs are not folded into `modifyAttr` even though a cost is an
   attribute of a card: the value is structured, and `playCost`'s payment search reads it.
5. **Amounts must become expressions** (#122): subtraction for `lifeDownTo`, a comparison of two
   expressions for `lifeVsOpponent` and `every`, and X for the cards that bind one.

Half 1 of #137 (12 Sep 2026) found a sixth, and it is the one that binds first: **a macro's body
can only name a parameter where the grammar lets a `$name` stand**, which is an `amount` or a `ref`
and nothing else (`lang/parse.ts`). `power`'s `until` is a `duration`, every `side` is a `side`, and
`may`'s body is an `ops` — so no row above is writable yet, whatever its primitive does.
`src/lib/arena/rulesets/dbs/ops.rules` carries that table row by row, and the expander
(`rulesets/expand.ts`) is built and tested against fixtures in the meantime.

### 2.6 The expression language

An operation's fields are not all constants: four shapes carry a computation, and they are the
expression language the table above leans on.

- **`Amount`** — a number, `$var`, `count(SELECTOR)` or `markers(SELECTOR)` (each optionally
  `* n`), `sumPower($var)`, `handUpTo(n)`. This is `EXPR_SCHEMA` in `src/lib/arena/lang/ast.ts`,
  and it is the whole arithmetic the language has: there is no addition, no subtraction and no
  comparison of two expressions. #122 is where those arrive, with X.
- **`Ref`** — what an op acts on: a selector, or `$var` (optionally `MINUS $var`, the one set
  operation the language has).
- **`Selector`** — which cards, where, whose, how many, in which mode: the fields of
  `SELECTOR_FIELDS`, evaluated by the interpreter (§7), never by a card.
- **`CardFilter`** — what a card *is*: colours, characters, traits, names, keywords, type, cost and
  power bounds (`FILTER_FIELDS`). Requirement 3 above is a list of what it cannot say yet.

A condition is the predicate half of the same language: `count` bounds an expression, and §2.4 is
the argument that the other seventeen rows are that one row with the right selector, the right
filter or the right boolean around it.

---

## 3. The definition files

A game is a **directory of `.rules` files**, one per concern, read by
`src/lib/arena/rulesets/load.ts`. The grammar is `docs/arena-rules-language.md` §3b; this section
says what the files are, what the loader does with them, and what it refuses.

The loader landed 12 Sep 2026 (#132), and four of the files the same day: `game.rules`,
`attributes.rules` and `zones.rules` (#133), then `triggers.rules` (#134). The rest are #135 and
the stage issues below, so `src/lib/arena/rulesets/dbs/` holds five of the eleven rows — `ops.rules`
is there with its header and no declaration yet (#137) — every refusal is still checked against
fixtures, and what the real files claim is checked against them directly
(`scripts/verify/rulesets.ts`). The trigger declarations name nine of the zones — `battle`,
`combo`, `drop`, `energy`, `hand`, `leader`, `life`, `unison`, `zEnergy` — and the loader resolves
every one of them against `zones.rules`, which is what makes the DBS set load rather than merely
parse.

### The files

Every row is one file of `src/lib/arena/rulesets/dbs/`. "Declares" is the `DEFINE` kinds it holds;
the manual sections are the ones the file encodes, cited line by line as `--` comments in the file
itself.

| File | Declares | Manual | Written by |
|---|---|---|---|
| `game.rules` | `GAME` (deck sizes, opening hand, life, mulligan, turn order), six `PHASE`s and the 26 `STEP`s of the turn, `WIN` for life-out and deck-out | §0-1-3, §6, §7 | #133 ✔ |
| `attributes.rules` | `ATTRIBUTE` — every `CardDef` field (id, name, type, colours, energy cost, specified-cost orbs, Z-Energy cost, power, combo cost and power, characters, traits, skill, back, also-names), the three derived costs with their layer order, and the player's energy markers | §1-2, §1-9, §1-14, §2, §9-9-1, §20-21 | #133 ✔ |
| `zones.rules` | `ZONE` — the manual's twelve areas plus `removed`, `under` and `play`: owner, visibility, order, single, markers, modes, host, and what "in play" means | §3, §9-1-3-1, §20-10, §23-2 | #133 ✔ |
| `ops.rules` | `OP` — one macro per row §2.3 marks *macro*, over the primitives beside it; `rulesets/expand.ts` lowers a program through them | §2 above | #137 |
| `triggers.rules` | `TRIGGER` — every moment an [Auto] or a [Counter] answers to, as the event pattern that *is* it, with the counter windows (58 declarations: the 53 of the `Trigger` union and the five `counter:*` windows) | §9-6, §4-3, §9-7 | #134 ✔ |
| `keywords.rules` | `KEYWORD` — all 39, their parameters and their meanings; the `HOOK` bodies stay empty until Stage 7 | §22 | #135 |
| `words.rules` | the words the board says for a zone, a colour, a mode, a requirement — **not written yet**: `DEFINE WORDS` is not one of the eleven kinds, and its shape is an open question on #131 | — | #135, after that answer |
| `prompts.rules` | one declaration per `Prompt` kind with the question it asks — **not written yet**, the same open question (it may be a field of `DEFINE ACTION` rather than a kind) | — | #135, after that answer |
| `actions.rules` | `ACTION` — charge, play, activate, endMain, pass, concede: `WHEN / FOR / COST / DO / REFUSE`, the refusal in the order the legacy engine checks it | §6, §7 | Stage 5 |
| `costs.rules` | `COST` — energy with colours and X, markers, life, rest, pay-with, and the unreadable price that refuses | §8-3-2-3, §22-45 | Stage 5 |
| `battle.rules` | the battle sub-flow as `STEP`s and `ACTION`s — declaration, the blocker window, counter windows, combo, comparison, damage | §7, §8 | Stage 6 |

Nothing in the list is a program *about* this game: a file is data, and the moment a game would
need code the primitive is missing (§1).

The manual sections in that table are the ones of `docs/rules/rulemanual.txt` as it actually
numbers them — §2 is the parts of a card, §3 the areas, §6 the setup and §7 the turn. The older
plan text said "setup §5, areas §3, card information §4"; only the middle one was right, and the
files cite the real numbering.

### What #133's three files settled

Three conventions a reader would otherwise have to infer, written on every declaration rather than
left to a missing line:

- **`ordered: true` means the rules fix the order and no player may rearrange it** — the Deck Area
  (3-2-2) and the Life Area (3-9-2), and the cards under a card (23-2-3). Every other area lets its
  owner reorder freely (3-3-2, 3-4-3, 3-8-2, 3-10-2, 3-12-2, 3-13-2), and is written
  `ordered: false` rather than left out.
- **`visibility` is who may read the faces**: `none` for a secret area neither player may check,
  `owner` for one its own player may read (the hand, 3-3-2; the Z-Deck, 3-12-2), `all` for an open
  area (3-1-3).
- **`inPlay` is 9-1-3-1**: the Leader, Battle and Unison Areas, the three a card's own skills are
  valid in. The Combo Area is *not* one, though 3-1-4-1 carries effects into it.

Three zones are declared that the manual's §3 does not count among its twelve areas, because a
program has to be able to name them: `removed` (20-10 — cards removed from the game, which the
manual pointedly says are in no area at all), `under` (23-2, whose *area* is the area of the card
on top, 23-2-2-2) and `play`, which is not a place a card is put but the word for the three in-play
areas together (`cardsInPlay` in `engine/state.ts`). Each says so in its own `text:`.

An attribute's `layers:` is the order of 9-9-1 — `printed` (9-9-1-1), `rewrite` (every continuous
effect that does not rewrite a number, 9-9-1-2), `numeric` (the ones that do, 9-9-1-3) — and a
cost's layers are its own, `printed` then `reduction` then `specified`, because 20-21's reduction
is a discount on the price rather than a rewrite of the printed cost, and the coloured half moves
on its own (the owner's BT19-039 ruling of 9 Sep 2026).

The completeness check over `attributes.rules` is **one-directional**: every `CardDef` field has a
card attribute, and the derived ones beside them (`costOf`, `comboCostOf`, `zEnergyCostOf`) and the
player's `energyMarkers` have no printed counterpart to match. #136's set equality is over the
zones, the phases, the triggers and the keywords, not over the attributes.

Five things the manual says that the grammar could not, left out rather than written wrongly and
recorded in `docs/arena-history-lessons.md` (12 Sep 2026): the deck's 50-**to**-60 range and the
4-copy limit (6-1-3, 6-1-5-1), the energy marker only the second player starts with (6-2-1-11),
conceding and a card that ends the game (0-1-3-4, 0-1-3-5), an attribute's real domain — the card
types, an X cost, the specified cost's orbs per colour (2-1, 1-2-2-2, 1-2-3) — and a card's back
side as a *face* of its own (1-9). The engine also runs the Main Phase End Step as a phase of its
own, where the manual makes it a step of the Main Phase (7-3-5); the declaration follows the
engine and says so.

### What a trigger declaration says

`triggers.rules` is the first file written, and four conventions hold across it. They are the
file's own, not the grammar's — the grammar leaves an event pattern open on purpose — so they are
written down here as well as in the file's header.

| Written | Means |
|---|---|
| `ON <event>(field: value, …)` | the event, and the fields that have to match. Only `from`, `to`, `in`, `area` and `zone` name a `DEFINE ZONE` and are checked; every other argument is a word about the event, so `attackDeclared(target: leader)` is a part in the attack and not a place |
| `watcher: controller \| opponent \| both` | whose cards in play are asked, when the moment is not the answering card's own. `controller` is the side the event is about; left out, only the card the event is about answers |
| `WHERE isTurnPlayer(who: you)` | a condition on the answering **side**, not on the event. "Your Charge Phase" and "your opponent's Charge Phase" are one event and this condition, which is also 7-1's framing — never a duration |
| `BIND "self" \| "subject"` | what the event's card is called inside the program: `self` when the moment happened to the answering card, `subject` when it happened to another card that card is watching |

`text:` is the record's WHEN **in words** — the same sentence `describeTrigger` prints — so #137
can make `TRIGGER_IN_WORDS` a re-export of `vocabulary.words` rather than a second copy that
drifts. `scripts/verify/rulesets.ts` asserts both halves: set-equality between `TRIGGERS` and the
declared names (reported by name in both directions, so a miss says *which*), and that every
declaration's `text:` is the words the record already uses.

The counter windows are declared as `TRIGGER`s with quoted names — `"counter:play"`,
`"counter:attack"`, `"counter:battleCardAttack"`, `"counter:counter"`, `"counter:skill"` — because
a [Counter] answers to a *window* (4-3, 9-7) rather than to a card's own moment. They are the only
names in the file a record's WHEN never says, which is why the test's expected set is the union of
`TRIGGERS` and those five and not `TRIGGERS` alone.

Writing the 53 out found three things the legacy names hide: one name pended from several moments
(`dealtDamage`, `played`, `markerRemoved`, `attacked`), several names pended from one
(`removedFromBattle`/`removedByOpponent`, the four turn-phase pairs, `evolvedInto`/
`evolveFromHandActivated`), and two names with no call site at all (`energyToDrop`, `damageStart`).
Each is listed with its manual section in `docs/arena-history-lessons.md`, "What 53 trigger names
turned out to be". **None of it changed the legacy engine**: the file is data, and Stage 4's
event-pattern matcher is where a difference would become behaviour.

### What the loader does

`loadRuleset(files, id)` takes a map of **file name → text** and returns
`{ ok: true, definition, vocabulary }` or `{ ok: false, errors }`. It is pure, synchronous and
client-safe — the workbench's rules page imports it into the browser — so it never reads a file
itself. The text reaches it as a generated constant: `scripts/arena-rulesets-emit.mts` writes
`rulesets/<game>/files.ts` from the `.rules` files beside it (`npm run arena:rulesets`, and
`--check` to prove it is not stale). That was chosen over a webpack/turbopack `?raw` import rule,
which every one of the three places that load a ruleset — app server, browser, scripts — would have
had to agree about.

Three things happen between the parse and the definition:

1. **Filing.** Each declaration goes under its kind, keyed by its declared name — a `GameDefinition`
   is `{ id, game, attributes, zones, phases, steps, actions, triggers, keywords, costs, wins, ops }`
   plus `definitions` (everything in read order, so a whole ruleset round-trips through
   `printDefinitions`) and `sources` (which file each came from).
2. **Defaults.** The schema's `default` is applied here, because the printer drops none: a field
   left out of the text is `undefined`, and a printer that dropped a value equal to its default
   could not bring it back.
3. **Resolution.** Every name that points at another declaration is checked (below).

### What the loader refuses

The parser refuses what it cannot *read* (§5 of the language doc). The loader refuses what needs a
second declaration to check, in the same `LangError` shape plus the file it is in, and pointed at
the line and column of the offending word:

| Refusal | Example |
|---|---|
| A name declared twice for one kind | two `DEFINE ZONE battle`, in one file or in two — the error names the file the first is in |
| A `GAME` naming a phase nothing declares | `phases: [charge, main, end]` with no `DEFINE PHASE end` |
| A `PHASE` naming an unknown step or action | `steps: [mainStart]`, `actions: [playCard]` |
| A `STEP` naming an unknown phase | `phase: "main"` |
| An `ACTION` naming an unknown phase or price | `WHEN [main]`, `COST [energy]` |
| A `TRIGGER` naming an unknown zone | `ON moved(from: hand, to: battle)` — the pattern arguments `from`, `to`, `in`, `area`, `zone` are places; the rest of an event pattern is open, as the grammar leaves it |
| **Any** program or selector naming an unknown zone | `moveTo(target: $chosen, to: warp)`, nested however deep. The check reads `OP_SCHEMA`/`COND_SCHEMA` rows rather than a list of places, so an op that grows an area field is checked the day its row says so |
| A `KEYWORD` hanging a body on an unknown hook point | `HOOK whenTheMoodTakesIt {}` — the points are the interpreter's (§4), not the game's |

Every error says **both ends**: the declaration it is in and the name that does not resolve.
`scripts/verify/rulesets.ts` holds one fixture per refusal; #136 grows it into the completeness
suite that proves the definition covers every legacy union.

### The vocabulary

`vocabularyOf(definition)` is the second half of the loader's job: the closed word lists the
language is checked against, taken from the declarations instead of from hand-written constants —
`areas` from the zones, `keywordNames` from the keywords, `triggers` from the triggers, `words` from
every declaration's `text:`. The names are the ones `engine/script-schema.ts` and `gaps.ts` use
today (`AREAS`, `KEYWORD_NAMES`, `TRIGGERS`, …) so that #137's swap is a re-export and not a rename.

Four of the eight lists have no declaration to come from yet, and say so rather than pretending:
`durations` and `sides` are the effect language's own words (a game needing different ones needs a
`DEFINE` kind, not a longer list), `skillKinds` comes off a card's printed tag, and `promptKinds` is
whatever the steps ask for until `DEFINE PROMPT` is decided.

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
