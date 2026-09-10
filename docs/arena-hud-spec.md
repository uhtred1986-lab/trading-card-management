# Arena — whose move is it

**Status: §1, §1.1 and §2.1 built (7 Sep 2026); §2.2–§2.6 still open.** The brief below is
unchanged; §6 records what was built. Branch observed when written: `claude/battle-verdict-motion`.

A screenshot from the deployed board, mid-game: the divider says `TURN 2 · YOU`, the headline says
*"Majin Buu is thinking…"*, the hint says *"Tap a card in hand, or s…"*, the pill says `8 moves`, and
the biggest button on the screen says **Skip charge**. Four of those five are right. The headline is
wrong, and it is wrong because of a stale prop, not because of a wording choice.

This brief fixes that bug, makes its whole class impossible, and rebuilds the header stack so the
three questions a player asks every few seconds — *whose move, what is being asked, what just
happened* — each have exactly one answer in exactly one place.

Reference (both states, all six board states, side by side at 390 px):
`https://claude.ai/code/artifact/3aab1e99-739f-49b5-a1ac-2131ff8eed15`

---

## 0. How to run this

Save as `docs/arena-hud-spec.md`, commit, add a pointer in `CLAUDE.md`'s Arena UI bullet, then from
the repo root run `claude` and paste:

> Read `docs/arena-hud-spec.md`. Implement §1 first, on its own, and show me that diff before
> anything else — it is a one-line fix plus a test. Then §2 onward.

§1 is a bug fix and should ship by itself. Everything after it is design and can be reviewed at
leisure.

## 1. The bug

`src/components/arena/stage/ArenaStage.tsx`:

```ts
const waitingOnServer = snapshot.waiting === "opponent" || snapshot.waiting === "referee";
const live = useLiveGame(gameId, snapshot, pending || waitingOnServer);
const { view, legal, taps, log, beats } = live;
```

`waitingOnServer` is derived from the **server-rendered prop**. `view`, `legal`, `taps`, the hint and
the move count are all derived from **`live`**, the long-polled snapshot. `useLiveGame` returns a
whole `Snapshot`, so `live.waiting` exists and is current; nothing reads it.

The sequence that produced the screenshot:

1. The server renders while it is Claude's turn → `snapshot.waiting === "opponent"`.
2. The poll returns a snapshot in which Claude has finished and the charge prompt is the viewer's.
3. `view`, `legal` and `taps` update. The board offers 8 moves and a `Skip charge` button.
4. `waitingOnServer` still reads the prop. It is still `"opponent"`.
5. The headline renders `` `${view.them.name} is thinking…` `` and the pulse keeps pulsing.

It is self-sustaining: the same stale value is `useLiveGame`'s `active` argument, so the poll never
stops either.

`waitingFor()` in `src/lib/arena/snapshot.ts` is correct — it returns `"you"` whenever the prompt
belongs to the viewer. The server is fine. The fix is to move the derivation after `live` and read
it from there:

```ts
const live = useLiveGame(gameId, snapshot, pending || snapshot.waiting === "opponent" || snapshot.waiting === "referee");
const { view, legal, taps, log, beats } = live;
const waitingOnServer = live.waiting === "opponent" || live.waiting === "referee";
```

`useLiveGame`'s `active` still needs a value computed before `live` exists — keep the prop-derived
expression there and nowhere else, with a comment saying why, or refactor the hook to accept a
callback. Every *rendered* use of "is the opponent acting" reads `live`.

`serverDecides` (the 1 v 1 case, same file) has the same defect and the same fix.

### 1.1 Make the class impossible

A one-line fix that a later refactor can silently undo is worth half of nothing. Add the invariant:

> If the prompt belongs to the viewer and the viewer has at least one legal action, nothing on the
> board may state that the opponent is acting.

Assert it in `npm run arena:playthrough` on every move — `waiting === "you"` whenever
`prompt.player === viewer && legal.length > 0` — and add a pure case to `scripts/verify-arena.ts`
that builds a snapshot in that state and checks it. The playthrough runs the real card pool, which
is where the odd prompt kinds live.

## 2. The header stack

Three questions, three slots, in this order, always. Nothing else on the board answers them.

```
┌─ turn strip ──────────────────────────────┐   whose move
│  YOUR MOVE        [8 moves]        turn 2 │
├─ last ────────────────────────────────────┤   what just happened
│  LAST  You draw Dynasty Deferred Son Goku │
├─ ask ─────────────────────────────────────┤   what is being asked
│  Charge one card as energy?    [Skip charge]
│  Tap a card in hand, or skip.             │
└───────────────────────────────────────────┘
```

### 2.1 The turn strip — new

Full width, directly above the ask, ~30 px. Replaces the `turn N · you` text inside `ClashBand`,
which is 10 px, grey, centred between two board rows, and the least visible thing on a screen it is
the most important fact on.

