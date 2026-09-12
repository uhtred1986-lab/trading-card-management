# The rules language

Written 9 Sep 2026, Stage 1 of the programme in `docs/arena-history-lessons.md`; the definition
grammar (§3b) added 12 Sep 2026, Stage 3. Code: `src/lib/arena/lang/`. Tests:
`scripts/verify/lang.ts`, part of `npm test`.

One grammar for three things, of which the first two exist today:

1. **a card's rule** — the `card_rules` row, printed and read back by the workbench's text view;
2. **a game's definition** — the `DEFINE` declarations of §3b, which `rulesets/*.rules` will hold,
   and which is why the parser is written table-driven rather than around the shape of a card;
3. **the referee's answers** — JSON until the language settles.

## 1. What it is for

The record has four parts — WHEN, COST, IF, DO — and until now only two of them could be edited.
The chips edit IF and DO. WHEN and COST had no editor and are not getting one (the plan of
9 Sep 2026 puts chip editors for them explicitly out of scope), and they are exactly the parts a
person most often needs to fix: a trigger the compiler put on the wrong moment, a price it read as
free.

So the whole record is written out in one line-per-clause text, edited, and read back. The catch is
that a text view of a record is only safe if the text and the record say the *same thing*. That is
the round-trip promise below, and everything else in the design follows from it.

## 2. The round-trip promise

> `parse(print(x))` is `x`, for every rule the compiler writes and every rule a person can type.

Checked in `scripts/verify/lang.ts` over: a minimal and a maximal instance of **every** row of
`OP_SCHEMA` and `COND_SCHEMA`; every sugar in both directions; every field of a `Selector` and of a
`CardFilter`, one at a time; every keyword literal in `KEYWORD_NAMES`, bare and with parameters;
and then every compiled program and every drafter record for every card in the test harness.
Printing is also idempotent — `print(parse(print(x)))` is `print(x)` — so a record does not churn
its own version each time it is opened and saved.

Two rules keep it true.

- **The printer never has a choice.** A sugar is printed only when it says exactly what the object
  says: `count(SEL) >= 2` for one bound, the general `count(sel: …, atLeast: …, atMost: …)` for two
  or none. One object, one printed form.
- **The parser is the generous one.** It takes the first required argument positionally
  (`ko($t)` for `ko(target: $t)`), keywords in any case, and the parts of a selector in any order.
  The asymmetry is what makes the promise an equality rather than a fixed point.

A **whole file** of declarations round-trips the same way: `printDefinitions(parseDefinitions(text))`
is `text` for every declaration the grammar can hold, over a minimal and a maximal instance of every
`DEFINE` kind and over all of them in one file (§3b). `--` comments are dropped on the way, as they
are for a rule — the printer never writes one, so a note it would eat on the next save is worse than
no note.

**Equality is the language's own** (`deepEqual` in `print.ts`): keys sorted, `undefined` dropped,
and two shapes the engine cannot tell apart treated as one —

- a selector switch written `false` (`upTo`, `fromEnd`, `ignoreBarrier`), which the engine reads
  truthily, so `upTo: false` is the same selector as one that never mentioned it;
- an `area` sitting beside an `areas` list, which `Selector` says is read by `areas` alone.

The compiler writes both of those; a person types neither. Both are dropped on the way through, and
nothing else is: `faceUp: false` means turn the card face *down* and `hidden: false` means Revealed
Mode, and those are printed out loud.

## 3. The grammar

```
rule   := WHEN ( COST )? ( IF )? THEN
WHEN   := "WHEN" "[" kind "]" ( trigger ( "|" trigger )* )?
COST   := "COST" ( item ( "," item )* )?
IF     := "IF" cond
THEN   := "THEN" ( stmt )*                         one per line
stmt   := name "(" ( value | field ":" value ) ( "," field ":" value )* ")"
cond   := comparison | name "(" … ")" | "NOT" cond | cond "AND" cond | cond "OR" cond | "(" cond ")"
expr   := term ( "+" number )*                     left-associative; the right side is always printed
term   := number | "$" name | call ( "*" number )?
call   := "count" "(" SEL ")" | "markers" "(" SEL ")" | "sumPower" "(" "$" name ")"
        | "handUpTo" "(" number ")" | "X" | "life" "(" side ")"
        | "attr" "(" REF "," attr ")" | "sumOf" "(" SEL "," attr ")"
attr   := "power" | "comboPower" | "energyCost" | "comboCost"
REF    := "$" name ( "MINUS" "$" name )? | SEL
SEL    := part+                                    parts in any order; "any" when there are none
part   := "[" special "]" | "FROM" "$" name | number | "UP TO" number? | "TOP" number
        | "BOTTOM" number | filter | "IN" places | "OF" side | flag
places := ( side "." )? ( zone | zone ( "|" zone )+ | "ANY" "(" zone ( "|" zone )* ")" )
flag   := "active" | "rest" | "fromEnd" | "ignoringBarrier" | "otherThanSelf" | "otherThanCopies"
filter := "\"" printed filter text "\"" | "(" field "=" value ( "AND" … )* ")"
item   := "{" colour "}"+ | "{" colour "/" colour "}" | ±n "marker" | "burst" n
        | "spiritBoost" n | "X" ( "min" number )? ( "max" number )? | "TEXT" "…"
        | "IF" cond | "DO" "{" stmt* "}"
```

