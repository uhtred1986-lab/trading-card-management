# Fixing a card in the text view

The owner's guide to correcting a card's rule in the Rules Workbench — on a phone or at the PC.
Four worked corrections; each names the exact button, tab and field you'll see. Written against
`main`, 20 Sep 2026.

## Where things are

`/arena/rules` (tab **My decks**, the default) lists the skills of the cards in your decks; use
the **find a card…** box, or open `/arena/rules/all` (tab **All cards**) for any card in the
catalog. Tap a row to open its record in the middle pane.

A record shows: a status badge (**Open — played as blank**, **Draft — compiled, not confirmed**,
**Confirmed**, or **Corrected**), the printed skill text, then four rows — **WHEN**, **COST**,
**IF**, **DO** — each a chip. Under the block, a line reads "**The engine will:** …", the plain
English of what's stored. Below: **Confirm — plays exactly like this**, **Correct by hand**,
**Explain to Claude**, **Show as text**, **Show program (JSON)**, **Mark as does nothing**. On the
right, the **Probe** pane runs the rule on a staged board and reports **fired**, **played as
blank**, **did not fire**, or a few other outcomes.

The **text view** (behind **Show as text**, or **edit as text** beside the WHEN chip) is the only
place WHEN and COST can be edited — the chips have no editor for either. It's a closed grammar: it
reads back the whole record as one rule and refuses anything it can't parse, rather than guessing.

## 1. A wrong trigger (WHEN)

`BT19-061` reads: *"When this card is played, choose one — This card gains [Barrier] until the
end of your opponent's next turn. Play up to 1 {Pan, Glimpse of Talent} from your deck, then
shuffle your deck."* — an `[auto]` skill that should fire on **played**.

1. Find `BT19-061` and open its record. Say the WHEN chip reads `[auto] · when this card attacks`
   — wrong for this card.
2. In the **Probe** pane, pick the "played" scenario and hit **Run probe**. The outcome badge
   reads **did not fire** — proof of the mistake before you touch anything.
3. Click **edit as text**. The whole record opens as text, one clause per line.
4. Change the first line from `WHEN [auto] attacks` to `WHEN [auto] played`. Click outside the box
   — the record parses immediately; a bad edit shows in red and keeps the old chips, a clean one
   updates the WHEN chip to `[auto] · when this card is played`.
5. Click **Save as corrected**.
6. **Run probe** again on "played": the outcome is now **fired**.
7. If it's still **Draft** or **Corrected** rather than **Confirmed** and you're happy with it,
   click **Confirm — plays exactly like this**.

`![the record for BT19-061 with the corrected WHEN line and a probe outcome of "fired"](images/arena-fixing-a-card/01-when-trigger.png)`
Capture: `/arena/rules/all`, `BT19-061` open, text view showing `WHEN [auto] played`, and the Probe
pane below/beside it showing the **fired** badge from step 6.

## 2. A wrong price (COST)

`BT17-065` reads: *"[+1][Activate: Main] Discard 1 card from your hand: Your opponent discards 1
card from their hand."* — the cost is a marker, paid by discarding a card from your own hand.

1. Open `BT17-065`. Say the **COST** row shows no chip at all — the record was drafted as free.
2. Run the probe: the move is offered and resolves with nothing discarded from your own hand —
   wrong.
