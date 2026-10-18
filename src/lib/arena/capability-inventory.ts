/**
 * Narrow runtime evidence for the Arena rules engine.
 *
 * A row describes only the named behavior and fixture. It is not a claim that
 * a rule section or keyword is covered exhaustively. Delivery state is kept
 * separate from runtime state so a pending PR cannot make the base appear
 * implemented.
 */
export type RuntimeStatus = "supported" | "unsupported" | "untested";
export type EvidenceKind = "runtime-scenario" | "runtime-gap" | "declaration-only";

export interface CapabilityEvidence {
  id: string;
  label: string;
  status: RuntimeStatus;
  evidence: EvidenceKind;
  /** Manual section or a precise source contract when no gameplay rule applies. */
  citation: string;
  ownerIssue?: number;
  /** Pending delivery does not change `status` on this branch's base. */
  delivery?: { state: "pending"; reference: string };
  /** The exact `rulesGap` callsite label, if this is a named skipped scenario. */
  skipWhere?: string;
  /** Test suite/file and the particular assertion represented by this row. */
  proof: string;
  detail: string;
}

export const CAPABILITY_EVIDENCE: readonly CapabilityEvidence[] = [
  {
    id: "arena-skill-unread-referee",
    label: "An unread due skill explicitly interrupts the game",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "Rule text ingestion and resolution boundary (`src/lib/arena/vm/flow.ts`)",
    ownerIssue: 544,
    proof: "scripts/verify/compiler.ts \u2014 unread effect with referee context; scripts/verify/outcomes.ts \u2014 false condition, typed outcome, archive and privacy",
    detail: "A due unread effect produces a typed interrupted outcome with no referee fallback or paid review. It is not resolved or labeled a draw; false conditions remain no-ops.",
  },
  {
    id: "arena-auto-own-cost",
    label: "A triggered Auto offers pay/decline and resolves its supported full cost",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "9-6-4; 5-8-2-2; 20-5",
    ownerIssue: 549,
    proof: "scripts/verify/compiler.ts — AUTOCOST paid/declined; scripts/verify/auto-costs-549.ts — full action/resource costs, X, actual play-triggered pending selection, turn-player priority, reload, stale and atomic rejection, exact named-transfer pruning, conditional/modal prices; scripts/verify/auto-search-549.ts — interchangeable-copy search equal to exhaustive search on 72 boards, its guards, a dormant replacement over 20 copies decided and a pending Auto paid end to end, direct under payment, public reveal and terminal paid shuffle; scripts/verify/ko-marker-price-549.ts — KO-this-card and own-card KO prices (real play offer, decline, Leader/opponent/prohibited exclusions, unaffordable, stale/wrong-actor refusal, reload, optional/mandatory/effect-only replacements, KO'd-Auto interaction, both projections) and add-marker prices, for Auto and after Aegis colours; scripts/verify/last-prints-price-549.ts — the last catalogued Auto action prices from the catalog's own text: BT12-023's conditional face-down Life flip, BT29-030's combo from under the source (real attack moment ordered beside [Triple Attack]) and DB2-011's self power loss (real opponent attack, negated): offer only when payable, pay before the skill, decline, unaffordable, stale/wrong-actor refusal, reload, both projections; scripts/verify/secret-auto-549.ts and arena-secret-auto-db.mts — cost-free secret declaration/decline and persisted masking; scripts/verify/priced-secret-auto-549.ts and arena-priced-secret-auto-db.mts — priced secret declaration distinct from activation, paid/declined/unpayable outcomes, saved continuation, two-viewer masking and persisted silent decline; docs/arena-backlog/evidence/549-priced-secret — synthetic browser presentation at 390px/1440px in both skins",
    detail: "Supported orb/action/X prices complete before the effect; public-area condition-only Autos remain compulsory. The strict action-price host accepts conditional prices only when both branches contain payment, modal prices only when every option contains payment, verified direct movement under a host, public mandatory reveal, a KO of this card or of a compulsory own-card choice verified to reach its owner's Drop (KO replacements answer it; a diverted KO fails payment, 5-8-4), adding a printed number of markers to this card in play, and shuffle only as a terminal adjunct after another payable step. Players choose among their own pending skills with turn-player priority and captured queue binding. A cost-free or priced Auto still in a secret area may be left undeclared silently. Declaring a priced Auto reveals only its source before the price decision; it activates only after full payment, and a declined or unpayable cost never fires. The transient reveal survives the exact valid saved price continuation, then movement, concealment, shuffle or a later unrelated action revokes it. Captured keyword hooks are excluded. Exact named hand-to-Drop transfer paths prune known dead branches, and identical unreferenced copies in an order-free area are replayed once; other searches still interrupt as unknown at 2,000 visited states. Unsupported instructions interrupt explicitly; general binding remains #550 and broader price coverage remains #549.",
  },
  {
    id: "arena-zero-power-rule-processing",
    label: "A Battle Card at zero or less power is processed",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "21-6",
    ownerIssue: 548,
    proof: "scripts/verify/compiler.ts — active TOUGH assertion; scripts/verify/rule-processing.ts — simultaneous processing, replacement choices and reload",
    detail: "The combined implementation processes zero-power Battle Cards before Autos, retaining simultaneous causes and replacement continuation across reload.",
  },
  {
    id: "arena-life-cost-damage-statistics",
    label: "Life paid as a cost is distinguished from damage",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "1-13-2; `engines.ts` damageTaken contract",
    ownerIssue: 557,
    proof: "scripts/verify/compiler.ts — E-LIFE life-cost scenario; scripts/verify/damage-statistics-557.mts — cost 1 versus event damage 2, skill damage, reload, old save and end screen; scripts/verify/arena-damage-statistics-db.mts — saved revision, stale CAS, duplicate request and both seat views",
    detail: "The rules engine accumulates completed damage events on new games. Life paid as a cost leaves the total unchanged; old states without a lifetime counter remain unavailable even after later damage.",
  },
  {
    id: "arena-static-negate-keyword",
    label: "A Permanent negates a keyword",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "9-1-5",
    ownerIssue: 553,
    proof: "scripts/verify/static-layers-553.ts; scripts/verify/compiler.ts \u2014 named keyword suppression and grants",
    detail: "The static layer applies named keyword negation after grants, respecting source validity and beNegated protections. Type-wide keyword negation is outside this row.",
  },
  {
    id: "arena-static-gains-trait",
    label: "A Permanent grants a trait in all areas",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "20-1",
    ownerIssue: 553,
    proof: "scripts/verify/static-layers-553.ts; scripts/verify/compiler.ts \u2014 trait gains and source scope",
    detail: "Trait gains are applied in their declared areas; stale all-area compiled rows are blocked until rebuilt.",
  },
  {
    id: "arena-static-gains-name",
    label: "A Permanent grants a name",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "20-1",
    ownerIssue: 553,
    proof: "scripts/verify/static-layers-553.ts; scripts/verify/compiler.ts \u2014 additional names",
    detail: "The identity layer retains printed names and adds declared effective names while the source is valid.",
  },
  {
    id: "arena-static-gains-colors",
    label: "A Permanent grants colors in all areas",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "20-1",
    ownerIssue: 553,
    proof: "scripts/verify/static-layers-553.ts; scripts/verify/compiler.ts \u2014 effective colors",
    detail: "Declared effective colors apply in their source scope. Original-color keyword eligibility remains separately tracked under #597.",
  },
  {
    id: "arena-combo-card-to-z-energy",
    label: "A combo card becomes Z-Energy at battle end",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "5-4, 8-5-2; `vm/index.ts` zEnergyFromCombo action",
    ownerIssue: 551,
    proof: "scripts/verify/z-energy-combo-551.ts; scripts/verify/compiler.ts — actual ZCHEAP payment",
    detail: "Both players get ordered optional choices with persisted continuation and the 8-5-4 checkpoint. Selected combo contributions remain through that checkpoint; the later 8-5-7/10 Auto checkpoints have separate bounded evidence under #609.",
  },
  {
    id: "arena-combo-cleanup-checkpoints",
    label: "Generic Combo-to-Drop and battle-end Autos use separate cleanup checkpoints",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "8-5-5..8-5-10-1; 9-6-9-1-3; 9-6-11",
    ownerIssue: 609,
    proof: "scripts/verify/battle-cleanup-replacement-gap-609.ts — native optional/competing replacement choices, redirects, captured-variable substitutes, saved cursor, actual-source 8-5-9 timing, and 8-5-7-installed redirects/substitutes/declines for an already-resolved generic Auto; scripts/verify/battle-cleanup-609.ts — synthetic generic trigger, both checkpoints, two players, order, paused JSON reload, projected Drop subject information versus live Combo selectors, source departure/negation, replacement boundary, special hand-origin Auto and actual old-main paused save; scripts/verify/z-energy-combo-551.ts, combo-entry-672.ts, rule-processing.ts, heroic-554.ts and battles.ts — existing controls; docs/arena-backlog/evidence/609/implementation-proof.md — manual and fixture boundaries",
    detail: "After the 8-5-4 checkpoint, generic same-player Combo-to-own-Drop watcher Autos are announced at 8-5-6 and resolve at 8-5-7 while their subjects remain in Combo. Subject information for the ordinary open-area movement is projected in Drop; live selectors and costs stay on the actual board. Native 8-5-8 departures persist replacement questions and substitute frames; a substitute actual Combo-to-Drop movement is captured for the later group. Remaining Combo cards depart at 8-5-8; battle-end and qualifying special card Autos enter pending at 8-5-9 for 8-5-10. Persisted cursors prevent duplicate occurrences and old grouped-cleanup pauses resume without replay. The generic card text is synthetic because no real repository fixture supplies it. A replacement installed during 8-5-7 for a subject whose generic Auto already resolved is applied at 8-5-8 under 9-10 like any other departure; the resolved Auto is neither reversed nor announced again. A replacement already present at 8-5-6 still interrupts under the open #609 boundary (it needs an owner ruling), and the existing non-Battle Extra departure fixture is preserved without claiming a new ruling.",
  },
  {
    id: "arena-counter-recursion",
    label: "A Counter opens a Counter: Counter window",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "9-7-2; 9-7-3-3..9-7-3-5; 22-10-3-4; 22-10-4; 22-10-7-1; 22-10-8",
    ownerIssue: 552,
    proof: "scripts/verify/compiler.ts — nested Counter scenario (E-STOP negates E-NEGATE); scripts/verify/counter-chain-552.ts — window after an attack's and a play's [Counter], opponent-only and [Counter: Counter]-only candidates, two- and three-motion chains resolved last-first, negation eliminating the motion under it (card in Drop, costs kept), each cost paid once, JSON reload mid-chain resolving identically, wrong-actor/non-candidate/left-the-hand/stale refusals with nothing changed, a 3-8-2 payment asked at the window, unaffordable answers not offered, both viewers' projections",
    detail: "Each activated [Counter] is a counter motion frame (`counterMotion`) that, on first reaching the front of the program queue, opens its player's opponent's [Counter: Counter] window (`openCounterCounterWindow`). Answers unshift in front of it, so motions resolve in descending order with no checkpoint between; `negateCounter` removes the motion directly under the running one. A window with no payable [Counter: Counter] is not put. A 20-14 activation price on a [Counter] is charged after its printed price, before it activates (#677).",
  },
  {
    id: "arena-counter-decline-window",
    label: "A player may decline a Counter window",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "9-7-2-3; 9-7-3-4; 9-7-3-5",
    ownerIssue: 552,
    proof: "scripts/verify/compiler.ts — declined Counter scenario; scripts/verify/counter-chain-552.ts — declined [Counter: Counter] window resolves the countered motion once, after a reload, with nothing of the decliner's spent, and the local policy (`policy/combat.ts`) answering the window by declining",
    detail: "\"Don't counter\" at a [Counter: Counter] window ends that counter timing; the motions under it resolve without being charged or announced again, and no window is put twice. The local policy declines every [Counter: Counter] window explicitly.",
  },
  {
    id: "arena-priced-choice-binds-x",
    label: "X from a chosen action-price value reaches the effect",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "20-5-3; 4-3-3; 5-3; 5-8-1; 22-10-7; action-price binding contract (`scripts/verify/cost-binding-550.ts` header)",
    ownerIssue: 550,
    proof: "scripts/verify/compiler.ts — chosen-price X scenario (a printed [Activate] action price, two chosen, two drawn); scripts/verify/cost-binding-550.ts — [Activate] chosen card read by the effect (BT28-105 wording: the chosen card's front power, not a same-area alternative's), refused wrong actor/non-candidate/empty/stale answers with nothing charged, JSON reload at the price resolving identically, both viewer projections; [Activate] X from a choosing price across a reload part-way through the choice, X = 0 drawing nothing; [Counter] printed action price on the strict host carrying X into the effect with one activation and no cursor left; BT28-124's action alternative offered only while its condition holds and paying with the chosen card; scripts/verify/auto-costs-549.ts — an Auto's action-chosen X in its own frame",
    detail: "A price program's choices bind their names (`$cN`) and a `bindX` choice binds X on the effect's frame, for a printed [Activate] action price (`saveVars`/`saveX`), a [Counter]'s printed action price (`stepCounterCost`, X carried since #550), a [Counter]'s action alternative and an Auto's price (its own frame). An energy X already paid wins over a chosen one. Invoked activations waive the original skill cost (12-2-4-4), so no price binds anything there and X-priced lines are not invocable. A [Swap]'s action price binds nothing for the keyword's own move, and an [Activate] price that moves this card under another card is still not chargeable; both are outside this row.",
  },
  {
    id: "arena-aegis-incremental-choice",
    label: "Aegis choice covers only the colors still missing",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "22-30-3",
    ownerIssue: 555,
    proof: "scripts/verify/aegis-555.ts \u2014 incremental mandatory coverage, three colors, invalid answers and reload",
    detail: "Each prompt offers only cards covering missing distinct colors; payment occurs once after complete coverage. Additional native/action-price ordering is independently tested in arena-aegis-additional-cost-order; original-color eligibility is independently tested in arena-keyword-original-colors.",
  },
  {
    id: "arena-energy-payment-effective-colors",
    label: "Effective applicable colours are used by energy payment planning",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "1-2-3; 2-2; 5-3; Hidden Mode exception 23-5-2",
    ownerIssue: 626,
    proof: "scripts/verify/effective-payment-colours-626.ts — effective grants pay the specified Blue cost; source/expiry revoke it; Hidden Mode, markers, AS energy and exact selected payment have independent assertions",
    detail: "The existing shared planner reads current applicable colours and preserves explicit alternative-payer colours and Hidden Mode colourless-only payment. Synthetic fixed expectations check real legal offers, rested resources, reductions, refusal/reload and viewer projections; original-colour keyword eligibility remains separately tested by #597. No claim of exhaustive alternative-price or verified catalog-grant coverage.",
  },
  {
    id: "arena-revive-additional-cost-order",
    label: "Revive pays original-colour hand cards before its supported live Auto price",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "22-34-3",
    ownerIssue: 624,
    proof: "scripts/verify/revive-cost-order-624.ts — independent hand-before-fee, live price, decline/failure, pending Auto, Counter: Play and saved-frame assertions",
    detail: "A declaration-derived optional colour-cost continuation precedes supported generic Auto additional prices. Independent synthetic fixtures verify exact costs/events and no unpaid resurrection; broader Auto instruction and replacement coverage remains bounded by the existing engine. Already-paid older frames retain their stored history and continuation without repricing or a destructive migration. Original-colour eligibility remains separately tested by #597.",
  },
  {
    id: "arena-keyword-original-colors",
    label: "Arrival, Aegis and unpriced Revive use original payment colors",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "22-29-3; 22-30-3; 22-34-3",
    ownerIssue: 597,
    proof: "scripts/verify/original-colors-597.ts — actual keyword eligibility, payment candidates, mono/multicolor, reload, source removal, expiry and private views",
    detail: "Only declared original-color filters and coverage read the shown printed face before identity layers. Ordinary filters retain effective colors. Revive additional-price ordering remains #624, outside this narrow proof; no exhaustive keyword-cost support is claimed.",
  },
  {
    id: "arena-aegis-additional-cost-order",
    label: "Aegis pays hand colors before supported additional native and action prices",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "22-30-3; 5-8-4",
    ownerIssue: 595,
    proof: "scripts/verify/aegis-cost-order-595.ts — live hand-dependent fee, native Burst, old additional-prompt reload, two-card native cursor, owner-selected optional/competing replacements, supported additional action-price continuations, stale side/mode answers, failed payment and actual scoped payer consumption; scripts/verify/aegis-printed-price-595.ts — printed post-tag action read as the skill cost by compiler and drafter, paid after the colours (event order, reload, stale/invalid answers, both viewer projections, late unaffordability), unread/mixed/stale-record refusals and declaration-time #595 interruption; scripts/verify/ko-marker-price-549.ts — KO and add-marker prices after the colours (reload, stale/wrong-actor refusal, both projections, 5-8-4 failure on a mandatory or applied optional KO replacement); scripts/verify/aegis-555.ts — priced event order",
    detail: "Hand cost moves precede live fee calculation, native prices in declared order, supported action-price instructions, and activation. A printed \"[Aegis XY] skill cost\" action (22-30-2) is compiled and drafted as the price, never as an effect. Saved cursors prevent repeat costs; legal replacement redirects and later unaffordability retain only actual performed payments, with no activation use or effect. The pooled replacement and action-price cases are synthetic VM fixtures, not printed-card coverage. The shared host's KO and add-marker prices are paid after the colours. Other unsupported action-price instructions remain explicit #595 interruptions through the shared strict price host, now raised on declaration before any colour card is paid; broader Auto grammar remains #549. Original-color eligibility is independently tested in arena-keyword-original-colors.",
  },
  {
    id: "arena-aegis-alternative-payment",
    label: "Aegis can be paid by a Permanent's printed alternative instead of the hand cards",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "22-30-3; 20-1-11",
    ownerIssue: 762,
    proof: "scripts/verify/aegis-alt-payment-762.ts — both printed lines compile, offer only under BT22-035's Leader condition and for BT22-140's own Aegis, the payer's choice beside the hand payment, Drop-to-Warp and opponent-hand-to-deck-bottom moves, refusal when unpayable or stale, reload mid-payment and the blind opponent-hand pick for both viewers",
    detail: "BT22-035 (a yellow and a blue card from the Drop to the Warp) and BT22-140 (one card of the opponent's hand to the bottom of their deck, chosen blind by the activating player: the Rule Manual is silent on who chooses, so the literal reading stands). The alternative replaces the whole hand-colour payment; additional costs, activation and Autos then proceed as usual.",
  },
  {
    id: "arena-heroic-once-per-turn",
    label: "Printed Heroic resolves once through turn-duration negation",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "22-35-3",
    ownerIssue: 554,
    proof: "scripts/verify/heroic-554.ts \u2014 Battle play, paid Extra activation, source departure, negation, independent owners, turn reset and reload",
    detail: "The declared hook retains its printed skill identity and applies ordinary per-turn negation. Granted-instance identity is asserted separately by arena-granted-heroic-instance-identity; this printed row does not establish copied identity.",
  },
  {
    id: "arena-granted-heroic-instance-identity",
    label: "Timed and Permanent-granted Heroic copies each retain their own once-per-turn identity",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "22-35-2/22-35-3; 9-1-5; 3-1-4",
    ownerIssue: 602,
    proof: "scripts/verify/granted-heroic-602.ts — actual Battle play and paid Extra flows, independent grants, copied Permanent provenance, reload, expiry/regrant and source/bearer reentry; scripts/verify/heroic-554.ts — printed controls",
    detail: "Timed grants use persistent effect IDs; standing grants distinguish source entry/face, skill/op path and bearer entry. Only the resolving instance is negated through the turn. Grant identities remain private; unsupported legacy hook frames with no identity interrupt before drawing rather than silently escaping self-negation. Local synthetic programs prove these bounded interactions, not exhaustive catalog or legacy-save migration coverage.",
  },
  {
    id: "arena-extra-auto-keyword-activation",
    label: "Successful Extra Auto skills capture eligible Heroic/Villainous hooks after payment",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "12-2-3; 22-35-2/3; 22-36-2/3",
    ownerIssue: 683,
    proof: "scripts/verify/villainous-683-auto-audit.ts — legal Field arrival, free/paid/declined/unaffordable Auto, own in-play source, independent keyword spend and Battle source exclusion; scripts/verify/arena-extra-auto-rules-db.mts — isolated PGlite persisted payments/choices, request receipts, stale CAS and both viewers",
    detail: "Successful Auto activation snapshots source qualification before effect changes and retains individual watcher identity. Failed or declined payment fires no hook. An in-play Extra can watch its own skill; another-card exclusion applies to Battle play. villainous-683-parent-continuation.ts also proves child effect, parent continuation, then keyword choice across saved prompts on both engines. This bounded evidence does not establish catalog-wide coverage or live deployment behavior.",
  },
  {
    id: "arena-fill-under-named-host",
    label: "A named host is filled from the top of its owner's deck to the printed stack total",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "BT2-009 official FAQ Q1/Q4; owner card review #539",
    ownerIssue: 573,
    proof: "scripts/verify/grouped-readings-573.ts — absent/wrong-zone host, zero/partial/full/overfull stack, short deck, multiple hosts, wrong selection, reload and privacy",
    detail: "An exact same-name bounded-total reading composes existing host choices, live counts and ordered deck moves. Existing under-stack order conventions are preserved per engine. Other wordings and the separate BT3-043 entry timing limitation are not claimed by this row.",
  },
  {
    id: "arena-combo-entry-auto-timing",
    label: "Ordinary card-specific combo Autos resolve at genuine entry before combat",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "5-7-5-2/3; 5-7-6; distinct 8-5-10-1 battle-end wording",
    ownerIssue: 672,
    proof: "scripts/verify/combo-entry-672.ts — hand/Battle entry, BT3-043 power and conditional return/draw, both owners, payment/reload, old stored rows, pinned DSL, explicit late Autos and no duplicate Z-Energy/Drop trigger; scripts/verify/grouped-readings-573.ts — engine-specific combat expectations",
    detail: "Current DBS rules-engine games pend the self Auto only after genuine Combo Area arrival and resolve it before another combo or combat. Older confirmed comboed rows bridge to this entry declaration without database rewrites. Legacy runtime and older pinned DSL bundles retain historical late timing; explicit end-of-battle Autos enter pending at the later 8-5-9 group under the bounded #609 checkpoint implementation. These local fixtures do not establish exhaustive catalog coverage.",
  },
  {
    id: "arena-combo-from-hand-battle-end",
    label: "A combo-end Auto binds this card’s hand origin and turn restriction",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "8-5 Combo Area cleanup; owner card review #539",
    ownerIssue: 572,
    proof: "scripts/verify/hand-combo-572.ts — legal hand/Battle-area combos, unrelated copy, opponent turn, reload, missing provenance, Z-Energy departure and later battle; scripts/verify/readings.ts — BT6-010 and BT2-010 source/turn readings",
    detail: "Each actual Combo Area entry records its source for that battle. Only the bound copy’s 8-5-8 Combo-to-Drop departure qualifies the hand-qualified Auto, which enters pending at 8-5-9 under #609. Older saved battles with no origin interrupt visibly before resolution; the synthetic 8-5-6 notice preserves real entry provenance without inventing it. This narrow provenance and timing evidence does not establish exhaustive catalog coverage.",
  },
  {
    id: "arena-opponent-next-charge-lock",
    label: "An opponent-next-Charge lock applies and expires on the source player's opponent clock",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "7-2-7; 20-13-5; BT3-085/BT3-101 owner card review #539",
    ownerIssue: 574,
    proof: "scripts/verify/duration-shuffle-574.ts — actual Charge Active Step, later Main skill untap, off-turn source clock, control transfer, skipped phase and JSON reload on both engines",
    detail: "The narrow switchToActiveInCharge prohibition blocks only the named opponent's next Charge Active Step, then expires; a whole skipped Charge also consumes it. An intervening Charge for the source player does not apply or consume the lock even if that player now controls the target. BT2-004's already-correct nextTurn power expiry has a separate game-level assertion in the same suite.",
  },
  {
    id: "arena-inspected-closed-area-shuffle",
    label: "A search shuffles each closed area it actually inspected",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "5-11-2; SD7-01 owner card review #539",
    ownerIssue: 574,
    proof: "scripts/verify/duration-shuffle-574.ts — SD7 actual Deck/Life search, separate remaining-area randomization, other-player unchanged, private identities and saved-choice determinism",
    detail: "The bounded inspectedOnly shuffle remembers executed search visibility through a choice and shuffles only the master's inspected Deck or Life areas. A plain shuffle remains Deck-only. This fixture does not establish every printed search wording or catalog-wide behavior.",
  },
  {
    id: "arena-desire-hand-skill-invocation",
    label: "A qualifying Desire Extra's Main skill is activated from hand",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "12-2-4-1–9; SD7-01 owner card review #539",
    ownerIssue: 574,
    proof: "scripts/verify/duration-shuffle-574.ts — hand/trait/current-energy bound with a live cost reduction, Drop-before-skill, original-cost waiver, condition/once/prohibition, line choice, nested continuation, stale/reload and privacy",
    detail: "The printed branch selects an eligible hand Extra by its current energy cost and invokes its actual Activate: Main line with its original energy and skill costs waived, then resumes the invoking effect. A live reduction can make a printed-cost-2 Extra eligible with one energy. Conditions, once limits and prohibitions still apply. An external 20-14 activateSkill tax is not waived: it is charged on the invoked line (see arena-activation-external-tax, #677).",
  },
  {
    id: "arena-white-cell-free-extra-invocation",
    label: "BT31-116 activates an eligible hand Extra's Main/Battle skill for free",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "9-6-2; 12-1-3; 12-2-4-1–9; BT31-116 owner card review #539",
    ownerIssue: 680,
    proof: "scripts/verify/free-extra-680.ts — exact event-time White Cell/Jr. qualification, paid/declined Hidden Mode Auto price, optional mono-white hand Extra choice, skill activation and Extra-activated watcher, normal zero-price and SD7 controls, current-cost/alt-payment boundaries, other-Auto movement/cost change, reload/stale/privacy, and legacy invocation/payment-gap assertions; scripts/verify/arena-free-extra-db.mts — PGlite revisions, wrong actor/stale CAS, duplicate pay/choice receipts, reload and both seat views",
    detail: "On the current locally compiled record, the rules engine pends BT31-116 only when the played Cell/Cell Jr. is White and currently costs at least 3, before another Auto can change it. Paying the Auto's own Hidden Mode price offers up to one mono-white cost-2 hand Extra's valid Main/Battle line. Its original energy and skill costs are waived; it goes to Drop and its actual skill and ordinary Extra-activated watcher resolve. A saved session survives the price and choice with one payment and one activation across duplicate requests. The legacy engine shares the invocation but omits the Auto's Hidden Mode action price, an active #549 gap. Older stored rules retain their old trigger guard and play operation until reviewed and re-drafted; catalog reading diff and fuzz-40 are not claimed.",
  },
  {
    id: "arena-activation-external-tax",
    label: "A 20-14 price on activating a skill is charged on [Activate], [Auto] and [Counter] activations (five catalog cards)",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "20-14-1; 22-30-3 additional skill cost; 9-6-3-2/9-6-4; 9-7; 12-1-3; 12-2-4 original-cost waiver boundary; 5-8-4",
    ownerIssue: 677,
    proof: "scripts/verify/activation-taxes-677.ts — EX06-35, DB1-015, BT29-022, BT23-140 and BT10-097 compiled from their catalog text and played: [Activate] (Extra from hand, Battle Card in play), [Auto] (pay / decline / cancelled when unpayable, local policy answers the price question), [Counter] (EX06-35, DB1-015's turn-long effect, BT29-022 activated for real), each price once at the activation boundary, unpayable not offered and refused with nothing changed, BT10-097's Leader condition and 12-1-3 scope, BT23-140's Battle-Card filter, live re-check after each payment (departed source not charged, newly due rule charged, newly unpayable fails the activation), JSON reload mid-payment, hand picks private in both viewers; scripts/verify/arena-activation-taxes-db.mts — PGlite saved session: two prices across reloads, revision/CAS, wrong actor, duplicate requests, both seat projections; scripts/verify/activate-tax-677.ts — the synthetic wording, invoked (SD7-01) activation, counted uses; scripts/verify/duration-shuffle-574.ts",
    detail: "The rules engine reads the prices at the declaration (refusing a set that cannot be paid whole, on the board the printed energy will leave) and charges them through a stored gate in front of what the activation queued — after an [Activate]'s Extra goes to the Drop, after an [Auto]'s or a [Counter]'s printed price — one at a time, re-reading the live set by each rule's stable key after every payment. An [Auto]'s price joins its 9-6-4 cost: one \"Pay\" option for the whole, or decline. A [Counter] pays from the hand before it goes to the Drop. A keyword's own activation move or own [Auto], a keyword hook Auto, and a [Counter] at an action alternative stop with a typed #677 NotYet rather than resolving untaxed. Catalog reading diff and fuzz-40 are owner work.",
  },
  {
    id: "arena-limit-across-copies",
    label: "[Limit X] is counted across every copy of the card, per master and turn",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "22-44-3, 22-44-4, 22-44-5; 22-11-3 per-copy control",
    ownerIssue: 741,
    proof: "scripts/verify/limit-copies-741.ts — SD15-03's [Limit 1][Spirit Boost 1] Auto answers once across three copies, including the copy that left and re-entered play, with no second marker paid, across a JSON reload, shown spent on both viewers' boards and back the next turn; declared [Activate: Main] [Limit 1]/[Limit 2] across copies with the [Limit 1] refusal; an unpriced [Limit 1] Auto played twice draws once; a [Counter: Attack][Limit 1] second copy is no candidate; [Once per turn] copies stay per copy; the eleven catalog [Limit 1] wordings of the #728 readings diff read as [Limit 1], not [Once per turn]",
    detail: "The rules engine keeps one count per master per [Limit X] line (card number, face, line) on the side, spent by a declared or invoked activation, a paid or unpriced Auto and a Counter, read by every offer and by the Auto checkpoint (an exhausted pending Auto fails to activate and is never offered its price), and dropped at the end of the turn. The legacy engine still counts per copy. Synthetic neighbours stand for the paths; the catalog wordings are proved as readings only.",
  },
  {
    id: "arena-face-up-life-trigger",
    label: "A face-up Life card event fires its Auto",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "3-9-2-1",
    ownerIssue: 556,
    proof: "scripts/verify/faceup-life-556.ts \u2014 source colors, audience, event binding, reload, masking and unrelated transitions",
    detail: "Actual face-down to face-up Life transitions pend matching self Autos and controller watchers; non-Life targets and unchanged values do not fire.",
  },
  {
    id: "arena-static-gains-list-attributes",
    label: "A Permanent grants list attributes",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "20-1",
    ownerIssue: 553,
    proof: "scripts/verify/static-layers-553.ts; scripts/verify/language.ts \u2014 list gains and timed expiry",
    detail: "Permanent and timed list-attribute gains apply with source scope, expiry and persisted state.",
  },
  {
    id: "arena-counter-alternative-action-price",
    label: "A Counter action price offers, asks, and charges",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "5-3, 4-3-3, 20-7",
    proof: "scripts/verify/wordings.ts — ALTC offers a paid choice, moves the chosen card, and hides the alternative when unaffordable",
    detail: "The deterministic ALTC fixture passes on the rules engine for two payable choices and for an unaffordable price. This is one tested shape, not an exhaustive claim about all alternative prices.",
  },
  {
    id: "arena-counter-action-price",
    label: "A [Counter]'s printed price beyond orbs is paid on the strict host before it activates",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "1-6, 5-8, 9-7, 22-10-4, 22-10-7",
    ownerIssue: 716,
    proof: "scripts/verify/counter-action-price-716.ts — BT5-023 and BT6-026 (catalog text): the leading \"Your Leader Card is red\" condition offered while it holds, refused as `condition` under a blue Leader, energy refusal, forged-declaration refusal with nothing paid, event order; BT10-008 (catalog text): the restriction price compiled as `forbid(activateCounter, counterKind: play, otherCards)`, put in force before the skill, binding only other cards' [Counter: Play] for the turn; synthetic hand price: offered only when payable after the energy (the [Counter] cannot pay for itself), stored continuation, both viewer projections, wrong-actor/self/empty/stale refusal unchanged, JSON reload mid-price, price → Drop → skill order, 5-8-4/22-10-7-1 failure; a draw price refused as a typed #716 gap, never free; scripts/verify/hidden.ts — BT28-121's Hidden Mode price through the same path",
    detail: "Condition-only prices are checked at offer and declaration (5-8-3). Action prices are proven payable after the energy (or a non-program alternative) on an isolated board, paid with the card still in hand, and only then is the card placed in the Drop and the skill activated, with the price's choices handed to the effect. Families outside the strict host, and an action alternative beside a printed action price, are typed #716 gaps. The effects of the three printed cards remain compiled-only (no card-level scenario of their effects). Legacy engine unchanged.",
  },
  {
    id: "arena-swap-specified-card",
    label: "[Swap] reveals only the specified Battle Card its printed description names",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "22-22-2, 22-22-3, 22-22-4, 1-8-1-1-1-1",
    ownerIssue: 731,
    proof: "scripts/verify/swap-729-731.ts — the printed description of every catalog [Swap] shape read with the filter grammar (≪trait≫ and SD5-04/SD5-05's ASCII \"<<Goku's Lineage>>\", character, colour, mono-colour, \"Green/Yellow\" as a multicolor card, \"and [Swap]\", \"and a [Swap] skill\", \"and 20000 power\", \"<Beerus> in its character name\"); on the rules engine BT4-078, SD5-05 and EX19-31's line offer and reveal only the specified card (not an off-trait or off-cost Battle Card, not an Extra), refuse the offer with none in hand, and refuse a forged answer naming an off-trait card unchanged; scripts/verify/keywords.ts and scripts/verify/workflow.ts — the same reading on both engines (SWAPPER names <COST3>; CRIT and DUAL are red cost-3 cards it never offers)",
    detail: "The `DEFINE KEYWORD Swap` offer gate and its choice read `asPrinted` (`parseFilter` over `printedDescription`) beside `type = BATTLE` and the energy cost X; the legacy engine's `swapCandidates` reads the same description. The neighbours diff of 13 Oct 2026 over the 60 catalog [Swap] lines moved three readings (SD5-04, SD5-05, EX19-31) and no other keyword line.",
  },
  {
    id: "arena-swap-action-price",
    label: "A [Swap]'s printed action price is paid on the strict host before the swap",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "22-22-2, 22-22-3, 4-3-3, 5-8",
    ownerIssue: 729,
    proof: "scripts/verify/swap-729-731.ts — BT4-079 (catalog text): the price compiles to choose-from-hand → Drop; offered only when the energy is there and the action leaves a specified card to reveal (refused with an empty hand, short energy, or only the card the swap would reveal), a forged declaration refused with nothing paid; declared, the energy is paid, the stored continuation asks for the paying card (never the only card to reveal), both viewer projections, wrong-actor/reveal-card/empty/stale answers refused unchanged, JSON reload mid-price resolves identically, price → skill → reveal → return → play order, no cursor left behind; 5-8-4 failure keeps the energy spent with no skill and no swap; P-594's restriction price refused as a typed #729 gap, never free",
    detail: "Energy first (`applyDeclared`), then the action on the strict action-price host shared with Auto, [Aegis] and [Counter], with 22-22-3's reveal appended to every payability proof; the skill is announced and its moments fired only once the price is paid. The compiler now reads a [Swap] line's price (the tag no longer blanks it): BT4-079, BT16-116/118/120, P-374 (hand to deck bottom), BT29-037/039 (discard) and P-594 (restriction, a typed gap) gained price records. Only BT4-079 has a card-level scenario. Legacy engine unchanged: a [Swap] whose price is more than orbs is refused as unread there.",
  },
  {
    id: "arena-unique-master-choice",
    label: "Two same-named [Unique] cards in one Battle Area: the master chooses the one that stays",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "21-11-1, 21-11-3, 22-39-4, 21-1-2-1, 9-10",
    ownerIssue: 730,
    proof: "scripts/verify/unique-730.ts - SD15-05 (catalog text) played beside itself by a skill: the master is asked before the skill's next instruction (its draw comes after), exactly one kept (the older copy or the newer), the rest to the Drop before the draw; both viewer projections (only the master is offered the copies); wrong actor, non-candidate, two and none refused unchanged; JSON reload mid-question resolves identically; three copies with a stale answer refused; the opponent's copies asked of their master during the turn player's action; the local policy answers through the choices layer and plays, the same from a JSON copy; a dropped copy's Drop Auto fires; a mandatory 9-10 redirect applied and an optional one asked (wrong actor refused, reload mid-question); neighbours unchanged (no [Unique], the keyword-less 'only 1 copy' wording, different names, a Hidden Mode copy)",
    detail: "Interruptive (21-11-1): `stepScript` asks the host after every instruction and the runner looks whenever it regains control, so the question comes before any further instruction, checkpoint or Auto. The choice is a `chooseCards` (min 1, max 1) stored on a `uniqueKeep` frame; departures are rule moves through 9-10. Not processed: the keyword-less 'only 1 copy of this card can be placed in your Battle Area' wording and the [Z-Extra] and Unison limits of 21-11-2. Legacy engine unchanged: it keeps the newest copy without asking.",
  },
  {
    id: "arena-native-mill-macro-exception",
    label: "Mill remains a native operation",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "`docs/arena-ruleset-spec.md` §2; `ops.rules` bind exception",
    proof: "scripts/verify/battles.ts — BT2-001 milled-card color changes the effect on rules engine; scripts/verify/rulesets.ts — macro sweep requires `mill` to be the only undeclared op",
    detail: "The macro sweep preserves mill as a native operation because its `as` binding names moved cards for later clauses and the macro grammar cannot preserve that binding.",
  },
  {
    id: "arena-vm-fixed-expectations",
    label: "VM oracle suite converted to fixed expectations",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "#459 fixed expected-state migration (test-lane status; no gameplay rule citation)",
    ownerIssue: 459,
    proof: "scripts/verify/vm.ts; scripts/verify/vm-*-459.ts; docs/arena-backlog/evidence/459/README.md — reviewed fixed gameplay expectations; full verify-arena suite on the rules engine",
    detail: "The VM rules-only lane checks fixed openings, complete turn/action/event traces, filter and price corpora, script outcomes, views and focused gameplay facts. This row is a test-migration result, not gameplay-rule support.",
  },
  {
    id: "arena-ai-vm-fixed-expectations",
    label: "AI presentation and requests have fixed rules-engine expectations",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "#459 fixed expected-state migration (test-lane status; no gameplay rule citation)",
    ownerIssue: 601,
    proof: "scripts/verify/ai-vm.ts; scripts/verify/fixtures/ai-vm \u2014 21 migrated parity checks, two extra Leader facts and negative fixture controls",
    detail: "The rules-only lane pins zones, both-viewer text, decklists, question, system and legal moves on the rules engine.",
  },
] as const;