**The expression calls are a table, not a list of cases.** `EXPR_SCHEMA` (`lang/ast.ts`) says each
one's call name, its arguments and whether it takes a `* n`; `printAmount` and the parser's
`amount()` both walk it, so a shape added to `Amount` is one row there and no new parsing. Only the
two literals (a number, `$name`) and the one operator (`+ n`) are written out by hand, because they
have no call name to put in a table.

`X` is the value this skill's price was paid at (20-5). A price says it charges one with the `X`
item above; the effect then reads it back. **A program that says `X` without a price that binds it
is refused by `validateRule`** — read as nothing, "draw X cards" would be a free skill that quietly
does nothing. A `choose` step carrying `bindX: true` binds it instead, to how many cards were taken,
and only the steps *after* that step may use it. A `bindX` in the price's own program binds X for
the effect that follows it, which is how "discard any number of cards: … X cards" is written.

The right-hand side of `*` and `+` is always a printed number. No card multiplies one reading of the
board by another, and allowing it would leave the printed form ambiguous about which was read first.

`trigger` names the engine's fired moments (validated by `validateRule`), including keyword-timing moments that are not plain phase names: `evolveFromHandActivated`, `unionAbsorbActivated`, and `counterFreeFromHand`. The free-counter wording is modelled as a WHEN moment (not as a COST item), so one printed form round-trips to one record shape.

`--` starts a comment to the end of the line. The printer never writes one, and the parser never
keeps one — a note that the next save would silently eat is worse than no note at all.

**Statements and conditions are not listed here** and never will be: they are generated from
`OP_SCHEMA` and `COND_SCHEMA` (`engine/script.ts`), field names and all. Adding an operation is
still *one interpreter case and one schema row*; the printer, the parser, the validator, the plain
reading, the referee's prompt and the chip editor all follow from the row.

### Literals

| written | is |
|---|---|
| `[self]` `[attacker]` `[guard]` `[subject]` `[leader]` `[opponentLeader]` `[resolving]` | a special target |
| `[Blocker]` `[Strike x: 3]` `[Empower color: Red, x: 2]` | a keyword skill, with its parameters |
| `[auto]` `[activate:main]` `[counter:attack]` `[permanent]` | the printed skill tag, in WHEN — **read-only** |
| `$t`, `$looked MINUS $kept` | cards bound by an earlier step |
| `you` `opponent` `both`, `hand` `battle` `zEnergy` …, `turn` `nextTurn` `game` … | a side, a zone, a duration |
| `"…"`, `null`, `true`, `[Red, Blue]` | a text, an absent value, a flag, a list |

A value that is a plain word is written bare; anything with a space or a hyphen is quoted. That is
why `[Energy-Exhaust]` and `[Warrior of Universe 7]` work: a keyword's name is taken from the
source between the brackets, not from the tokens the lexer broke it into.

### The card filter

A filter is printed in **its own words** — `"blue ≪Saiyan≫ card with an energy cost of 3 or less"`
— but only when `parseFilter` reads those words back into the same filter. When it does not, the
field form is used instead: `(colors = [Blue] AND traits = [Saiyan] AND costMax = 3)`. Uglier and
exact. `parseFilter` ignores wording it does not know, so a filter printed in words it cannot
re-read would come back *wider* than it went in, which is the silent widening ground rule 5
forbids.

## 3b. The definition grammar

The second of the language's three uses: a **game's own definition**, written as declarations in
`rulesets/*.rules` instead of as TypeScript unions and a phase switch. Stage 3 (12 Sep 2026) added
the grammar and nothing else — no declaration is *interpreted* yet (Stage 4), no name is resolved
against another (the loader), and the DBS files are their own issues. `parseDefinitions(text)` and
`printDefinitions(defs)` are the two calls, beside `parseRule` / `printRule`.

