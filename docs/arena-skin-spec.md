# Arena — the Anime Sky skin

**Status: built (6 Sep 2026).** Written to be executed by Claude Code in this repository; §8 records
what was built and where it departs from the brief.

A second skin for the arena board: daylight sky instead of deep space, ink outlines instead of thin
borders, ki auras instead of rings, impact type instead of plain numerals. Same board, same rules,
same beats, same card sizes — only the surface changes. A skin that has to reach into the game logic
is not a skin, and this one does not.

Independent of `docs/arena-workflow-spec.md`. Either can go first; this one is smaller.

---

## 0. How to run this

### 0.1 Put the brief in the repo

Save as `docs/arena-skin-spec.md` and commit.

### 0.2 Start the session

From the repo root, `claude`, then paste:

> Read `docs/arena-skin-spec.md`. Implement it. Do not change any layout, card size, spacing or
> component logic — this is a skin. Plan first and show me the plan before you edit anything.

Plan mode is worth it for the first turn only because of §3.3, which touches four component files.

### 0.3 What to watch in the diff

- **No JSX structure changes, no size changes.** The only edits to `.tsx` files should be replacing a
  hardcoded colour with a token, plus one `data-skin` attribute and one toggle component. If a diff
  starts moving elements or changing `width={52}`, stop it.
- **`globals.css` does most of the work.** If the diff is mostly component edits, the mechanism in
  §1 was not used.
- **Both skins must stay good.** The night board is the default and stays the default. A change that
  only makes sense under the sky belongs inside the skin's scope.

---

## 1. The mechanism, and why this is small

The app is Tailwind v4 with a plain `@theme` block in `src/app/globals.css`. Plain `@theme` (not
`@theme inline`) emits the palette as CSS custom properties and compiles every utility to reference
them — `bg-space-800` becomes `background-color: var(--color-space-800)`.

**That means redefining `--color-*` inside a scope re-skins every Tailwind utility inside that
subtree, with no component edits at all.** The whole board is already painted in `space-*`, `ki-*`
and `dbs-*`; overriding those variables under one attribute selector repaints it.

Verify this before building on it rather than trusting the paragraph above: build once and check
that the emitted utility references the variable.

```powershell
npm run build
# then grep the built CSS for a utility and confirm it reads var(--color-…)
```

If it does not — if the project is ever switched to `@theme inline`, which inlines the literal — the
fallback is a second `@theme` under a `@layer` with duplicated utilities, which is much worse. Say so
and stop rather than quietly doing that.

Two things the mechanism does not cover, and they are the actual work:

- **25 hardcoded colour literals** in the arena components (`rgba(…)` and `#rrggbb` in
  `shared.tsx`, `ArenaCard.tsx`, `stage/ArenaStage.tsx`, `stage/Ghosts.tsx`) plus the keyframes in
  `globals.css`. These do not move with the tokens. §3.3.
- **The things that are not colours**: outlines, hard shadows, halftone, aura, starburst, speed
  lines, display type. Those are new rules, scoped to the skin. §3.4.

## 2. Decisions

1. **A preference, not a rewrite.** Night table stays the default and stays maintained. The skin is
   one attribute and one block of CSS.
2. **A cookie, not `localStorage`.** `FeelToggle` uses `localStorage`, which is right for sound and
   haptics — nobody sees a flash of the wrong buzz. A whole re-skin read on the client flashes the
   night board on every load. Read the cookie server-side in `src/app/arena/[id]/page.tsx` and put
   the attribute on the markup the server sends, exactly as the deleted `boardStyle` cookie did.
3. **Scope is the `.arena` root, not `<html>`.** The rest of the app — collection, decks, cart — is
   not part of this and must not change colour.
4. **Card faces stay dark.** The chrome goes bright; the card itself keeps a dark ground under the
   art, because the art is the card and a bright bezel around a dark face is what a cel looks like.
   This is also what keeps `.pw`, `.nm` and the keyword marks legible without re-tuning every one.
5. **Ink outlines are a legibility feature, not only a style.** A 2 px near-black border around a
   66 px card on a bright ground raises its contrast rather than lowering it. That is the reason the
   skin is safe at phone size, and the reason §5 checks it rather than assuming it.
6. **The manifest stays dark.** `themeColor` in `src/app/layout.tsx` and `theme_color` /
   `background_color` in `src/app/manifest.ts` are the app's identity on the home screen and the
   splash, not the board's skin. A per-user skin must not change what the OS shows before the app
   has loaded.

