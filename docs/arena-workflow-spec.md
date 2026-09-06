# Arena — every rule as a workflow

**Status: Phases 1–3 built (6 Sep 2026); Phase 4 (Android) not started.** Written to be executed
by Claude Code in this repository. §9 records what was built and where it departs from the brief.

The board today can only draw what `legalActions` offers, and `legalActions` offers only what is
legal. That single fact is the root of everything below: a card you cannot play is silent, a skill
with a cost is one unexplained tap, a choice from the deck has nowhere to point, and an ability
Claude uses goes past as motion. This brief makes the *rules themselves* the thing the interface
shows — every one of them as a named workflow with a step, a cost, a reason, and a sentence.

---

## 0. How to run this

Everything needed to start is in this section; §1 onward is the work itself.

### 0.1 Put the brief in the repo

Save this file as `docs/arena-workflow-spec.md` and commit it. It belongs beside the other arena
specs and is meant to be read by the agent doing the work, not just by a person.

### 0.2 Make it self-loading

Add one line to `CLAUDE.md`, in the **Arena UI** bullet, next to the existing pointer at the client
contract:

```
`docs/arena-workflow-spec.md` is the current work brief for making every rule a
visible workflow — read it before touching `legalActions` or the `Snapshot` shape.
```

Without that line the brief is only found when it is named. With it, any future session that goes
near `legalActions` picks it up on its own.

### 0.3 Start the session

From the repo root:

```
claude
```

Enter plan mode (`shift+tab` twice) for the first turn — this touches `engine.ts`, and the approach
is worth seeing before the diff exists. Then paste:

> Read `docs/arena-workflow-spec.md`, then `docs/arena-client-contract.md`. Implement **Phase 1
> only** — §3.1 through §3.6. Do not start Phase 2. Plan first and show me the plan before you edit
> anything.

### 0.4 Three things to watch in the diff

- **Nothing in `legalActions` or in any existing predicate body should change.** §2 decision 2 and
  §3.2 explain why the design adds `whyNot*` twins instead. If the diff starts editing
  `planPayment`, `canPlay`, `canCombo` or `activatable` themselves, stop the pass — that is the
  failure mode this shape exists to prevent.
- **Phase 1 changes no pixels.** That is deliberate (§3), and it means there is nothing to look at
  until Phase 2. Judge it by `npm test` and the fixture diff, not by opening the board.
- **The Android app does not exist.** `android/` is a Gradle skeleton plus the shared `contract`
  module — there is no UI to patch. What Phase 1 does for it is make sure `Snapshot.kt` and the
  golden fixtures carry these fields from day one, so the app inherits the workflow model whenever
  it gets built rather than retrofitting it.

### 0.5 When it is done

Run everything in §5. `npm run contract:emit` rewrites the fixtures after a deliberate shape change;
`npm run android:test` proves the Kotlin still round-trips them. Then read §7 for what comes next,
and note the gate in §5 that Phase 2 sits behind.

### 0.6 Reading order for the agent

1. This file.
2. `docs/arena-client-contract.md` — §1 is the rule this brief must not break, §3 the `Snapshot`,
   §4 the beats, §7 the fixtures.
3. `docs/arena-ui-motion-spec.md` §7 — the beat storyboard Phases 2 and 3 extend.

**This brief is Phase 1 only.** Phases 2–4 are sketched in §7 so that the shapes built here are the
right ones; they are not in scope and must not be started in the same pass.

---

## 1. What already exists, verified

Read before writing; each of these was checked in the tree on 6 Sep 2026.

- **`legalActions(ctx, s)` (`engine.ts:1368`) returns only legal moves**, each with a `label`.
  Illegality is expressed by `continue` and by unentered `if` branches. `mainActions` (`:1483`) is
  the dense case: `planPayment(…) && canPlay(…)`, `canCombo(d)`, `forbids(ctx, s, …)`,
  `activatable(…)`. Nothing anywhere records *why* a branch was not taken.
- **`Tappable.byCard` (`view.ts`) is keyed by card instance id**, and the board renders only cards
  that appear in a `SideView` zone. A `choose` prompt naming cards in the deck therefore produces
  `byCard` entries for ids that no element on the board carries: the action is legal and
  unreachable. `SideView` has `deck: number`, `drop: number`, and a single `dropTop`.
- **`BoardView.prompt` is `{ kind, player, question, hint }`** — one line of text. The engine's own
  prompt union is much richer: `choose` carries `choice.min` / `choice.max` and a `reason`,
  `payCost` carries `describe`, `chooseMode` carries the options. That detail is flattened to a
  string in `questionFor` (`view.ts:182`) and cannot be recovered by a client.
