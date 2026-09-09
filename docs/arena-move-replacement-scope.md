# Arena — letting a move replacement ask a question: scope, not a patch

Lane J of the rules-language programme's Stage 2 "instead" family. The brief
(`PROMPT.md` on `claude/lane-j-move-refactor`) asked for `move()` (`state.ts`)
to gain a suspension path so a 9-10 replacement effect can prompt the affected
player, and gave an explicit way out: *"If the refactor proves larger than one
lane, STOP and write the design document instead... A precise account of
where it stops is a good outcome."* This is that document. No engine behavior
changes here — the only edit made on this branch is the misleading comment on
`replacementFor` (`state.ts:109-116`), corrected to point here instead of
promising a fix that was never one prompt away.

## 1. What was measured

### 1.1 The mechanism, confirmed

`move()` (`state.ts:866-953`) calls `replacementFor(ctx, s, id, opts.reason)`
(`state.ts:117-129`) once, before `detach(s, id)` at `state.ts:907`. Before
that line only local variables (`to`, `insteadMode`) are touched; `detach`
removes the card from every area array/slot, and everything after it — the
under-stack splice (23-2-5), the active/rest reset, the `enteredTurn` stamp,
and the final placement — assumes the card is either already gone or already
in its new spot. There is no point after `detach` where the state could be
serialized with the card in transit. This confirms the brief's claim exactly:
a decision has to be made **before `move()` is called**, not inside it.

`replacementFor` already has the shape a prompt would need: it iterates every
`StaticEffect` of kind `replaceLeave` targeting the card and returns the
first whose `by` clause (`skill` / `ko` / `skillOrKo` / unset) matches the
move's `reason`. Today it returns the first match; 9-10-2 says the affected
player should choose among several.

### 1.2 All 48 call sites, and which can suspend

Every `move(` call in `src/lib/arena` was enumerated (state.ts ×3, engine.ts
×35, triggers.ts ×1, script.ts ×7, probe.ts ×2 — see the appendix below for
the full table). Two are inside `stepScript`'s resumable per-op loop and
touch cards that can be "in play" when they leave: `script.ts:811` (the
generic `"moveTo"` op, inside `for (const id of resolveRef(...))`) and
`triggers.ts:337`'s `koCard`, invoked from `script.ts`'s `"ko"` op
(`script.ts:776-789`), also inside a `for` loop over `resolveRef(...)`. This
matches the brief's "2 of ~48".

**Both loops mutate per-iteration locals that a mid-loop suspend has to
survive.** `"moveTo"` (`script.ts:791-838`) computes `dest`/`owner` per id and,
load-bearing at line 810, `const leftBattle = areaOf(s, id) === "battle"`
*before* calling `move()`, then compares against the post-move area to decide
whether to fire `removedFromBattle` / `removedByOpponent` / `droppedFromBattle`
/ `leftBattleToDrop` (lines 815-823). `"ko"` similarly snapshots the owner's
drop-pile length before `koCard` to detect whether the KO actually landed
(line 783, compared at 786). Neither `leftBattle` nor the drop-length snapshot
is currently representable in `ScriptFrame` (`script.ts:500-520`, no loop
cursor field of any kind) — the two op cases run their whole `for` loop as one
uninterruptible unit today, the same way `"damage"`, `"mill"`, `"addLife"`,
`"lifeDownTo"` and `"comboFrom"` do. Making either op suspendable mid-loop
means adding a resumable cursor to the frame (which ids are left, and which
per-id locals to carry across the boundary) — the same restructuring
`stepScript`'s `choose` op already does for its own suspension
(`s.flow.unshift({ op: "script.step", frame })`, `script.ts:758`), but applied
to a second, independent loop shape inside the same op handler.

### 1.3 The finding the brief did not anticipate: `reason` is not call-site-scoped

