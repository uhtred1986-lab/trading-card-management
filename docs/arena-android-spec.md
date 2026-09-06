# Arena — the Android app

A native Android client for the arena, built for animation fidelity and installed from the app's own
domain rather than a store.

**Status: not built (6 Sep 2026)** — but it is now *testable*. Step 1, the contract it runs on, is
done and serving at `/api/v1`, and step 0 of §10 is built: `android/contract` proves the Kotlin
still understands the server, in Docker, with no JDK or Android SDK installed on the machine
(`npm run android:test`). No app code exists yet. **Read §10 before writing any.**

Read `docs/arena-client-contract.md` first — it is the wire this app runs on, and the rule it must
not break. The web client's plan is `docs/arena-ui-motion-spec.md`; the two are built and improved
in parallel and share §4 of `docs/arena-design-proposal.md` as their storyboard.

---

## 1. What native buys, and what it costs

Worth writing down plainly, because §13 of the design proposal recommended against a native app and
that recommendation is being overruled deliberately.

**What it buys, concretely:**

- **Frames.** Compose animates on the render thread against a 120 Hz display. A card flight is a
  `graphicsLayer` transform, not a React reconciliation followed by a browser layout pass. Nothing
  in the web board can guarantee it never drops a frame while `next/image` decodes card art.
- **Real haptics.** `VibrationEffect.Composition` gives `PRIMITIVE_TICK`, `PRIMITIVE_CLICK` and
  `PRIMITIVE_THUD` with an intensity per primitive. `navigator.vibrate` gives a duration in
  milliseconds and nothing else. For a game where the whole point is that a card *lands*, this is
  not a small difference.
- **Shaders.** AGSL `RuntimeShader` (API 33+) does the ki burst, the awakening flare and the impact
  flash properly, on the GPU, with no canvas layer fighting the DOM.
- **The screen to itself.** No pull-to-refresh firing mid-drag, no browser back gesture eating a
  swipe, no address bar, no tab. The system back gesture is the app's to handle.
- **Audio that works.** A short cue plays when it is asked to, not when a browser decides the audio
  context may resume.

**What it costs, equally plainly:**

- **Every feature is built twice**, forever, and the storyboard in §6 has to be implemented in two
  animation systems.
- **The thin-client decision keeps the wait.** Native animation is silky; the *pause before it
  starts* is still a Neon round-trip, because the rules stay on the server (contract §1). Native
  fixes jank, not latency. §5.4 is how that is covered rather than solved, and contract §10 is the
  one change that would actually shorten it.
- **A release pipeline** — signing keys, a version endpoint, an in-app updater — for an app with one
  user.

## 2. Decisions (5 Sep 2026)

1. **Kotlin + Jetpack Compose.** React Native was the alternative and would have let the TypeScript
   engine be embedded, but the ask was native and Compose is where the animation ceiling is.
2. **Thin client.** The engine stays on the server; the app renders `view`, offers `legal`, and
   animates `beats`. **No rule is ever evaluated on the device.** A second rules implementation is
   the one thing that would sink this project.
3. **Arena plus read-only decks.** Pick a deck, look a card up, play. Collection entry, scanning,
   pricing, the cart and the AI deck tools stay in the web app and are reached by deep link.
4. **Self-hosted APK** behind the existing Basic Auth, with an in-app update check. No Play Store,
   no Firebase, no third party.
5. **One repository.** The app lives in `android/` next to the server that defines its contract, so
   the golden fixtures both sides test against are one relative path away.

## 3. Stack