- **The `skill` beat already exists** — `{ t: "skill"; card; label; text; unread }` — but carries no
  owner, so a client cannot say *whose* ability just resolved.
- **`contract/fixtures/*.json` are the anti-drift mechanism.** `npm test` re-emits and diffs them;
  `npm run contract:emit` rewrites them deliberately; `npm run android:test` round-trips them
  through `android/contract/src/main/kotlin/arena/Snapshot.kt` in Docker. Any field added below must
  land in all three in the same commit.
- **The Android app does not exist.** `android/` is a Gradle skeleton plus the shared `contract`
  module. "Both clients" today means: the web board, and the Kotlin data classes that the app will
  inherit. Keep them in step; do not build UI for an app that has no modules.

## 2. Decisions

Take these as given. Each was a real fork; the reasoning matters more than the choice.

1. **Reasons come from the engine, never from a client.** The moment a board decides that four
   energy is not three, contract §1 is broken and the two clients begin to drift. A rejection is a
   rules judgement and belongs beside the rule.
2. **A second list, not a richer `LegalAction`.** `legalActions` keeps its exact current shape and
   meaning — *these are the moves the server will accept*. Rejections go in a parallel
   `rejectedActions()`. Nothing that reads `legal` today has to change, and no caller can
   accidentally send a rejected action because it never appears in the list actions are indexed
   from.
3. **A closed vocabulary of requirement kinds, not free text.** `{ kind: "energy", need, have }`
   rather than `"needs 4 energy, you have 3"`. The client renders the sentence, which means one
   place to change the wording, a phone and a watch can phrase it differently, and German is a
   translation rather than a fork. The engine may attach a `detail` string for the long tail.
4. **Rejections are computed for the viewer only, and capped.** They are answers to *"why can't I"*,
   which only the player asking can ask. Never compute them for Claude's side — it would double the
   engine work on every snapshot for a player who cannot read.
5. **Step position comes from the engine's prompt chain, not a client counter.** A client counting
   its own taps will be wrong the first time a skill branches, and wrong silently.
6. **Additive only. `contract` stays `1`.** §7 of the contract: adding an optional field is not a
   bump. Every field below is optional and absent-means-unchanged.

## 3. Phase 1 — the foundation

The whole of this phase is invisible in the running app. That is intentional and it is the reason it
goes first: the UI in Phase 2 is small and obvious once these three things exist, and impossible to
do honestly before.

### 3.1 The requirement vocabulary — `engine/types.ts`

```ts
/** Why a move the player might expect is not on the menu. */
export type Requirement =
  | { kind: "energy"; need: number; have: number }
  | { kind: "energyColour"; colour: string; need: number; have: number }
  | { kind: "mode"; card: string; mode: Mode }          // it is resting
  | { kind: "timing"; window: string }                  // not this phase / not your turn
  | { kind: "oncePerTurn"; what: string }               // charge, Unison growth, a [Once per turn] skill
  | { kind: "zone"; card: string; area: Area }          // it is not where the skill needs it
  | { kind: "cardType"; card: string; needs: string }    // "a Battle Card"
  | { kind: "target"; reason: string }                  // nothing legal to point at
  | { kind: "forbidden"; by: string | null }            // a skill in play forbids it (`forbids()`)
  | { kind: "unread"; card: string }                    // the compiler cannot read the text
  | { kind: "other"; detail: string };

export interface RejectedAction {
  /** The action the player was reaching for, in the same shape as a legal one. */
  action: Action;
  /** What the label would have been, so a client can show the move it cannot make. */
  label: string;
  /** Every requirement that failed, most decisive first. Never empty. */
  why: Requirement[];
}
```

`"other"` is a pressure valve with a cost: every use of it is a sentence the client cannot style,
translate, or count. Treat a growing `other` as the signal to add a kind.

### 3.2 `rejectedActions(ctx, s)` — `engine.ts`

Sits beside `legalActions`, same signature, returns `RejectedAction[]`.

**Do not rewrite the rule logic.** The gates in `mainActions` are already named predicates —
`planPayment`, `canPlay`, `canCombo`, `activatable`, `forbids` — and the vocabulary in §3.1 was
chosen to map onto them one for one. The refactor is to make each predicate report rather than only
answer, in the cheapest way that does not disturb its callers:

