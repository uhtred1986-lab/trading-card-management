# Arena — the two refusals the probe could not word

The work brief for the two findings the Rules Workbench, phase 3 (PR #58, merge `e756565`,
8 Sep 2026) measured and deliberately left open. Both are the same promise:
`docs/arena-workflow-spec.md` §3.1 — beside `legalActions` stands `rejectedActions`, every
predicate has a `whyNot*` twin, and a move off the menu can always be worded.

Read `docs/arena-workflow-spec.md` §3.1–§3.2 and §4 before this file. This brief does not
restate the vocabulary; it says which two holes are left in it, what each is really caused
by, and what a fix costs.

---

## 0. How to run this

Same shape as the workflow brief. Commit this file, plan before editing, and keep
`legalActions` and every existing predicate body untouched — the `whyNot*` twins are the
only side that changes, which is the rule §3.2 exists to protect.

**Measure with the sweep.** `npm run arena:probe -- --all` is the instrument: 13,563 rules,
read-only, no writes. Every change to `legalActions` / `rejectedActions` states the numbers
before and after. `npm run arena:reprobe` is not a net here — nothing is confirmed, so it
re-runs 0 probes.

**Measure before the push.** A branch's Vercel preview build runs `db:migrate`, and there is
one database for dev, preview and production.

### The baseline, re-measured on `main` (8 Sep 2026)

`npm run arena:probe -- --all`, 13,563 rules, 0 errors:

```
fired 5674 · notOffered 3505 · blank 1330 · inForce 1114 · noScenario 1042 · didNotFire 898
activateMain 3246 · play 2582 · permanent 1811 · keyword 1573 · attack 1453 · none 1042 ·
activateBattle 707 · counter 543 · combo 387 · moment 219

678 refusals with no reason at all
```

Identical to the numbers PR #58 reported, so the instrument reads the same here.

---

## 1. Finding 1 — a negated card falls out of both lists

A card in the Battle Area whose skills a `negateSkills` continuous effect has silenced is in
**neither** `legalActions` nor `rejectedActions`. The board can give no reason at all, and the
reason it should give — "the skill is negated" — is a branch the twin already carries.

### The repro, reduced

Pure engine, no database. Against `scripts/verify/harness`:

```ts
const s = arena({ battle: ["PUMP"], energy: ["V1", "V1", "V1"] }); // [Activate: Main] +5000 power
const inst = find(s, "p1", "battle", "PUMP");
// before:            legal = 1   rejected = 0
addEffect(s, [], { target: inst, kind: "negateSkills", value: 0, until: "turn", master: "p2" });
// after negateSkills: legal = 0   rejected = 0      ← the hole
```

The same board with the *single-skill* form of the negation answers correctly:

```ts
addEffect(s, [], { target: inst, kind: "negateSkill", value: 0, until: "turn", master: "p2" });
// legal = 0   rejected = [{ kind: "other", detail: "the skill is negated" }]
```

So the vocabulary is not missing a kind. One of the two negations reaches the twin and the
other does not.

### Why, exactly — two places, both on the reporting side

1. **`rejectedActions` (`engine.ts`)** feeds `rejectActivate` from `skillsOfInstance` for cards
   in play (two call sites, the `main` and the `combo` prompts). `skillsOfInstance`
   (`state.ts`) opens with `if (inst.hidden || skillsNegated(s, id)) return []` — so for a
   wholly negated card the twin is handed nothing and has nothing to explain. Cards *in hand*
   are already fed from the printed `skillsOf(def(...))` and do not have this hole.
2. **`skillNegated` (`state.ts`)** — the predicate `whyNotActivate` consults for its
   `{ kind: "other", detail: "the skill is negated" }` branch — reads `negated: "all"`,
   `negateSkill` and `negateSkillKind`, but **not** `negateSkills`. So even handed the skill,
   the twin would not name the negation.

`activatable` is right as it stands: the skill genuinely cannot be declared, and it says no
for the same board. This is a twin that cannot see, not a predicate that is wrong — which is
why the fix belongs entirely on the reporting side.