| Concern | Choice | Why |
|---|---|---|
| Language / UI | Kotlin 2.x, Jetpack Compose, Material 3 | — |
| minSdk / targetSdk | **30** / 36 | API 30 is where `VibrationEffect.Composition` lands, which §5.5 depends on |
| Networking | OkHttp + Retrofit + `kotlinx.serialization` | Two clients: a short-timeout one for actions, a long-read one for `advance` and long-polls |
| Images | **Coil 3**, sharing the OkHttp client | Disk cache for card art; both decks preloaded at game start so no card ever pops in |
| DI | Hilt | — |
| State | ViewModel + `StateFlow`, unidirectional | One `ArenaViewModel` owning `Snapshot` and the beat queue |
| Navigation | Navigation Compose, type-safe routes | Four screens (§4) |
| Storage | DataStore for preferences; **Android Keystore** AES-GCM for credentials | `EncryptedSharedPreferences` has sat in alpha and is deprecated — do not use it |
| Shaders | AGSL `RuntimeShader`, API 33+, with a Compose `Canvas` fallback | §6 |
| Audio | `AudioTrack` tone synthesis | Mirrors `src/lib/scan/cue.ts` — the app ships no audio assets, on either client |
| Build | Gradle version catalogs, R8 + resource shrinking | — |

## 4. Screens

1. **Games** — the list, resume or start. Mirrors `/arena`.
2. **New game** — two deck pickers (leader art, built/virtual, legality, "playable" if `dbs` with a
   leader and 50+ main), mode toggle Sparring / Tournament / hot-seat.
3. **Board** — §5. Portrait, edge-to-edge, screen kept awake.
4. **Decks** — read-only: the deck list, a deck's zones, a card's full face and text. Anything that
   would change data is a button that opens the web app at the matching URL.

## 5. The board

### 5.1 Layout

The web board's arrangement is already right and is kept: the two Battle Areas facing each other
across a stage, each Leader anchored at its own side with life beside it, counters pushed to the
corners, one prompt bar asking one question, the hand along the bottom. Portrait only. Edge-to-edge
with `WindowCompat.setDecorFitsSystemWindows(false)` and insets consumed explicitly, so the prompt
bar sits above the gesture bar and nothing hides under a cutout.

The hand is a **bottom sheet**, not a filmstrip: a fanned peek, dragged up to a readable fan, a card
lifted on tap with the legal destinations lit, committed on the second tap. This is the single
biggest ease win and it is worth building here first, where a drag can be velocity-tracked properly.

### 5.2 Cards fly, because the id is the key

`SharedTransitionLayout` with `Modifier.sharedElement(rememberSharedContentState(key = card.id))`
is the direct analogue of the web board's `layoutId`: the engine's instance id is stable across
zones, so a card moving hand → battle → drop is one composable whose bounds animate, not two
composables that appear and disappear. Every zone also renders an invisible **anchor** so a card
arriving from somewhere unseen — deck, life, Z-deck — has a rectangle to fly from.

### 5.3 The beat player

A `BeatPlayer` in the ViewModel walks `Beats.list` on a frame clock and exposes
`suppressed: Set<String>`, `ghosts: List<Ghost>`, `current: Beat?` and `skip()`. It works exactly as
the web client's does, and for the same reason: the server sends the **end** state, so cards that
have not yet arrived are held back and cards that have left are drawn as ghosts from the art the
beat carries. Contract §4 explains what this can and cannot show.

Input is locked while a beat run plays, with **Skip** in the prompt bar. Skip and reduced motion are
the same code path — `Settings.Global.ANIMATOR_DURATION_SCALE == 0f` sets every duration in
`Motion.kt` to zero rather than branching in each composable, so neither can rot while the other is
in use.

### 5.4 Covering the round trip

The app cannot know whether a move is legal, but it does know **which move it just sent**, and the
server accepts a move from `legal` nearly always. So on tap:

1. Haptic `PRIMITIVE_CLICK`, the card lifts — immediately, on the frame of the touch.
2. The **provisional beat** for the intent plays at once: the card flies to the zone the action
   names. Nothing else changes; no counter moves, no power figure, no life.
3. The response arrives and either confirms it — the provisional card is already there, so the real
   beats continue from it seamlessly — or it is an `illegal_action`, in which case the card snaps
   home with a shake and `PRIMITIVE_THUD`, and the message from the engine is shown verbatim.

This is honest latency cover, not a fix. It makes the tap feel instant and the *consequences* still
arrive when the server says so.

Also: one OkHttp connection pool kept warm, HTTP/2, a `GET /health` on resume so the first tap of a
session does not pay for a cold TLS handshake.

### 5.5 Feel