- Add a `why` variant beside each predicate (`whyNotPlay`, `whyNotPay`, `whyNotCombo`,
  `whyNotActivate`) that returns `Requirement[]` and is called **only** from `rejectedActions`. The
  existing boolean predicates keep their exact signatures and behaviour, and each `why` function is
  the same tests in the same order, returning instead of short-circuiting.
- Duplication between the pair is the trade being made deliberately: the alternative is threading a
  reason collector through hot paths that run on every legal-move enumeration, including Claude's.
  Keep each pair adjacent in the file and covered by the same test so they cannot drift.
- Cover, in this order of value: **play from hand** (energy, colour, timing, `forbids`),
  **activate a skill** (once-per-turn, mode, zone, cost, unread text), **attack** (mode, timing, no
  legal target), **combo** (cost, `canCombo`), **charge** (already charged, `forbids`).
- Cap the output. A hand of ten cards times several branches is a long list nobody reads; return at
  most one `RejectedAction` per card per action type, keeping the most decisive requirement first.

### 3.3 The view — `view.ts`

Three additions, all optional:

```ts
export interface Tappable {
  byCard: Record<string, number[]>;
  bare: number[];
  attackTargets: Record<string, Record<string, number>>;
  /** NEW — rejections indexed the same way, so a tap on a dead card has an answer. */
  whyByCard?: Record<string, Requirement[]>;
}

export interface SideView {
  // …unchanged…
  /** NEW — cards the current prompt names that live in no visible zone (deck, drop, warp).
   *  Absent unless the prompt names them. This is what makes a search renderable at all. */
  choices?: CardView[];
}

// BoardView.prompt gains, all optional:
//   min?: number; max?: number;         // from the engine's `choose` prompt
//   step?: { index: number; count: number; label: string };
//   cost?: string;                      // `payCost`'s `describe`, unflattened
```

`choices` is the field that turns "a skill that searches the deck is unreachable" from unfixable
into a component. It must be built from the same `viewerOf` hiding rules as everything else in
`boardView` — a search of *your* deck reveals those cards to you and to nobody else, and `npm test`
should assert exactly that.

`step` comes from the engine: when a prompt is part of a skill's resolution chain, the flow already
knows how many prompts that chain will ask. If the flow cannot answer cheaply, emit
`{ index, count: 0, label }` and let the client show "step 2" without a total rather than inventing
one.

### 3.4 Beats — `beats.ts`

One change only in this phase: `skill` gains `owner: PlayerId`. Without it the opponent narration in
Phase 3 cannot say whose ability resolved, and it is far cheaper to add now, in the same fixture
churn, than in its own commit later.

### 3.5 Snapshot, contract, Kotlin

- `snapshot.ts`: pass the new fields through. No logic.
- `docs/arena-client-contract.md`: update §3 and §4 with the new shapes and a line in §7 recording
  that this was additive and the contract did **not** bump.
- `android/contract/src/main/kotlin/arena/Snapshot.kt`: mirror every field as a nullable/defaulted
  `kotlinx.serialization` property. `Requirement` is a sealed class with `@SerialName` discriminators
  matching `kind` exactly.
- `npm run contract:emit`, then `npm run android:test`. If the Kotlin round-trip fails, the Kotlin is
  wrong — the fixtures are the truth.

### 3.6 Tests — `scripts/verify-arena.ts`

Pure, no database, in the existing `assert` style. At minimum:

- A hand card costing more than the active energy produces exactly one `RejectedAction` whose first
  requirement is `{ kind: "energy", need, have }` with the right numbers.
- A card in Rest Mode offered no attack produces `{ kind: "mode" }`, not `{ kind: "timing" }`.
- After charging, a second charge produces `{ kind: "oncePerTurn", what: "charge" }`.
- **No action appears in both `legal` and `rejected`.** This is the assertion that catches a drifted
  `why` pair, and it should run over every fixture state.
- A `choose` prompt over deck cards populates `view.you.choices` with exactly those cards, and
  `view.them.choices` is absent.
- `rejectedActions` is never computed for the non-viewer: assert it is empty when the prompt belongs
  to the other player.

## 4. How a rejection is worded

Not code, but the reason the vocabulary is shaped this way, and Phase 2 will need it.

A refusal must name **which requirement failed** and **what would satisfy it**. "Illegal move" is not
an answer; neither is a card that simply does not respond. Three examples of the target register:

- *"Twin Moon Ascension costs 4 — 3 energy active, 1 short. Charge a card to gain one."*
- *"You have already charged this turn. This card is playable next turn, once your rested energy
  stands back up."*
