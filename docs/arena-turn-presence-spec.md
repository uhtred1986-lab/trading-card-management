# Arena — turn presence: the leader owns the room

**Status: built (7 Sep 2026).** The brief below is unchanged; §6 records what was built, the numbers
that were settled, and the three places the implementation departs from it.

Whose turn it is should be readable at arm's length, before a word is read. The leader already
sitting on each side is the instrument: on its owner's turn it grows and lights, and the room takes
its colour. The ground, the ink outlines, the card sizes and the type do not move.

Companion to `docs/arena-hud-spec.md`, which fixes the *stated* turn (the strip and the ask). This
brief is the *ambient* turn. Neither replaces the other, and §2.5 is the rule that keeps that true.

Tunable reference, both skins, with the CSS printed as you drag:
`https://claude.ai/code/artifact/b2bebed6-0ab9-45d8-a3ca-728266727489`

---

## 0. How to run this

Save as `docs/arena-turn-presence-spec.md`, commit, add a pointer in `CLAUDE.md`'s Arena UI bullet,
then from the repo root run `claude` and paste:

> Read `docs/arena-turn-presence-spec.md`. Implement it. This is CSS and one derived value — no
> component may learn a rule and no snapshot field is added. Plan first.

**Settle the numbers before you start.** Open the reference, drag the six sliders until it looks
right on your phone, and paste the CSS block it prints into the plan. The defaults below are a
starting point, not a decision.

## 1. What this uses that already exists

- **`CardView.colors`** — every leader carries its printed colour identity (Red / Blue / Green /
  Yellow / Black). `globals.css` already has a token per colour: `--color-dbs-red` and friends.
- **`CardView.imageUrl`** — the leader's art, already on the board, already cached by the service
  worker for the five CDN hosts in `next.config.ts`.
- **`BoardView.turnPlayer`** and **`view.you.player`** — who is acting, already rendered by
  `ClashBand`.
- **`SideRail`** in `stage/ArenaStage.tsx` already draws each leader at `width={56}`.
- The `.arena` root already carries `--arena` and is where both skins scope themselves.

Nothing new is needed from the snapshot, the engine or the contract.

## 2. The design

Three layers. Each is allowed to touch exactly one thing.

### 2.1 Layer 1 — the artwork, blurred past recognition

The **active** leader's `imageUrl` as a background on the `.arena` root, `blur(28px)
saturate(1.15)`, `opacity: .22`, masked with a radial gradient that fades out before it reaches the
Battle Areas.

It is never read as a picture. It is read as weather.

The hard blur is the point, not a softening: leader art is busy and high-contrast, and anything
sharp enough to recognise is sharp enough to compete with a 13 px power figure. Below about 16 px of
blur the board measurably gets harder to read — the reference lets you find that edge yourself.

**Fallback is required.** A leader with no art (`imageUrl: null`, and tokens have none at all) gets
no wash; layer 2 carries it alone. Never show a broken or half-loaded wash.

### 2.2 Layer 2 — ambient light, per leader colour

A soft radial glow on the `.arena` root whose **position** is the only thing a turn flip changes:

```css
--turn-y: 88%;   /* your move  — the light is at your end of the table */
--turn-y: 12%;   /* their move — it is at theirs */
```

**The hue comes from the leader's printed colour, not from sampling its art.** That is a deliberate
choice against the more obvious one:

- deterministic, and identical on both clients — the Android app derives the same value from the
  same field without shipping an image pipeline;
- no canvas, no CORS, no image decode on a phone;
- it cannot produce mud. A dark painting sampled at its dominant colour gives a brown-grey that
  reads as "off", not as "Red leader".

**The dial is per colour, not global.** The five DBS colours do not carry equal weight as light: a
neutral Black tint is nearly invisible, Blue disappears into the anime skin's sky, and Yellow sits
uncomfortably close to the ki accent. One master strength multiplied by a per-colour intensity is
what lets each of them land at the same *perceived* level.

| Colour | tint | glow | intensity | why this number |
|---|---|---|---|---|
| Red | `#e5484d` | `#ff7a6b` | **95 %** | Warm and naturally loud. Held under 100 so it does not shout over the ki accent. |
| Blue | `#3b82f6` | `#6aa8ff` | **105 %** | Recedes on the night ground *and* fights the sky on anime — the one colour needing a boost in both. |
| Green | `#22c55e` | `#58e08a` | **100 %** | Sits mid-range on both grounds. The reference the others are tuned against. |
| Yellow | `#e8c020` | `#ffe36b` | **88 %** | Pulled green-gold, away from the ki orange `#f28c0f`, so ambient light never reads as "this is interactive". |
| Black | `#7b7f97` | `#a9adc9` | **125 %** | A neutral tint barely registers as light. Leaned violet and given the highest multiplier — the honest hard case. |

