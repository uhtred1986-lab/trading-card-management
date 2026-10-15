# Arena phone reports — investigation for #877

Investigated 15 October 2026. Baseline: `57fbe43b` (`origin/main` at investigation start).
No live game data or production settings were changed. No migration or paid AI call.
The owner's original phone image files were not attached to this session; these are
code, saved-game and browser reproductions, not pixel comparisons with those images.

## Findings and changes

| Report | Evidence and disposition |
| --- | --- |
| Swap review error | Confirmed in saved `ai_runs` #238 for rule #5560, BT4-084 front skill index 0 (UI skill 1). Its inner `ruleJson` contains `trigger:null`. The outer schema previously checked only that `ruleJson` was a string, so this passed generation and failed later at `validateRule`: “WHEN is a list of moments”. The generation schema now runs structural rule validation inside that string, feeding the existing single repair retry; prompt and schema describe `trigger:[]` for no WHEN. The authoritative validator remains strict. |
| Swap interpretation | The saved proposal also used choose → play → return, following the old print's reminder instead of the current manual. It did not explicitly restrict the replacement to a Battle Card and included unsupported operation fields. Generation now explains the native keyword lifecycle; keyword proposals cannot approve ordinary THEN steps as a replacement for native timing/payment. An existing native keyword is routed to native review, not mislabeled as missing engine support. Ordinary complete-rule drafts still require explicit versioned approval; no rule is auto-approved. |
| Babidi candidates | Confirmed UI defect, not an oversized engine search. Live rule #11635 is `look 3 as looked → choose up to 1 <Majin Buu> fromVar looked → move chosen to hand → shuffle`. Pinned replay exposes only one legal candidate. The search UI appended rejected choose diagnostics from across the board. It now draws only the prompt's own hidden-zone candidates. |
| Attack beam | Confirmed independently on main: changing topbar/layout after mount left the attack endpoint 62–70 CSS px off its card without a resize/scroll. The clash effect measured only once as well. Both use live card geometry each animation frame while mounted, including layout shifts, transforms and replacement DOM elements; absent endpoints hide the beam. Targeting semantics are unchanged. |
| Immediate actions | Confirmed: artwork preceded Charge/Attack in the card review. Legal basic actions now precede artwork in the sheet and desktop inspector. Ability sections and refusals remain below. Attack still starts existing target selection and phone confirmation. No phase-inappropriate action is manufactured. |
| Persistent popup | Confirmed both the spotlight timer bug and a second, deliberately modal no-target notice. A same-sequence spotlight object cancelled its timeout; dragging/expanding also cancelled it. Timeout now belongs to the displayed sequence and survives these interactions. Resolved no-target notices now expire after four seconds, with no scrim/focus trap. Dismissal releases held playback/advance once and sends no game action. Required choices remain open. |
| Blank phone scrolling | **Exact portrait-phone report not reproduced on current main.** Baseline 390×844 and 390×667 already clip the decorative wash and have no document scroll at normal text. Tiny/short screens and 200% text legitimately scroll to real controls. A related confirmed defect at 768×1024 leaves a 329px blank area below the board: the minimum viewport height stopped at `sm` while the phone layout lasts until `lg`. Extending the minimum through `lg` leaves only the 8px shell inset (16px at 200% text). It is a minimum, not a fixed height or document scroll lock. Existing decorative overflow clipping remains. No claim that the original phone/browser-specific white tail is conclusively fixed. |
| Jiren life | **No missing damage found.** Matching saved game #80, Majin Buu vs Yellow Jiren Rest-Lock Beatdown (Claude draft), is on turn 5. All 37 actions replay exactly on its actual pinned interpreter checkout; the complete final state equals the saved authoritative state. Jiren has 7 life in both state and projected snapshot. See complete attack ledger below. |

## Swap basis

Live BT4-084 prints `[swap 3] {y}{y}: ≪Goku's Lineage≫ with an energy cost of 3`
with the older parenthetical “Play … then return”. The repository's current
`docs/rules/rulemanual.txt`, 22-22-1 through 22-22-4, instead specifies:

1. Activate: Main, from the Battle Area.
2. Pay its printed two yellow energy. Reveal the specified Battle Card from hand
   with energy cost **exactly 3** and the Goku's Lineage trait.
3. Return the source as part of activation. If the replacement cannot be chosen
   or the source cannot return, activation is unavailable.
4. Play the revealed replacement on resolution, using the native Counter: Play window.