## 3. The work

### 3.1 The switch

- Cookie `arenaSkin`, values `night` (default) and `anime`.
- A server action beside the existing ones in `src/app/arena/actions.ts` to set it.
- `src/app/arena/[id]/page.tsx` reads it and passes it down; `ArenaStage` puts it on its root:
  `<div className="arena …" data-skin={skin}>`.
- A toggle in the same row as `FeelToggle` and `ReportBug` — one control, two words, no icon.
- `?skin=anime` / `?skin=night` as a one-load override, for screenshots and for checking both
  quickly. The old `boardStyle` cookie did exactly this; follow that shape.

### 3.2 The token overrides — `src/app/globals.css`

Add after the existing `.arena` block. These are the tested values from the prototype.

```css
/*
 * Anime Sky — a second skin for the board only. Daylight ground, ink outlines,
 * ki light. It repaints by redefining the theme's own custom properties inside
 * this scope, so every Tailwind utility on the board follows without a single
 * component knowing a skin exists.
 */
.arena[data-skin="anime"] {
  /* A bright ground needs the native controls and scrollbars to know. */
  color-scheme: light;

  /* Surfaces invert: what was deep space is now paper and ink. */
  --color-space-50: #12161f;
  --color-space-100: #1b212d;
  --color-space-200: #2c3646;
  --color-space-300: #46566a;
  --color-space-400: #5a6b80;
  --color-space-500: #7c8ca0;
  --color-space-600: #12161f;   /* borders become ink, not grey */
  --color-space-700: #12161f;
  --color-space-800: #ffffff;
  --color-space-900: #f4f8ff;
  --color-space-950: #eaf7ff;

  /* Ki stays ki — it is the one thing both skins agree on. */
  --color-ki-300: #ffd54a;
  --color-ki-400: #ffc02e;
  --color-ki-500: #f2711c;
  --color-ki-600: #c2410c;

  --color-gain: #17a55f;
  --color-loss: #d8322f;

  /* Skin-local values the rules below use. */
  --ink: #12161f;
  --sky: #63c2f5;
  --sky-deep: #2e9fe0;
  --sky-hi: #bfe9ff;
  --cloud: #ffffff;

  background:
    radial-gradient(closest-side at 16% 13%, rgba(255,255,255,.95) 0 38%, rgba(255,255,255,0) 74%),
    radial-gradient(closest-side at 34% 7%,  rgba(255,255,255,.90) 0 34%, rgba(255,255,255,0) 72%),
    radial-gradient(closest-side at 72% 6%,  rgba(255,255,255,.95) 0 36%, rgba(255,255,255,0) 74%),
    radial-gradient(closest-side at 90% 17%, rgba(255,255,255,.80) 0 32%, rgba(255,255,255,0) 70%),
    radial-gradient(closest-side at 54% 21%, rgba(255,255,255,.55) 0 34%, rgba(255,255,255,0) 72%),
    linear-gradient(180deg, var(--sky-deep) 0%, var(--sky) 26%, var(--sky-hi) 62%, #eaf7ff 100%);
}
```

The inversion of `space-600`/`700` to ink rather than to a light grey is deliberate: those two tokens
are what every border on the board uses, and turning them into the outline is what buys the cel look
for free.

### 3.3 The literals that do not move

25 hardcoded colours will not follow the tokens. Find them:

```powershell
# in src/components/arena/ and the .arena rules in globals.css
rg "rgba\(|#[0-9a-fA-F]{6}" src/components/arena src/app/globals.css
```

For each, one of three fixes, in order of preference:

1. **Promote to a token** if the colour is already in the palette in another form — e.g.
   `rgba(242,140,15,0.55)` is `--color-ki-500` at 55%. Tailwind v4's slash syntax handles this:
   `shadow-[0_0_14px_theme(--color-ki-500/55%)]`, or move the shadow into a named class.
2. **Give it a skin-local variable** if it is genuinely a board colour with no token — the card back
   radial in `ArenaCard.tsx` and `ArenaStage.tsx`'s `HandBacks`, and the ghost overlay in
   `Ghosts.tsx`. Define `--card-back` in both skins and use it in both places, which also removes an
   existing duplication.
3. **Scope it** if it only makes sense in one skin. Last resort; each one is a rule that has to be
   remembered twice.

The keyframes in `globals.css` (`arena-hit`, `arena-hurt`, `arena-banner`, …) carry literals too.
They should read the tokens so the hit flash is red on both grounds without a second copy.