### The proposed fix

- `rejectedActions`: at the two in-play call sites, hand `rejectActivate` the printed skills
  when the card's skills are wholly negated, so the twin has something to explain. The
  `offered` set already keeps anything on the menu out of the rejected list, so a card that is
  only *partly* negated is unaffected.
- `whyNotActivate`: widen its first test to `skillsNegated(s, card) || skillNegated(...)`, so
  the whole-card form reaches the branch that is already written. `skillNegated` itself is left
  alone — it has ten callers in `engine.ts`, `state.ts`, `script.ts` and `triggers.ts`, and
  widening it there would be a change to a predicate, which §3.2 forbids.

Roughly ten lines in `src/lib/arena/engine`, no new `Requirement` kind, no view or `Snapshot`
change.

### The test

`scripts/verify/workflow.ts`, in the block that already covers activation rejections: the
repro above, asserting **both** sides — the activation is gone from `legalActions` *and*
`rejectedActions` names the negation — plus the `negateSkill` twin beside it, so the pair
cannot drift apart again. Order stays as `scripts/verify-arena.ts` fixes it.

Expected sweep effect: **none.** The probe's `negated` variant is not the default scenario the
sweep runs, so this is a correctness fix the sweep will not see. That is the honest statement
and it should be in the commit message.

---

## 2. Finding 2 — 678 refusals with no reason

`npm run arena:probe -- --all` ends with:

```
678 refusals with no reason at all (the engine offers the move nowhere and explains it nowhere),
e.g. BT20-087 [activate:main 20], BT15-057 [activate:battle 20], BT7-048 [auto 20],
BT29-090 [activate:battle 10], BT3-018 [activate:main 20]
```

PR #58 read these as "most of them second and third skill lines whose price is an action" and
filed them against the compile-at-game-time corner. **The first half of that reading is right
and the second is not**, and the difference decides which of (a) and (b) below is worth doing.

### What the 678 actually are, measured

Every one of the 678, broken down:

| by family | n | | by position among the card's skills | n |
|---|---|---|---|---|
| activateMain | 466 | | the card's **last** skill | 591 |
| activateBattle | 169 | | a middle skill | 49 |
| keyword | 29 | | the card's **first** skill | 38 |
| play (an `[Auto]`) | 14 | | | |

| by price shape | n |
|---|---|
| an action ("Place 1 card from your hand under a {Spirit Bomb}") | 478 |
| **no price at all** | 191 |
| orbs only | 9 |

**640 of 678 are not the card's first skill.** The price correlates — later skill lines do tend
to carry action prices — but 191 have no price whatsoever and 9 are plain orbs, which the
price theory cannot explain at all. Position explains all 678; price explains 478.

### The cause: the one-rejection-per-card cap

§3.2 asked for it in as many words — *"return at most one `RejectedAction` per card per action
type"* — and `rejectedActions` implements it twice over:

- `rejectActivate` walks the card's skills and **returns after the first** whose twin answers
  at all, so skills 2..n are never asked; and
- `push` keys `seen` and `offered` on `` `${action.type}:${cardOf(action)}` `` — the card, not
  the skill — so a card with one offered activation swallows every other one.

The probe asks about one *rule*, and a rule is one skill: its goal matches
`a.type === "activate" && a.card === card && a.skill === rule.skillIndex`. A rejection filed
under skill 0 does not answer a question about skill 20. Hence the concentration on last
lines, and hence `[activate:main 20]`, `[activate:battle 20]`, `[activate:battle 10]` in the
sample the sweep prints.

### Measured, not argued

Keying `seen`/`offered` by skill index for `activate` actions and letting `rejectActivate`
report every skill rather than the first, then re-running the same count over the same 13,563
rules:

```
678  →  74        (−604, 89 %)
```

The residue of 74, all of them cases where the twin returns `null` (the skill is never a
declared move) or where the prompt the probe stopped at enumerates no activations at all:

