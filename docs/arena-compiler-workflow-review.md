# Arena — the rule compiler under the workflow UI: a review

Written 6 Sep 2026 on `main` after the three workflow phases landed
(`docs/arena-workflow-spec.md` §9). The question asked was: now that every
rule is meant to be a visible workflow per ability, does the core compiler and
the effect layer under it hold up, where are the gaps, and how do **ongoing
("for the turn") and [Permanent] effects** fare in that model?

Everything below was checked against the tree on that date. Where a claim is
about behaviour rather than shape, it was reproduced with a probe script
(synthetic cards, no database, the same harness `scripts/verify-arena.ts`
uses); the probe's output is quoted in the finding. Nothing in this document
changes code — it is a work list, ranked, with a fix sketch and a test beside
each item.

---

## 1. Verdict in short

The workflow model is sound for the abilities it was designed around —
**declared** ones. A play, an attack, a combo and an [Activate] each now have
a legal action with a label, a `whyNot*` twin producing a `Requirement`, a
sentence in `wording.ts`, a beat and a narration line. The twin-not-edit
discipline of §2 decision 2 held: `legalActions` and every predicate body are
untouched, `legal ∩ rejected = ∅` is asserted over every fixture, and the
vocabulary grew by exactly one kind (`condition`) under real pressure.

Two whole classes of rule sit *outside* that model, and that is where the gaps
are:

- **Ongoing effects** — anything `addEffect` writes into `state.effects` with a
  duration. They are created correctly and expire correctly (§4 verifies every
  duration), but the client never sees them as things: no beat when one
  begins, no event when one ends, no field on a card that says "+5000 until
  the end of the turn, from X". A card simply has a different number.
- **[Permanent] skills** — never activated, never resolved, so they have no
  legal action, no rejection, no beat. A conditional one ("during your turn")
  flips on and off silently; an *inert* one (compiles, emits no static) looks
  identical to a working one; an *unreadable* one wears the referee badge for
  a referee that will never be asked.

And two engine bugs surfaced while probing, both in the seam between the
compiler and the menu, both worth fixing before anything cosmetic:

- **[Limit X] is not enforced on [Activate] skills** (22-44-3, 22-44-5). A
  `[Limit 1]` skill was activated twice in one turn; `rejectedActions` had
  nothing to say about it.
- **Every text [Activate] skill emits its `skill` event twice**, so the
  narration ribbon reads the same sentence twice and the beat stream carries
  a beat that happened once.

---

## 2. What holds up

Recorded so the next pass does not re-derive it.

- **The twin pairs are honest.** `whyNotActivate` mirrors `activatable` gate
  for gate, including the keyword cases, the marker cost, the action price
  (`compileCostProgram` + `canPayCostProgram`) and `canResolve`; `whyNotPay`
  reports count and colour separately and falls into `other` only when the
  planner still cannot settle it; `forbiddenBy` walks the same three rule
  sources as `forbids` in the same order. `rejectedActions` is built *from*
  the legal list, so the disjointness invariant holds by construction, and a
  twin that finds nothing is a counted `other`, never silence.