- *"Elder Namekian Sage is in Rest Mode — it cannot attack."*

Each is one clause of fact and one clause of remedy. Where there is no remedy this turn, say so
plainly rather than implying one.

## 5. Verification

```powershell
npm run typecheck
npm run lint
npm test                  # includes verify-arena + the fixture diff
npm run contract:emit     # only after a deliberate shape change
npm run android:test      # Docker; the Kotlin round-trip
npm run arena:playthrough # a whole game through the database
```

`arena:playthrough` gains one audit for this phase: on every move, assert that
`legal ∩ rejected = ∅` and that no `RejectedAction` has an empty `why`. It runs the real card pool,
which is the only place the long tail of `activatable` gets exercised.

**The gate this phase does not clear:** nobody has yet played a game on the phone and watched it
(`docs/arena-ui-motion-spec.md` §8). Phase 1 changes no pixels, so it cannot make that worse — but
Phase 2 must not start until one full Tournament game has been played on the owner's device with the
log open.

## 6. Risks

- **Blast radius in `engine.ts`.** The mitigation is the shape of decision 2: `legalActions` is not
  touched. If a diff starts editing the body of an existing predicate, stop — that is the failure
  mode this design exists to avoid.
- **Cost per snapshot.** `rejectedActions` roughly doubles enumeration work for the viewer. Measure
  it in `arena:playthrough`; if a Main Phase snapshot gets materially slower, make it lazy —
  computed on demand behind `/api/v1` and a server action rather than inside `buildSnapshot`.
- **Fixture churn.** Every fixture changes in this commit. Review the diff for *shape*, not content;
  a fixture whose `view` changed in a way this brief did not ask for is a real bug.
- **The `other` valve.** If more than a handful of rejections land as `{ kind: "other" }`, the
  vocabulary is wrong and the client will be stuck printing engine prose. Count them in the
  playthrough audit.

## 7. What comes after (not in scope)

Sketched only so Phase 1 builds the right shapes.

- **Phase 2 — the web workflow UI.** A card action sheet listing every legal action on one card with
  its price on it; the refusal line in the prompt bar driven by `whyByCard`; a full-height search
  sheet driven by `choices` with a "Choose none" button whenever `prompt.min === 0`; a
  `step N of M` chip. All of it in `src/components/arena/stage/` and `shared.tsx`, all of it reading
  fields that exist by then.
- **Phase 3 — the opponent's turn, spelled out.** A narration formatter over the beat stream, bound
  to `playback.current`: one sentence per beat, held after playback stops, with the `skill` beat
  reading *"Claude uses 《Union-Absorb》 — places a card under it, then searches"* rather than a card
  sliding silently. Needs `owner` from §3.4 and nothing else new.
- **Phase 4 — Android.** When the app modules exist, the same three surfaces in Compose, from the
  same `Snapshot`. The Kotlin data classes are already correct if Phase 1 was done properly.

A prototype of Phases 2 and 3 exists as a published artifact — the step chips, refusal wording, deck
search, combo step and clash cinematic are all playable there at phone size:
`https://claude.ai/code/artifact/fe01dff9-b48e-4b66-8d4f-a955fc47b649`. Treat it as a picture of the
destination, not as code to port: it is vanilla HTML with a hand-written state machine and no engine
behind it.

## 8. Where this came from

The gap analysis behind this brief — what Pokémon TCG Pocket, Marvel Snap, Hearthstone and Legends
of Runeterra do on a 360–390 px screen, with sources — is in the project doc
`claude/arena-mobile-ux-research.md`. The three findings that drive Phase 1:

- A skill with a cost is two questions, not one, and each needs its own whole-screen step on a phone.
  Hearthstone had to break battlecry targeting into multiple steps for touch; Marvel Snap removed
  targeting from its ruleset instead, which a DBS engine cannot do.
- A refusal that does not name the failed requirement is indistinguishable from a bug. Silence on a
  mis-tap is the worst available answer, and mis-taps are frequent at this size.
- An optional choice (`min: 0`) needs an explicit "Choose none" button, or the player is stranded in
  a state the rules call legal.

## 9. What was built (6 Sep 2026)

**Phase 1** landed exactly as §3 describes, with one addition to the vocabulary: a `condition`
kind (`{ kind: "condition"; text }`) for a printed condition that does not hold yet, because the
first fixture emit showed every Leader's `[Awaken]` condition in the `other` valve on every Main
Phase snapshot — the signal §3.1 names. `rejectedActions` is built *from* the legal list, so
`legal ∩ rejected = ∅` holds by construction (keyed by card and action type) and a twin that finds
nothing surfaces as a counted `other` rather than silence. `step` is read from the script frame's
`choose` ops when the prompt is inside a compiled skill, otherwise `{ index: 1, count: 0 }`.