| | n | what it is |
|---|---|---|
| keyword | 29 | `[Double Strike]`, `[Alliance]`, `[Rejuvenate]` — keywords with no activation of their own, asked for one by the probe's keyword goal |
| activateBattle | 25 | the probe stops at a `counter` prompt, whose `rejectedActions` case files counter cards only and never calls `rejectActivate` |
| play (`[Auto]`) | 14 | an `[Auto]` is not a declared move; `whyNotActivate` correctly returns `null` |
| activateMain | 6 | same shape |

None of the 74 is a price. Two are engine gaps worth their own line (the `counter` prompt case,
and `BT29-044`, a Unison the staging removes from the game before the move is reached); the
rest is probe staging, which belongs with the thin-board session the worklist already carves
out.

### (a) The wording — a `rejectedActions` change only

Give every skill its own rejection: key `seen` and `offered` by skill index for `activate`, and
let `rejectActivate` walk the whole list. Nothing else in the engine moves.

- **Amends a decision, so it needs the owner's word.** §3.2's cap was written against "a hand of
  ten cards times several branches"; this narrows it to *per card, per action type, per skill*
  for activations only, which are bounded by the card's own skill lines (nine at the worst in
  the catalog, three or four typically). The cap stays exactly as it is for play, charge,
  attack, combo, counter and block. §3.2 gets the amendment written into it.
- **No shape change.** `tappable` already merges several rejections per card into
  `whyByCard` and dedupes identical requirements, so `Snapshot`, the client contract and the
  Kotlin fixtures are untouched. The board's refusal line does get more to say about a
  multi-skill card; if it reads long in practice the answer is a cap on *requirements shown*,
  in `wording.ts`/the sheet, not a cap on what the engine reports.
- **Tests:** `assertDisjoint` in `scripts/verify/harness.ts` keys its "two rejections for X"
  assertion on the card alone and must learn the skill index — that harness change is the one
  place the new promise is written down, so it carries a comment saying so. Plus a case in
  `scripts/verify/workflow.ts` for a card with two activations where only the second is
  refused.
- **Numbers to report:** the full sweep before and after, and the 678 → 74 line. The other
  outcome counts should not move; if they do, that is the finding.

### (b) The mechanism — the engine reads the price from the row

The announced change: stop compiling the price before the colon at game time
(`costIsReadable`, `canPayCostProgram` and the five sites around them in `engine.ts`) and read
`cost.condition` / `cost.program` off the `card_rules` row, which has carried them since phase
2. It touches `activate`, `canResolve` and `altCostFor`, and the owner has asked for
`npm run arena:fuzz -- 100` on it.

It is the right change — CLAUDE.md's "Rules are records" says the engine **never** compiles card
text at game time, and these five sites are where that is still untrue. But on *this* metric it
is worth at most the 20 remaining action-priced entries, because (a) takes the other 604 first.
Its case is architectural, not this number.

### Recommendation

**Do Finding 1 and (a) in this session. Leave (b) for its own.**

- (a) removes 89 % of the count, needs no engine mechanics, no fuzzer run and no re-draft, and
  is exactly what §3.1 promises.
- (b) is a real change with a real risk surface whose yield *on this measurement* is small. Run
  together, the two would land in one sweep and neither could be read: the whole point of
  quoting a before and an after is lost when two changes share one. It deserves its own
  session, its own before/after and its own fuzzer run — and it starts from a better baseline
  once (a) has cleared the noise.

---

## 3. Not in this brief

Named so they are not mistaken for forgotten. Both are probe staging, not engine faults, and
the worklist already holds them:

- attack triggers about being attacked or KO'd — 623 `didNotFire`;
- keywords whose price is in the Drop or the hand — `[Union]`, `[Over Realm]`, `[Successor]` —
  which the probe cannot pay for and which therefore report "not offered" with the engine's own
  reason.

## 4. One piece of housekeeping

`scripts/_why.mts` was a scratch analysis script committed by accident in `3f6398a`. Nothing in
`package.json`, `docs/` or `CLAUDE.md` referred to it. Deleted.