- **Yours**: ki fill, ink text, `YOUR MOVE`, the move count as a pill, `turn N` right-aligned.
- **Claude's**: slate fill, `MAJIN BUU'S MOVE`, the pulse dot, `turn N`.
- Colour, position and words all carry it, so losing any one channel still leaves it readable —
  which is also what makes it survive the anime skin, greyscale, and a colour-blind viewer.
- Derived from `live.waiting` and `view.prompt.player`. One expression, used once.

Delete the `turn N · you` line from `ClashBand` in the same commit. Two turn indicators is how the
first one came to be ignored.

### 2.2 One card, not two bars

`NarrationRibbon` and the prompt bar are currently two sections with the same border, radius,
padding and leading dot. One is history, the other is the live ask, and nothing in the design ranks
them.

Merge: the ribbon becomes a single dim 11.5 px line inside the top of the prompt card, prefixed with
a `LAST` label, clipped to one line, with its own hairline under it. The ask keeps the large italic
display type. One border, one shadow, one place to look.

Keep `NarrationRibbon` as a component for playback — during a beat sequence the narration *is* the
headline (the branch already does this with `held?.text`), so in that state the card shows the
narration large and the `LAST` line is hidden.

### 2.3 Buttons: filled means do the thing

`Skip charge` renders filled because `bare.slice(0, 3)` only demotes `endMain` and `pass`:

```ts
l.action.type === "endMain" || l.action.type === "pass" ? ghost : filled
```

A `charge` with `card: null` is a decline and is not in that list. Widen the rule rather than adding
a third case: **an action that declines, skips, passes, ends or cancels is a ghost button.** That is
`endMain`, `pass`, `charge` with `card: null`, `block` with `card: null`, `counter` with
`card: null`, `optionalCost` with `pay: false`, and the `choose` action with an empty `cards` array
("choose none"). Put the predicate in one exported helper beside `shortLabel` in `shared.tsx` so
both clients get the same answer, and unit-test it against the fixtures.

At most one filled button in the bar at a time.

### 2.4 Give the hint its line

The move-count pill shares the hint's line and clips it — the one sentence that says what to do
loses to a number that is now in the turn strip anyway. Remove it from the hint row; let the hint
wrap to two lines (`line-clamp-2`, as the refusal line already does).

### 2.5 Demote the settings

Nine controls sit between the ask and the hand: BUZZ, SOUND, PACE, IN PLACE, DUEL BAND, TAKEOVER,
NIGHT TABLE, "something's wrong", LOG. Same weight, no grouping, in the best strip on the screen.

`log` stays inline — it is read mid-game. The other eight move behind a single `⋯` button opening
the existing `Sheet`, grouped: **Feel** (buzz, sound, pace), **Board** (staging, skin), **Help**
(report a problem). One 44 px target instead of nine ambiguous ones, and the hand gets the space.

### 2.6 Reclaim the empty board

An empty Battle Area draws three dashed 78 px slots plus padding. Collapse it to one 30 px line —
*"no Battle Cards yet"* — until it holds a card. On a 667 px screen that is most of a card's worth of
height returned to the hand, which is where the answer to the current question usually is.

The side rail keeps the leader, life and energy; `deck` and `drop` counts are reference data and can
live behind the same `⋯`.

## 3. What must not change

- No rule moves into the client. The strip and the card render `waiting`, `prompt` and `legal`; they
  decide nothing.
- `NarrationRibbon`, `StepChip`, `refusalLine` and the refusal wording all stay — this brief
  rearranges them, it does not replace them.
- The layout must not move between states. Switching from your move to Claude's changes colours and
  words, never positions: a HUD whose elements jump is one you re-read instead of glance at.
- Both skins stay good. Check the turn strip in night and anime.

## 4. Verification

```powershell
npm run typecheck
npm run lint
npm test
npm run arena:playthrough   # with the new invariant from §1.1
```

By hand, on the phone, in both skins:

- The exact state from the screenshot: finish a turn, let Claude move, and watch the headline as the
  poll returns. It must never say "thinking" while a move is offered.
- Every state in the reference artifact: your charge step, your main phase, Claude deciding,
  playback, a refusal, targeting. In each, read the screen and say aloud whose move it is and what
  is being asked. If either takes more than a glance, the strip or the ask is wrong.
- Greyscale the screen (or set the skin to night and squint): whose-move must still read.
- `design:accessibility-review` on the turn strip: ki fill with ink text and slate fill with ink
  text both need 4.5:1.

## 5. Risks

- **`active` and `waitingOnServer` are no longer the same expression.** Keep the prop-derived one for
  the hook and the live one for rendering, and comment the difference, or the next reader will
  "simplify" them back together and restore the bug.
- **A poll that never starts.** If `active` is derived from `live` it can go false before the first
  poll returns. That is why §1 keeps the prop expression for the hook argument.
- **Hiding settings behind `⋯` costs a tap** for the pace control, which is the one a player changes
  most while learning. If that proves annoying, promote `pace` alone back to the header — one
  control, not nine.
- **The turn strip is another 30 px.** It is paid for by §2.2 (two cards become one), §2.4 and §2.6.
  Measure the header stack's total height before and after; it should shrink.

---

## 6. What was built (7 Sep 2026)

**§1, §1.1 and §2.1 only.** §2.2–§2.6 are untouched and still open.

### 6.1 §1 — the bug

`ArenaStage.tsx` now derives the poll's `active` argument and everything the
board *states* from two different snapshots, on purpose:

```ts
const pollWhile = snapshot.waiting === "opponent" || snapshot.waiting === "referee";  // the prop — hook argument only
const live = useLiveGame(gameId, snapshot, pending || pollWhile);
const waitingOnServer = live.waiting === "opponent" || live.waiting === "referee";    // everything rendered
const serverDecides = live.game.mode !== "versus" ? waitingOnServer : live.waiting === "referee";
```

`serverDecides` had the same defect and got the same fix. The comment on
`pollWhile` names §5's risk explicitly, because the next reader's instinct will
be to collapse the two back into one expression and that restores the bug.

### 6.2 §1.1 — the invariant

> If the prompt belongs to the viewer and the viewer has at least one legal
> action, nothing on the board may state that the opponent is acting.

Asserted in two places, as the brief asks:

- `scripts/verify-arena.ts` — a pure case built from `arena({ hand: ["BIG"], energy: ["V1","V1"] })`,
  checking `waitingFor` directly and again through a whole `buildSnapshot`,
  plus the opposite direction so it cannot pass vacuously. Runs in `npm test`.
- `scripts/arena-playthrough.mts` — `auditWhoseMove`, on every move of a whole
  game against the real card pool.

### 6.3 §2.1 — the turn strip

`TurnStrip` in `src/components/arena/shared.tsx`, mounted directly above the
ask. Both are wrapped in one positioned container, because a sticky bar with a
static strip above it comes apart the moment the board scrolls; `promptRef`
moved to that wrapper so `--arena-prompt-h` still tells the takeover where to
stop, and now clears both.

Whose move is `const yourMove = live.waiting === "you"` — one expression, used
once. `waitingFor` already means exactly "the prompt belongs to the viewer".

**Two turn indicators became none.** The brief names the one in `ClashBand`;
there was a second, `T2 · you`, in `TopStrip`'s right-hand corner. Both are
gone, on the brief's own reasoning — with a real strip, three would be worse
than two. `ClashBand`'s divider keeps its rule and is now `aria-hidden`.

**Every colour is a named class in `globals.css`, not a utility.** The strip's
text has to stay dark in both skins: both fills are light, and the anime skin
inverts the space scale, so `text-space-950` is near-white there. `--strip-ink`
is redefined per skin, the anime block repaints both fills (its `space-200/300`
are dark), and the component carries no colour utilities at all.

### 6.4 §4 verification matrix (2026-09-10)

| §4 row | Result | Evidence | Defect issue |
| --- | --- | --- | --- |
| `npm run typecheck` | Pass | Clean run on 2026-09-10 (`tsc --noEmit`) | — |
| `npm run lint` | Pass | Clean run on 2026-09-10 (`eslint`) | — |
| `npm test` | Pass | `verify-rules`, `verify/lang`, `verify-arena`, `verify-db` all passed on 2026-09-10 | — |
| `npm run arena:playthrough` | Blocked | Run attempted once on 2026-09-10; environment had no `DATABASE_URL`/playable decks (`Error: need two playable decks`) | — |
| Exact screenshot state (finish turn → Claude move → poll return headline) | Blocked | Phone/manual flow not executable in this cloud session (no phone/tunnel session attached) | — |
| Reference artifact states (charge, main, Claude deciding, playback, refusal, targeting) | Blocked | Same execution blocker as above | — |
| Greyscale/night readability glance check | Blocked | Same execution blocker as above | — |
| `design:accessibility-review` or manual WCAG AA check | Pass | Manual WCAG contrast check completed (below) | — |

#### Turn-strip contrast figures (manual WCAG AA)

Text colour is the strip ink (`--strip-ink`). Each fill is a gradient, so the
worst stop ratio is recorded.

| Skin | Fill | Foreground | Background stops | Worst ratio | AA (4.5:1) |
| --- | --- | --- | --- | --- | --- |
| Night | Yours (`.arena-turnstrip-you`) | `#090b15` | `#ffc46b` → `#f28c0f` | **7.97:1** | Pass |
| Night | Theirs (`.arena-turnstrip-them`) | `#090b15` | `#aab5d1` → `#7d8bb0` | **5.79:1** | Pass |
| Anime | Yours (`.arena-turnstrip-you`) | `#12161f` | `#ffd97a` → `#f2b21c` | **9.62:1** | Pass |
| Anime | Theirs (`.arena-turnstrip-them`) | `#12161f` | `#dbe6f5` → `#b9cbe4` | **10.97:1** | Pass |

### 6.5 Note on the header stack

§2's diagram puts *last* between the strip and the ask. That is §2.2, which is
not built: `NarrationRibbon` is still its own bar above the pair, exactly as it
was. So the stack today is **strip → ask**, with the ribbon still separate —
the order is right, the merge is not done.