- **Durations expire at the right moments** — see §4. The `master`-relative
  reading of `nextTurn` / `opponentTurn` (a [Counter] resolving on the
  opponent's turn) is right and tested; `afterNextCharge` is spent by the
  Active Step it was written for.
- **The static layer's conditional permanents work**: "gains +5000 power and
  [Critical] during your turn" compiles to `if isTurnPlayer` and the probe
  shows 15000 with [Critical] on your turn, 10000 without on theirs.
- **The prompt chain is engine-owned.** `step` is read from the script frame's
  `choose` ops, `choices` from the prompt's candidates under the same hiding
  rules as the board, `min`/`max` from the prompt itself.
- **The beat translation is exhaustive** over `GameEvent`, so a new event is a
  compile error rather than a silent omission — which is exactly why the two
  deliberate drops in it (`effect`, and the absence of any expiry event) are
  the place to look, §3.3.

---

## 3. Gaps, ranked

Each: what was found, the evidence, why it matters to the workflow, a fix
sketch, and the test that would pin it.

### 3.1 [Limit X] does not gate [Activate] skills — engine bug, 22-44

**Found.** `parseSkills` sets `limit` from the tag and `oncePerTurn` only from
the words "once per turn" (`cards.ts:315-316`). `activatable` checks
`sk.oncePerTurn && inst.usedThisTurn.includes(sk.index)` and nothing else
(`engine.ts:1789`); `activate` does push the index onto `usedThisTurn` for a
`limit` skill (`:2556`), but nothing on the [Activate] path reads it back.
`resolveAuto` does it properly for [Auto] (`:432-436`). `whyNotActivate`
mirrors the same omission, so there is no rejection either.

**Evidence** (probe, two synthetic cards `[Activate: Main][Limit 1] Draw 1
card.` and `[Limit 2]`):

```
2a after one use of [Limit 1] and two of [Limit 2]: activations offered
 ["Activate LIMITED: Draw 1 card.", "Activate LIMITED2: Draw 1 card."]
2a usedThisTurn   { lim: [0], lim2: [0, 0] }
2a rejected for LIMITED   []
2a [Limit 1] activated a SECOND time   { hand: 4 }
```

`docs/arena-next-stage-spec.md` §1 lists Limit among the keywords with an
engine rule; that is true for [Auto] only.

**Why it matters here.** The workflow's `oncePerTurn` requirement exists for
precisely this refusal, and the UI would word it correctly today — the engine
simply never raises it. Real cards print `[Limit 1]` far more often than
`[Once per turn]` on [Activate] skills.

**Fix.** In `activatable`, replace the `oncePerTurn` test with the same count
`resolveAuto` uses:

```ts
const cap = sk.oncePerTurn ? 1 : sk.limit;
if (cap != null && inst.usedThisTurn.filter((i) => i === sk.index).length >= cap) return null;
```

and the identical line in `whyNotActivate` pushing `{ kind: "oncePerTurn",
what: "skill" }`. 22-44-3 counts across *all copies of the same card number*
for one master; the per-instance count is the same approximation
`resolveAuto` already makes and is fine for now, but say so in the comment.
`wording.ts` `oncePerTurn` should say "[Limit N]" rather than "[Once per
turn]" when it is one — the requirement needs a `limit?: number` for that.

**Test.** `[Activate: Main][Limit 2]`: offered, offered, then absent from
`legal` and present in `rejected` with `oncePerTurn` first; a `[Limit 1]`
and a `[Once per turn]` behave identically.

### 3.2 Every text [Activate] fires two `skill` events — beat/narration bug

**Found.** `activate` pushes `{ type: "skill" }` unconditionally
(`engine.ts:2559`), then for a text skill queues `skill.resolve` (`:2677`,
`:2720`), whose handler pushes the same event again (`:346`). Keyword
branches that resolve natively do not go through `skill.resolve`, so only
text skills double.

**Evidence** (probe, `[Activate: Main] This card gets +5000 power and
[Critical] for the turn.`):

```
2b events   ["action", "skill", "skill", "effect", "effect"]
2b beats    ["skill", "skill"]
```

**Why it matters.** `toBeats` turns each into a beat, `narrate` turns each
beat into "You use 《Activate: Main》 on PUMP — …", and the ribbon holds the
last one, so the player reads it twice and a client counting beats is off by
one per activation. None of the fixtures contains an [Activate], which is
why the contract sweep did not see it.

**Fix.** Drop the push at `:2559` for the branches that go through
`skill.resolve`, or make `skill.resolve` the only place a `skill` event is
written and have the keyword branches that resolve inline push their own.
The second is cleaner: one event per resolution, wherever it resolves.

**Test.** An `activate` fixture (there is none) with exactly one `skill`
beat; `npm run contract:emit` afterwards.

### 3.3 Ongoing effects have no workflow surface

This is the heart of the question asked. Three separate absences, in the
order a player would hit them.

**(a) No beat when an effect begins.** `toBeats` maps `effect` to nothing
with the comment "continuous effects show up as changed power figures"
(`beats.ts:226`). True for `power` and `comboPower`; false for `keyword`
(the card grows a glyph, at most three, only for keywords in
`KEYWORD_GLYPH`), and silent for `forbid`, `permit`, `negateSkills`,
`negateSkill`, `negateSkillKind`. During the opponent's playback a +10000
before a clash is visible only as the clash's numbers; a "your Battle Cards
can't attack until the start of my next turn" is invisible until you tap a
card on your turn and it shakes.

**(b) No event when an effect ends.** `endEffects`, `endTurnRelativeEffects`
and the `afterNextCharge` filter in `turn.activeAll` all mutate
`s.effects` and write nothing to `ev`. Probe: ending the turn after the pump
produced `["action", "phase", "phase", "move", "draw"]` and the two effects
were gone. `GameEvent` has no shape for it. So a card that stood at 15000
reads 10000 in the next snapshot with no beat in between, and during the
opponent's turn playback the number changes mid-story with no sentence.