- **Haptics** (`Haptics.kt`, `VibratorManager`): tap `TICK`; land `CLICK`; illegal `THUD` ×2;
  clash a composition of `CLICK` + `THUD`; damage a longer `THUD` scaled by the amount; KO a
  falling pair. `HapticFeedbackConstants.CONFIRM` / `REJECT` for the prompt bar. One switch.
- **Sound**, default off, one switch: draw, charge, land, clash, KO, win — synthesised through
  `AudioTrack` at the same intervals `cue.ts` uses on the web, so the two clients sound alike.
- **Screen** stays awake for a `playing` game (`FLAG_KEEP_SCREEN_ON`), released when it ends.
- **Refresh rate**: request the display's highest mode while the board is on screen.
- **Back** is handled: on the board it asks before leaving a game in progress, never drops out.

## 6. The storyboard, in Compose

§4 of the design proposal, mapped to the mechanism. Durations match the web client's to the
millisecond, from the same table, so the two clients feel like one game.

| Moment | Beat | Compose mechanism | ms |
|---|---|---|---|
| Draw | `draw` | shared element from the deck anchor; the fan re-spaces via `animateBounds` | 220 |
| Charge energy | `move` hand→energy | shared element + `graphicsLayer { rotationZ }` through 180° | 260 |
| Play a Battle Card | `move` hand→battle | lift (`scale`, elevation), glide, 4 px settle, AGSL edge glow | 280 |
| Rest / Active | `mode` | `animateFloatAsState` on `rotationZ` | 200 |
| Attack declared | `attack` | `Animatable` lunge to 30 % and back; the targeting arc drawn on a `Canvas` between the two anchors | 300 |
| Combo | `move` →combo | slide in; the power figure **counts up** with `animateIntAsState` | 250 |
| Clash | `clash` | both figures slam (`keyframes`), AGSL impact flash at the guard | 300 |
| Counter | `move` in a counter window | spring from hand, stamp, then Drop | 320 |
| Blocker | `block` | blocker slides in front of the target and rotates to rest | 280 |
| Damage | `damage` | leader flash, a life card flips and flies to hand (red + to Drop if Critical), haptic | 340 |
| KO | `ko` | ghost shudders, desaturates via a colour-matrix `RenderEffect`, slides to Drop | 300 |
| Awaken | `flip` | `rotationY` on a `graphicsLayer` with `cameraDistance`, AGSL ki burst at the midpoint | 350 |
| Unison markers | `markers` | chips pop in on a spring / fall off with gravity | 180 |
| Claude plays | `move` from a hidden hand | the back flips to the face as it leaves | 300 |
| Claude thinking | `waiting == "opponent"` | leader pulses. **Never streams reasoning** | — |
| Turn change | `phase` | the banner sweeps; the active side's light shifts | 1500 |

Particles (ki burst, KO motes) are a Compose `Canvas` driven by `withFrameNanos`, capped and pooled.
Below API 33 every AGSL effect degrades to a radial-gradient flash — the game must be fully playable
on a device that has no shader support.

## 7. Read-only decks

`GET /api/v1/decks` and `/decks/{id}`. Grid of leaders, built/virtual badge, legality label from the
server's own `legality()` — never recomputed on the device, for the same reason no rule is. Tapping a
card opens the full face, printed text, and the engine's reading of it (`CardView.reading`,
`CardView.referee`), which is the same panel the web board's inspector shows. Every edit affordance
is a link into the web app.

## 8. Build, signing and delivery

- **CI** (GitHub Actions) on a tag: `./gradlew assembleRelease`, signed with a keystore held in
  repository secrets, producing a **universal APK** — an AAB would only matter to a store.
- **Hosting**: CI uploads the APK to Vercel Blob (private) and `GET /api/v1/app/apk` streams it
  after Basic Auth passes. If Blob is not wanted, the fallback is a `bytea` row, which is exactly
  what `scan_photos` already does for phone photos.
- **Update check**: on launch and on resume, `GET /api/v1/app/version` →
  `{ versionCode, versionName, sha256, notes }`. Newer than `BuildConfig.VERSION_CODE` offers the
  update; below the server's `minClient` it is required and the board refuses to open.