These are a considered starting point, not a decision. They are **user settings**: §3.5.

`--turn-strength` is then `var(--turn-master) * var(--leader-<colour>-k)`. A multi-colour leader uses
`colors[0]`.

### 2.3 Layer 3 — the leader itself

- Active: `transform: scale(1.10)` plus a breathing ring in the leader's glow colour.
- Idle: `opacity: .65; filter: saturate(.55) brightness(.85)`.

**The footprint is reserved.** The scale is a transform inside a fixed box, so nothing on the board
reflows when the turn flips — which is also the HUD spec's rule that layout never moves between
states. Transform and opacity only: free on a mid-range Android, and correct under
`prefers-reduced-motion` for free.

### 2.4 What the turn may not touch

The ground stays the ground — deep space in `night`, the sky gradient in `anime`. Ink outlines, card
sizes, radii, hard shadows, type and spacing are untouched. **A turn moves light, and one card's
scale.** That is the whole contract, and it is what stops the board becoming a different app every
other turn.

### 2.5 It is never the only signal

Colour and light are an ambient channel and ambient channels fail quietly: in sunlight, in
greyscale, for a colour-blind player, and for anyone who has turned the effect down. The turn strip
and its words from `docs/arena-hud-spec.md` §2.1 stay exactly as they are.

**The test:** set the ambient tint to 0 and the board must still be unambiguous. That is the bar this
design has to clear, not the one it gets credit for.

### 2.6 Mirror matches — the alternate scheme

The ambient only ever lights the **active** player's half, so when both leaders share a colour the
room is the same hue on both turns and only `--turn-y` moves. Position alone is a weak signal at a
glance, which is exactly the failure this feature exists to prevent.

So: when `you.leader.colors[0] === them.leader.colors[0]`, the **opponent's** side is re-hued. Yours
always stays true to your leader — the player's own colour never changes under them.

A setting, three values, default **Rival hue**:

| Setting | What it does | When to pick it |
|---|---|---|
| **Rival hue** *(default)* | The opponent's room becomes a fixed violet, `#a855f7` / glow `#c98bff`, in every mirror regardless of colour. One extra hue to learn, and it always means the same thing: *the other side, same colour as me*. | Maximum separation. Violet is not a DBS leader colour and is far from the ki accent, so it collides with nothing. |
| **Cooled** | The opponent keeps their hue, mixed 55 % toward slate `#64748b` and desaturated. Subtler, and stays inside the match's palette. | If the violet reads as too much of an intrusion on the vibe. |
| **Off** | No re-hue. Position, leader scale and the turn strip carry it alone. | If the ambient is turned down anyway, or you find the re-hue distracting. |

Two details worth deciding on purpose:

- **It is the opponent that shifts, not the active player.** Re-hueing whoever is acting would mean
  your own room changes colour depending on who moved last, which is worse than the problem.
- **Exact primary-colour match only.** A dual-colour leader is compared on `colors[0]`. Two
  perceptually *close* colours (Red against Yellow) do not trigger it — a ΔE threshold would be
  more correct and much harder to reason about; revisit only if a real pairing proves confusing.