**(c) The view carries the result, not the effect.** `CardView` has `power`
(effective), `keywords` (printed + granted, merged), `reading` (the printed
program), and nothing else. There is no base power, no list of effects on the
card, no `until`, no source. Probe after the pump:

```
2b CardView   { power: 15000, keywords: ["Critical"],
                reading: "this card +5000 power for the turn, this card gains [Critical] for the turn" }
```

A client cannot draw "+5000 this turn" beside the number, cannot mark
[Critical] as granted rather than printed, and cannot say when either
stops. The card action sheet — the one place a card explains itself — lists
moves and refusals and then the printed text, and nothing about what is
*currently* happening to the card.

**Why it matters.** The spec's premise is that a rule you cannot see is
indistinguishable from a bug. An effect is a rule in force. Of the three
kinds of skill, [Auto] and [Activate] got their moment (the `skill` beat);
their *product* did not.

**Fix, additive and contract-safe (§2 decision 6 of the workflow spec):**

1. `types.ts`: `ContinuousEffect` gains `source?: string` (the card whose
   skill made it; `frame.card` in every `addEffect` call in `script.ts`, the
   card in the two `engine.ts` calls). Needed by 3.4 as well.
2. `GameEvent` gains `{ type: "effectEnded"; effect: ContinuousEffect }`,
   written by `endEffects`, `endTurnRelativeEffects` and the
   `afterNextCharge` filter — they need an `ev` parameter; the two callers
   in `exec` have one.
3. `Beat` gains `{ t: "effect"; card: string | null; kind; label: string;
   until: Duration; source: string | null; owner: PlayerId }` and
   `{ t: "effectEnded"; … }`. `label` is worded once, in `beats.ts` from
   the effect (`"+5000 power"`, `"[Critical]"`, `"can't attack"`), or
   better in a pure `effects.ts` beside `wording.ts` so the Android app
   carries the same table. `narrate` gets two cases: *"Son Goku gets +5000
   power until the end of the turn."* / *"…wears off."*
4. `CardView` gains `effects?: { label: string; until: Duration; source:
   string | null; yours: boolean }[]` and `basePower?: number`, built in
   `cardView` from `s.effects` filtered by `target` — and, for the
   [Permanent] half, from `staticEffects` filtered the same way (3.5). The
   sheet lists them under the moves as "In force", the card wears a small
   `+5k` / `↓` badge when `power !== basePower`, and a granted keyword glyph
   gets a ring the printed one does not.
5. `Snapshot.kt` mirrors the fields; `contract:emit`; `android:test`.

**Test.** A pump activation yields exactly one `effect` beat per effect;
`endMain` afterwards yields one `effectEnded` per effect; `view.you.battle[i]
.effects` names both with `until: "turn"`; the `all-beats` fixture gains the
two kinds.

### 3.4 A turn-scoped prohibition cannot name what forbids it

**Found.** `ContinuousEffect` has `master` and `target` but no `source`, so
`forbiddenBy` returns `{ by: null }` for every rule that came from
`s.effects` (`state.ts:961`), and `wording.ts` falls back to *"A skill in
play forbids it. Until that effect ends."* Probe, after "choose 1 of your
opponent's Battle Cards; it can't attack until the end of your opponent's
next turn" and the turn passing:

```
2c p2's attack rejections   [{ label: "Attack with V-BLUE", why: [{ kind: "forbidden", by: null }] }]
2c victim CardView          { keywords: [], power: 10000, reading: "" }
```

The refusal names neither the card that did it nor when it ends, and the
locked card shows nothing until tapped.

**Fix.** `source` from 3.3 step 1, read in `forbiddenBy`; and `Requirement`
`forbidden` gains `until?: Duration` so the remedy can say *"until the end of
this turn"* rather than *"until that effect ends"*. The spec's own example
register (§4) is one fact and one remedy; this is the one kind where the
remedy is currently a shrug.

**Test.** The 2c scenario asserts `by: "LOCKER"` and `until: "nextTurn"`;
`sentence()` reads *"LOCKER forbids it. Until the end of this turn."*

### 3.5 [Permanent] skills have no workflow surface

**Found.** Three sub-cases, all visible in the probe.