The native `keywords.rules` implementation already returns before playing. The
new BT4-084 regression in `scripts/verify/swap-729-731.ts` checks exact eligibility,
two yellow payments, return-before-play events and refusal with only one yellow.
The original prompt/proposal was not an engine damage or native Swap regression.
No new Bandai card-specific Q&A ruling was needed for these explicit manual clauses.

## Babidi's actual turn-1 search

Game #80 action 5 plays BT3-045 (`p1#45`). Before the effect the top three are:

| Instance | Card | Eligible? |
| --- | --- | --- |
| `p1#49` | BT3-047 The Ultimate Evil, Majin Buu | Yes; only engine candidate |
| `p1#11` | BT3-046 Magician's Father, Bibidi | No |
| `p1#5` | BT5-043 West Kai, Keeping Watch | No |

Prompt `chooseCards` has candidates `["p1#49"]`, min 0, max 1. Action 6 chooses it.
The projected search choices contain that one card. The old UI appended seven
rejected cards: Majin Buu (leader), Babidi (in Battle), Unyielding Defender, East
Supreme Kai, Dimension Magic, Great Saiyaman, Town Hero, The Most Evil Absorption
in History, and Jiren (opposing leader). **Eight rows could therefore be shown,
while only one was selectable.** Neither leader was in the looked-at cards.
This is confirmed from reconstructed inputs and the same UI path, not inferred
from a screenshot's visible count. The new browser fixture is synthetic and
reproduces the diagnostic-list inflation without publishing private deck exports.

## Game #80: every attack and life change

Action positions below are one-based in the saved 37-action array. All completed
battles had **zero combo cards on both sides**, so combo additions were 0/0.
There were no blocks, redirects or target substitutions. “No window” means the
engine found no legal response and recorded it in `emptyResponses`, not an
unobserved assumption that a player passed.

| Turn / actions | Attacker → declared and final target | Counter / block | Final totals and result | Life after (Buu / Jiren) |
| --- | --- | --- | --- | --- |
| Start | Both begin at 8 | — | — | 8 / 8 |
| T2 / 10–12 | BT3-097 Tora `p2#11` → Buu leader `p1#0` | No legal counter or blocker window | 10,000 vs 10,000; hit, 1 noncritical damage to Buu | 7 / 8 |
| T2 / 13–15 | EX03-19 Jiren `p2#0` → Buu leader | No legal counter or blocker window | 10,000 vs 10,000; hit, 1 noncritical damage to Buu | 6 / 8 |
| T3 / 19–21 | BT3-031 Buu leader → **Tora**, `p2#11` | No legal counter or blocker window | 10,000 vs 10,000; hit, Tora KO'd. Battle Card hit causes no leader life damage | 6 / 8 |
| T4 / 24–27 | Jiren leader → Buu leader | Buu explicitly declines counter at action 25; no legal blocker | 10,000 vs 10,000; hit, 1 noncritical damage to Buu | 5 / 8 |
| T5 / 31–34 | Buu leader → Jiren leader | Jiren explicitly declines counter at action 32; no legal blocker | 10,000 vs 10,000; hit, 1 noncritical damage to Jiren | 5 / 7 |
| T5 / 35–37 | BT3-050 Majin Buu, Dawn of the Rampage `p1#28` → Jiren leader | Jiren plays BT28-102 Stop Laughing! `p2#46` at action 36; pays one yellow energy (`p2#25` rests). Action 37 chooses no optional rest targets | `attackNegated`; battle ends before offense/defense and power comparison. No combo total or resolved hit exists; damage 0 | 5 / 7 |

