# Arena — battle staging: the duel band and the takeover

**Status: brief, not built (7 Sep 2026).** Written to be executed by Claude Code in this repository.

A DBS attack is not one event. It is an attacker, a guard, and a chain of combo and counter cards
added in order, some of which fire skills of their own, before two numbers are compared. The board
today shows that as a lunge, a beam and a pair of figures — which is enough to see *that* a fight
happened and not enough to see *what* decided it.

This brief adds two stagings for a battle, as a player preference, and the two things both of them
need: **you can open any card in the fight and read it**, and **a combo or counter skill that
triggers says so, on the card, in words**.

Independent of `docs/arena-skin-spec.md`. It shares two small server additions with
`docs/arena-workflow-spec.md` — see §1 and §3.1; if that brief has already landed, part of §3.1 is
done.

---

## 0. How to run this

### 0.1 Put the brief in the repo

Save as `docs/arena-battle-staging-spec.md` and commit.

### 0.2 Add a pointer in `CLAUDE.md`

In the **Arena UI** bullet, beside the other spec pointers:

```
`docs/arena-battle-staging-spec.md` — the duel band and takeover battle stagings,
the in-fight card inspector, and triggered combo/counter skills.
```

### 0.3 Start the session

From the repo root, `claude`, then paste:

> Read `docs/arena-battle-staging-spec.md`, then `docs/arena-client-contract.md` §1–§4 and
> `docs/arena-ui-motion-spec.md` §7. Implement §3.1 and §3.2 first and stop there — I want to see
> the server side before any UI. Plan first and show me the plan.

Two passes is the right shape: §3.1–§3.2 are the snapshot and the beats and cannot be seen; §3.3
onward is the board and can only be judged by playing it.

### 0.4 What to watch

- **No rule may move into the client** (contract §1). The band decides nothing: which cards are in
  the fight, what each contributes, and whether a skill fired all come from the engine.
- **The two stagings share one data path.** If the diff grows a second way to work out what is in a
  battle, stop it — that is how the two drift.
- **The inspector is reuse.** `CardDetail` and `Sheet` already exist in
  `src/components/arena/shared.tsx`. A second card-detail component is a bug.

### 0.5 The reference

Both stagings, the inspector and the triggered-skill spotlight are playable at 390 px in the
prototype: `https://claude.ai/code/artifact/2de30892-fe6c-457f-a2d4-4b18ef93ef8e` — segmented
control top right, timeline underneath, tap any card in the fight. It is vanilla HTML with a
hand-written state machine and no engine behind it: a picture of the destination, not code to port.

---

## 1. What exists, verified

Checked in the tree on 7 Sep 2026.

- **`BoardView.battle`** is `{ attacker, guard, step, attackPower, guardPower }` — the two ids and
  the two running figures the band needs, already correct.
- **`SideView.combo: CardView[]`** already carries each side's combo cards. The classic board draws
  them at `width={32}` in `ClashBand`.