### 3.4 The skin's own rules

Everything here is scoped under `.arena[data-skin="anime"]` and adds no layout. Values are from the
prototype and were checked at 360, 375 and 390 px.

- **Screentone.** A 6 px halftone dot grid at 16% opacity over the top of the board, masked to fade
  out before it reaches the battle rows. `pointer-events: none`, behind everything.
- **Ink outlines.** `border: 2px solid var(--ink)` and `box-shadow: 2px 3px 0 rgba(18,22,31,.9)` on
  cards, strips, chips and buttons. No blur — the hard offset is the whole trick.
- **Ki aura.** Replace the ring on a playable card with a gold glow on a 1.5 s breathing cycle.
  **Board cards animate; hand cards get the static version** — six animated box-shadows in a fanned
  hand is both a wall of gold and a real paint cost on a mid-range phone.
- **Impact type.** Power figures, life numerals, the step banner and the verdict get a heavy italic
  face with a black `-webkit-text-stroke` and `paint-order: stroke fill`. Sizes do not change; only
  the treatment.
- **The clash starburst.** A slow conic-gradient starburst behind the two power figures in
  `ClashBand`, masked to a ring so it never sits under the digits.
- **Speed lines.** A radial `repeating-linear-gradient` overlay for ~320 ms on the `attack` and
  `clash` beats, masked out of the centre. Driven from `playback.current` like every other moment in
  `docs/arena-ui-motion-spec.md` §7 — not from a re-render.
- **Energy chips.** The `echip` row reads as upright gold cards and rested grey ones, outlined.

Put these in `globals.css` beside the existing `arena-*` keyframes, in one block with a comment
naming the skin, so the whole thing can be read — or deleted — in one place.

### 3.5 The display face

There is no `next/font` in this project today; the app runs on Tailwind's default stack. Add one:

```ts
// src/app/layout.tsx
import { Kanit } from "next/font/google";
const impact = Kanit({ subsets: ["latin"], weight: ["800", "900"], style: ["italic"], variable: "--font-impact", display: "swap" });
// …then add impact.variable to the <html> className
```

Used **only** inside the skin, for the numerals and banners in §3.4. Everything else keeps the
current stack. One family, two weights, italic only — do not let this grow into a typography system.

### 3.6 Where each rule lands

| Prototype rule | Real component |
|---|---|
| card frame, cost disc, power bar, keyword marks | `src/components/arena/ArenaCard.tsx` (classes only) |
| strips, life pips, energy chips, deck/drop counters | `stage/ArenaStage.tsx` — `SideRail`, `TopStrip` in `shared.tsx` |
| clash starburst, power figures | `stage/ArenaStage.tsx` — `ClashBand`, `Count` |
| step banner, skill spotlight, card preview, inspector | `src/components/arena/shared.tsx` |
| prompt bar, buttons | `stage/ArenaStage.tsx` |
| hand fan, grip, log | `stage/Hand.tsx` |
| speed lines, aura, screentone, sky | new rules in `globals.css`, no component edits |

## 4. What must not change

- No card width, height, gap, padding or font size. `--arena` and every `px(n)` in `ArenaCard` stay
  exactly as they are. The skin is paint.
- No component logic, no props beyond the one `data-skin` attribute.
- No change to `motion.ts` durations, `useBeatPlayer`, or anything in `src/lib/arena/`.
- The night board stays the default and stays as good as it is today.
- `prefers-reduced-motion` continues to zero every animation, the new ones included — add them to
  the existing reduced-motion block rather than starting a second one.

## 5. Verification

```powershell
npm run typecheck
npm run lint
npm test
npm run build     # and confirm §1's mechanism in the emitted CSS
```

Then, by eye and by measurement:

- **Contrast.** Every text colour against its new ground at **4.5:1** (WCAG AA), and the small
  numerals — power at 13 px, cost at 12 px — checked specifically, since those sit on the card and
  not on the sky. The `design:accessibility-review` skill in this workspace does this pass.
- **Both skins at 360 and 390 px**, night and anime, side by side. Anything that reads worse under
  the sky is a bug in the skin, not a reason to change the night board.
- **Reduced motion** on: the board must be fully playable, aura and speed lines still.
- **The manifest is untouched** — `themeColor` and `manifest.ts` unchanged (decision 6).
- **One game on the phone in each skin**, which is also the gate `docs/arena-ui-motion-spec.md` §8
  has been waiting for.

## 6. Risks