## 3. The work

### 3.1 The derived value — one place

In `stage/ArenaStage.tsx`, beside the existing view derivations:

```ts
// The room belongs to whoever is acting. One expression, used once.
const actor = view.turnPlayer === view.you.player ? view.you : view.them;
const turnStyle = {
  "--turn-hue": colourTokenFor(actor.leader?.colors?.[0]),   // → var(--color-dbs-*)
  "--turn-art": actor.leader?.imageUrl ? `url(${actor.leader.imageUrl})` : "none",
  "--turn-y": view.turnPlayer === view.you.player ? "88%" : "12%",
} as React.CSSProperties;
```

Applied to the existing `.arena` root element alongside `data-skin`. `colourTokenFor` is a small
pure map in `shared.tsx`, exported so the Android app's Compose side can mirror it from the same
field.

### 3.2 The layers — `globals.css`

Two pseudo-elements on `.arena`, both `pointer-events: none`, both behind the board
(`z-index: 0`, with the board's children at `z-index: 1`). Take the exact declarations from the
reference's printed CSS block; the shape is:

```css
.arena::after  { /* layer 1: var(--turn-art), blur, mask to --turn-y, opacity var(--turn-wash) */ }
.arena::before { /* layer 2: radial glow in var(--turn-hue) at 50% var(--turn-y) */ }
```

Both transition on `--turn-ms` (420 ms default, `cubic-bezier(.2,.8,.2,1)`).

**Animate `opacity` and the mask position only. Never animate the blur radius** — it re-rasterises
every frame and is the one thing here that can cost real milliseconds on a phone.

Defaults to start from, all overridable per skin: `--turn-strength: .55`, `--turn-wash: .22`,
`--turn-blur: 28px`, `--lead-scale: 1.10`, `--lead-dim: .65`, `--turn-ms: 420ms`.

### 3.3 Per-skin values

The anime skin's ground is bright, so the same wash reads much stronger on it. Expect to want a
lower `--turn-wash` and a higher `--turn-strength` there. Set them in the skin's own scope
(`.arena[data-skin="anime"]`) — that is exactly what `docs/arena-skin-spec.md` §3.2 built the
mechanism for.

### 3.4 Reduced motion

Add the two pseudo-elements and the leader transform to the existing reduced-motion block. The
change still *happens* — it must, it is state — it simply happens in 1 ms instead of 420. Removing
it would remove information.

### 3.5 The settings

All of this is a preference, stored beside the existing feel toggles and surfaced in
`src/app/settings/page.tsx` under a **Turn lighting** group. Three controls:

1. **Turn lighting** — `on` / `subtle` / `off`. `subtle` halves the master strength and the wash;
   `off` sets both to 0 and keeps only the leader scale and ring. This is the switch that has to
   exist for §2.5 to be honest.
2. **Colour tone** — the five per-colour rows from §2.2: a tint, a glow, and an intensity slider
   each. Ship the table above as the defaults with a **Reset to defaults** button; a player who
   never opens this never sees it.
3. **Same-colour scheme** — `Rival hue` / `Cooled` / `Off`, per §2.6.

Persist as one JSON blob in the same place the sound and haptics preferences live, versioned with a
plain integer so a future default change can migrate rather than silently override a tuned palette.
Server-read where the skin cookie is read, so there is no flash of the default palette on load.

**Tune the defaults before shipping them.** The reference in §0 has every one of these controls and
prints the exact CSS block as you drag; settle the numbers on your own phone, in both skins, and put
them in this document.

## 4. Verification

```powershell
npm run typecheck
npm run lint
npm test
npm run build     # confirm no new render work landed in a server component
```

By hand, on the phone:

- **Both skins, both turns**, four screenshots. The active side must be obvious in a thumbnail.
- **Every leader colour** you actually play. Red, Blue, Green, Yellow and Black each own a
  different room; check none of them turns the board muddy or garish.
- **A leader with no art** — the wash must be absent, not broken.
- **A mirror match in all three schemes**, both turns. In `Rival hue` and `Cooled` the two turns must
  be tellable apart in a thumbnail; in `Off` they must still be tellable apart from the strip, the
  scale and the ring alone — that is the §2.5 test, run against the hardest case.
- **Each colour at its intensity**, both skins, judged for *perceived* equality rather than measured:
  no colour should feel like a brighter or duller turn than another. Black and Blue are the two that
  will need adjusting.
- **Contrast**: run `design:accessibility-review` on the ask card and the turn strip with the wash
  at its chosen value, in the anime skin, where it bites hardest. 4.5:1 stays 4.5:1. Above roughly
  30 % wash it stops holding; find the number rather than assuming one.
- **Greyscale the screen.** Whose-move must still read — from the strip, the scale and the ring.
- **Ambient tint at 0.** Still unambiguous. If it is not, §2.5 has been broken.
- **Reduced motion**: the flip is instant and complete, never absent.
- **Paint cost**: a turn flip on a mid-range Android should not drop frames. If it does, the blur is
  being re-rasterised — check nothing is animating `filter`.

## 5. Risks

- **The wash sits under text.** It is the one layer that can cost legibility, and it is the one most
  tempting to turn up. The number goes in this document once it is chosen, with the contrast figure
  beside it.
- **A full-screen blurred layer is the expensive thing here.** Blur once, animate opacity and mask
  position. Two pseudo-elements is the budget; a third layer is a redesign, not an addition.
- **Colour identifies the leader, not the side.** That is what §2.6 exists for, and why its default
  is on. With the scheme `Off`, a mirror match is the one configuration where the ambient adds
  nothing — the strip and the scale must carry it, and they must be checked in that state.
- **A tuned palette is easy to lose.** Version the stored blob (§3.5) so changing a default later
  migrates rather than quietly overwriting numbers the player chose.
- **Five colours is five times the tuning surface.** Resist adding a sixth knob per colour; tint,
  glow and intensity are enough, and every extra one is a decision the player has to make to get a
  board that already worked.
- **Two turn signals drifting.** The strip says it in words, the room says it in light. Both derive
  from the same `view.turnPlayer` expression in §3.1 — keep it that way, or the contradiction the
  HUD spec just removed comes back in a new form.

---

## 6. What was built (7 Sep 2026)

### 6.1 The code map

| Piece | Where |
|---|---|
| The palette, the schemes, the settings blob, and `turnVars` — the only place a turn becomes a colour | `src/lib/arena/lighting.ts` (pure, no React, under `npm test`) |
| The two layers, layer 3, the master dials, the per-skin values, reduced motion | `src/app/globals.css` |
| The one derived value, and the leader's reserved footprint | `src/components/arena/stage/ArenaStage.tsx` (`turnStyle`, `SideRail`'s `active`) |
| Reading the cookie server-side, beside the skin and the staging | `src/app/arena/[id]/page.tsx` |
| Settings → **Turn lighting** | `src/components/arena/TurnLighting.tsx`, `chooseLightingAction` in `src/app/settings/actions.ts` |
| The checks | `scripts/verify-arena.ts`, last block |