---

## 5. What was built (8 Sep 2026)

Both findings, in two commits. **(b) was not built** — see the recommendation in §2, which the
owner took.

- **Finding 1** — the twin reads `skillsNegated` as well as `skillNegated`, and `rejectedActions`
  hands it the printed skills for a wholly negated card in play. `skillNegated`, `activatable` and
  every other predicate untouched. Sweep unchanged, exactly as predicted here: this is a
  correctness fix the default scenario cannot see.
- **Finding 2 (a)** — activations are keyed by skill index and every line is reported.
  **678 → 74** refusals with no reason, every other number in the sweep identical. §3.2 of
  `docs/arena-workflow-spec.md` carries the amendment.

Two consequences the change forced rather than chose, both in the same commit: the rejection label
names the skill line the way the menu does (six contract fixtures moved by that one string, no
shape change), and the card action sheet stopped keying its rows on the action type alone.

`npm test` · `lint` · `typecheck` · `build` clean; `arena:fuzz -- 100` → 100 games, 0 crashes;
`arena:playthrough` passes and its `other` bucket carries no "not offered by the engine", so no
twin drift shows in a real game. `android:test` needs a Docker daemon the sandbox has none of; CI
runs it.

### What is left, with numbers

The 74, none of which is a price:

- **31** — the probe stops at a `counter` prompt, and `rejectedActions`' `counter` case files
  counter cards only and never calls `rejectActivate`. A real gap, and the next thing here.
  `BT29-044` belongs with it: a Unison the staging removes from the game before the move is
  reached.
- **43** — 29 keywords with no activation of their own and 14 `[Auto]`s, both of which
  `whyNotActivate` rightly declines to invent a rejection for. Probe staging, so they go with §3.
- **(b)** — done, see §6 below.

---

## 6. (b), done separately (8 Sep 2026)

Its own commit, its own before and after, as §2 argued for.

**What moved.** `Script` gained `price` (`SkillPrice`: the condition and the action, read together,
4-3-3), so a program and its price travel as one record. `rulesFor` fills it from
`card_rules.cost`, which the drafter has written since phase 2 and nobody read; `compileCard` fills
it from the text, which is what keeps `npm test` and the probe playing prices without the engine
calling the compiler. `priceFor` in `engine.ts` is the one reader, and the six sites — `canResolve`,
two branches of `activatable`, two of `whyNotActivate`, and the payment in `activate` — use it.

**`engine.ts` no longer imports `compileCostProgram` or `priceCondition`.** What remains of its
compile import is `costIsOnlyOrbs` and `costText` (spelling tests over the printed price, no program
built) and `parseConditionClause` for a keyword's own reminder. No program is compiled during a game.

**The measurement is a sameness, and that is the point.** Sweep before and after, 13,563 rules,
0 errors: `fired 5674 · notOffered 3505 · blank 1330 · inForce 1114 · noScenario 1042 ·
didNotFire 898`, all ten family rows, and 74 refusals with no reason — **byte-identical**. Over the
whole catalog the price the drafter stored and the price the engine used to recompute agree
everywhere. `arena:fuzz -- 100`: 100 games, 0 crashes. `arena:playthrough` passes, and its `other`
bucket still shows action prices charged and refused, which is the record-driven price working in a
real game.

**One behaviour changes, deliberately.** A skill with **no record** has an *unknown* price, not a
free one: it is refused and the refusal says the text is unread. That is the honest answer for a
card `arena:draft` has never seen, and it matches an undrafted skill already having no effect
program. All 13,563 catalog rules have a row.

A sweep that does not move is easy to mistake for a change that did not land, so the test is the
part that earns it: it fails when `priceFor` is made to fall back to compiling, and it pins the one
board that separates the two readings — a record whose *effect* is readable but which carries **no
price** is refused rather than offered for free. An earlier version of that test passed for the
wrong reason (the effect was unread too, so the price was never the deciding gate); the mutation run
is what caught it.