- *Conditional permanents flip silently.* `[Permanent] This card gains +5000
  power and [Critical] during your turn.`: on your turn the view shows
  `power: 15000, keywords: ["Critical"]`, on theirs `10000, []`, and
  `reading` is the same sentence both times. Nothing says whether the
  condition holds now.
- *Inert permanents look like working ones.* `staticEffects` only turns the
  ops in `STATIC_OPS` into standing effects; a program made of anything
  else compiles, is described in `reading` with a green border ("Engine
  reads: …"), and does nothing. `arena:coverage` counts these (141 on 6
  Sep) but the client is never told. `emitsStatic` is exported and
  unused by the view.
- *Unreadable permanents wear the wrong badge.* `[Permanent] Negate the
  skills of all of your opponent's Battle Cards with energy costs of 4 or
  less.` → `referee: true`, and the sheet says "Claude rules on this card's
  remaining text when it resolves." A [Permanent] never resolves and the
  referee is never consulted for one (`state.ts:508-509` says so). The
  honest word is "does nothing".

**Why it matters.** The other two skill kinds now answer "why didn't that
happen?"; a [Permanent] is the one kind where the player still has to guess,
and it is the kind whose failure is quietest (the number is simply what it
is). Of the three, the inert case is the worst: the UI actively vouches for
it.

