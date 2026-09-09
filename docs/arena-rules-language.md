# The rules language

Written 9 Sep 2026, Stage 1 of the programme in `docs/arena-rules-worklist.md`. Code:
`src/lib/arena/lang/`. Tests: `scripts/verify/lang.ts`, part of `npm test`.

One grammar for three things, of which only the first exists today:

1. **a card's rule** — the `card_rules` row, printed and read back by the workbench's text view;
2. **a game's definition** — `rulesets/*.rules` (Stage 3), which is why the parser is written
   table-driven rather than around the shape of a card;
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
expr   := number | "$" name | "count" "(" SEL ")" ( "*" number )?
        | "sumPower" "(" "$" name ")" | "handUpTo" "(" number ")"
        | "markers" "(" SEL ")" ( "*" number )?
REF    := "$" name ( "MINUS" "$" name )? | SEL
SEL    := part+                                    parts in any order; "any" when there are none
part   := "[" special "]" | "FROM" "$" name | number | "UP TO" number? | "TOP" number
        | "BOTTOM" number | filter | "IN" places | "OF" side | flag
places := ( side "." )? ( zone | zone ( "|" zone )+ | "ANY" "(" zone ( "|" zone )* ")" )
flag   := "active" | "rest" | "fromEnd" | "ignoringBarrier" | "otherThanSelf" | "otherThanCopies"
filter := "\"" printed filter text "\"" | "(" field "=" value ( "AND" … )* ")"
item   := "{" colour "}"+ | "{" colour "/" colour "}" | ±n "marker" | "burst" n
        | "spiritBoost" n | "TEXT" "…" | "IF" cond | "DO" "{" stmt* "}"
```

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

A definition grammar (`DEFINE GAME | ZONE | ACTION | …`, Stage 3). New primitives from the gap
table (Stage 2). The referee answering in this language rather than JSON. Chip editors for WHEN and
COST — the text view is the editor. `compilerDiff` for a changed trigger or price. Multi-error
reporting. Editing the skill kind.