Life cards move to hand exactly with the four damage events: Buu's `p1#20`,
`p1#29`, `p1#28`; Jiren's `p2#29` (BT31-070 Vegeta, the Targeted Prince). Damage
is neither lost nor duplicated. No other life movement occurs. Jiren's displayed
7 is consistent with the one completed leader hit. The T3 attack was actually
submitted against Tora; the logs cannot tell whether the owner intended Jiren.
The independently confirmed stale beam could confuse that intent, but it is not
evidence of an extra leader hit. Opponent table talk (“I'll take the hit”) is
not a hit event and does not override Stop Laughing!'s recorded negation.

## Read-only provenance and replay

The app's pooled URL was retrieved from its Vercel project using the documented
procedure, expected pooler/Frankfurt hostname checked, and
`select to_regclass('public.card_rules')` verified **before any card/game query**.
The ambient URL was never used. Raw SQL reads used `rows()`. Local validation
and preview servers run with `DATABASE_URL` unset. Credentials, raw saved games
and replay bundle remain outside the repository.

- Game: 80; seed: 1284908591; 37 actions; 186 replay events.
- Actual interpreter checkout: `d1544fbf54ada0947c8d8d9502a7c5fb88416017`.
- Immutable bundle: `ce6337d90d2be47a2cc7c86062d8ca0ae7ee20673bd00495d430103e733e9260`.
- State SHA-256: `11a4086375ecab668fff88d72bbfb4a10673244981c077366b9de0f6f526616b`.
- Events SHA-256: `0ad463d5fb47ef86468b1cef80a0b57f61405dca795b34bce776cc7dd022eb32`.
- Legal actions SHA-256: `1bfbbe5766539411ba1a5b55bb6ef3a3045f94a41f3f710724b9a409fbd2d4ce`.

Using an admin export of that game, run `arena:replay` **on that interpreter's
checkout**, with `DATABASE_URL` unset, `--runtime-revision d1544fbf54ada0947c8d8d9502a7c5fb88416017
--summary --output result.json`. The audit additionally projected the search
snapshot after action 5, recorded prompt/candidates and each action's events,
and deep-compared the entire final replay state with saved `arena_games.state`.

## Browser evidence and reproduction

Run a DB-free dev server. `scripts/arena-phone-reports.mts` uses synthetic fixtures
and writes screenshots and `checks.json` to `docs/arena-redesign/current/reports-after/`.
Use `--base http://localhost:3001 --tag before --out <path>` against a clean main
server for baseline failures. Generated fixtures are removed by the script.
`arena-report-actions.mts` checks legal quick actions, phone target confirmation,
clash-beam geometry and 200% text review access.
`arena-no-target-783.mts` checks automatic notice expiry and exactly one released
advance with zero game actions, in and outside a battle, in both skins.

Evidence images use the real board and synthetic, clearly named cards with
placeholder artwork. Portrait 390×844 and desktop 1440×900 cover both skins;
layout probes also cover 390×667, 320×568, 844×390 and 768×1024 at normal/200% text.
The long portrait white-tail report remains explicitly unverified on the owner's
actual phone browser. No Android/native work is included.

Committed representative evidence beside this report:

- `before-phone-anime-search.jpg` / `after-phone-anime-search.jpg`: bounded search rows.
- `before-phone-anime-charge-review.jpg` / `after-phone-anime-charge-review.jpg`:
  Charge before artwork; layout/pager scroll with the body to preserve short-screen access.
- `before-desk-anime-charge-review.jpg` / `after-desk-anime-charge-review.jpg`: desktop inspector.
- `before-phone-anime-beam.jpg` / `after-phone-anime-beam.jpg`: layout-shift endpoint.
- `before-768x1024-100-bottom.jpg` / `after-768x1024-100-bottom.jpg`: 329px blank tail → 8px inset.
- `after-phone-anime-attack-confirm.jpg`: review → target → explicit confirmation.
- `before-checks.json`: 24 failures, 12 passing controls; `after-checks.json`: all 36 pass.
- `action-checks.json`: both skins/phone/desktop target confirmation and clash geometry
  (under 0.001px endpoint error), plus working Charge at 200% text on both short phones.

The first complete `npm test` run passed, and final exact-source validation is
recorded in the PR. The read-only backlog-wide `--check` is blocked by a pre-existing
`848.md: front matter lacks 'stage'`; #877's own metadata parses and its source paths exist.

## PR review follow-up

Review against current main (`e6349b77`) found one gap in the generation repair
contract: a rule with `kind`, `trigger` and `ops`, but no `cost` or `cond`, passed
`ExplanationSchema` and was rejected only by the later review decision. Unknown
root/price keys and unknown price colours had the same gap. Generation and review
now share the existing complete-proposal shape checks, so these malformed outputs
enter the bounded repair retry too. Regression checks cover each missing field,
unknown fields/colours, and a fake-provider missing-field → corrected-rule retry.
The native keyword prompt also explicitly limits its nonempty-ops requirement to
non-keyword rows, consistent with its keyword `ops:[]` instruction.

The browser beam regression now waits for the beam SVG rather than any SVG path
(an unrelated icon could satisfy the old wait before board hydration completed).

Both beam probes await rendered animation frames after a layout shift instead of
assuming 180 ms guarantees a render on a busy host. The original clash timing
probe failed once during concurrent validation and passed when run separately;
the frame-based wait tests the hook's rendering lifecycle directly.

The clash layout probe also finishes card entrance animations before applying
its deliberate shift, so its endpoint comparison measures that shift rather
than racing an unrelated entrance animation.