No snapshot field was added, no component below `ArenaStage` learns a rule, and `/api/v1` is
untouched — the Android app derives the same room from the `colors[0]` and `imageUrl` it already
receives.

### 6.2 The settled numbers

Taken from the reference tool's own defaults, which is what it prints:

```css
.arena {
  --turn-master:      0.55;    /* night table */
  --turn-wash-master: 0.22;
  --turn-blur:        28px;
  --lead-scale:       1.10;
  --lead-dim:         0.65;
  --turn-ms:          420ms;
}
[data-skin="anime"] .arena {
  --turn-master:      0.70;    /* the glow washes out against the sky */
  --turn-wash-master: 0.13;    /* the wash bites much harder on white */
}
```

| Colour | tint | glow | k |
|---|---|---|---|
| Red | `#e5484d` | `#ff7a6b` | 95 % |
| Blue | `#3b82f6` | `#6aa8ff` | 105 % |
| Green | `#22c55e` | `#58e08a` | 100 % |
| Yellow | `#e8c020` | `#ffe36b` | 88 % |
| Black | `#7b7f97` | `#a9adc9` | 125 % |
| *Rival* (mirror) | `#a855f7` | `#c98bff` | — |

The anime wash at **0.13** is the contrast number this document owes §5: it is well under the ~30 %
the brief names as where 4.5:1 on the ask card stops holding, and it was chosen low deliberately
rather than tuned up to the edge. **These have not been judged on a phone yet** — that is the one
part of §4 no machine can do, and the Settings group exists so it can be done without a commit.