export const NAMED_RUNTIME_GAPS = CAPABILITY_EVIDENCE.filter((row) => row.skipWhere !== undefined);

export const DEFERRED_STATIC_EVIDENCE: readonly { operation: string; capabilityIds: readonly string[]; ownerIssue: number; citation: string }[] = [];

/** Test-lane evidence not yet converted to fixed expectations under #459. */

/**
 * Source-level exits that can refuse or omit an Arena mechanic. `ordinal` is
 * the 1-based source order of the matching NotYet expression in that file;
 * the verifier walks TypeScript syntax and requires exact file/count parity.
 * Historical issue references explain lineage and are never treated as live
 * ownership. A missing owner is intentionally visible for triage.
 */
export interface VmUnsupportedSourceSite {
  id: string;
  file: string;
  ordinal: number;
  kind: "not-yet" | "silent-exit" | "interruption";
  classification: "current-runtime-unsupported" | "validated-guard" | "declaration-extension" | "referee-boundary" | "menu-gate";
  citation: string;
  detail: string;
  ownerIssue?: number;
  historicalIssues?: readonly number[];
  /** For silent exits, a stable distinctive source fragment checked verbatim. */
  sourceNeedle?: string;
}

export const VM_UNSUPPORTED_SOURCE_SITES: readonly VmUnsupportedSourceSite[] = [
  { id: "arena-vm-notyet-cleanup-projected-choice", file: "src/lib/arena/vm/battle.ts", ordinal: 3, kind: "not-yet", classification: "current-runtime-unsupported", citation: "8-5-6..8-5-8; 9-6-9-1-3; 9-10", ownerIssue: 609, detail: "A generic pre-announced Combo-to-Drop subject with replacement choices has no proven new-area projection; interrupt before inventing Drop information." },

  { id: "arena-vm-notyet-auto-face-area", file: "src/lib/arena/vm/auto-costs.ts", ordinal: 1, kind: "not-yet", classification: "current-runtime-unsupported", citation: "5-8-2-2; 3-9-2-1; strict face-turn payment", ownerIssue: 549, detail: "A saved face-turn price target outside Life interrupts as unknown; missing or already-desired Life faces are unpayable rather than free payment." },
  { id: "arena-vm-notyet-auto-face-choice", file: "src/lib/arena/vm/auto-costs.ts", ordinal: 5, kind: "not-yet", classification: "current-runtime-unsupported", citation: "5-8-2-2; 3-9-2-1; bounded Life choice payment", ownerIssue: 549, detail: "Only an immediate mandatory single own-Life choice followed by an actual opposite-face turn is admitted; its filter may only ask for the face the turn leaves (BT12-023: flip 1 face-up card in your life face down). Other face-turn shapes remain typed unknown; the shared validator labels Aegis callers under #595, [Counter] callers under #716 and [Swap] callers under #729." },

  { id: "arena-vm-notyet-hand-return-subject-info", file: "src/lib/arena/vm/triggers.ts", ordinal: 1, kind: "not-yet", classification: "validated-guard", citation: "9-6-9-1-1/2; original Battle Area information for a qualified return", historicalIssues: [825], detail: "A qualified Battle-to-hand Auto whose movement lacks original subject information interrupts before pending; the card's new hand identity cannot prove its original qualification. Current movement emitters capture that information before effect cleanup, including redirected and borrowed returns. This is a missing event-provenance guard, not a claim that the supported hand-return mechanic is unavailable." },
  { id: "arena-vm-notyet-combo-entry-origin", file: "src/lib/arena/vm/triggers.ts", ordinal: 2, kind: "not-yet", classification: "validated-guard", citation: "5-7-5-3/5-7-6-3; printed hand-qualified entry source", historicalIssues: [672], detail: "A hand-qualified entry Auto with missing captured origin interrupts before effect resolution. Genuine combo actions capture the actual source before this checkpoint; hand origin is never guessed." },
  { id: "arena-vm-notyet-combo-origin-save", file: "src/lib/arena/vm/triggers.ts", ordinal: 3, kind: "not-yet", classification: "validated-guard", citation: "8-5; persisted combo-origin contract", historicalIssues: [572], detail: "An older saved battle missing origin for a due hand-qualified combo-end Auto interrupts before resolution. Current battles capture actual origins; no legacy save provenance is invented." },
  { id: "arena-vm-notyet-cleanup-old-reentry", file: "src/lib/arena/vm/battle.ts", ordinal: 1, kind: "not-yet", classification: "validated-guard", citation: "8-5; pre-#609 saved grouped-cleanup continuation", ownerIssue: 609, detail: "A malformed old save that calls native cleanup again at its already-performed `cleanup` stage interrupts instead of replaying departed cards or pending battle-end Autos. Actual old-main paused choices resume through the stored runner frame." },
  { id: "arena-vm-notyet-cleanup-final-reentry", file: "src/lib/arena/vm/battle.ts", ordinal: 2, kind: "not-yet", classification: "validated-guard", citation: "8-5-10; persisted battle-end checkpoint continuation", ownerIssue: 609, detail: "A malformed saved frame that re-enters completed native battle-end work interrupts instead of announcing the 8-5-9 group a second time; normal pauses resume through the checkpoint runner." },
  { id: "arena-vm-notyet-cleanup-projected-replacement", file: "src/lib/arena/vm/battle.ts", ordinal: 4, kind: "not-yet", classification: "current-runtime-unsupported", citation: "8-5-6/7; 9-6-9-1-3; 9-10", ownerIssue: 609, detail: "If a replacement keeps a pre-announced generic Combo-to-Drop subject in Combo or redirects it elsewhere, the projected new-area information is unresolved and the game interrupts. The ordinary same-player Drop path and replacements without a qualifying generic watcher remain supported." },
  { id: "arena-vm-notyet-cleanup-projection-refused", file: "src/lib/arena/vm/battle.ts", ordinal: 5, kind: "not-yet", classification: "validated-guard", citation: "8-5-6; projected movement subject invariant", ownerIssue: 609, detail: "If a predicted Drop move cannot be represented on the cloned board after a Drop route was selected, the VM refuses to invent subject information. No current valid fixture reaches this invariant guard." },
  { id: "arena-vm-notyet-auto-search-budget", file: "src/lib/arena/vm/auto-costs.ts", ordinal: 2, kind: "not-yet", classification: "current-runtime-unsupported", citation: "9-6-4; 5-8-2-2; Auto price declaration contract", ownerIssue: 549, detail: "Exact named-transfer pruning excludes some proven dead branches, and interchangeable copies (same zone and card state, unreferenced, area order unobservable) are replayed once, so replaceable prices over copies finish. A search over distinct cards beyond 2,000 visited states still interrupts as unknown; no free effect or false unaffordability claim." },
  { id: "arena-vm-notyet-auto-conditional-empty", file: "src/lib/arena/vm/auto-costs.ts", ordinal: 3, kind: "not-yet", classification: "current-runtime-unsupported", citation: "9-6-4; 5-8-2-2; conditional action-price declaration", ownerIssue: 549, detail: "A conditional price with an empty branch and no proven prior payment interrupts. A completed mandatory prefix admits a conditional adjunct, including a shuffle terminal on every path." },
  { id: "arena-vm-notyet-auto-modal-empty", file: "src/lib/arena/vm/auto-costs.ts", ordinal: 4, kind: "not-yet", classification: "current-runtime-unsupported", citation: "9-6-4; 5-8-2-2; modal action-price declaration", ownerIssue: 549, detail: "A modal price with no option or an option with no payable instruction interrupts before payment; supported options each complete their own price." },
  { id: "arena-vm-notyet-auto-price-op", file: "src/lib/arena/vm/auto-costs.ts", ordinal: 6, kind: "not-yet", classification: "current-runtime-unsupported", citation: "9-6-4; 5-8-2-2; Auto price declaration contract", ownerIssue: 549, detail: "The strict host supports choose/discard/mill/switchMode/hidden/moveTo (including verified direct under)/removeMarker, public mandatory reveal, verified single own-Life face turns, KO of this card or of a compulsory own Battle-Area/in-play choice, adding a printed number of markers to this card, a plain restriction the payer puts on themself for the turn or battle (BT10-008, #716), and a terminal shuffle after payment. Play movement, private looks, draw, life movement, other KO/marker shapes, bare or nonterminal shuffle, and other instructions interrupt before payment. The same validator gates [Aegis] (#595), [Counter] (#716) and [Swap] (#729) action prices, where an unadmitted family is a refusal naming that issue (P-594's described restriction for [Swap])." },
  { id: "arena-vm-notyet-auto-unread-cost", file: "src/lib/arena/vm/auto-costs.ts", ordinal: 7, kind: "not-yet", classification: "referee-boundary", citation: "9-6-4; 5-8-2-2; Auto price declaration contract", detail: "An unread printed price interrupts before effect or payment; this ingestion boundary does not implement the unread mechanic." },
  { id: "arena-vm-notyet-auto-x-bounds", file: "src/lib/arena/vm/auto-costs.ts", ordinal: 8, kind: "not-yet", classification: "validated-guard", citation: "9-6-4; 5-8-2-2; Auto price declaration contract", detail: "Malformed negative/noninteger/inverted X bounds are refused; finite valid bounds are capped by available resources." },
  { id: "arena-vm-notyet-auto-pooled-instruction", file: "src/lib/arena/vm/auto-costs.ts", ordinal: 9, kind: "not-yet", classification: "declaration-extension", citation: "9-6-4; 5-8-2-2; Auto price declaration contract", detail: "A pooled cost declaration outside the current moveTo shape cannot be verified as a complete Auto payment." },
  { id: "arena-vm-notyet-keyword-fusion-material-price", file: "src/lib/arena/vm/keyword-costs.ts", ordinal: 1, kind: "not-yet", classification: "current-runtime-unsupported", citation: "22-13-4-4-1; 5-8-2-2; 5-8-3; keyword action price", ownerIssue: 926, detail: "A [Union-Fusion] action price is proven before its materials move, so only a price that cannot reach them (a draw, a mill, or a choice of the opponent's cards) is charged; any other shape is refused before it is offered or paid, never a free Fusion. Draw, mill and opponent-card prices on Fusion, Potara and the Evolve family are paid on the strict host (#926)." },
  { id: "arena-vm-notyet-activation-tax-keyword-auto", file: "src/lib/arena/vm/flow.ts", ordinal: 1, kind: "not-yet", classification: "current-runtime-unsupported", citation: "20-14-1; 9-6; 22-1", ownerIssue: 677, detail: "A keyword's own [Auto] ([Offering], [Revive], [Alliance] …) under a 20-14 activation price interrupts before it resolves; a printed text [Auto] is charged (the price joins its 9-6-4 cost), but no boundary is built for a keyword's own Auto, and it is never resolved untaxed." },
  { id: "arena-vm-notyet-activation-tax-hook", file: "src/lib/arena/vm/flow.ts", ordinal: 2, kind: "not-yet", classification: "current-runtime-unsupported", citation: "20-14-1; 9-6; 22-35/22-36", ownerIssue: 677, detail: "A pending keyword hook Auto ([Heroic]/[Villainous]) under an activation tax interrupts the same way, before any draw or discard." },
  { id: "arena-vm-notyet-activation-tax-counter-alt", file: "src/lib/arena/vm/battle.ts", ordinal: 6, kind: "not-yet", classification: "current-runtime-unsupported", citation: "20-14-1; 9-7; 5-3", ownerIssue: 677, detail: "A [Counter] under an activation price, taken at an action alternative (`pay: \"program\"`), interrupts before anything is paid: the order of the alternative's program and the 20-14 price is not built. A [Counter] paid with energy, with or without a printed action price, is charged." },
  { id: "arena-vm-notyet-counter-alt-beside-action", file: "src/lib/arena/vm/battle.ts", ordinal: 7, kind: "not-yet", classification: "current-runtime-unsupported", citation: "5-3; 5-8-2; 22-10-4", ownerIssue: 716, detail: "A [Counter] with a printed action price whose other way to pay is an action alternative (`pay: \"program\"`) is neither offered nor paid: the order and joint payability of two price programs are not built. No known printed card needs it; the refusal names #716." },
  { id: "arena-vm-notyet-activation-tax-keyword", file: "src/lib/arena/vm/actions.ts", ordinal: 1, kind: "not-yet", classification: "current-runtime-unsupported", citation: "20-14-1; 22-1", ownerIssue: 677, detail: "A keyword's own activation move ([Evolve], [Aegis], [Over Realm] …) under an activation tax interrupts before anything is paid; text [Activate] lines, declared or invoked, are charged." },
  { id: "arena-vm-notyet-granted-hook-identity", file: "src/lib/arena/vm/flow.ts", ordinal: 3, kind: "not-yet", classification: "validated-guard", citation: "22-35-3; persisted hook identity contract", historicalIssues: [602], detail: "A legacy or unrecognized qualifying hook with no individual identity interrupts before any draw. Current timed and Permanent grants carry individual provenance; this guard does not claim legacy saved-hook migration." },
  { id: "arena-vm-notyet-concede-program", file: "src/lib/arena/vm/index.ts", ordinal: 1, kind: "not-yet", classification: "declaration-extension", citation: "0-1-3-4", detail: "A concede declaration with a DO body has no execution semantics; current declarations are guarded by this path.", historicalIssues: [142] },
  { id: "arena-vm-notyet-apply-pass", file: "src/lib/arena/vm/index.ts", ordinal: 2, kind: "not-yet", classification: "validated-guard", citation: "Action declaration contract", detail: "Fallback if applying a declared pass action unexpectedly yields none; current action declarations are expected to validate this." },
  { id: "arena-vm-notyet-apply-activate", file: "src/lib/arena/vm/index.ts", ordinal: 3, kind: "not-yet", classification: "validated-guard", citation: "Action declaration contract", detail: "Fallback if applying a declared activate action unexpectedly yields none; current action declarations are expected to validate this.", historicalIssues: [147] },
  { id: "arena-vm-notyet-apply-other-action", file: "src/lib/arena/vm/index.ts", ordinal: 4, kind: "not-yet", classification: "validated-guard", citation: "Action declaration contract; `DECLARED_BY` in `vm/index.ts`", detail: "Fallback for an action with no declared implementation; injected or invalid actions reach this, not a supported mechanic." },
  { id: "arena-vm-notyet-play-unmapped-zone", file: "src/lib/arena/vm/play.ts", ordinal: 1, kind: "not-yet", classification: "validated-guard", citation: "3-5-3; 0-2-4", detail: "A readable program that tries to play a card type with no playable area (the source names an ordinary Leader) is refused; this is an invalid-program guard, not a legal placement gap. Z-Leader onto Leader is implemented.", historicalIssues: [146] },
  { id: "arena-vm-notyet-price-if", file: "src/lib/arena/vm/costs.ts", ordinal: 1, kind: "not-yet", classification: "declaration-extension", citation: "Price declaration contract; `costs.rules`", detail: "A price with its own IF condition is not interpreted by this planner; current declarations are expected to exclude it.", historicalIssues: [142] },
  { id: "arena-vm-notyet-price-do-op", file: "src/lib/arena/vm/costs.ts", ordinal: 2, kind: "not-yet", classification: "declaration-extension", citation: "Price declaration contract; `costs.rules`", detail: "A price DO operation outside the planner's explicit paying-op set is not interpreted; current declarations are expected to validate against the set.", historicalIssues: [142] },
  { id: "arena-vm-notyet-cost-unbound-cards", file: "src/lib/arena/vm/costs.ts", ordinal: 3, kind: "not-yet", classification: "validated-guard", citation: "5-4; 20-19", detail: "A price's card pool requires caller-bound payers; activation binds `payWith` and declared price readers pass those values. The refusal guards callers that omit required input.", historicalIssues: [149] },
  { id: "arena-vm-notyet-cost-unbound-pooled-amount", file: "src/lib/arena/vm/costs.ts", ordinal: 4, kind: "not-yet", classification: "validated-guard", citation: "22-27; 20-5", detail: "A pooled price with line-sourced amount requires a caller binding; activation binds Burst and the appropriate Z-Energy pool. The refusal guards callers that omit required input.", historicalIssues: [148] },
  { id: "arena-vm-notyet-cost-unbound-marker-pool", file: "src/lib/arena/vm/costs.ts", ordinal: 5, kind: "not-yet", classification: "validated-guard", citation: "22-43", detail: "A price sourced from a marker pool requires a line binding; activation binds Spirit Boost, including zero when the line has no such tag. The refusal guards callers that omit required input.", historicalIssues: [157] },
  { id: "arena-vm-notyet-cost-unbound-markers", file: "src/lib/arena/vm/costs.ts", ordinal: 6, kind: "not-yet", classification: "validated-guard", citation: "13-4; `vm/activate.ts` `boundFor`", detail: "A record-sourced marker amount requires caller binding; activation binds the skill's marker cost, including zero. The refusal guards callers that omit required input.", historicalIssues: [149] },
  { id: "arena-vm-notyet-cost-unbound-life", file: "src/lib/arena/vm/costs.ts", ordinal: 7, kind: "not-yet", classification: "validated-guard", citation: "21-3; price declaration contract", detail: "A record-sourced life amount requires caller binding; no supported caller may be inferred from this defensive branch alone. Treat this as untested caller reachability, not a proven legal mechanic gap.", historicalIssues: [149] },
  { id: "arena-vm-notyet-cost-unknown-consumes", file: "src/lib/arena/vm/costs.ts", ordinal: 8, kind: "not-yet", classification: "validated-guard", citation: "CostConsumes discriminated union / ruleset validation", detail: "Exhaustive-switch fallback for a malformed or future CostConsumes value; not a mechanic gap." },
  { id: "arena-vm-notyet-alt-pay-variant", file: "src/lib/arena/vm/costs.ts", ordinal: 9, kind: "not-yet", classification: "validated-guard", citation: "Alternative payment declaration contract; `vm/battle.ts` handles `program` separately", detail: "Fallback for an alternative-pay variant not handled by the legacy path; current reachable Counter `program` payments are handled separately.", historicalIssues: [150] },
  { id: "arena-vm-note-unread-auto", file: "src/lib/arena/vm/flow.ts", ordinal: 1, kind: "interruption", classification: "validated-guard", citation: "Rule text ingestion / interruption outcome contract", detail: "A due unread Auto interrupts explicitly; this guard does not implement its unread mechanic.", historicalIssues: [544], sourceNeedle: "No readable rule program was produced." },
  { id: "arena-vm-static-own-prohibition-unread", file: "src/lib/arena/vm/effects.ts", ordinal: 1, kind: "silent-exit", classification: "current-runtime-unsupported", citation: "9-1-5; `DEFERRED_STATICS`", detail: "An unread Permanent is omitted from own-prohibition evaluation; this is the deferred static-reading boundary.", ownerIssue: 553, sourceNeedle: "if (!program || program.unsupported.length) continue;" },
  { id: "arena-vm-static-unread", file: "src/lib/arena/vm/effects.ts", ordinal: 2, kind: "silent-exit", classification: "current-runtime-unsupported", citation: "20-1; `DEFERRED_STATICS`", detail: "An unread Permanent is omitted from static evaluation.", ownerIssue: 553, sourceNeedle: "program.unsupported.length || (only && !only(program.ops))" },
  { id: "arena-vm-static-view-unread", file: "src/lib/arena/vm/program.ts", ordinal: 1, kind: "silent-exit", classification: "current-runtime-unsupported", citation: "20-1; `DEFERRED_STATICS`", detail: "The view helper returns no static effects for an unread Permanent.", ownerIssue: 553, sourceNeedle: "if (!program || program.unsupported.length) return [];" },
  { id: "arena-vm-skill-view-referee", file: "src/lib/arena/vm/view.ts", ordinal: 1, kind: "silent-exit", classification: "referee-boundary", citation: "Rule text ingestion / referee outcome contract", detail: "An unread skill is surfaced as requiring a referee; this display flag does not itself implement its mechanic.", ownerIssue: 544, sourceNeedle: "if (sc.unsupported.length) referee = true;" },
] as const;

