# Arena on a real phone: the overnight run and the UX review

The phone half of `docs/arena-offline-release.md` §8, plus a review of whether the board **tells the
player what is going on**. `npm run arena:phone` plays the offline matrix on an Android phone over
USB, by touch, and keeps a screenshot of every moment worth judging with the engine's truth beside
it. The review below turns that into findings. A Claude session on the laptop runs both halves; the
owner only plugs the phone in.

What it is not: no iPhone (Safari can only be driven from a Mac), no claim about Firefox or Samsung
Internet, and no substitute for a person playing a match: the moves are the scripted `humanPick`
the release matrix uses, made by tapping.

## 1. One-time setup

**Phone** (Android 11 or later, Chrome)
1. Settings → About phone → tap **Build number** 7 times (Developer options).
2. Developer options: **USB debugging** on, **Stay awake** on.
3. Screen lock: **None** or **Swipe** for the night. A PIN lock hides Chrome and the run stops.
4. Plug it in and accept "Allow USB debugging" (tick "Always allow from this computer").
5. In Chrome, sign-in and sync do not matter; a first-run screen must be dismissed once by hand.

**Laptop** (PowerShell)
```powershell
winget install Google.PlatformTools          # adb; open a new terminal afterwards
adb devices                                  # one line ending in "device"
git worktree add ..\dbs-phone origin/main    # a worktree with NO .env.local: no Neon, no sign-in
# node_modules: copy the main checkout's (docs/arena-agent-tools.md §1; npm ci fails on this machine)
```
Why the worktree: `next start` reads `.env.local` by itself, so a checkout with one would reach Neon
and ask for a sign-in. The script also drops those variables from the server's environment, but
the build would still read them.

## 2. The overnight run

```powershell
cd ..\dbs-phone
$env:GITHUB_SHA = git rev-parse HEAD
npm run build
npm run arena:phone                          # 8 matches + the recovery case, by touch, with shots
npm run arena:phone -- --skip-prepare --shots none --no-recovery   # optional second pass: clean budget figures
```

The script needs nothing else open: it starts `next start` on port 3763, maps it to the phone
(`adb reverse`), drives Chrome over `adb forward … chrome_devtools_remote`, prepares the offline
pack online, then **stops the server, removes the mapping and switches airplane mode on**. USB
debugging keeps working in airplane mode. Each case force-stops Chrome and cold-launches `/arena`.
At the end it switches airplane mode off, removes both mappings and puts back the phone's own pace
setting. **Ctrl+C restores the phone too.** A run that stops with the phone still in airplane mode
(the laptop slept, the cable came out) is undone with `adb shell cmd connectivity airplane-mode disable`.

Useful flags: `--cases A-v-B-first,B-v-A-second` or `--cases 2`; `--pace slow` (the default a player
gets) instead of `step` (one shot per beat of the computer's turn); `--shots decisions`;
`--card-review-every N` (default 12); `--serial` with two devices; `--browser-package
com.chrome.beta`; `--no-airplane` (Android 10 and older, which refuse the airplane command: the
network is then cut only by stopping the server, so card art could still come from the CDN).

Laptop sleep ends the run: plug the laptop in and set sleep to "never" for the night.

**No phone?** `npm run arena:phone -- --emulated --cases 1` runs the same thing in headless Chrome
at 390 px. That proves the tool; it fills no row of the §8 table.

## 3. What comes out (`arena-phone-runs/<time>/`, git-ignored)

| File | What |
|---|---|
| `findings.md` | The §8 table filled in where a figure exists, the budgets, playing by touch (moves made by tap, a tap that sent another move, moves **no tap reached**), card navigation, recovery, and every objective screen finding with the shots it was seen on |
| `review.html` | The contact sheet: every shot in order per case, its objective findings, and the engine's truth folded away |
| `run.json` | Everything, including each shot's screen facts (`scripts/lib/ux-probe.mts`) |
| `shots/` | Page screenshots at the phone's pixel density; `-device.png` ones are `adb screencap` (system bars, dialogs) |
| `run.log` | Progress, one line per event |

The shot kinds: `launch`, `new-match`, `decision` (every time the player is asked), `playback` (each
beat of a turn being told), `card-review`, `card-review-next`, `hand-review`, `zones`,
`unreachable`, `saved-match`, `storage-full`, `storage-recovered`, `over`, `stall`, `error`.

## 4. The objective checks (automatic)

At every shot (`checksOf` in `scripts/lib/ux-probe.mts`):

- **Overview at a glance**, at each human decision with no sheet open: whose turn, the phase, both
  players' life and the prompt bar are drawn, **on the first screen without scrolling**, and not
  covered. Your life and the opponent's must be readable as numbers.
- **Touch**: every visible control at least 44×44 css px (`CLAUDE.md` Conventions).
- **Legibility**: text under 11 css px; text cut off (ellipsis or line clamp); a page wider than
  the screen; images that did not load; text under its WCAG contrast need (the walk of
  `arena:contrast`, `scripts/lib/contrast-audit.mts`, on decisions, reviews and recovery screens;
  under 3:1 is major).
- **Reachability**: each scripted move is made by the tap a player would make. A control that is
  off screen or under something (the tab bar, a sticky strip, a skill pop-up) is first scrolled to
  the middle of the screen, as a player would, and counted as **had to scroll**. A control covered by
  a skill pop-up is **obstructed**: a failure, shot before anything is touched, with the size of the
  pop-up's close control. The harness then closes the pop-up only so the match can go on; the move is
  never counted as a plain tap. "Directly by tap" counts only moves whose every control was reachable.
  The tap-to-move time runs from the player's first required interaction (the pop-up's close included),
  and the pop-up recovery time is reported on its own. `unreachable`
  means no tap found it even then, so a player would be stuck too; the log names what covered it.
  `tapped-other` means the tap sent a different move, so a label is ambiguous or the driver chose the
  wrong row; read the shot before calling it a bug. After an `unreachable` the move is made through
  the board and the run starts the computer's turn itself; a turn that stalls for 45 s is started
  the same way and listed under stalls.