**Phase 2** was taken ahead of its gate (§5) at the owner's request, as the Phase F cutover was.
What exists, all in `src/components/arena/` and reading only fields Phase 1 added:

- **`src/lib/arena/wording.ts`** — the one place the web board turns a `Requirement` into English,
  in the register of §4: `refusal()` returns a fact and a remedy (or null when nothing this turn
  will help), `pill()` the two words a disabled row wears, `priceOf()` what a legal move costs.
  Pure, covered by `npm test`, and the table the Android app should carry in Kotlin.
- **The card action sheet** (`CardSheet` in `shared.tsx`) — every legal action on one card with its
  price on it, then every refused move with its reason worded, then the card itself. It opens from
  a tap when a card has more than one move or a move beside a refusal, and from a long press or a
  right-click always. A card whose only moves are attacks still goes straight to targeting.
- **The refusal line** — a tap on a dead card shakes it (`arena-nope`), buzzes `illegal`, and puts
  the first requirement's sentence in the prompt bar in red for five seconds; a second tap opens
  the sheet with every reason. A dead card wears a red cost badge before it is tapped
  (`CardState` `dead`).
- **The search sheet** (`SearchSheet`) — a full-height list over `view.you.choices`, one row per
  card, with **Choose none** whenever `prompt.min === 0`. "See the board" closes it for a look and
  the bar keeps one button, *Choose from N*, to reopen it; the next prompt opens it again.
- **The step chip** (`StepChip`) — `prompt.step` as "step N of M", or "step N" alone, in the
  prompt bar and on the search sheet.

Not done: the missing-energy chips the prototype draws beside the energy strip.

**Phase 3** — the opponent's turn, spelled out — followed in the same session:

- **`src/lib/arena/narration.ts`** — `narrate(beat, narrator)`: one sentence per beat, from the
  beat stream alone. Names come from the `art` the beats already carry, "you" from the viewer,
  and whose ability resolved from `owner` on the `skill` beat (§3.4), which reads
  *"Claude uses 《Union-Absorb》 on Son Goku — Place a card under it, then search."* A hidden card is
  "a card", never a name the viewer may not know. Pure; every kind covered by `npm test`.
- **The narration ribbon** (`NarrationRibbon` in `shared.tsx`) — bound to `playback.current`, so
  the words follow the beat on screen in the story's order, and **held after playback stops**,
  dimmer and with the beat's number, until the player acts. The prompt bar's hint is blanked while
  the story plays, because the next prompt's hint would only mislead there.

Nothing new was needed from the engine or the contract. **The gate now stands for Phase 4 and for
the first real-pool exercise of all three phases:** one full Tournament game on the owner's phone
with the log open.

**Rules in force** (later on 6 Sep 2026, from `docs/arena-compiler-workflow-review.md`): the two
classes of rule the three phases left out — continuous effects with a duration, and [Permanent]
skills — got the same treatment. Additive, contract still `1` (contract §3.2, §4):

- `ContinuousEffect.source`, an `effectEnded` event wherever the engine expires an effect, and
  `effect` / `effectEnded` beats with a sentence each in `narration.ts`; on the board the card
  surges as a rule lands and settles as it wears off.
- `CardView.basePower`, `CardView.effects` and `CardView.permanents`; `SideView.rules` for a rule
  on the player. `src/lib/arena/effects.ts` is the one place a rule becomes a label and a
  duration. The card face shows a coloured `▲`/`▼` power figure when the number is not the printed
  one, a green ring on a keyword a skill granted, and an `∞` chip for a [Permanent] — lit while it
  is in force, dim while it is not, struck when the engine cannot apply it. The sheet lists what
  is in force with its source and its end, and each [Permanent] with its state and why.
- `forbidden` carries `until`, so a refusal ends with *"Until the end of the turn."* or *"While
  Frieza is in play."* rather than *"until that effect ends"*; `oncePerTurn` carries the printed
  `limit`; `mode` says when a lock will keep the card down.
- `LegalAction.cost` from the engine, so a skill's orbs are on its row rather than guessed off the
  label; rejections for the counter window, a `chooseCards` prompt and the blocker prompt.
- Two engine bugs found on the way, both fixed: [Limit X] did not gate [Activate] skills, and every
  text [Activate] emitted its `skill` beat twice.

