# Arena — a life card's move as a fourth replacement moment: scope

Issue #272. BT10-031 and SD18-01 (and their `b` back prints) all print the same
line: "During your opponent's turn, if you would add a card from your life to
your hand or place it in your Drop Area, you may reveal it and add it to your
hand instead." That is a 9-10 replacement of a **life card's own move**, not a
Battle Area departure, and the `replace` op's `event` (`src/lib/arena/engine/
script-schema.ts`) is the closed list `leave` / `ko` / `play` — none of which
is this moment. In the shape of `docs/arena-move-replacement-scope.md` §1:
measure first, then build only what the measurement justifies.

## 1. What was measured

### 1.1 Every site that moves a card out of the life area

Four, not one, move a card whose current area is `life` — grepped across
`engine.ts`, `state.ts` and `script.ts` for every `move(`/`h.move(` call
targeting a card taken from `s.players[p].life`/`h.zone(p, "life")`:

1. **`battleDamage`** (`engine.ts:1404-1457`, the `battle.damage` flow step).
   8-4-6-1: a Battle Card's attack connecting with a Leader takes the
   defender's top life card(s) — `amount` of them, raised by [Strike]) — to
   **hand**, or to **Drop** instead if the attacker has [Critical]:
   ```
   move(ctx, s, ev, life, critical ? "drop" : "hand", defP, { reason: "damage", reveal: critical });
   ```
   (`engine.ts:1429`, inside a `for (let i = 0; i < amount; i++)` loop that
   also accumulates `taken` for the `damage` event and the `dealtDamage`/
   `lifeLeft` triggers pended after it.) This is the site the two cards'
   wording is squarely about: a Battle Card attack is the ordinary way a life
   card ever "would" move to hand or Drop on its own, and it is the only one
   of the four that can be `critical` — matching the printed "or place it in
   your Drop Area" half exactly.
2. **The `damage` op** (`script.ts:958-975`, inside `stepScript`'s per-op
   `switch`, no relation to the resumable `"moveTo"` sub-loop). A skill that
   deals damage directly ("deal 2 damage to your opponent") reaches life
   cards the same way, always to **hand** — 5-10/21-3 read together: "damage
   from an effect is never Critical", so this site can never produce the
   Drop half of the two cards' text.
   ```
   for (let i = 0; i < n; i++) {
     const life = h.zone(p, "life")[0];
     if (!life) break;
     h.move(life, "hand", p, { reason: "damage" });
     taken.push(life);
   }
   ```
3. **The `lifeDownTo` op** (`script.ts:1017-1022`, "add cards from your life to
   your hand until you have N life left", 126 catalog occurrences). Always to
   **hand**, and 1-13-2 says this is deliberately *not* damage — the comment
   on the line above the loop says so, and no `dealtDamage`/`lifeLeft` moment
   is pended for it. A card headed to hand this way still matches BT10-031's
   bare wording ("if you would add a card from your life to your hand"), but
   it is not what either printed card is about (this op fires only from the
   controller's *own* skill resolving on their *own* turn in every catalog
   use, which the "during your opponent's turn" gate on both cards would
   refuse anyway) — noted for completeness, not pursued.
4. **`payAltCost`'s `pay: "life"` branch** (`state.ts:1912-1917`, 20-19/5-3's
   "add N cards from your life to your hand" as another way to pay a
   [Counter]'s price). To **hand** always, and — unlike the three above —
   this is the *paying* player's own deliberate choice, not something that
   "would" happen to them; 9-10 replaces an event, and choosing to pay a
   price is not one. Also always on the payer's own turn in a [Counter]'s
   ordinary case (answering the opponent's attack, i.e. paid on the
   *defending* player's own following declaration, not "during your
   opponent's turn" from the payer's chair — the two cards' gate would not
   even open here). Excluded on both grounds.

**Conclusion: one site is in scope.** `battleDamage` is the only one of the
four that can produce *either* named destination, the only one damage-shaped
enough to trigger the "during your opponent's turn" gate as its normal case
(an attack is always the opponent's, from the defender's chair), and the one
a Drop-side reveal is actually observable on. `damage`/`lifeDownTo`/
`payAltCost`'s life branch stay exactly as they are — additive, not universal,
exactly as increment 1/2 of the Battle Area feature left 46 of 48 sites
untouched.

### 1.2 Can `battleDamage` suspend? Yes, and more cheaply than the Battle Area case needed

The two Battle-Area-departure sites (`docs/arena-move-replacement-scope.md`
§1.2) needed new plumbing because both live *inside* `stepScript`'s per-op
interpreter loop (`script.ts`'s `"moveTo"` and `"ko"` cases), which is itself
one frame on `s.flow` and had no cursor of its own to survive a suspension —
hence `ScriptFrame.moveLoop`, built for increment 1.

`battleDamage` is not a script op at all. It is a **flow step** — a case in
`engine.ts`'s big `run()` switch, exactly the shape `battleOffense`/
`battleDefense`/`turn.promptMain` already are, and those already return
`"wait"` freely to ask a player something and resume later. There is no
second layer to reach through: the general resume path an answered `Prompt`
takes (`apply()`'s `case "chooseMode":`, `engine.ts:3018-3023`) does nothing
but record `s.lastMode = action.index` and let whatever flow step is on top
of `s.flow` read it back when the flow loop re-enters that step — which is
exactly how `script.ts`'s two `moveLoop` sites already read `h.lastMode()`
today (`pickedReplacement(frame.moveLoop, h.lastMode())`, `script.ts:864`).
Nothing about answering a `replaceMove` prompt is specific to a `ScriptFrame`;
a flow step can read the same `s.lastMode` the same way.

What has to be threaded across the wait, because `battleDamage`'s own local
variables (`amount`, `taken`, `critical`, the loop index) do not survive a
return: `{ op: "battle.damage" }` (`types.ts:928`) currently carries nothing.
It needs an optional resume payload —

```
{ op: "battle.damage"; resume?: { taken: string[]; remaining: number; critical: boolean } }
```

— pushed back onto `s.flow` in place of continuing the loop in-process,
exactly the way `play.resolve` already carries `markers`/`empowerCarry` across
its own wait (`types.ts:918`, "requeues this same step with the answer on
it"). One card taking multiple hits ([Strike] against a life-card-reveal
card) is the only reason the loop needs a cursor at all — a single hit
(the overwhelming majority of attacks) never suspends more than once.

### 1.3 What discriminates this replacement from an ordinary Battle Area one

`causeMatches` (`state.ts:241-247`) reads `Replacement.by`/`bySide` against
`reason`/`actor` — a vocabulary built for "the card would leave the Battle
Area *by a skill or a KO*". None of that is what BT10-031/SD18-01 ask: they
name no cause at all, only the **destination** ("to your hand or … your Drop
Area") — both of which `battleDamage` already decides before it calls
`move()` (`critical ? "drop" : "hand"`). So the new `event: "life"` on
`replace` does not reuse `by`/`bySide`; `collectStatics` reads it into a
`StaticEffect` the same way `replaceLeave`/`event: "leave"` already is
(`state.ts:1096-1106`), and the new reader asks only "is this card's current
move a life-area departure at all" — the *destination* it names (`hand` or
`drop`, or unset for "either", which is what both cards need) narrows it, in
the same field shape `Replacement.to` already has for a **redirect**. No
`by`/`bySide` field is meaningful here and neither is read.

### 1.4 The substitute itself needs two ops, so it is not a redirect

`redirectOf` (`state.ts:284-291`) only recognises a *single* `moveTo` as a
plain redirect. "Reveal it and add it to your hand instead" is `reveal` **and
then** `moveTo` — two ops — so this is a **substitute** exactly as
`docs/arena-move-replacement-scope.md` §1's "instead" family already
distinguishes: `subject` bound to the departing life card, and the substitute
either the deterministic path (`runReplacement`, when nobody could be asked)
or the deferred one (`replacementChoicesFor` + a wait, when somebody can be —
which after §1.2 is true for `battleDamage`). `optional: true` (9-10-3, "you
may") is 9-10-2/3's own question, put by the same `replaceMove` prompt the
Battle Area feature already built — reused, not duplicated, exactly as
increment 2 reused it rather than adding a `move.replace` `FlowStep` (§5
point 1 of the other document).

### 1.5 The reveal half: a real gap in `revealedTo`, not a new mechanism

`reveal` (`script-schema.ts:245`, `script.ts:1053-1060`) already shows a
selector's cards to both players and logs their names — it is a 20-11-2
primitive, not a new one. What is missing is that **`maskBeats` masks a
beat's art from the current state, not from history** (`beats.ts:313-317`,
"the rule is `revealedTo`'s… asked of the state *now*"): a life card that
was revealed and then moved into its owner's hand is, by the time anyone
looks, sitting in a hand — a zone `revealedTo` (`view.ts:411-430`) only shows
to its own owner (`if (p === viewer) for (const id of ps.hand) add(id)`,
`view.ts:422`) and hides from the opponent regardless of the reveal that just
happened. `revealedTo` already has the exact precedent this needs: a life or
Z-Deck card is shown to *everyone* while `faceUp` (`view.ts:423`,
`if (s.cards[id]?.faceUp) add(id)`), because 3-9-2-1 lets a life card sit
face-up in a normally-hidden zone and stay public knowledge. A hand card is
never printed with that same public-facing state today (nothing sets
`faceUp` on a card entering a hand), so extending the same check to hand
cards — `for (const id of ps.hand) if (p === viewer || s.cards[id]?.faceUp) add(id)`
— is additive and narrow: it only ever fires for a card this feature marks
`faceUp` on the way into a hand, via `moveTo`'s existing `faceUp` field
(`script.ts:1276`, "`Add it to your life face up` (3-9-2-1): how the card
arrives, set after the move because 3-1-4 clears the flag on the way" — the
same convention, aimed at a hand instead of a life area for the first time).

## 2. What the Build therefore is

1. `event: "life"` on `replace` (`script-schema.ts`), narrowed by an optional
   `to: "hand" | "drop"` rather than `by`/`bySide` (§1.3); `collectStatics`
   reads it into a `StaticEffect` beside `replaceLeave` (§1.3); a new
   `replacementsForLife`-shaped reader (mirroring `replacementChoicesFor`)
   answers `battleDamage`'s question.
2. `battleDamage` (`engine.ts`) gains the resume payload of §1.2 and, before
   each `move(life, …)`, asks `replacementChoicesFor`-for-life the same way
   `script.ts`'s `moveLoop` already asks for a Battle Area departure — 0 or 1
   candidates (both cards print an unconditional, ungated offer, so more than
   one can only happen if two players' Permanents somehow both target the
   same card, which 9-10-2's existing choice prompt already covers for free)
   deterministic; an `optional` one waits.
3. The substitute program is `[{op: "reveal", sel: {special: "subject"}, as: "revealed"}, {op: "moveTo", target: {sel: {special: "subject"}}, to: "hand", faceUp: true}]`, run through the same deferred/`runReplacement` split §1.4 names.
4. `revealedTo` grows the one line §1.5 gives, so `maskBeats` lets the
   revealed card's art through to both seats from the moment it lands in
   hand onward, exactly as a face-up life card already is.
5. Compile the wording on both cards, `wording.ts`/`narration.ts`'s sentence
   for the new event, the glossary's `replace` entry, and re-draft
   `card_rules` for BT10-031/SD18-01 (and their `b` prints).

## 3. What is out of scope, named rather than silently dropped

- The `damage` op, `lifeDownTo` and `payAltCost`'s life branch (§1.1 points
  2-4) do not check the new replacement. A card that happened to print this
  wording narrowed to one of those three moments would be refused, not
  wrongly offered — no such card exists in the catalog today.
- Multiple simultaneous life-card replacements naming different destinations,
  or a redirect (as opposed to a substitute) version of this event: not
  printed by any card, so not built.
- Rebuilding `move()` around a frame for all 48 sites — the same exclusion
  `docs/arena-move-replacement-scope.md` names, and still unnecessary here.