**Fix.** In `cardView`, per [Permanent] skill of the card, classify:
`unread` (unsupported), `inert` (compiles, `!emitsStatic`), `off` (emits,
but no static in `staticEffects(ctx, s)` has this card as `source` right
now), `on`. Emit `permanents?: { text: string; state: "on" | "off" | "inert"
| "unread" }[]` on `CardView`, show it in the sheet ("Permanent · on" / "not
now: only during your turn" / "the engine cannot apply this yet"), and stop
setting `referee` for a [Permanent]. `staticEffects` already records
`source`, so "on/off" costs one filter. The 3.3 `effects` list should
include the static ones with `until: "game"` and `source`, so a card
buffed by someone else's [Permanent] can say so.

**Test.** TURNAURA reads `on` on your turn and `off` on theirs; MUTEPERM
reads `unread` and `referee` is false; a synthetic permanent whose program is
a bare `draw` reads `inert`.

### 3.6 The inspector's wording is wrong for permanents and leaks enum names

**Found.** `durationOf` returns `"turn"` when a clause names no duration —
right for a resolved skill, meaningless for a [Permanent], whose ops the
static layer applies without reading `until` at all. `describeScript` then
prints the `until` verbatim. Probe:

```
[Permanent] This card gets +5000 power.                → "this card +5000 power for the turn"
[Permanent] Your opponent can't attack with Battle Cards. → "your opponent can't attack battle card for the turn"
[Permanent] Your Battle Cards gain [Critical].          → "all in your battle gains [Critical] for the turn"
… can't attack until the end of your opponent's next turn → "… can't attack for the nextTurn"
```

**Fix.** `compileSkill` knows the skill kind: for `permanent`, set `until:
"game"` on every duration-bearing op it emits (one pass over the ops, or
have `durationOf` take the kind). `describeScript` gets a small
`DURATION_IN_WORDS` table (`turn` → "for the turn", `nextTurn` → "until the
end of your opponent's turn", `game` → "while in play"). Also fix the
`filter` description that drops the plural ("battle card").

**Test.** Compile assertions on the four sentences above.

### 3.7 Rejections exist for three prompts only

`rejectedActions` handles `charge`, `main` and `combo` and returns `[]` for
everything else. Missing, in order of how often a phone player will tap
something dead:

- **`counter`** — a counter card in hand you cannot afford, or one whose
  price the engine cannot read: `whyNotPay` on `playCost + orbTotals` and
  `unread`, both already available.
- **`chooseCards`** — the card you wanted to choose but the prompt does not
  offer: [Barrier] (`beChosen`), the filter, `notSelf`. The `choose` op
  records its clause in `reason`, and `resolveSelector` knows why a card is
  out; a `target` requirement with that reason is enough.
- **`blocker`** — a [Blocker] card that cannot block: rested, or `forbids
  block`.

Same pattern as the existing three; cap one per card per type.

### 3.8 A skill's orb cost is not on its row

`priceOf` for `activate` regex-reads `(N)` off the label, and the board
text-skill label is `Activate NAME: <effect>` with no price. So a `{r}{r}`
skill sits in the sheet with no pill, against the spec's "every legal action
with its price on it". `LegalAction` should carry `cost?: { energy?: number;
orbs?: Partial<Record<Color, number>>; markers?: number; describe: string }`
filled by `activatable` from `orbTotals`/`markerCost`, and `priceOf` should
read that instead of the label. Additive; `Snapshot.kt` mirrors it.

### 3.9 Smaller findings

- `negateSkillsOfKind` with `until: "game"` is coerced to `"turn"`
  (`script.ts:763`) on the comment "no card prints for the game on a single
  kind" — but `durationOf` maps "in all areas" to `game`, and "negate that
  card's [Auto] skills in all areas" compiles to exactly that. Either honour
  it (`negated` on the instance would need to carry kinds) or fail the
  clause; silently shortening it is the one outcome the ground rules forbid.
- `stepFor` counts only top-level `choose` ops in the frame. A `choose`
  inside `may`/`if`/a modal option is not counted, and the prompts `may`
  and `chooseMode` raise are not counted as steps at all, so a skill that
  asks "may?" then "choose 1" shows "step 1 of 1" on both prompts.
  Count `choose | may | chooseMode` and recurse into `then`/`else`/`ops`/
  `modes` when a program is spliced (the frame's ops change on splice, so
  the count should be taken from the *original* program, stored once on the
  frame).
- `wording.ts` `mode` says "It stands back up at the start of your next
  turn" — false for a card under `afterNextCharge` / [Servant]; once 3.3's
  `effects` exist the remedy can check for a `switchToActive` ban first.
- `whyNotAttack` puts `timing: nextTurn` before `mode`, so on turn 1 a
  rested card is blamed on the turn — fine, since on turn 1 nothing rested
  can attack anyway, but "most decisive first" is a judgement worth a
  comment.

---

## 4. How the durations behave — verified

Where each `until` is created and where it dies. All correct as read and as
the existing tests assert; listed so the 3.3 `effectEnded` event can be
written at exactly these points and nowhere else.

| `until` | printed as | ends at | where | note |
|---|---|---|---|---|
| `battle` | "for the battle" | Battle Cleanup | `battleCleanup` → `endEffects(s, "battle")` | created outside a battle it lingers until the next one ends |
| `turn` | "for the turn", or nothing | Cleanup of the turn it was made in, whoever made it | `turn.cleanup` → `endEffects(s, "turn")` | the default for any clause with no duration, including every [Permanent] op (3.6) — harmless there because the static layer ignores `until` |
| `nextTurn` | "until the end of your opponent's (next) turn", "until the start of your next turn", the rest-lock wordings | start of the **master's** next turn | `turn.start` → `endTurnRelativeEffects` | master-relative, so a [Counter]'s effect on the opponent's turn ends as your next begins; tested |
| `opponentTurn` | "until (the start of) your opponent's next turn" | start of the **opponent's** next turn | same | tested |
| `afterNextCharge` | "during your next Charge Phase" | after the Active Step of the target's owner's next turn | `turn.activeAll` filter | spent, not expired; only meaningful with a `switchToActive` ban |
| `game` | "for the game", "in all areas" | never (`negateSkills`: `negated = "all"` on the instance, cleared when the card leaves play) | — | `negateSkillKind` is the exception in 3.9 |

Delayed effects (`state.delayed`) are the other ongoing thing and are already
visible: they get a `delayed` event when written (dropped by `toBeats` — it
could become a beat in the same pass as 3.3) and their `skill`-less ops run
inside a `script.step`, so the *result* shows. What does not show is the
"written down" moment, which is exactly the "at the end of the turn, KO it"
a player most wants to see hanging over a card.

---

## 5. Suggested order

1. **3.1 and 3.2** — engine bugs with one-line fixes and clear tests; do first
   and separately.
2. **3.3 + 3.4 together** — one commit that adds `source`, `effectEnded`,
   the two beats, `CardView.effects`/`basePower`, the richer `forbidden`,
   fixture churn, Kotlin. This is Phase 1's shape applied to effects and is
   the item that answers the question asked.
3. **3.5** — [Permanent] state on the card, in the same shape.
4. **3.6** — wording; small, do with 3.5 since both touch what the sheet
   says about a permanent.
5. **3.7, 3.8** — widen the rejection and price coverage.
6. **3.9** — as they come up.

Gate for all of it, per `docs/arena-next-stage-spec.md` §2.7: `typecheck`,
`lint`, `npm test`, `build`, `arena:fuzz 40`, and `contract:emit` +
`android:test` whenever a `Snapshot` field is added.