- **No-target notices** (#783, `role=alertdialog`): each one met is shot and acknowledged by tapping
  its OK, as a player must before the board goes on. `findings.md` lists them; a run that met none
  says the notice was **not exercised**. A notice that cannot be acknowledged by touch stops the case.
- **Pass or fail**: a case passes only when it is played to the end **and every move was made by
  touch** with no control obstructed, and every notice acknowledged. After an `unreachable` move the run makes it through the
  board only to keep collecting evidence; the case still fails, and so does the run (exit code 1).
- **Card navigation** (a "no change" after the swipe is not yet a finding: the run's swipe is one
  synthetic 140 px stroke, so check it by hand before reporting it), every `--card-review-every` decisions: tap a card, the review opens (time),
  shows the card's name, the pager's Next and a swipe change the card, × closes it; the hand review
  and the public zones open.
- **Feedback**: tap-to-move time (p50/p95/max), playback that never ends, a computer turn that
  stalls, "Retry".

These are measurements, not judgements: a finding is real when the shot shows it.

## 5. The review (judgement, by Claude on the laptop)

Run it the morning after, in a session at the worktree. Read `findings.md` first, then work
through `review.html`. Look at images with the Read tool; open "Engine truth" only after step 2.

### 5.1 Cold reads: is the state clear?

Take a sample, about 40 shots across the cases: the first `decision` of each case, every
`decision` where the phase or the turn changed, every `decision` during a battle, all `playback`
shots of two whole computer turns, every `over`, `saved-match` and `storage-full`. For each shot,
**before** opening its truth, write down from the image alone:

1. Whose turn is it, and who is being asked right now?
2. Which phase (and which battle step)?
3. Both players' life; your ready energy.
4. What is being asked, and what are the choices?
5. During a battle: who attacks whom, with what power on each side, and what happens if you pass?
6. On a `playback` shot: what did the opponent just do, and to which card?

Then open the truth and score each answer: **right**, **wrong** (the screen misleads), or **can't
tell** (it isn't on screen, or can't be read at phone size). Every wrong answer is a finding, and
so is any can't-tell on questions 1–4. A can't-tell on 5–6 is a finding when the answer matters for
the decision being made.

### 5.2 Heuristics, per area

| Area | Questions | Shots |
|---|---|---|
| Overview | Is the whole state visible without scrolling or opening anything? Is "your" side unmistakable? Is the opponent's state as readable as yours? | `decision` |
| What is happening | Does each beat of the computer's turn say what happened in words, not only by animation? Can you follow a whole turn from the beats alone, using the log in the truth as the check? Is the end of the opponent's turn obvious? | `playback` |
| The question | Is the prompt a sentence a new player understands? Are the choices labelled with what they do? Is the consequence of passing stated? Is a disabled choice explained? | `decision`, `unreachable` |
| Cards | Is a card's text readable at phone size in the review? Can you move between cards without closing the sheet? Can you find your hand, your energy, the drop? Does the review say where the card is and what it can do now? | `card-review*`, `hand-review`, `zones` |
| Feedback | Does a tap show an answer at once? Is a refused tap explained? | tap timings, `decision` after a refusal |
| Errors and recovery | Does the device-full notice say what to do? Does Continue make clear you are back where you were? | `storage-*`, `saved-match` |
| Consistency | Same words for the same thing (energy, rested/ready, drop)? The same place for the same kind of control? | all |

### 5.3 Write-up

Write `ux-review.md` beside `findings.md`, with one table:

| # | Area | Severity | What the player sees (shot) | What is true (truth) | Why it matters | Suggested change |
|---|---|---|---|---|---|---|

- **Blocker**: a player would make a wrong move or cannot make a legal one (a wrong cold read on
  questions 1–4, `unreachable`).
- **Major**: the state can be worked out, but only by scrolling, opening a sheet or remembering;
  a turn cannot be followed; a control is under 44 px in a place used every turn.
- **Minor**: wording, consistency, small text in a secondary place.

Cite every row with a shot number. Group findings with the same cause. Then add the cold-read
scores (right / wrong / can't tell per question). Propose GitHub issues for blockers and majors,
but create none without the owner's say-so. Card *rules* that look wrong in a shot go to the rule
review (`docs/arena-fixing-a-card.md`), not here.

Before writing, check each automated finding against its shot: a "covered" overview behind an open
banner for half a second, or a "cut off" line that is a deliberate one-line clamp with the full text
a tap away, is not a finding. Say which ones you dropped and why.

## 6. Limits

- The moves are scripted and make no attempt to play well, so the matches look like a weak player's.
- Taps are DevTools touch events in the page, not finger touches on the glass. They go through the
  page's real touch, pointer and click handling, but not Android's input pipeline or gesture navigation.
- Swipe-down to close, long-press and drag-to-play are not exercised. Drag has a tap path, which is the
  one taken.
- Memory pressure (§8 step 9) is left for a person: background Chrome under several heavy apps for a
  few minutes, return, and note whether the match is intact or Continue restores it.
- `--pace step` shows every beat but is not the default pace. Run one case with `--pace slow` to
  judge whether the default pace gives time to read.