3. Click **Show as text** (there's no COST chip yet to click "edit as text" on).
4. Add a COST line: `COST +1 marker, TEXT "Discard 1 card from your hand", DO { discard(n: 1) }`.
   Leave `THEN discard(n: 1, side: opponent)` as it is.
5. Leave the box; the COST row now shows a chip reading the marker and the discard together.
   **Save as corrected**.
6. Re-probe: it now costs a marker and a card from your hand before your opponent discards.

`![the record for BT17-065 with a COST line added in the text view](images/arena-fixing-a-card/02-cost-price.png)`
Capture: `/arena/rules/all`, `BT17-065`, text view open with the `COST +1 marker, TEXT "Discard 1
card from your hand", DO { discard(n: 1) }` line visible above the THEN.

## 3. An unread clause, fixed by typing the program

`BT16-087` reads: *"[Activate: Main]{1}, send this card to its owner's Warp: Draw 1 card, then
choose up to 1 of your opponent's Battle Cards in Rest Mode and KO it."* Say the record's DO chips
stop after the `choose` step — the printed line highlights *"and KO it"* in a red **mark**, the
record's own sign that a clause went unread, and the line under the block reads "the printed text
says more than that."

1. Open the record. The DO row shows `choose(sel: UP TO 1 IN opponent.battle rest, as: "c0")` and
   nothing after it.
2. Click **Show as text** — the printed program ends after the `choose` line.
3. Add a line: `ko(target: $c0)` — `ko` is a real step in the rules language, and `$c0` is the name
   the `choose` line already bound.
4. First try a typo, to see a refusal: `ko(targe: $c0)`, then leave the box. The message reads
   something like `THEN, line 4 column 3: ko has no field called "targe" — expected target` — the
   parser names exactly which word it didn't recognise, and the last valid rule (without the KO
   step) is kept; nothing is lost.
5. Fix the typo to `ko(target: $c0)` and leave the box again. The error clears, the DO row shows
   both chips, and the printed line's highlight is gone.
6. **Save as corrected**, then re-probe to confirm the chosen card is actually KO'd.

`![the text view for BT16-087, showing a refused field name and then the corrected ko(target: $c0) line](images/arena-fixing-a-card/03-unread-clause.png)`
Capture: `/arena/rules/all`, `BT16-087`, text view open, with the refusal message from step 4
visible (or, if you'd rather show the fixed state, the corrected two-line DO with no error).

## 4. Prefer unread to wrongly read

Not every gap should be closed by guessing. `BT31-097` reads: *"[Activate: Main] If your Leader is
an `<Aeos>` card: Skip your turn and begin your opponent's Charge Phase."* The `skip` step can skip
one phase for one side — it has no way to skip a **whole turn**, so this clause is honestly unread,
and the record says so.

1. Open the record. The printed line marks *"Skip your turn and begin your opponent's Charge
   Phase"* as unread; the IF condition (your Leader is an `<Aeos>` card) is already read correctly.
2. It's tempting to type something that at least does *part* of it: click **Correct by hand**,
   switch to text, and add `skip(what: charge, side: opponent)`. It parses cleanly — `skip` is a
   real step and the syntax is valid.
3. Read it back against the card: this only begins your opponent's Charge Phase — it says nothing
   about skipping *your own* turn, the point of the card. The editor can't catch this: it checks
   that a step exists and its fields are well-formed, not that the program means what the card
   says.
4. Remove the line you just typed, then click **Cancel** — not **Save as corrected**. Nothing is
   written. The record stays **Open**, the clause stays marked unread.
5. Leave it there. The next real game that reaches this skill puts it to the runtime referee, which
   rules from the card's actual text and records the ruling as a draft on this row — reviewable,
   not a guess baked in by hand.

A wrongly-read program plays confidently wrong, every game, until someone notices. An honestly
unread one says so and asks a live ruling instead — the safer state when you're not sure.

`![BT31-097's record showing the unread mark on "Skip your turn and begin your opponent's Charge Phase", with the status badge still reading Open](images/arena-fixing-a-card/04-prefer-unread.png)`
Capture: `/arena/rules/all`, `BT31-097`, record view (chips, not text view), showing the **Open**
badge and the highlighted unread clause in the printed line.

## When to use "Explain to Claude" instead

Typing the program yourself needs you to already know which step does what. When you don't — or
the wording is one other cards likely share — open **Explain to Claude** and say, in plain words,
what the card does. Claude answers with a program (landing as a **Draft**, source **Claude**, for
you to confirm like any other draft) and, when the wording looks like a pattern, a brief for
teaching the compiler that wording for good. You still confirm what comes back.

## When to record a ruling instead

`npm run arena:rule` (your own machine, since it needs the shared database) writes down a ruling
you've already settled on — in conversation, at the table, or from a GitHub issue — without writing
a program for it. Use it when the fix isn't "type the right steps" but "decide what this wording
means," and the compiler or engine change is going to be made deliberately, by hand, across every
card that shares the wording — not attached to one card from the workbench on the spot. The ruling
lands in the row's explanation immediately; the program follows once someone builds it.