```
file    := ( definition )*                          blank lines and "--" comments between
definition := "DEFINE" kind name ( field )*         one field per line, until the next DEFINE
kind    := "GAME" | "ATTRIBUTE" | "ZONE" | "PHASE" | "STEP" | "ACTION" | "TRIGGER"
         | "KEYWORD" | "COST" | "WIN" | "OP"
name    := word | "\"" text "\""                     quoted when it carries a space or a hyphen
field   := name ":" value                           the fields written as a pair
         | WORD value                               the fields written as a clause word
         | "HOOK" point "{" stmt* "}"               a keyword's body, one line per hook point
value   := every value form of §3 — an amount, a selector, a cond, a program "{ … }",
           a list, a quoted text, a number, a flag
pattern := event ( "(" field ":" plain ( "," field ":" plain )* ")" )?
params  := "(" ( name ":" type ( "," name ":" type )* )? ")"
type    := amount | ref | selector | side | area | duration | cond | conds | ops
         | string | number | boolean | keyword | filter | modes | color | colors
```

A declaration's body needs no brackets: a field is one line, and the next `DEFINE` announces
itself. That is deliberate — a ruleset diff then shows one changed line per changed field.

**The fields come from one table.** `DEFINE_SCHEMA` (`lang/ast.ts`) has one row per kind, the way
`OP_SCHEMA` has one per step, and the printer, the parser and the error messages all read it: a
field added to a declaration without a row fails `npm run typecheck`, and so does a row with no
field to put it in. A field whose row carries a `word` is written as that clause word (`ON`, `DO`,
`REFUSE`); every other field is written `name: value`. The colon is what tells the two apart, so
neither can be read as the other.

Three shapes a card's rule never carries, and so three field types the op schema has no word for:
`pattern` (a trigger's event — `moved(to: battle)`, written as `field: value` pairs and never as an
arrow, because the lexer reads `-` and `>` as two tokens), `params` (what a macro, a price or a
keyword takes), and `hooks` (a keyword's bodies, which print one `HOOK` line each rather than as a
list, so a diff shows the hook that changed).

### The eleven kinds

**GAME** — the game itself: how a player starts and what a turn is made of (manual §5). `title:`,
`players:`, `deck:`, `zDeck:`, `hand:`, `life:`, `startMarkers:`, `markersPerTurn:`, `mulligan:`,
`firstPlayerDraws:`, `phases:`. Only `deck:`, `hand:` and `life:` are required; a field left out is
the loader's default.

```
DEFINE GAME dbs
  title: "Dragon Ball Super Card Game"
  players: 2
  deck: 50
  zDeck: 7
  hand: 6
  life: 8
  markersPerTurn: 1
  mulligan: true
  phases: [charge, main, end]
```

**ATTRIBUTE** — something a card, a player or a zone has — printed on the card, or derived from the
board (manual §4). `of:` (card | player | zone) and `value:` (number | string | strings | colors |
boolean) are required; `printed:` says it comes off the card, `derived:` is the expression that
computes it instead, `layers:` the order the layers apply in, `text:` what it means.

```
DEFINE ATTRIBUTE power
  of: card
  value: number
  printed: true
  layers: [printed, markers, skills]
  text: "the number a battle is decided by (4-6)"
```

**ZONE** — an area cards sit in: who owns it, who may see it, and whether what is in it is in play
(manual §3, §9-1-3). `owner:` (player | shared) and `visibility:` (none | owner | opponent | all)
are required; then `ordered:`, `single:`, `markers:`, `inPlay:`, `host:` (cards may sit under a card
here), `modes:` and `text:`.

```
DEFINE ZONE battle
  owner: player
  visibility: all
  ordered: false
  inPlay: true
  modes: [active, rest]
  text: "where Battle Cards are played (3-6)"
```