- **Contrast on a bright ground** is the one that fails silently. Card faces staying dark
  (decision 4) is what prevents it; if a decision is made to brighten them, every numeral needs
  re-checking.
- **Animated box-shadows are expensive.** The aura is a shadow animation on potentially six or seven
  cards at once. Board only, hand static; if a frame budget is exceeded on a mid-range Android,
  reduce to a single pulsing outline rather than a glow.
- **`color-scheme`.** `:root` sets `dark` globally. Without the scoped `light` in §3.2, native
  scrollbars and form controls inside the board stay dark on the bright ground.
- **Halftone over text** is the classic mistake. It is masked to the top of the board and must never
  reach the prompt bar or the hand.
- **Two skins to maintain.** Every future board change now has two grounds to look right on. That is
  the standing cost of decision 1, and it is the reason §3.2 repaints through tokens rather than by
  duplicating component styles — the cheaper the skin, the likelier it survives.

## 7. The reference

The skin is playable at phone size, both skins side by side, in the prototype:
`https://claude.ai/code/artifact/fe01dff9-b48e-4b66-8d4f-a955fc47b649` — the **Skin** control in the
panel. Its "Anime sky" section explains each decision and what it deliberately does not do.

Everything there is drawn in CSS: no character art, no logos, nothing traced. That is not only a
licensing position, it is why the skin is portable — there are no assets to ship, nothing to load on
a mobile connection, and the whole thing survives as text in `globals.css`.

## 8. What was built (6 Sep 2026)

The mechanism in §1 was verified first: the built CSS compiles `bg-space-800` to
`background-color:var(--color-space-800)`, so the skin repaints through the tokens. What landed:

- **The switch** as §3.1 describes: cookie `arenaSkin`, `chooseSkin` in `src/app/arena/actions.ts`,
  read in `src/app/arena/[id]/page.tsx` with `?skin=` winning for one load, `data-skin` on the
  board's root, and `SkinToggle` beside the buzz/sound toggles, naming the skin it switches *to*.
  `src/lib/arena/skin.ts` holds the two names and the cookie key.
- **Every colour literal in the arena components is gone.** They became named classes in
  `globals.css` painted from the tokens with `color-mix` (`arena-ring-*`, `arena-cost`,
  `arena-float`, `arena-prompt-live`, `arena-pulse`, `arena-power-win`, `arena-tick-*`,
  `arena-ghost`), `--card-back` for the two card-back radials, and CSS variables on the attack
  beam's SVG. The stage gradient, the empty slot and the `arena-hurt` keyframe read tokens too.
  Component edits are class names and the one attribute; no size, spacing or logic changed.
- **The skin block** at the end of `globals.css`: the token overrides, the sky, the screentone
  (masked out by 45 %, well above the battle rows), ink outlines with the hard offset shadow on
  cards, strips, the stage, the prompt bar, the hand and every `.tap` button, the ki aura
  (animated on the board, static in the hand), impact type on the power figures, the life
  numerals and the step banner, the clash starburst masked to a ring, speed lines on the `attack`
  and `clash` beats, and paper-grey rested energy. Kanit arrives through `next/font` as
  `--font-impact`, used only inside the skin.
- **Card faces keep the night palette** (decision 4) by re-declaring the dark tokens inside
  `.arena-card`, so names, power bars, rest bands and keyword marks keep the contrast they were
  tuned for without touching a single one.

**Departures, all for §5's 4.5:1:** `space-500` is `#5f7087` rather than the prototype's `#7c8ca0`
(3.4:1 on white, and it is the colour of every small label), `gain` is `#0b7a43` and `loss`
`#c92a27`. Ki as *text* on paper is the dark ki (`ki-600`, 5:1) and stays gold on a card face;
a `space-700` *background* is the prototype's panel blue rather than ink. Measured, not assumed:
ink on paper 18:1, `space-300` 7.5:1, `space-400` 5.5:1, the strip's sky blue 9.9:1.

**The default flipped on the same day**: the owner asked for the anime sky to be the default, so
`skinFrom` now falls back to `anime` and `night` is the one you choose (decision 1 amended). The
night table stays maintained and stays as good as it was.

Verified here: typecheck, lint, `npm test`, both skins at 360 and 390 px from the golden fixtures,
reduced motion zeroing the aura (the reduced-motion block was moved after the skin so it wins),
and `themeColor` / `manifest.ts` untouched. Not yet done: a game on the phone in each skin, which
is the gate §5 shares with the motion spec.

