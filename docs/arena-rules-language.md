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
        | "PAYWITH" SEL "AS" ( "energy" | "{" colour "}" ) | "IF" cond | "DO" "{" stmt* "}"
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

`PAYWITH` names cards this price may be settled with instead of energy (20-19). Each one is rested
exactly as an energy card is and never moves, standing in for one energy — of its own colours
(`AS energy`) or of the colour named (`AS {Red}`). The item scopes the permission to **one price**;
a card that says it about itself for every payment ("You can use this card to pay energy costs even
when it's in your Battle Area", BT3-039) says so as a `payWith` step in a [Permanent] instead, and
the planner reads both. Energy is always tried first: the permission is an offer, and resting a
Battle Card to pay for something the Energy Area could have covered is a cost nobody agreed to.

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
here), `place:`, `modes:` and `text:`.

`place:` defaults to true and marks the zone as a list of cards a side holds. The two that are not
are the reason the field exists: DBS declares `play`, which is the word for the Leader, Battle and
Unison Areas together (§9-1-3-1), and `under`, the pile hanging off one card (§23-2-2-2). A program
has to be able to *name* both, and an interpreter building a side's zones from the declarations must
be able to leave them out without knowing either name (#139).

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

A price the board may settle with something other than energy (20-19). The skill costs two energy,
and either of your rested-able ≪Godly Power≫ Battle Cards may stand in for one of them:

```
WHEN [activate:main]
COST {any}{any}, PAYWITH 1 "≪Godly Power≫" IN you.battle AS energy
THEN
  draw(n: 1)
```

The same permission said about the card itself, for every payment rather than one price — the
[Permanent] half of 20-19, and what BT3-039 compiles to:

```
WHEN [permanent]
THEN
  payWith(as: energy)
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

One card taking on another's printed skills (20-18). The commoner of the two wordings is printed as
two clauses — "Choose up to 1 keyword skill on a card placed under this card, and this card gains
that skill until the end of your opponent's next turn" (BT20-028) — and neither half means anything
alone, so the compiler joins them into the one step. `only: keyword` is what "**keyword** skill"
says; with neither `which` nor `skill` given, the engine asks the master which one as the skill
resolves, offering every skill of every card the selector finds and a decline:

```
WHEN [activate:main]
THEN
  copySkills(target: [self], from: 1 IN you.under, only: keyword, until: nextTurn)
```

The other wording names the source outright — "Gain all of the chosen card's skills for the
duration of the turn" (BT3-049) — and copies every skill of it:

```
WHEN [activate:main]
THEN
  choose(sel: 1 IN you.under, as: "c0")
  copySkills(target: [self], from: $c0, which: all, until: turn)
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

Taking control of a card for the turn (20-9, BT15-118). In this engine the area a card is in *is*
who masters it (0-3-4-1), so `control` moves the card into that player's Battle Area — keeping its
mode, its markers and every effect on it (20-9-2) — and the `until` is the loan: the card walks
back when the duration ends. Left out, the control does not end, and a KO still sends the card to
its **owner's** Drop Area (5-12-1):

```
WHEN [activate:main]
THEN
  choose(sel: 1 IN opponent.battle, as: "taken", reason: "Choose 1 of your opponent's Battle Cards")
  control(target: $taken, until: turn)
```

A phase that does not happen (20-13). `what` is one of the five the turn and a battle are made of,
`side` is whose, and `when` says which occurrence — `next` (the default) is the first in a later
turn, which is what a card resolving in your own Main Phase means by “your next Charge Phase”:

```
WHEN [activate:main]
THEN
  skip(what: charge, side: opponent)
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

## 4b. One example per §20 fixed phrase

The manual's §20 is its own list of standard wordings ("Fixed Phrases") — the vocabulary a card's
text draws on rather than a rule about one card. A person fixing a card in the text view has the
printed text in one hand; this table is the other hand, one real card and its confirmed or drafted
record per phrase, generated with `printRule` so it cannot drift from what the language actually
parses (checked in `scripts/verify/lang.ts` the same way §3b and §4 are). Where the language cannot
yet say a phrase, the row names the open issue rather than a program — inventing one here would be
exactly the "compiles and reads wrongly" failure `docs/arena-tooling.md` warns costs more than an
outright refusal.

### 20-1. Omitting or Simplifying Text

20-1-1: a skill with no stated target targets the source of the effect. The manual's own example
for this heading (20-1-7) is a marker skill on `SD14-02` ("SS Gotenks, Fusion of Friendship"):
"[-4][Activate: Main] This card gets +20000 power and [Dual Attack] for the turn." — the record
never writes a target for the power gain or the [Dual Attack] grant; `[self]` is the default every
op falls back to when the card names nothing else:

```
WHEN [activate:main]
COST -4 marker
THEN
  power(target: [self], amount: 20000, until: turn)
  grant(target: [self], keyword: [Attack x: 2], until: turn)
```

### 20-2. Choose X

"Choose one" (or "choose X") separates its options with bullet points and resolves the one picked;
`chooseMode`'s own schema entry cites this heading. `BT19-061`: "When this card is played, choose
one― ・This card gains [barrier] until the end of your opponent's next turn. ・Play up to 1 {Pan,
Glimpse of Talent} from your deck, then shuffle your deck.":

```
WHEN [auto] played
THEN
  chooseMode(modes: ["This card gains [barrier] until the end of your opponent's next turn." {
    grant(target: [self], keyword: [Barrier], until: nextTurn)
  }, "Play up to 1 {Pan, Glimpse of Talent} from your deck, then shuffle your deck." {
    choose(sel: UP TO 1 "{pan, glimpse of talent}" IN you.deck, as: "p0", reason: "Play up to 1 {Pan, Glimpse of Talent} from your deck")
    play(target: $p0)
    shuffle()
  }])
```

### 20-3. Original

20-3-1: "Original" is what a card describes before any skill effect has applied — distinct from its
current, possibly modified, state. `P-295` prints "an original power of 500", and other cards
("originally skill-less", `BT23-106`/`BT22-085`/`BT22-088`) filter on a card's *printed* skill-less
state rather than whether a skill currently touches it. Neither reading exists: today's filter
fields read a card's current power, and nothing distinguishes "as printed" from "as it now stands"
— so a filter written against "original power" silently reads current power instead, the wrong-read
failure this table exists to avoid repeating. **unreadable — see issue #238.**

### 20-4. Unaffected by Skills

9-1-4/20-4-1: a card no skill may touch. The `immune` op already says this for the ordinary case —
"can't be chosen or moved by an opponent's skill" — and a real card compiles cleanly against it.
`BT10-120`: "This card can't attack and isn't affected by your opponent's skills.":

```
WHEN [permanent]
THEN
  forbid(what: attack, until: game, target: [self])
  immune(until: game, target: [self], from: opponent)
```

The op's `from` names **whose** skills, and it is what the engine asks — never who owns the card.
`from: opponent` is the printed phrase above; `from: you` its own controller's skills; `both`, or
no `from` at all, every skill, the card's own side's included. `BT18-019` prints that last one,
and narrows it by a filter on the card whose skill is asking rather than on the card being
affected:

```
WHEN [permanent]
THEN
  immune(until: game, target: [self], fromFilter: "non-<gogeta: gt>")
```

The engine checks it in one place — `resolveSelector`, where every op reaches a card — so a new
operation inherits the check rather than repeating it, and the sweeps and board-wide power changes
are covered along with the choices, because they name their cards through a selector too. A
`[permanent]` immunity holds against another `[permanent]` as well as against an effect with a
duration. Two things are still outside it, and deliberately: a `[self]` selector, because a card's
own skill naming itself is the skill working rather than a skill touching it from outside; and an
effect that names no card at all — a skill aimed at a player, damage, a rule of the game (issue
#128's own "out of scope", and the glossary's "What a card no skill may touch" entry says the same).

### 20-5. Skills that Mention X (Undetermined Numbers)

An X price, bound once when it is paid and read again by the effect (#122/PR #220). No card in the
catalog fetched while writing this table prints one — `npm run arena:tally -- --show "{x}"` finds
none, and the feature's own acceptance test (`scripts/verify/compiler.ts`) is built against a
synthetic harness card ("pay X energy: draw X cards") for exactly that reason. The mechanism is
real and round-trips — it is §4's own "An X price…" example, reproduced here rather than invented
twice:

```
WHEN [activate:main]
COST X
THEN
  draw(n: X)
```

### 20-6. Total of X Cards

20-6-1: "a total of X cards from area A and area B" lets any combination across the named areas be
picked — a selector with more than one `area` (`Selector.areas`). `P-497`: "When this card attacks,
choose up to a total of 2 of your opponent's Battle Cards or Unisons in Rest Mode, ignoring
[barrier], and those cards won't switch to Active Mode during your opponent's next Charge Phase.":

```
WHEN [auto] attacks
THEN
  choose(sel: 2 IN opponent.battle|unison rest ignoringBarrier, as: "c0", reason: "choose up to a total of 2 of your opponent's Battle Cards or Unisons in Rest Mode")
  forbid(what: switchToActive, until: nextTurn, target: $c0)
```

### 20-7. Discard

20-7-1: discard is a card leaving a hand for the Drop. `BT17-065`: "[+1][Activate: Main] Discard 1
card from your hand: Your opponent discards 1 card from their hand." — the same op on both sides of
the colon, once as a cost and once as the effect:

```
WHEN [activate:main]
COST +1 marker, TEXT "Discard 1 card from your hand", DO {
  discard(n: 1)
}
THEN
  discard(n: 1, side: opponent)
```

### 20-8. Sending Cards to the Warp

20-8-1: sending a card to the Warp places it face up in its owner's Warp — `moveTo(to: warp)`.
`BT16-087`: "[activate: main]{1}, send this card to its owner's Warp: Draw 1 card, then choose up to
1 of your opponent's Battle Cards in Rest Mode and KO it.":

```
WHEN [activate:main]
COST {any}, TEXT "send this card to its owner's Warp", DO {
  moveTo(target: [self], to: warp)
}
THEN
  draw(n: 1)
  choose(sel: UP TO 1 IN opponent.battle rest, as: "c0", reason: "choose up to 1 of your opponent's Battle Cards in Rest Mode")
  ko(target: $c0)
```

### 20-9. Gaining Control of Cards

20-9-1: gaining control moves another player's card to your area and makes you its master, while
20-9-2 keeps its owner, positioning and markers unchanged — the `control` op (§4's "Taking control
of a card for the turn"). `BT15-118` reads: "gain control of it" after a choice that bound one.
Nine cards in the catalog print the wording; five read correctly (`BT15-118`, `P-413`, and "your
opponent gains control of this card" on `BT19-055`/`P-277`/`P-564`). The other four stay unread on
purpose rather than guessed at: `BT21-063`'s "you gain control of it" and `BT19-154`'s "gain control
of the played card" both turn on a pronoun this reading now refuses to resolve the wrong way — a
card can't be taken from the player already mastering it, and the last choice is as often the price
as the prize — and `P-348`/`BT16-115` name a clause — a replacement moment, what the opponent chose
to send away — that is itself unread. A Leader or a Unison Card can't change hands, and a KO still
sends the taken card to its **owner's** Drop Area (5-12-1). `src/lib/arena/glossary.ts`'s `control`
entry carries the owner/master audit that made this reading possible.

### 20-10. Remove from the Game

20-10-1/20-10-2: removing a card takes it outside every area — `moveTo(to: removed)`. `BT30-110`:
"[activate: main] Remove this card from the game: Choose up to 1 of your opponent's Battle Cards
and remove it from the game." — the same op pays the cost and resolves the effect:

```
WHEN [activate:main]
COST TEXT "Remove this card from the game", DO {
  moveTo(target: [self], to: removed)
}
THEN
  choose(sel: UP TO 1 IN opponent.battle, as: "c0", reason: "Choose up to 1 of your opponent's Battle Cards")
  moveTo(target: $c0, to: removed)
```

### 20-11. Revealing Cards

20-11-1/20-11-2: revealing makes a card's information visible to both players; the cards stay put
and are hidden again once the skill resolves. `BT10-061`: "When this card attacks, reveal the top
card of your deck; if it's a green ≪Ginyu Force≫ card with an energy cost of 2, you may play it.
Then draw 1 card.":

```
WHEN [auto] attacks
THEN
  reveal(sel: 1 TOP 1 IN you.deck, as: "revealed")
  if(cond: varMatches(var: "revealed", filter: "green ≪Ginyu Force≫ with an energy cost of 2"), then: {
    may(ops: {
      play(target: $revealed)
    }, reason: "play it")
    draw(n: 1)
  })
```

### 20-12. Viewing Secret Areas

20-12-1/20-12-2: viewing a secret area is private to the viewer (unless the card says otherwise) and
the cards stay in place — `look`, as opposed to `reveal`'s public form. `BT15-134`: "[Activate:
Main][Limit 1][Burst 1] Send this card from your hand to your Warp: Look at up to 5 cards from the
top of your deck, add up to 1 black ≪Shadow Dragon≫ Battle Card with an energy cost of 5 or less
among them to your hand, then shuffle your deck." — the same card also happens to pay its cost by
sending itself to the Warp (20-8):

```
WHEN [activate:main]
COST burst 1, TEXT "Send this card from your hand to your Warp", DO {
  moveTo(target: [self], to: warp)
}
THEN
  look(n: 5, as: "looked")
  choose(sel: FROM $looked UP TO 1 "black ≪shadow dragon≫ with an energy cost of 5 or less" IN you.battle, as: "c0", reason: "add up to 1 black ≪Shadow Dragon≫ Battle Card with an energy cost of 5 or less among them to your hand")
  moveTo(target: $c0, to: hand)
  shuffle()
```

### 20-13. Skipping Turns/Phases/Steps

20-13-1…20-13-4: a skipped turn, phase or step does not happen at all — no actions, no checkpoints,
and no [Auto] trigger fires for it. The `skip` op (§4's "A phase that does not happen") now says
this for one of five things — the Charge, Main or End Phase, or the Offense or Defense Step — as a
flag the operation writes when a skill resolves and `exec()` spends where the step would begin. It
deliberately says nothing yet for what the catalog's own printed cards need: `BT31-097`: "[activate:
main] If your Leader is an <Aeos> card: Skip your turn and begin your opponent's Charge Phase" —
`skip` has no *turn* among its five, and there is no single point in the flow to refuse a whole turn
at; `BT21-104` skips a **span** of phases; and `BT18-001`/`BT18-019` print their Offense/Defense
Step skip as a [Permanent] conditioned on a battle in progress — a standing rule read at the step,
not the one-shot flag a resolving skill writes. Compiling any of the four as it stands would read as
the wrong card. **unreadable — see issue #126.**

### 20-14. You Can't Do Action A Unless You Do Action B

20-14-1: action A is blocked until action B is done — `forbid`'s `unless` field, cited on the op's
own schema entry. `BT22-125`: "[permanent] This card can't attack unless you have a Z-Extra in your
Battle Area.":

```
WHEN [permanent]
THEN
  forbid(what: attack, until: game, target: [self], unless: count("Z-card extra card" IN you.battle) >= 1)
```

The manual's own example for this heading, `BT13-030`'s "your opponent can't attack with cards for
the turn unless they give the attacking card -5000 power for the turn each time", needs an escape
that is itself a repeatable cost rather than a boolean `Cond` — a harder shape `unless` does not
reach yet, which is why this row cites a simpler real card instead of the manual's own.

### 20-15. If Declared

20-15-1: from when an action is declared until it is taken (or something is known to have that
status) — the window every `counter:*` WHEN already answers within, but not, today, a condition a
*different* skill can read ("if declared" naming an action other than the one the skill itself is
answering). `npm run arena:tally -- --show "if declared"` finds no card printing the fixed phrase
verbatim in the catalog fetched while writing this table. **unreadable — see issue #239.**

### 20-16. If You Do

20-16-1: the clause after "if you do" only happens if the optional action before it was taken —
`did(what: "may")`, or, for an "up to" choice with no explicit "you may", the `chose` condition
(both cite this heading on their own schema entries). `BT7-027`: "When you play this card, you may
choose 1 card in your life and add it to your hand. If you do, choose up to 1 of your opponent's
Battle Cards with an energy cost of 4 or less and return it to its owner's hand.":

```
WHEN [auto] played
THEN
  choose(sel: UP TO 1 IN you.life, as: "c0", reason: "you may choose 1 card in your life")
  moveTo(target: $c0, to: hand)
  if(cond: chose(var: "c0"), then: {
    choose(sel: UP TO 1 "card with an energy cost of 4 or less" IN opponent.battle, as: "c1", reason: "choose up to 1 of your opponent's Battle Cards with an energy cost of 4 or less")
    moveTo(target: $c1, to: hand)
  })
```

### 20-17. If You Don't

20-17-1: the mirror of 20-16 — the following clause happens only if the optional action was
*declined*, `NOT did(what: "may")`. `BT17-018`: "If your Leader Card is a <Dr. Myuu> card: When this
card is played, you may draw 1 card. If you don't, activate up to 1 {Planet M-2} from your deck,
then shuffle your deck.":

```
WHEN [auto] played
COST TEXT "If your Leader Card is a <Dr. Myuu> card", IF leaderMatches(filter: "<dr. myuu>")
IF leaderMatches(filter: "<dr. myuu>")
THEN
  may(ops: {
    draw(n: 1)
  }, reason: "draw 1 card")
  if(cond: NOT did(what: may), then: {
    choose(sel: UP TO 1 "{planet m-2}" IN you.deck, as: "p0", reason: "activate up to 1 {Planet M-2} from your deck")
    play(target: $p0)
    shuffle()
  })
```

### 20-18. "" (Text Used to Indicate Another Skill Within a Skill)

20-18-1: a skill quoting another skill by name — `copySkills`. Both real cards this table would
otherwise repeat are already §4's own worked examples, generated the same way: `BT20-028` ("Choose
up to 1 keyword skill on a card placed under this card, and this card gains that skill until the
end of your opponent's next turn") and `BT3-049` ("Gain all of the chosen card's skills for the
duration of the turn") — see "One card taking on another's printed skills" and "The other wording
names the source outright" in §4 above.

### 20-19. (Can) Use \<Specified Cards\> as Energy

20-19-1: paying with a named card as if it were energy — the `payWith` op and cost item (§4's two
"A price the board may settle with something other than energy" examples), for the **unscoped**
permission: a card that may always stand in for one energy, wherever it is. `BT3-039` is what it
compiles: "[Permanent] You can use this card to pay energy costs even when it's in your Battle
Area." Four other cards in the catalog *qualify* the permission instead of giving it outright — to
the cards whose cost is being paid (`BT28-031`/`BT28-032`), to one play (`BT17-065`, this heading's
own manual example: "you can pay its energy cost using {Infinite Multiplication Meta-Cooler} in
your Battle Area as energy"), or to a count per turn (`BT28-106`) — and the op carries no scope, so
reading them would grant a wider permission than the card prints (ground rule 5). They stay unread.

### 20-20. Non

20-20-1…20-20-3: "non-(X)" is everything that is not X, including cards with no character or trait
at all when X is one. The filter fields negate directly (`notCharacters`, `notTraits`, `notNames`,
…). `BT27-027`: "[Activate: Main][Once per turn] Add up to 2 blue ≪Red Ribbon Army≫ cards from your
hand to your energy, and you can't play non-≪Red Ribbon Army≫ Battle Cards for the turn.":

```
WHEN [activate:main]
THEN
  choose(sel: UP TO 2 "blue ≪red ribbon army≫" IN you.hand, as: "c0", reason: "Add up to 2 blue ≪Red Ribbon Army≫ cards from your hand to your energy")
  moveTo(target: $c0, to: energy, reveal: true, owner: you)
  forbid(what: play, until: turn, side: you, filter: "non-≪red ribbon army≫ battle card")
```

### 20-21. Increasing/Reducing Energy Costs by X

20-21-1/20-21-2: raising or lowering a cost moves both the specified and total cost by the same
amount — `costReduction`, cited on its own schema entry; a negative `amount` is an increase.
`BT3-005`: "[Permanent] When your life is at 4 or less, increase the energy cost of this card in
your Battle Area by 2.":

```
WHEN [permanent]
IF life(you) <= 4
THEN
  costReduction(target: [self], amount: -2, until: game)
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

A definition grammar (`DEFINE GAME | ZONE | ACTION | …`), which Stage 3 has since added — §3b. New
primitives from the gap table (Stage 2), also since added — X and expressions, `forbid`'s `uses` and
`unless`, `replace(event)`, `copySkills`, `control`, `skip` and `payWith` (§4, §4b) — leaving open
only immunity's full enforcement: `immune` already reads the ordinary case (§4b 20-4), and #128, in
progress, is whether the engine checks it at every site an effect lands on a card rather than only
the sites that consult it today. The referee answering in this language rather than JSON. Chip
editors for WHEN and COST — the text view is the editor. `compilerDiff` for a changed trigger or
price. Multi-error reporting. Editing the skill kind.