**PHASE** — a phase of the turn, in the order the game declares (`DEFINE GAME`'s `phases:`).
`steps:` is required; `actions:` lists what a player may do in it, `auto:` says it passes with no
prompt, `text:` what it is.

```
DEFINE PHASE main
  steps: [mainStart, mainActions]
  actions: [playCard, attack, activateSkill]
  text: "the phase a player takes their moves in (6-4)"
```

**STEP** — one step of a phase, and the program it runs. `phase:` is required; `DO` is the program
the step runs, `optional:` whether it may be skipped, `prompt:` what is asked, `text:` what it is.

```
DEFINE STEP mainStart
  phase: "main"
  DO {
    note(text: "the moment [Auto] skills of the Main Phase answer to")
  }
  text: "the start of the Main Phase (6-4-1)"
```

**ACTION** — a move a player may make, and the sentence that says why they may not: `WHEN` the
phases it is available in (required), `FOR` the cards it applies to, `COST` the names of the `DEFINE
COST` prices it charges, `DO` what it does (required), `REFUSE` the sentence said when it may not be
taken. The refusal is part of the declaration because every rule is a visible workflow
(`docs/arena-workflow-spec.md`): an action with no `REFUSE` can only be missing from the menu, never
explained.

```
DEFINE ACTION playCard
  WHEN [main]
  FOR 1 IN you.hand
  COST [energy]
  DO {
    moveTo(target: $chosen, to: battle)
  }
  REFUSE "you cannot pay for that card"
```

**TRIGGER** — a moment an [Auto] or a [Counter] answers to, as the event that is it (manual §9-6).
`ON` is the event pattern (required), `WHERE` a condition on it, `BIND` the name the event's subject
is bound to, `text:` the moment in words. This is the same vocabulary a record's WHEN names (§7), so
a rule cannot answer to a moment the definition does not declare.

```
DEFINE TRIGGER played
  ON moved(to: battle)
  WHERE isTurnPlayer()
  BIND "subject"
  text: "a card arrives in a Battle Area from outside play (9-6-9-4)"
```

**KEYWORD** — a keyword skill: what it means, what it takes, and the hook points it hangs on (manual
§22). `TAKES` its parameters, `text:` what it means (required), `section:` the manual section, and
one `HOOK` line per hook point it hangs on. A keyword with no `HOOK` is a declaration of the name
and its meaning and nothing more, which is what Stage 3 writes: the bodies are Stage 7.

```
DEFINE KEYWORD Blocker
  TAKES ()
  text: "switch this card to Active Mode and make it the attack target (22-4)"
  section: "22-4"
  HOOK attackDeclared {}
```

**COST** — a price the game knows how to charge, named so an action can ask for it. `TAKES` its
parameters, `IF` when it can be paid, `DO` what paying it does (required), `text:` how it reads.

```
DEFINE COST energy
  TAKES (amount: amount)
  IF isTurnPlayer()
  DO {
    switchMode(target: [self], mode: rest)
  }
  text: "cards from the Energy Area, switched to Rest Mode (7-2)"
```

**WIN** — a condition that ends the game, and for whom. `IF` the condition (required), `result:` win
| lose | draw (required), `who:` the side it is about, `text:` the manual's wording.

```
DEFINE WIN lifeOut
  IF life(you) <= 0
  result: lose
  who: you
  text: "a player with no life left loses (2-2)"
```

**OP** — a macro over the primitives, so a step the cards use is a row rather than an interpreter
case. `TAKES` its parameters, `DO` the program it expands to (required), `text:` the sentence it
renders as, `doc:` the line the referee is told. The round-trip promise is over the macro's
**name**: a program keeps printing `power(…)` and never its expansion.

```
DEFINE OP koAll
  TAKES (target: ref)
  DO {
    ko(target: $t)
  }
  text: "KO every chosen card"
  doc: "the macro every KO wording lowers to"
```

### What the loader refuses

The parser refuses what it cannot read: an unknown kind, an unknown field, a field said twice, a
value outside a closed list, and a **required field left out** — which fails at the declaration's
own line, with `clause` naming the kind, exactly as a rule's missing argument fails at the call
(§5). Everything that needs a second declaration to check is the loader's, not the grammar's: a
**dangling reference** (an `ACTION` naming a `COST` nothing declares, a `TRIGGER` — or any program
— naming an unknown zone), a **duplicate name**, and an **unknown hook point**. Those are the
ruleset loader's (`rulesets/load.ts`, built 12 Sep 2026), in the same `LangError` shape plus the
file, pointed at the line and column of the offending word.
`docs/arena-ruleset-spec.md` §3 lists them one by one.

## 4. Worked examples

A skill that draws when it is played, from the drafter:

```
WHEN [auto] played
THEN
  draw(n: 1)
```

A price, a condition and a choice — the shape most corrected records have:

```
WHEN [activate:main]
COST {Red}{any}, IF leaderColor(color: Red)
IF life(you) <= 4
THEN
  choose(sel: 1 "battle card with an energy cost of 3 or less" IN opponent.battle, as: "t")
  ko(target: $t)
```

A modal skill, a nested program and a delay:

```
WHEN [auto] played
THEN
  chooseMode(modes: ["Draw 1 card." {
    draw(n: 1)
  }, "Your opponent discards 1 card." {
    discard(n: 1, side: opponent)
  }])
  delay(at: turnEnd, ops: {
    ko(target: $t)
  })
```

A [Permanent] that changes a rule while the card is in play:

```
WHEN [permanent]
THEN
  power(target: 99 IN you.battle, amount: count(99 "≪Saiyan≫" IN you.battle) * 5000, until: game)
```

An X price, paid at a value the player picks and read again by the effect (20-5). The engine offers
this skill once per value of X it can pay, so the choice is made on the move list:

```
WHEN [activate:main]
COST X
THEN
  draw(n: X)
```

An expression that reads the board: the total combo power of the cards a price discarded, and a
power bonus of a thousand for each marker on this card:

```
WHEN [activate:main]
COST DO {
  choose(sel: UP TO 99 IN you.hand, as: "discarded")
  moveTo(target: $discarded, to: drop)
}
THEN
  power(target: [self], amount: sumOf(FROM $discarded, comboPower), until: turn)
  power(target: [self], amount: markers([self]) * 1000, until: turn)
```

A counted prohibition with an escape clause:

```
WHEN [auto] played
THEN
  forbid(what: attack, until: turn, side: opponent, filter: "battle card", uses: 1, unless: count(99 IN opponent.energy) >= 3)
```

A replacement whose substitute is a whole program (9-10, BT3-051): the card is not KO'd at all, it
stays where it is, and the cards under it go to the Drop in the KO's place. `with` is the program
that happens instead of the event `event` names, and it may not stop to ask a question — a
replacement has nowhere to wait for the answer, so the parser reads one and `validateProgram`
refuses it (#107):

```
WHEN [permanent]
THEN
  replace(event: ko, with: {
    moveTo(target: 99 IN you.under, to: drop)
  })
```

A price paid by an action rather than energy, and a marker cost:

```
WHEN [activate:main]
COST -1 marker, DO {
  switchMode(target: [self], mode: rest)
}
THEN
  draw(n: 1)
```

## 5. Errors

**The first error wins.** A rule is five lines long, and a list of five complaints about one
missing bracket tells a person less than the first one does (multi-error reporting is explicitly
out of scope). An error is `{ line, col, clause, message, expected[], lineText }`:

```
THEN, line 3 column 3: the engine has no step called "kill" — expected draw, discard, damage, mill, addLife, lifeDownTo
```

`clause` is which of WHEN / COST / IF / THEN the parser was in. `expected` is what could have stood
there, from the schema — the op names, the field names of the call, the values of an enum, the
keyword names. A missing required field is caught by the parser rather than by the validator, so
the error can point at the call: `ko()` fails at the `(`, not somewhere later.

## 6. Row versus text

The text is a **view**. The row is `card_rules`, and what is stored is still the record's own
columns — `trigger`, `cost`, `cond`, `ops` — never the text. `saveRuleAction` parses, validates and
writes those four; nothing keeps the string.

`validateRule` is the other half of Save, and the whole of it on the server, where the rule arrives
as JSON from a browser and nothing about its shape may be assumed. It refuses, in order:

- a **kind** that is not the row's own — the printed skill tag comes off the card;
- a **trigger** the engine never fires, or one named twice. This is the sharpest of the refusals:
  such a rule reads perfectly and the skill simply never happens;
- a **price** whose orbs, either-orbs, condition or program the engine could not charge;
- a **condition** or a **program** `validateProgram` refuses.

## 7. Why an edited WHEN does anything

Before Stage 1 the engine matched an [Auto] skill's moment by running the compiler's regexes over
the printed text at game time (`autoTriggerMatches`). An edited WHEN would have been a label on a
record and nothing more.

`skillAnswersTo` (`engine/triggers.ts`) now reads the row: the record's WHEN if it has one, the
printed text if it has not. `undefined` is *no record* and falls back to the text, so a card nobody
has drafted still plays; an empty list is a record that says "this skill answers to no moment", and
is honoured as that. `rulesFor` carries `card_rules.trigger` onto `Script.trigger` for exactly this.

This is the precedent of 8 Sep 2026 applied to the second of the record's four parts: the price
stopped being recompiled at game time then, and the trigger has now. A keyword's own moments
(§22 — [Attack], [Revenge], [Offering], [Revive], [Z-Stack]) are still the engine's rule and are
not read off the row: the keyword *is* the rule, and the glossary says which.

## 8. What Stage 1 deliberately left out

A definition grammar (`DEFINE GAME | ZONE | ACTION | …`), which Stage 3 has since added — §3b. New primitives from the gap
table (Stage 2). The referee answering in this language rather than JSON. Chip editors for WHEN and
COST — the text view is the editor. `compilerDiff` for a changed trigger or price. Multi-error
reporting. Editing the skill kind.