### 6.3 Three departures, on purpose

1. **The tone tokens are their own, not `--color-dbs-*`.** §3.1's comment points `colourTokenFor`
   at the theme's card-colour tokens, but the reference's own palette disagrees with two of them —
   Yellow is `#e8c020` against the token's `#eab308`, Black `#7b7f97` against `#6b7280` — because a
   pill on a card and a light filling a room are not the same job. Reusing the tokens would have
   made every future pill tweak a lighting change. The five tones live in `lighting.ts` instead,
   and are emitted as `--turn-tint`/`--turn-glow` per render.

2. **The blob is a cookie, not `localStorage`.** §3.5 asks for both "beside the existing feel
   toggles" (which are `localStorage`) and "server-read where the skin cookie is read". Only one of
   those is possible, and the no-flash requirement is the one that matters: a palette the client had
   to read first would show the default room on every load. It is a cookie, like `arenaSkin` and
   `arenaStaging`. It also stores **only the colours that were tuned**, so a later change to a
   default reaches a player who never touched it — which is what §3.5's version integer is for.

3. **The board's children are lifted, not the room isolated.** The obvious way to put two
   pseudo-elements behind everything is `isolation: isolate` on `.arena`. That would make the board
   a stacking context, and the card sheet (`z-50`) would fall behind the app header (`z-20`), which
   is outside it. Instead `:where(.arena) > :where(*)` gives every direct child `position: relative;
   z-index: 1` at **zero specificity**, so anything declaring its own position or z-index — the
   sticky prompt bar, a fixed sheet, an absolute ghost — keeps exactly what it had, and a child
   added later is above the room without knowing the room exists. The reference does the same thing
   (`.scr > * { position: relative; z-index: 1 }`).

### 6.4 What §4 still owes

`npm run typecheck`, `npm run lint`, `npm test` and `npm run build` are clean. Everything in §4's
by-hand list is still open, and the three that will actually change numbers are: **perceived
equality across the five colours in both skins**, **the anime wash against
`design:accessibility-review`**, and **a mirror match in all three schemes**. The `Off` mode is the
one to check first — it is the §2.5 test, and if the board is not unambiguous with the light at
zero, the fix belongs in the turn strip and not in this feature.

### 6.5 One thing this brief assumes that is not true yet

§2.5 and §2.4 both defer the *stated* turn to `docs/arena-hud-spec.md` §2.1 — "the turn strip and
its words stay exactly as they are". **That document is not in this repository and that strip is not
built.** What exists today is `TopStrip`'s trailing `T3 · you` at 10 px in `text-space-600`, the
dimmest colour on the board. So the non-ambient half of §2.5 currently rests on layer 3 — the
active leader at 1.10 with a ring, the idle one dimmed to 0.65 and desaturated, both of which
survive greyscale and `mode: off`. That clears the bar, but only just, and it is one weak signal
where the brief assumed two. The reference tool draws a `turnstrip` band and a `your move` pin that
would fix it; neither was built here, because §2.4 is explicit that a turn moves light and one
card's scale and nothing else. **That is the HUD spec's work, and it is the next thing to do.**