/** Semantic AST identities: function, switch case, and enclosing guard chain. */
export const VM_NOT_YET_AST_SIGNATURES: Readonly<Record<string, string>> = {
  "arena-vm-notyet-hand-return-subject-info": 'pendAutos|-|match.trigger === "yourCardReturnedToHand" || match.trigger === "yourUnisonLeft" > first?.op === "if" && first.cond.kind === "count" && first.cond.sel.special === "subject" && first.cond.sel.filter > !subjectInfo',
  "arena-vm-notyet-combo-entry-origin": 'pendAutos|-|wanted > origin === undefined',
  "arena-vm-notyet-combo-origin-save": "pendAutos|-|comboBattleEndFromHand(sk) > origin === undefined",
  "arena-vm-notyet-cleanup-projected-choice": "<top-level>|-|game.id === \"dbs\" && end > end.stage === \"checkpoint\" > replacementChoices(ctx, game, state, id, undefined, { requestedTo: \"drop\", comboCleanup: true }).length",
  "arena-vm-notyet-cleanup-old-reentry": '<top-level>|-|game.id === "dbs" && end > end.stage === "cleanup"',
  "arena-vm-notyet-cleanup-final-reentry": '<top-level>|-|game.id === "dbs" && end > end.stage === "battleEndCheckpoint"',
  "arena-vm-notyet-cleanup-projected-replacement": '<top-level>|-|game.id === "dbs" && end > end.stage === "checkpoint" > route.stays || route.to !== "drop"',
  "arena-vm-notyet-cleanup-projection-refused": '<top-level>|-|game.id === "dbs" && end > end.stage === "checkpoint" > !placed.ok || placed.move.to !== "drop"',
  "arena-vm-notyet-auto-face-area": "automaticPriceHost|-|op?.op === \"faceUp\" && ref === op.target > found.some((id) => state.cards[id] && host.areaOf(id) !== \"life\")",
  "arena-vm-notyet-auto-face-choice": "readableAutomaticPrice|-|op.op === \"faceUp\" > !verifiedFaceTurn(op, steps[index - 1])",
  "arena-vm-notyet-auto-search-budget": "canFinishAutomaticPrice|-|--budget < 0",
  "arena-vm-notyet-auto-conditional-empty": 'readableAutomaticPrice|-|op.op === "if" > !paid && (!op.else?.length || !pays(op.then) || !pays(op.else))',
  "arena-vm-notyet-auto-modal-empty": 'readableAutomaticPrice|-|op.op === "chooseMode" > !op.modes.length || op.modes.some((mode) => !pays(mode.ops))',
  "arena-vm-notyet-auto-price-op": "readableAutomaticPrice|-|![\"choose\", \"discard\", \"mill\", \"switchMode\", \"hidden\", \"moveTo\", \"removeMarker\"].includes(op.op)\n        || (op.op === \"moveTo\" && op.to === \"play\")",
  "arena-vm-notyet-auto-unread-cost": "prepareAutomaticCost|-|bound.unreadable",
  "arena-vm-notyet-auto-x-bounds": "prepareAutomaticCost|-|!Number.isInteger(min) || min < 0 || (declaredMax !== undefined && (!Number.isInteger(declaredMax) || declaredMax < min))",
  "arena-vm-notyet-auto-pooled-instruction": "chargeAutomaticPayment|-|op?.op !== \"moveTo\"",
  "arena-vm-notyet-keyword-fusion-material-price": "readable|-|isFusion(line) && !materialIndependent(ops)",
  "arena-vm-notyet-activation-tax-keyword-auto": 'checkpoint|-|skill?.kind === "keyword" && activationTaxes(ctx, game, state, next.master, next.card, skill.kind).length',
  "arena-vm-notyet-activation-tax-hook": 'stepProgram|-|frame.pendingHookSkill && taxesOn(ctx, game, state, "activateSkill", { player: frame.master, card: frame.card }).length',
  "arena-vm-notyet-activation-tax-counter-alt": 'applyCounter|-|taxGate && alt?.pay === "program"',
  "arena-vm-notyet-counter-alt-beside-action": "programAltBesideAction|-|-",
  "arena-vm-notyet-activation-tax-keyword": "applyDeclared|-|line?.keyword && gate",
  "arena-vm-notyet-granted-hook-identity": "stepProgram|-|frame.pendingHookIdentityMissing || (frame.pendingHookSkill && frame.skillIndex === undefined && frame.grantEffectId === undefined && frame.standingGrantId === undefined && hasActiveNegateOwnSkill(ctx, game, state, frame, frame.ops))",
  "arena-vm-notyet-concede-program": "applyInner|-|action.type === \"concede\" > def.do.length",
  "arena-vm-notyet-apply-pass": "applyInner|\"pass\"|took === \"none\"",
  "arena-vm-notyet-apply-activate": "applyInner|\"activate\"|took === \"none\"",
  "arena-vm-notyet-apply-other-action": "applyInner|default|took === \"none\"",
  "arena-vm-notyet-play-unmapped-zone": "resolvePlay|-|!to",
  "arena-vm-notyet-price-if": "chargeOf|-|def.if !== undefined",
  "arena-vm-notyet-price-do-op": "chargeOf|-|does && !PAYING_OPS.includes(does.op)",
  "arena-vm-notyet-cost-unbound-cards": "priceFor|\"cards\"|!charge.from > !bound?.payers",
  "arena-vm-notyet-cost-unbound-pooled-amount": "priceFor|\"cards\"|bind === undefined && charge.amount === null",
  "arena-vm-notyet-cost-unbound-marker-pool": "priceFor|\"markers\"|charge.from > bind === undefined",
  "arena-vm-notyet-cost-unbound-markers": "priceFor|\"markers\"|bound?.markers === undefined",
  "arena-vm-notyet-cost-unbound-life": "priceFor|\"life\"|bound?.life === undefined",
  "arena-vm-notyet-cost-unknown-consumes": "priceFor|default|-",
  "arena-vm-notyet-alt-pay-variant": "payAltCost|-|-",
};

export function capabilityForSkip(where: string): CapabilityEvidence {
  const row = NAMED_RUNTIME_GAPS.find((item) => item.skipWhere === where);
  if (!row) throw new Error(`rulesGap has no capability inventory row: ${where}`);
  return row;
}