- **`CardView` already carries everything an inspector needs**: `text` (the printed text),
  `reading` (the engine's own reading), `keywords`, `power`, `comboPower`, `comboCost`,
  `underCount`, `markers`, `referee`. `shared.tsx` exports `CardDetail` and `Sheet`, and
  `ArenaStage` already opens them from a tap or a 450 ms long press.
- **A counter is invisible as a counter.** `docs/arena-ui-motion-spec.md` §7 lists the counter stamp
  and the blocker slide as **✗ not built**, and says why: *"a counter is only a `move` to the Drop,
  and `block` arrives after the guard has already changed."* The board cannot tell a counter played
  in a battle from any other card reaching the Drop. §3.1 fixes this, and it is the one genuinely
  new piece of information this brief needs.
- **The `skill` beat exists** — `{ t: "skill"; card; label; text; unread }` — and is already
  rendered by `SkillSpotlight`. What it does not carry is `owner` (added by
  `docs/arena-workflow-spec.md` §3.4) or any statement that the skill belongs to *this battle*.
- **Beat playback is already the right machine.** `useBeatPlayer` walks the queue, exposes
  `{ playing, suppressed, ghosts, current, skip }` and locks input while it runs; `motion.ts` holds
  every duration in one table and reduced motion is that table at zero. Nothing in this brief needs
  a second timing mechanism.
- **`AppShell` already gives a game the whole screen** on `/arena/<id>`, so a takeover has a screen
  to take over.

## 2. Decisions

1. **Three stagings, one preference, one data path.** `inplace` (today's lunge), `band` (default),
   `takeover`. All three render from the same battle data; they differ only in layout and in how
   much of the board they cover. A staging that needs its own data is not a staging.
2. **`band` is the default.** The research reason, not a taste one: the takeover is the only variant
   where the player loses sight of the position being fought over while the fight resolves, and
   Runeterra's most-cited mobile complaint is that the centre of the screen runs out of room. The
   takeover stays available because it is better for the fights that decide a game.
3. **A cookie, not `localStorage`.** Read server-side in `src/app/arena/[id]/page.tsx`, same as the
   deleted `boardStyle` cookie, so a reload does not flash the wrong staging.
4. **Additions lay out on one axis and are numbered.** Each side's chain runs outward from its card,
   never stacked in Z, with an ordinal badge in play order and a separate moving highlight for the
   one resolving now. Those are two different questions and they get two different channels — the
   survey is unanimous on this, and Magic Arena is the counter-example.
5. **Both totals are on screen the whole time, as a figure and as a bar.** The figure is exact, the
   bar is the glance. A running total that has to be summoned is the thing players patch out.
6. **Inspection pauses playback.** Opening a card mid-fight stops the beat player and resumes it on
   close. A fight that runs on behind an open card is why the inspector exists in the first place.
7. **Long chains accelerate themselves; there is no skip toggle.** Past four additions every beat
   drops to 55 %. Marvel Snap ships exactly this. A skip button is an admission the default is wrong
   — the existing Skip stays for the opponent's whole turn, which is a different thing.
8. **The engine says a skill fired. The board only draws it.** No client may infer a trigger from a
   power figure changing.

## 3. The work

### 3.1 The server: what a battle contains

Two additive fields, both optional, `contract` stays `1`.

```ts
// src/lib/arena/view.ts — BoardView.battle gains:
//   counters?: { card: CardView; by: PlayerId }[]
//     Cards played as counters in THIS battle, in play order, while the battle is open.
//     Built from the battle's own record, not by inspecting the Drop.
//   contributions?: Record<string, number>
//     card instance id → the power that card is contributing to its side right now.
//     This is what lets the band attribute a change in the total to the card that caused it,
//     which is the whole point of numbering them.
```

`counters` is the piece that does not exist in any form today; the engine knows it (a counter is
played into an open battle) and simply never says so. `contributions` may exist already inside the
power calculation — surface it rather than recomputing it, and never recompute it in a client.

```ts
// src/lib/arena/beats.ts — the skill beat gains, alongside `owner` from arena-workflow-spec §3.4:
//   inBattle?: boolean   // this skill fired as part of the open battle
```

That one boolean is what lets the band show the spotlight *inside itself*, attached to the card that
fired, instead of the generic `SkillSpotlight` sliding over the top of the fight.

Then: `snapshot.ts` passes them through, `docs/arena-client-contract.md` §3–§4 are updated, the
Kotlin data classes in `android/contract/src/main/kotlin/arena/Snapshot.kt` mirror them,
`npm run contract:emit`, `npm run android:test`.

### 3.2 Beats for a battle

No new beat kinds. What changes is that three existing ones become distinguishable:

- A **counter** is a `move` hand→drop while `view.battle` is open and the card appears in
  `battle.counters`. The board reads that, stamps it, and slots it into the guard's chain.
- A **combo** is the existing `move` hand→combo. Already correct.
- A **trigger** is a `skill` beat with `inBattle: true`, drawn beside the card it names rather than
  in the global spotlight.

Add the durations to `src/components/arena/stage/motion.ts` — the one table, so reduced motion and
Skip keep working through the same path:

| Beat | ms | What moves |
|---|---|---|
| declare (`attack`) | 300 | both cards FLIP from their rows into the band; board dims |
| combo (`move`→combo) | 280 | card flies in, ordinal pops, that side's total climbs |
| counter (`move`→drop, in battle) | 320 | card slides in on the far side with its stamp |
| trigger (`skill`, `inBattle`) | 520 | the card's ⚡ lights, a one-line spotlight, the total climbs again |
| resolve | 160 per link, capped at 4 | the highlight sweeps the chain in play order |
| clash | 340 | starburst, bars settle |
| outcome | 700 | verdict; KO burn, or the shield for a repelled attack |
| return | 300 | survivors FLIP back to their rows |

Two combos, one counter and one trigger comes to about 3.1 s at 1×. That is over the 1.5 s one
widely-cited essay argues is enough for a whole attack animation, which is precisely why decision 7
exists. Measure it in `arena:playthrough` and be willing to cut the resolve sweep first.

### 3.3 The duel band — `src/components/arena/stage/DuelBand.tsx`

A new component under `stage/`, rendered by `ArenaStage` when a battle is open and the staging is
`band`. Geometry that held at 360, 375 and 390 px in the prototype:

- Absolutely positioned strip at `top: 46%`, `translateY(-50%)`, `left/right: 8px`, over the board.
  The board stays mounted and gets `filter: blur(1.5px) saturate(.55); opacity: .4` — visible,
  dimmed, not gone.
- One lane: `[your chain][attacker 76px] VS [guard 76px][their chain]`. Chain cards at 42 px, cost
  badge hidden on them (the ordinal owns that corner), ordinal badge gold on your side and blue on
  Claude's, a `COUNTER` stamp under a counter, a ⚡ on any card with a battle trigger — grey until
  it fires, gold after.
- Under the lane, the two totals: figure plus a bar scaled to `max(attack, guard)`, the guard's bar
  filling toward the centre. Both count up over 260 ms inside the beat that changed them, using the
  existing `Count` component from `ArenaStage`.
- A `beat n of m` chip top right, and the narration line stays where it already is, below the band —
  never under it.
- Cards use `layoutId` as everywhere else, so the lift from row to band is the same FLIP machinery
  as every other card flight. 76 px against the board's 52 px is deliberate: the size delta is what
  says *this one matters right now*.

### 3.4 The takeover — reuse, do not rebuild

The same data, full screen: board hidden, each side a cluster with the main card at ~104 px raised
above its chain, the wave between them. It must consume the identical props as `DuelBand` and share
the chain, ordinal, stamp, trigger and total components — extract those into `stage/BattleParts.tsx`
rather than writing them twice. If the two files do not import the same pieces, decision 1 has been
broken.

### 3.5 The in-fight inspector

- Any card in the band or the takeover is tappable and long-pressable, and opens the existing
  `Sheet` + `CardDetail` from `shared.tsx`.
- Opening pauses the beat player; closing resumes it. Add `pause()` / `resume()` to
  `useBeatPlayer` — it already owns the timer, so this is two lines and no new state machine.
- The detail must show, for a card in a chain: its **combo power** and **combo cost**, its printed
  `text`, and — when it has one — its battle trigger and what that trigger contributed, taken from
  `battle.contributions[cardId]`. That last figure is the answer to "why is the total 35,000?" and
  it is the reason the inspector is in this brief rather than being assumed.

### 3.6 The preference

Cookie `arenaStaging` ∈ `inplace | band | takeover`, default `band`. A three-way control beside
`FeelToggle`; `?staging=` as a one-load override for screenshots. Server-read in `page.tsx`.

## 4. What must not change

- No engine rule moves into a client. The band draws `battle`, `combo`, `counters`,
  `contributions` and the beats; it computes nothing.
- `legalActions`, `taps`, and every existing beat kind keep their current shape.
- `motion.ts` stays the only duration table, and reduced motion stays the same code path as Skip.
- The `inplace` staging keeps working exactly as it does today — it is the fallback and the control.
- Card sizes on the board itself do not change. The band is a new surface, not a resize.

## 5. Verification

```powershell
npm run typecheck
npm run lint
npm test                  # verify-arena + the fixture diff
npm run contract:emit     # after the deliberate shape change in §3.1
npm run android:test
npm run arena:playthrough
```

`arena:playthrough` gains two audits: every `skill` beat with `inBattle: true` names a card that is
in the open battle or one of its chains, and `battle.counters` never contains a card that is also in
`SideView.combo`.

Then, by hand:

- A battle with **0, 1, 2 and 4 combo cards** at 360 px. Find where the lane stops being readable
  and cap it there, collapsing the overflow into a `+n` chip that opens the chain in a sheet.
- A battle with a **counter that changes the outcome**, so the shield and `REPELLED` are seen.
- A battle with a **triggered combo skill**, checking the spotlight names the card and the effect.
- **Inspect mid-fight**: playback pauses, the sheet shows the contribution, closing resumes.
- **Reduced motion**: the band still appears and is readable; nothing animates.
- One full game on the phone in each staging — which is also the gate
  `docs/arena-ui-motion-spec.md` §8 has been waiting for since 6 Sep.

## 6. Risks

- **`counters` is a real engine change, not a view one.** If the battle record does not currently
  keep which cards were played into it, that is the actual work in this brief and it is worth
  saying so in the plan rather than discovering it halfway.
- **Three stagings is two too many to maintain badly.** Decision 1 and the shared `BattleParts` are
  the mitigation; if they are not honoured, delete `takeover` rather than keeping two divergent
  implementations.
- **Total duration.** 3.1 s for a four-element chain is long. The auto fast-forward, the resolve
  sweep being the first thing cut, and measuring in `arena:playthrough` are the three defences.
  Watch the opposite failure too: Hearthstone Battlegrounds is the standing proof that too fast
  leaves the player unable to say what happened.
- **The centre of a 360 px screen.** The band, the narration line and the prompt bar all want the
  same space. The band is capped in height and the narration sits below it; if a third thing wants
  that room, something has to lose.
- **Inspection during Claude's turn.** Pausing playback is right; make sure resume cannot double-run
  a beat, and that a pause left open when the queue is replaced does not strand the board.

## 7. Where the design came from

The staging survey — Legends of Runeterra's split between a combat row and a spell stack, Yu-Gi-Oh's
Chain Link numbering plus its separately-patched resolution highlight, Magic Arena's pile and the
readability complaints about it, Slay the Spire 2's move from stacked to side-by-side, Marvel Snap's
automatic fast-forward, Hearthstone Battlegrounds' too-fast failure, and Material's motion budget —
is in the prototype linked in §0.5, with sources on every claim.

No published source gives per-game animation durations in seconds. Every millisecond in §3.2 is
derived from Material's motion guidance and the FLIP reference implementation, not measured from a
shipped game.