The plan's implicit safety argument is "gate prompting replacements on being
reached from a script frame, refuse the rest." That argument does not close,
because `replacementFor`'s only signal for *which* call site invoked `move()`
is `opts.reason`, and `reason` is not exclusive to the two suspendable sites.
Grepping every `move(` call's `opts` across `engine.ts` shows `reason: "effect"`
used at five more places, none of them inside a resumable frame:
`engine.ts:1313` (`chooseApply` "zstack"), `engine.ts:1333` (`chooseApply`
"evolve" xeno), `engine.ts:2761` (`applyAction` "counter"), `engine.ts:2792`
(`applyAction` "offering"), `engine.ts:3024` (`activate` [Rejuvenate]). A
`replaceLeave` effect compiled with `by: "skill"` — which is exactly what
`parseWouldLeave` (`compile.ts:1345-1392`) emits for the ordinary "would leave
the Battle Area" wording, i.e. all 29 skills working today — matches `reason
=== "effect"` regardless of which of those seven call sites produced it. So a
compile-time gate that says "this card's replacement may prompt because its
only mover is a script frame" cannot be justified from the clause text or the
`by` field alone: the same `StaticEffect` is live for as long as the card
satisfies the [Permanent]'s condition, and any of those seven sites can be the
one that tries to move it out of play while it's live.

This does not block the feature; it changes its shape. The fix cannot be "let
`move()` prompt when reachable from a script frame." It has to be "the two
script-frame call sites *pre-decide* the replacement before calling `move()`
at all, and every other call site keeps calling `move()` exactly as today,
deterministically, via the existing unmodified `replacementFor`." That is
consistent with the brief's proposed shape (a `MoveOptions.replaced` field
that suppresses the lookup) — it just means the suppression is the *only*
new behavior `move()` itself gains; the decision-and-prompt logic lives
entirely in the two callers, not in `move()`.

### 1.4 Where the `by`-optional gap resurfaces

`by` is optional on a compiled `replaceLeave` op (`compile.ts:4143`) — a
replacement with no named cause matches *any* `reason`, including `"rule"`,
`"cost"`, `"play"`, `"combo"`, `"damage"`, `"draw"`, `"charge"`, all of which
are produced exclusively by the 46 non-suspendable sites (state.ts's `draw` /
`payAltCost` / `payZEnergy`, and the bulk of `engine.ts`: end-of-turn rule
cleanups, `battleDamage`'s accumulating loop, `chooseApply`'s cost payments,
`activate`'s keyword costs). Any new "optional" or "multiple replacements"
flag added to such an effect is unaskable from most of the sites where it
could fire. The only safe default — consistent with ground rule 5, "prefer
unread to wrongly read" — is: outside the two script-frame call sites, an
optional ("you may … instead") replacement is never auto-applied, and a
9-10-2 ambiguity keeps today's first-match behavior unchanged. Nothing about
this lane may make the deterministic 46 sites behave differently than they do
today; the feature is additive only at the two suspendable sites.

### 1.5 The compiler side is currently correct, not currently wrong

`parseWouldLeave` (`compile.ts:1345-1392`) only matches "if this card would
leave the Battle Area" — the mandatory 9-10-1 wording. "You may … instead"
clauses (13 cards, 9-10-3) use different phrasing and simply never match this
regex, so they fall through to the general refusal path and are correctly
marked unread today. This is good news for scope, not bad: there is no
existing "compiles and reads wrongly" bug on this family to fix first. It also
means the compiler-side half of this work is net-new grammar (an `optional`
flag on the `replaceLeave` op, a second regex family for "you may" phrasing,
`filterFor`'s existing subject-naming path reused), not a correction.

## 2. What a full fix costs

In scope, all touched in one coherent change, none separable without leaving
a half-built path:

1. **`state.ts`** — add `MoveOptions.replaced?: { to: Area; mode?: "active" |
   "rest" }`; `move()` short-circuits `replacementFor` when present (small,
   confirmed additive: no other call site references `MoveOptions` by name,
   all 47 remaining callers pass inline object literals TypeScript accepts
   unchanged).
2. **`script.ts`** — give `ScriptFrame` a resumable cursor for a per-id loop
   (which ids remain, plus `leftBattle`/drop-length locals needed after
   resume) and restructure the `"moveTo"` and `"ko"` op handlers to consult a
   new pure helper (`replacementChoicesFor`, returning *every* applicable
   `Replacement` plus its optionality) before calling `move()`; when that
   helper reports more than one candidate or an optional one, push a new flow
   step and return `"wait"` instead of calling `move()` directly; on resume,
   call `move()` with `opts.replaced` set from the answer.
3. **`engine.ts` / `types.ts`** — a new `FlowStep` variant (`{ op:
   "move.replace", card, to, owner, opts, choices }`, the shape the brief
   proposed) and a new `Prompt` variant for it, dispatched in `exec()`.
4. **`view.ts`** — the `Prompt.kind` switch is exhaustive (`view.ts:483`);
   a new variant needs a case there and in the guards at lines 418/430/461/
   462/473.
5. **`compile.ts`** — a second regex family beside `parseWouldLeave` for "you
   may … instead" phrasing, emitting `replaceLeave` with `optional: true`;
   and, per §1.4, the emission must refuse (not silently downgrade) any
   optional/ambiguous replacement whose subject could plausibly leave play via
   a non-script route the compiler cannot rule out — which in practice is
   every card, since nothing on a card's text says which call site will move
   it. That refusal rule needs its own design pass; it is not a one-line
   condition.
6. **UI** — `ArenaStage.tsx` needs an affordance for the new prompt (a yes/no
   or pick-one control distinct from the existing `chooseMode` modal at
   `ArenaStage.tsx:384`), plus whatever narration/wording (`wording.ts`,
   `narration.ts`) a "you may let it go to the Warp instead" question reads as.
7. **The two public-reveal cards** (BT10-031, SD18-01) additionally need the
   replacement's destination shown face-up before the choice resolves —
   `opts.reveal` already exists on `MoveOptions` but nothing currently reveals
   a card that has not yet moved.
8. **Full regression**: `npm run typecheck`, `npm run lint`, `npm test`,
   `npm run build`, `npx tsx --env-file-if-exists=.env.local
   scripts/arena-fuzz.mts 200`, and `npm run arena:diff -- --all` (the oracle)
   against every saved game, because this touches the shape of `GameState`
   (`s.flow`, `ScriptFrame`) that `arena:diff` replays from seed.

Steps 2-6 are not independently shippable: a `move.replace` flow step with no
compiler path to produce it is dead code; a compiler that emits `optional:
true` with no consumer either crashes `move()` (unknown field) or is ignored
silently, which is exactly the "half a replacement is worse than none" trap
`compile.ts` already names. They have to land together.

## 3. Where this lane stops

Nothing shipped beyond the comment fix at `state.ts:109-116` (§0). The
14 clauses this would unlock (13 "you may … instead" cards, 9-10-3, plus
9-10-2's mandated-choice case) remain refused exactly as they are on `main`
today — correctly refused, per §1.5, not wrongly read. No `GameState`,
`ScriptFrame`, `Prompt`, `FlowStep`, or compiler grammar changed, so
`arena:diff`'s oracle and `arena:fuzz` have nothing new to disprove; the gate
was not re-run for that reason, beyond confirming the single comment edit
doesn't affect `typecheck`/`lint`/`test`/`build`.

## 4. A smaller next step, if someone wants a first increment

Not evaluated in depth here (out of this lane's remaining budget), but worth
naming: **9-10-2's ambiguity, ignoring optionality entirely**, is close to a
one-lane-sized change on its own. Restricting to "two mandatory (`by`-defined)
replacements target the same card at the same time, from one of the two
suspendable sites" avoids the optional-replacement/non-script-route problem
in §1.4 entirely (a mandatory replacement with no player consent needed, when
there is exactly one candidate, already behaves correctly with no change).
The remaining work is steps 1-4 and 8 above, minus the "you may" grammar
(step 5's second half) and the reveal mechanic (step 7) — still real engine
surgery, but roughly half the surface, and it closes the sentence in
`replacementFor`'s old comment on its own terms rather than the "you may"
family's. Whoever picks this up should re-measure first, per this lane's own
first rule: take nothing here on faith, including this document.

## Appendix: all 48 `move()` call sites

| File | Line(s) | Suspendable? | Context |
|---|---|---|---|
| `state.ts` | 961, 1380, 1681 | no | `draw`, `payAltCost`, `payZEnergy` |
| `triggers.ts` | 337 | **yes** (via script `"ko"`) | `koCard`, shared KO helper |
| `script.ts` | 619, 655, 666, 673, 904, 1099 | no | `damage`/`mill`/`addLife`/`lifeDownTo`/`comboFrom`/`resolvingPlay` ops — none move a card that was in play out of it via a replacement-eligible path |
| `script.ts` | 811 | **yes** | `"moveTo"` op, generic script move, inside `for (const id of resolveRef(...))` |
| `engine.ts` | 248, 515, 528, 535, 545, 638, 639, 645, 646, 653, 820, 821, 1000, 1228, 1284, 1313, 1329, 1333, 1334, 1349, 1356, 1379, 1394, 1431, 1441, 2561, 2575, 2698, 2761, 2781, 2792, 2959, 3024, 3047, 3098 | no | setup, rule processing, play resolution, keyword costs, battle damage/cleanup, `chooseApply` (zstack/evolve/union/successor/aegis/revive/swap), player actions (mulligan/charge/combo/counter/zEnergyFromCombo/offering), keyword activation |
| `probe.ts` | 349, 359 | no (and must never be) | speculative scenario staging, `ev = []`, unreachable from any live prompt path |

Reason values seen at non-suspendable sites that overlap with the two
suspendable sites' reasons (§1.3): `reason: "effect"` at `engine.ts:1313,
1333, 2761, 2792, 3024`; `reason: "ko"` is exclusive to `triggers.ts:337`
today, but nothing in `move()` or `replacementFor` enforces that — a future
non-suspendable call site passing `reason: "ko"` would silently regain the
same problem.
