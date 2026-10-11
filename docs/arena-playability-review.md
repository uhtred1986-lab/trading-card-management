# Arena playability review and delivery specification

Reviewed 11 October 2026 against workspace HEAD ce8479e, the live issue backlog and issue comments.
This is the source for the `pv-*` backlog follow-ups. Findings are regression hypotheses to verify
against the implementation before a worker changes code, not a claim that every deck fails.
The arena is Dragon Ball Super Masters; catalogue support for Fusion World does not make it playable here.

## Owner decisions and grounded design

The owner requested a full capability, rule, speed and usability review and a real-app design,
including phone layouts. The dev-only grounded draft is
`src/app/arena/preview/GroundedDesign.tsx`, selected by `/arena/preview?design=grounded`.
It uses actual ArenaCard artwork and app skins. Its simulated decisions and ability filters are
design data; live legality must come from the server. The draft is still uncommitted in this workspace.

Portable reference for fresh worktrees:
[interactive artwork prototype](arena-redesign/playability-grounded-design.html).
Reference frames: [desktop](arena-redesign/playability-abilities-desktop.jpg),
[phone Counter ability](arena-redesign/playability-abilities-counter-phone.jpg),
[phone wrong-timing abilities hidden](arena-redesign/playability-abilities-hidden-phone.jpg),
and [phone Battle ability](arena-redesign/playability-abilities-battle-phone.jpg).
These are review artifacts, not a live match or authoritative rule availability.

- Fullscreen card review must be discoverable without long press. Tap/visible Inspect, swipe,
  prev/next, position and stable card-instance selection extend existing #348; they do not rebuild it.
- Show abilities available now, their cost, effect and named activation. Wrong turn/round/phase/window
  or zone abilities are collapsed by default. Timely but resource-blocked abilities show a remedy.
- Automatic triggers and passive effects need distinct presentation; an Auto is not a manual button.
- Keep actor, decision window, life, ready/total energy by colour, battle stakes and Pass consequence
  visible. Log/settings/phase detail are available on demand.
- Reduce phone empty slots/chrome; use an expandable hand and sticky decision dock. On desktop use
  one match strip and one decision/selection panel while retaining current decision during inspection.
- Preserve public-zone access, hidden-information masking, both skins, charge/target gestures,
  keyboard access and reduced motion.

## Match integrity findings

`src/lib/arena/readiness.ts` counts row status; missing rows can be treated as plain without
establishing that all front/back printed skills are absent. `rules-store.ts` can load a missing
program as blank. Readiness must reconcile individual printed skills, review state and runtime support.
Open rules stay blocked under the established policy; practice/referee behavior stays explicit.

`src/lib/arena/vm/flow.ts` has unread and action/X-price paths that can skip execution; thrown
NotYet already stops a game, but all unsupported execution must share an explicit explanation.
`GameEnd.tsx`/page null-winner draw mapping must distinguish interruption from a genuine draw.
False conditions, legal decline, paid resolution and unsupported are different outcomes.

`games.ts`, `snapshot.ts` and `useLiveGame.ts` need freshness independent of animation beats:
abandon/status changes can have no beats. Existing database CAS is necessary but does not alone
make browser response ordering safe. Expose monotonically increasing revision and request identity.
Polling needs cancellable lifecycle-aware recovery and player-visible connection state.

Stored games currently reload rule/catalogue definitions. Pin an immutable rules/program/catalogue
bundle so a correction does not change an ongoing match or invalidate its exported reproduction.

## Named rules follow-ups

The VM and declarative rules are a strong foundation; completed stages and hook contracts do not
prove all runtime mechanics. Reproduce each finding and consult the current manual before implementing.

| Follow-up | Manual/source | Proof needed |
|---|---|---|
| Zero-power Battle Card processing | 21-6; VM flow/effects/zones | Correct checkpoint, cause, protection/replacement behavior |
| Auto costs | VM flow/costs/script | Pay, cannot-pay, optional decline, reload and ordering |
| Cost-established X and chosen targets | VM costs/script/activate; #542 | Bindings survive prompts; alternative Counter prices |
| Spent combo to Z-Energy | 8-5-2; VM battle | Eligibility, optional choice and cleanup |
| Counter: Counter chains | 9-7-3; VM flow/activate | Response, decline, negation, nested resumption |
| Static identity/keyword/negation layers | DEFERRED_STATICS; #153 completed hook contract | Selector changes, provenance, expiry and removal |
| Heroic limit | 22-35-3 | Once per turn and reset |
| Aegis payment choices | 22-30-3 | Recompute valid choices after each selection |
| Face-up life event | 3-9-2-1 | Emit once; preserve hidden life |
| Damage totals | engines.ts damageTaken | Genuine damage versus life paid; unavailable old counts |

#539 owns concrete compiler readings and splits into four bounded families in the delivery plan.
#540 timed bounce replacement, #541 Union payment and #542 name-in-skill/cost binding retain their
existing acceptance. Do not fold distinct mechanisms into one broad PR or alter the oracle to hide differences.

## Performance findings and measurement limits

The web `act` path waits on opponent advance whereas HTTP separates human action from advance.
Return persisted acknowledgement before AI, using a revision lease and resumable bounded advance.
`ai/run.ts` cumulative usage read/write can lose concurrent increments; use atomic accounting.
This is distinct from model selection #381 and provider deployment #518.

The local review's small/crowded/aura CPU samples were directional, approximately millisecond-scale;
they did not measure hosted database latency, network, paid AI or real phone frame rate.
Profile apply/legal/rejection/view, DB round trips, response bytes, acknowledgement, AI and browser
frame time separately with p50/p95. Optimize unchanged snapshot polling and immutable derived
evaluation only after an appropriate baseline. Keep personalized caches scoped to viewer and revision.
History cursors must retain complete reconnect and replay behavior.

Optional gameplan preview should simulate payment/legal choices without committing state, advancing
RNG or calling paid AI. Stop assumptions at responses, draws and unknown outcomes.

## Verification and agent delivery

One implementation issue, branch and reviewed PR at a time. Read issue comments, CLAUDE.md,
docs/agent-brief.md, the arena-work skill and cited docs; verify paths/symbols before editing.
Use PGlite and local fixtures. Do not query this environment's DATABASE_URL: it belongs to another app.
No live database writes, paid AI calls or production configuration changes are authorized by this plan.
An additive migration proposal can be developed and reviewed locally; live evidence is owner-run.

For code changes run typecheck, lint, targeted meaningful scenarios, npm test and build before push;
compiler/VM work also needs glossary changes when vocabulary/semantics change, named rule proofs,
reading diff review and the repository's fuzz gate. DB/paid acceptance must remain explicitly unverified.
UI: compare before/after at 1440 and 390 widths in both skins, plus 320px, short phones, 200% text,
keyboard/reduced motion, crowded hands and primary decision windows.

Existing review result: npm test passed; the rules-only run reported 26/28, with two comparisons
not run and 18 named skips. Treat those limitations as inventory, not proof of full rules completeness.
New issues are proposals, not fixes shipped. Ready-for-agent applies only when prerequisites have merged.
Historical Stage 3 #170 checklist drift is repaired separately; declaration completeness is not runtime completeness.