- **Installing**: `DownloadManager` with `addRequestHeader("Authorization", …)`, then the SHA-256 is
  **verified before anything is launched**, then a `PackageInstaller` session. This needs
  `REQUEST_INSTALL_PACKAGES`, which is a sensitive permission — acceptable for a sideloaded personal
  app, and worth knowing it would need justification if this ever did go to a store.
- **Crash reporting without a third party**: an uncaught-exception handler that POSTs the stack and
  the current game id into the existing `arena_feedback` table, which already exists for bugs found
  while playing and is already read at `/arena/feedback`.

## 9. Security

- Credentials are entered once and stored **encrypted with an Android Keystore key**, `StrongBox`
  when the device has it, with an optional biometric gate on launch. Not in DataStore in the clear,
  not in `SharedPreferences`.
- `usesCleartextTraffic="false"`; a network security config that permits nothing but HTTPS.
- Certificate pinning is **not** recommended: the domain is on Vercel's rotating certificates and a
  pin would brick the app on a renewal, which is a worse failure than the one it prevents.
- `allowBackup="false"` — the credential should not travel to another device through a cloud backup.
- The app never logs the `Authorization` header, and OkHttp's logging interceptor is release-off.

## 10. Verification, and how to make any of it possible

**Today, nothing on this machine can compile a line of Kotlin.** Checked 6 Sep 2026: no `java`, no
`javac`, no `kotlinc`, no `gradle`, no `ANDROID_HOME`, no Android SDK directory, no Android Studio.
Writing the app before fixing that means writing code nobody can run, which is worse than writing
none — unverified code *looks* finished.

The good news is that the risk and the setup cost are not spread evenly. Four tiers:

| Tier | What it can check | Needs | Rough size |
|---|---|---|---|
| **0** | The contract: does Kotlin round-trip what the server actually sends? | a JDK | ~200 MB |
| **1** | Pure logic: beat player, moments, view state, update checks | a JDK | — |
| **2** | Compose UI rendered to PNG, no device involved | + Android SDK (cmdline-tools) | ~3 GB |
| **3** | Haptics, wake lock, install/update, real frame timing | + a phone or emulator | the phone you own |

**Tiers 0 and 1 need no Android at all** — no SDK, no emulator, no Studio, just a JDK. That is the
wedge: the highest-risk part of a thin client is not its UI, it is whether it still understands the
server, and that is checkable for the price of one download.

### Stage 0 — **built**: `android/contract/`

A Kotlin/JVM Gradle module with **no Android plugin at all**: `kotlinx-serialization-json`, the
`Snapshot` / `Beat` / `CardView` data classes hand-written in `Snapshot.kt`, and six tests that read
the golden fixtures straight out of `contract/fixtures` — not copies, the very files `npm test`
regenerates and compares on the server side.

Run it with **no JDK on the machine**:

```
npm run android:test                                  # from the repository root
cd android && docker compose run --rm contract        # the same thing
cd android && docker compose --profile tools run --rm shell   # a prompt inside the toolchain
```

Two decoders, deliberately:

- **strict** (`ignoreUnknownKeys = false`) — fails the moment the server grows a field. A tripwire,
  not a bug: someone should look at the new field and decide whether the app wants it.
- **lenient** (`ignoreUnknownKeys = true`) — proves an *older* app still works against a *newer*
  server, which is the actual promise contract §7 makes.

Proven rather than assumed: renaming one field in a fixture — `owner` → `whoseCard`, exactly what a
careless server change looks like from here — fails five of the six tests. That is the drift
detection working across two languages.

Three things the build settled:

- **`LegalAction.action` is left as opaque `JsonElement`.** A client picks a move by index and never
  describes one (contract §5), so modelling the `Action` union in Kotlin would be a second
  definition of the rules' vocabulary in a second language, for nothing.
- **Kotlin block comments nest.** A `/*` inside a doc comment — as in a path with a glob — opens a
  nested comment and swallows the rest of the file. Cost one confusing build failure.
- **The fixtures directory is declared as a task input.** Without it Gradle calls the tests up to
  date when only the fixtures changed, which is the exact moment they need to run.

