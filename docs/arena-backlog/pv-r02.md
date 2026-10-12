---
title: [P0] Arena: Resolve Auto skill costs with pay and decline decisions
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, ready-for-agent, enhancement, area:arena-vm, phase:capability-gap, model:opus-5
stage: ui
issue: 549
priority: P0
touches: src/lib/arena/vm/flow.ts, src/lib/arena/vm/costs.ts, src/lib/arena/vm/script.ts
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P0. **Delivery:** Rule engine correctness. **Plan key:** R02.

**Depends on:** #544 (T02)

**Build.** Give pending Auto skills a complete cost-planning, payable choice, paid resolution and optional decline path. Use current trigger/source/event bindings; no silent dropping of action-price or X-price skills. Resume deterministically after prompts; document mandatory versus optional behavior from the manual.

**Files to verify first:** `src/lib/arena/vm/flow.ts`, `src/lib/arena/vm/costs.ts`, `src/lib/arena/vm/script.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [ ] A triggered priced Auto pays exactly once and resolves; unaffordable and declined cases have distinct outcomes; two pending Autos preserve source and ordering after reload.
- [ ] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [ ] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/vm/flow.ts`, `src/lib/arena/vm/costs.ts`, `src/lib/arena/vm/script.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.


**Delivery status.** Partial delivery; #549 remains open. The supported cost paths and
cost-free and priced secret-area declaration below have fixed local scenarios. Other
action-price instructions and the bounded search limit remain reachable engine
limitations owned by #549, so this increment does not claim the entire issue acceptance.

**Rule-grounded behavior (#549).** Manual 9-6-4 permits paying or declining any necessary
Auto skill cost, including printed energy and action costs. A condition that is already true
cannot itself be declined (9-6-4-1-1); public-area cost-free/condition-only Autos retain compulsory
resolution. Unaffordable prices cancel activation under 9-6-3-2 and 5-8-2. The cost must
complete before the effect (5-8-2-2), and chosen X applies through resolution (20-5).
The private stored continuation retains source, skill index, master, trigger, subject,
cost targets, X and the paid cursor across generic option/card prompts and JSON reload.
A legal optional replacement remains its affected owner’s choice (9-10-2). Declining it can
complete payment; applying a different destination preserves the attempted payment and
replacement, cancels the Auto without resolving its effect, and resumes the pending queue
(5-8-2-2-1-1, 5-8-4). Effect-only replacement causes do not match cost moves.

**Local proof.** `scripts/verify/auto-costs-549.ts` uses fixed expectations rather than the
legacy oracle: a real play-triggered Auto; pay/decline/unaffordable outcomes; invalid actor,
invalid index and stale resource rejection; two source/master queues; combined orb/action
payment across reload; cost targets and action-/energy-chosen X; source departure with
subject binding; Burst and Spirit Boost; sequential double-spend/mode/cardinality refusal;
mandatory choose-three with too few cards or distinct names; safe candidate pruning;
explicit unsupported/missing price interruption; a 20-card action-price projection. The
9-6-3 selection increment adds two compiled Autos from one real play moment, choosing the
second first, three-candidate and repeat choices after a resolving skill pends another Auto,
exact source/master/subject bindings across JSON reload, turn-player priority, stale queue
and turn rejection, and opponent snapshot privacy for a hand source. No cost is charged
before the order decision.

`scripts/verify/secret-auto-549.ts` asserts the 9-6-3-1-1 choice for a cost-free
Auto still in a secret area, including an actual start-turn interaction where one
pending Auto returns the other's source from Battle to Hand. Declaration reveals only
that source's art and skill during its activation and valid saved choice continuation;
decline produces no skill, price, draw or public note. Movement, concealment, shuffle,
later actions and a new occurrence revoke an older declaration's viewer authority.
`scripts/verify/arena-secret-auto-db.mts` checks the saved action/revision path:
wrong actor and stale revision reject atomically, supplied table talk on a private
decline is omitted from both viewers' session log, and ordinary later talk still logs.

`scripts/verify/priced-secret-auto-549.ts` asserts that a priced secret-area Auto
may be left undeclared silently or declared before payment, with a declaration event
that does not count as a fired skill. Supported orb and action prices pay once; declined
or unpayable prices never activate or draw. Exact source, skill, trigger and private
reveal epoch survive price prompts and JSON reload; wrong-actor/stale answers reject
without mutation, and a later action or duplicate occurrence cannot reuse an older
declaration. `scripts/verify/arena-priced-secret-auto-db.mts` checks persisted
wrong-actor/stale CAS, both viewers' scoped declaration art and text, no private key
in public snapshots, silent decline, and no saved log disclosure after concealment.
The browser proof in `docs/arena-backlog/evidence/549-priced-secret` uses a synthetic
priced Auto and a portable artwork stand-in; it checks the distinct declaration and
activation labels and later masking at 390px and 1440px in both skins through a
mocked API poll of real engine snapshots. No printed priced-secret card is claimed.

`scripts/verify/compiler.ts` independently asserts AUTOCOST pays exactly one additional
energy and draws two, while decline pays nothing further. No compiler reading is changed.

**Remaining boundaries.** A player now chooses among their own simultaneous pending skills
at a checkpoint (9-6-3), with the turn player's pending skills taking priority. A
secret-area Auto, whether cost-free or priced, may be left undeclared without telling
the opponent; its selection menu is visible only to the deciding player. Captured
keyword hooks remain outside this optional [Auto] declaration path. Supported action
prices use choose/discard/mill/switchMode/hidden/moveTo/removeMarker, including verified placement under a host and nonempty conditional/modal branches; unimplemented instructions
and a full-price choice search exceeding 2,000 visited states produce an explicit typed
interruption instead of free resolution or a false affordability claim. This Auto-specific
continuation does not deliver #550's broader Activate/cross-skill binding work. The
priced secret browser and persisted proofs use synthetic records; they do not establish
that a particular printed card has this price/source combination. No dependencies or
production/database writes.

**Affordability-limit correction and narrow search proof.** The planner's `NotYet` inherits `IllegalAction`; the former catch treated its exhausted search as an ordinary failed branch and could cancel a payable Auto as unaffordable. That catch now preserves the typed interruption. The registered `auto-costs-549.ts` case uses compiler-derived synthetic supported price grammar: rest one Battle Card, discard three of a 20-card hand, then rest the source. Choosing the source first is proven unable to pay the final self-rest only when the remaining instructions are exactly an acting-side hand choice, a move of those chosen cards to Drop, and a pure self-rest, with no saved source alias or possible cost-move replacement. The planner skips that dead branch and finds the later payable choice; the test checks its payment menu, decline, reload, cost-before-skill order, draw and opponent privacy. Controls retain normal search for a mode reset, source movement, saved alias, altered selector and dormant conditional replacement. A separate compiler-derived hand-to-Drop then Drop-to-Warp price still exceeds 2,000 states and interrupts as typed unknown, even though its late choice can pay. This increment does not complete the bounded solver or #549 acceptance. No printed catalog card is asserted.

**Direct-transfer continuation proof.** The later compiler-derived hand-to-Drop then named Drop-to-Warp price now has a capacity proof before the search branches: cards already in Drop, saved picks still in hand, and at most the remaining hand-choice slots can provide its named Drop choice. When that sum is too small, the branch is genuinely unaffordable; when it is large enough, the planner tries matching cards first and still replays the whole payment in an isolated VM. This shortcut applies only to a direct acting-player hand choice and move followed by a named Drop choice and Warp move, with no live effects, in-play Permanents, possible cost-move replacements, moved source alias, other chooser, or order-sensitive selector fields. All other forms retain interpreter search with the 2,000-state typed unknown boundary. Failed exact-state continuations are memoized without identifying different chosen orders. A 30-card positive pays in roughly 300 ms locally with three late matching cards and retained JSON choice cursors; a 30-card negative with only two names is proved unaffordable in low single-digit milliseconds without mutation or skill activation (`DATABASE_URL='' node_modules/.bin/tsx scripts/verify/auto-costs-549.ts`, timings depend on host). The existing saved-alias, altered chooser/source, and dormant replacement controls remain typed unknown rather than false. The synthetic fixture does not establish a printed card with this exact chain.

**Additional complete price branches.** A `moveTo under` payment now requires one existing host and a successful move into that host's under-pile (23-2); a missing host cancels as unpayable before skill activation. Nonempty `if` branches and `chooseMode` price options use the same interpreter and stored mode answer as the rest of an Auto cost, with every branch validated as a payment before an offer. An empty modal option is refused as typed unknown rather than offered as a free path. Focused scenarios assert the under-pile and stack event precede the fired skill, missing-host no-mutation, both conditional branches, and a modal answer across JSON reload. The shared readable-price validator exports a configurable label and issue owner so Aegis additional-cost work can use the same admitted grammar without claiming these Auto-only payment checks for itself.

**Observable and terminal adjuncts.** A public `reveal` price requires its selected cards to exist before it can fire; an empty hand is unaffordable, and a private look is still unsupported as a price. A deck/life `shuffle` may follow another payable price step only as the final instruction, so no later price decision can depend on randomized order. Standalone, conditional-nested, inspected-only and nonterminal shuffles remain typed unknown. Fixed scenarios check reveal and shuffle notes occur before the skill event, an empty reveal draws nothing, and unsupported shuffle forms interrupt. No printed Auto with either adjunct is asserted.

`compile/prices.ts` compiles pre-colon action text through the general effect compiler, so the current readable Auto price set is narrower than all compiler-emittable operations. Source-identified local Auto fixture text compiles BT31's <Cell> Extra price as `choose energy, hidden(true)` and the King Piccolo line as a condition plus `moveTo self→drop`; both are in the supported set. The BT31 <Vegito> fixture is condition-only. Other printed price examples in the compiler notes are different skill kinds: BT31-132 is [Activate: Main] and BT28-138 is a [Counter] alternative, so they are not Auto coverage evidence. No local fixture establishes a printed Auto price using an excluded op; local fixtures cannot establish catalog coverage without the owner-run catalog reading. The original complete action-price acceptance remains open: a different supported but order-sensitive price may still reach the bounded unknown search, and compiled instructions outside the validated payment set (including play placement) interrupt before activation. These are explicit unknown outcomes, never free resolution or a false unaffordable claim.

**Owner-run verification.** Catalog reading snapshots require the deckplanet endpoint in this
environment; the baseline attempt failed DNS lookup (`EAI_AGAIN api.deckplanet.net`).
Fuzz 40 was attempted with `DATABASE_URL=''`, but the script requires actual deck inputs and
failed before any game at `arena-fuzz.mts:87`. Reading diff and real-deck fuzz are therefore
unverified owner-run checks, along with live database/paid-provider/production checks.