**The gap it closed on the server side:** `scripts/verify-arena.ts` now also emits `all-beats.json`,
a snapshot carrying **one of every one of the sixteen beat kinds**, built by hand. It has to be by
hand: ~700 moves of `arena:playthrough` have never produced a `token`, `block`, `markers`, `negated`
or `say` beat, because those need a token card, a blocker, a Unison, a negated attack and an
opponent who talks. Without that fixture a client could get five of the sixteen shapes wrong and
nothing anywhere would notice.

### Stage 2 — screenshots without a device

Roborazzi or Paparazzi render Compose to PNG on the JVM. Board states driven from the same fixtures:
mid-battle, targeting, a counter window, rest/active, an awakened leader, game over. This catches
layout regressions that a person playing would not notice for weeks, and still never starts an
emulator.

### Stage 3 — the phone, for what cannot be faked

Haptics, wake lock through a Tournament turn, install and update from the app's own domain, the back
gesture, airplane mode, `ANIMATOR_DURATION_SCALE = 0`, and Macrobenchmark's `FrameTimingMetric`
across a full attack sequence. An emulator is mostly avoidable here: the owner has the target device,
and jank on it is the only number that means anything.

### Where it lives

`android/` with its own Gradle wrapper, ignored by the JS toolchain (`tsc` and ESLint only look at
`src/` and `scripts/`, so nothing to change). `.gitignore` gains `android/build/`, `android/.gradle/`
and `android/local.properties`. `npm test` stays JavaScript-only; an `npm run android:test` that
shells out to `gradlew` is optional sugar, not a requirement.

Pin versions when the module is created rather than from memory — Kotlin, AGP and
`kotlinx-serialization` all move, and a wrong version in a document is worse than no version.

### CI

`actions/setup-java@v4` with Temurin gets tiers 0 and 1 running on every push in well under a
minute. Tier 2 adds `android-actions/setup-android`. Tier 3 needs
`reactivecircus/android-emulator-runner`, which is slow enough to reserve for release tags.

### The recommendation

**Install a JDK, build stage 0, and stop there for now.**

Stage 0 pays for itself whether or not the Android app is ever written: it is a second, independent
check on the contract, in a different language, which is exactly the kind of check that catches what
one language's type system waves through.

Everything past stage 0 should wait on one question that is still open. This app's whole
justification (§1) is animation fidelity the web could not reach — but the web motion board now
exists and **nobody has watched it run**. If it turns out to be smooth enough on the owner's phone,
the honest conclusion is that the Android app is not needed, and the cheapest version of this
project is the one that never gets built.

## 11. Order of work

| # | Step | Done when |
|---|---|---|
| 0 | ~~Toolchain and `android/contract`~~ **done** | `npm run android:test` round-trips every fixture, strict and lenient, in Docker |
| 1 | ~~Contract — the server side~~ **done** | `/api/v1` serves a real snapshot; `npm test` guards the shape with golden fixtures |
| 2 | Project skeleton: Gradle, Hilt, theme mirroring the `space` / `ki` tokens, auth screen | The games list loads from the real server |
| 3 | Static board — `view` rendered, `legal` tappable, no animation at all | A whole hot-seat game is playable, ugly |
| 4 | Beat player + shared-element flights | Claude's turn is watchable |
| 5 | Hand sheet, targeting, prompt bar, provisional beats (§5.4) | It feels like an app |
| 6 | Storyboard §6, one row at a time | — |
| 7 | Haptics, sound, wake lock, refresh rate | — |
| 8 | Read-only decks | — |
| 9 | Signing, hosting, in-app update | Installed on the phone from the app's own domain |

Steps 1–3 are the ones that decide whether this works. If the board is not playable end to end by
step 3, stop and reconsider before a line of animation is written.

## 12. What deliberately stays in the web app

Collection entry and bulk entry, voice entry, the scanner and quick capture, prices and movers, the
CardTrader cart optimiser, deck editing, the AI deck tools, the arena's own debug, backlog, rules and
feedback pages. All of it is server-driven and gains nothing from being native, and every one of
those built here is one not being improved in the place it already works.
