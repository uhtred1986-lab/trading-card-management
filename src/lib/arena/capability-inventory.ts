/**
 * Narrow runtime evidence for the Arena rules engine.
 *
 * A row describes only the named behavior and fixture. It is not a claim that
 * a rule section or keyword is covered exhaustively. Delivery state is kept
 * separate from runtime state so a pending PR cannot make the base appear
 * implemented.
 */
export type RuntimeStatus = "supported" | "unsupported" | "untested";
export type EvidenceKind = "runtime-scenario" | "runtime-gap" | "declaration-only" | "suite-migration" | "legacy-only";

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
  /** Test suite when the row records an unported oracle lane, not a gameplay rule. */
  suite?: string;
  /** The exact legacyOnly callsite label, for the legacy-only saved-game lane. */
  legacyWhere?: string;
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
    proof: "scripts/verify/compiler.ts — AUTOCOST paid/declined; scripts/verify/auto-costs-549.ts — full action/resource costs, X, actual play-triggered pending selection, turn-player priority, reload, stale and atomic rejection; scripts/verify/secret-auto-549.ts and arena-secret-auto-db.mts — cost-free secret declaration/decline and persisted masking; scripts/verify/priced-secret-auto-549.ts and arena-priced-secret-auto-db.mts — priced secret declaration distinct from activation, paid/declined/unpayable outcomes, saved continuation, two-viewer masking and persisted silent decline; docs/arena-backlog/evidence/549-priced-secret — synthetic browser presentation at 390px/1440px in both skins",
    detail: "Supported orb/action/X prices complete before the effect; public-area condition-only Autos remain compulsory. Players choose among their own pending skills with turn-player priority and captured queue binding. A cost-free or priced Auto still in a secret area may be left undeclared silently. Declaring a priced Auto reveals only its source before the price decision; it activates only after full payment, and a declined or unpayable cost never fires. The transient reveal survives the exact valid saved price continuation, then movement, concealment, shuffle or a later unrelated action revokes it. Captured keyword hooks are excluded. The instruction whitelist and bounded search interrupt explicitly; general binding remains #550 and broader price coverage remains #549.",
  },
  {
    id: "arena-zero-power-rule-processing",
    label: "A Battle Card at zero or less power is processed",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "21-6; `contract/probe-rules-parity.json` rule-processing cause",
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
    proof: "scripts/verify/battle-cleanup-609.ts — synthetic generic trigger, both checkpoints, two players, order, paused JSON reload, projected Drop subject information versus live Combo selectors, source departure/negation, replacement boundary, special hand-origin Auto and actual old-main paused save; scripts/verify/z-energy-combo-551.ts, combo-entry-672.ts, rule-processing.ts, heroic-554.ts and battles.ts — existing controls; docs/arena-backlog/evidence/609/implementation-proof.md — manual and fixture boundaries",
    detail: "After the 8-5-4 checkpoint, generic same-player Combo-to-own-Drop watcher Autos are announced at 8-5-6 and resolve at 8-5-7 while their subjects remain in Combo. Subject information for the ordinary open-area movement is projected in Drop; live selectors and costs stay on the actual board. Remaining Combo cards depart at 8-5-8; battle-end and qualifying special card Autos enter pending at 8-5-9 for 8-5-10. Persisted cursors prevent duplicate occurrences and old grouped-cleanup pauses resume without replay. The generic card text is synthetic because no real repository fixture supplies it. A changed or redirected pre-announced destination interrupts under the open #609 boundary, and the existing non-Battle Extra departure fixture is preserved without claiming a new ruling.",
  },
  {
    id: "arena-counter-recursion",
    label: "A Counter opens a Counter: Counter window",
    status: "unsupported",
    evidence: "runtime-gap",
    citation: "9-7-3",
    ownerIssue: 552,
    skipWhere: "compiler: E-STOP counters E-NEGATE (9-7-3)",
    proof: "scripts/verify/compiler.ts — nested Counter scenario",
    detail: "The rules engine opens no Counter: Counter window while a Counter itself resolves.",
  },
  {
    id: "arena-counter-decline-window",
    label: "A player may decline a Counter window",
    status: "unsupported",
    evidence: "runtime-gap",
    citation: "9-7",
    ownerIssue: 552,
    skipWhere: "compiler: declining to answer a counter (9-7)",
    proof: "scripts/verify/compiler.ts — declined Counter scenario",
    detail: "The rules engine has no Counter: Counter window to decline in this case.",
  },
  {
    id: "arena-priced-choice-binds-x",
    label: "X from a chosen action-price value reaches the effect",
    status: "unsupported",
    evidence: "runtime-gap",
    citation: "20-5; action-price binding contract",
    ownerIssue: 550,
    skipWhere: "compiler: X bound by a price that chooses (20-5)",
    proof: "scripts/verify/compiler.ts — chosen-price X scenario",
    detail: "The price program's bindX does not reach the effect. This row is scoped to X binding, not all Counter or action-price support.",
  },
  {
    id: "arena-aegis-incremental-choice",
    label: "Aegis choice covers only the colors still missing",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "22-30-3",
    ownerIssue: 555,
    proof: "scripts/verify/aegis-555.ts \u2014 incremental mandatory coverage, three colors, invalid answers and reload",
    detail: "Each prompt offers only cards covering missing distinct colors; payment occurs once after complete coverage. Additional resource-cost ordering is independently tested in arena-aegis-additional-cost-order; original-color eligibility is independently tested in arena-keyword-original-colors and additional action prices remain #595.",
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
    label: "Aegis pays its hand colors before its supported additional resource cost",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "22-30-3; 5-8-4",
    ownerIssue: 595,
    proof: "scripts/verify/aegis-cost-order-595.ts — live hand-dependent fee, native Burst, reload, failed payment and actual scoped payer consumption; scripts/verify/aegis-555.ts — priced event order",
    detail: "Hand cost moves precede live fee calculation/payment and activation. Later failure retains performed payments without an effect or activation use. Additional action prices remain explicitly unsupported under #595; original-color eligibility is independently tested in arena-keyword-original-colors.",
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
    detail: "The printed branch selects an eligible hand Extra by its current energy cost and invokes its actual Activate: Main line with its original energy and skill costs waived, then resumes the invoking effect. A live reduction can make a printed-cost-2 Extra eligible with one energy. Conditions, once limits and prohibitions still apply. External activateSkill taxes remain unsupported under #677; this row does not claim their payment.",
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
    label: "A normal or invoked Activate skill charges applicable external taxes",
    status: "unsupported",
    evidence: "runtime-gap",
    citation: "20-14; 12-2-4 original-cost waiver boundary",
    ownerIssue: 677,
    proof: "scripts/verify/duration-shuffle-574.ts — active compiled discard tax is recognised by both engines' taxesOn readers, yet both normal and invoked activation omit its extra hand-to-Drop payment",
    detail: "The test records the current omission as an explicit failing-rule boundary, not a legal free activation. #677 owns normal and invoked external-tax payment, including interactions with the original-cost waiver.",
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
    status: "untested",
    evidence: "suite-migration",
    citation: "#459 fixed expected-state migration (test-lane status; no gameplay rule citation)",
    ownerIssue: 459,
    suite: "vm",
    proof: "scripts/verify/vm.ts — comparisons still run against legacy rather than checked-in expectations",
    detail: "About 130 legacy calls across 4,900 lines remain call-for-call comparisons. This is an independent test-migration gate, not a runtime mechanic gap.",
  },
  {
    id: "arena-ai-vm-fixed-expectations",
    label: "AI presentation and requests have fixed rules-engine expectations",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "#459 fixed expected-state migration (test-lane status; no gameplay rule citation)",
    ownerIssue: 601,
    proof: "scripts/verify/ai-vm.ts; scripts/verify/fixtures/ai-vm \u2014 21 migrated parity checks, two extra Leader facts and negative fixture controls",
    detail: "The rules-only lane pins zones, both-viewer text, decklists, question, system and legal moves without invoking the legacy engine. Larger VM oracle migration remains #459.",
  },
  {
    id: "arena-legacy-saved-game",
    label: "Saved legacy game opens unchanged on the rules-only lane",
    status: "untested",
    evidence: "legacy-only",
    citation: "#118 save/replay decision (test-lane status; no gameplay rule citation)",
    ownerIssue: 118,
    legacyWhere: "engine-default: a saved legacy game opens unchanged",
    proof: "scripts/verify/engine-default.ts — deliberately runs a saved/played game through the legacy engine",
    detail: "This legacy-only fixture is not asserted by `--rules-only`; it is an independent save/replay retirement gate, not a rules mechanic.",
  },
] as const;

export const NAMED_RUNTIME_GAPS = CAPABILITY_EVIDENCE.filter((row) => row.skipWhere !== undefined);

export const DEFERRED_STATIC_EVIDENCE: readonly { operation: string; capabilityIds: readonly string[]; ownerIssue: number; citation: string }[] = [];

/** Test-lane evidence not yet converted to fixed expectations under #459. */
export const ORACLE_MIGRATION_GAPS = CAPABILITY_EVIDENCE.filter((row) => row.evidence === "suite-migration");

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
  { id: "arena-vm-notyet-combo-entry-origin", file: "src/lib/arena/vm/triggers.ts", ordinal: 1, kind: "not-yet", classification: "validated-guard", citation: "5-7-5-3/5-7-6-3; printed hand-qualified entry source", historicalIssues: [672], detail: "A hand-qualified entry Auto with missing captured origin interrupts before effect resolution. Genuine combo actions capture the actual source before this checkpoint; hand origin is never guessed." },
  { id: "arena-vm-notyet-combo-origin-save", file: "src/lib/arena/vm/triggers.ts", ordinal: 2, kind: "not-yet", classification: "validated-guard", citation: "8-5; persisted combo-origin contract", historicalIssues: [572], detail: "An older saved battle missing origin for a due hand-qualified combo-end Auto interrupts before resolution. Current battles capture actual origins; no legacy save provenance is invented." },
  { id: "arena-vm-notyet-cleanup-old-reentry", file: "src/lib/arena/vm/battle.ts", ordinal: 1, kind: "not-yet", classification: "validated-guard", citation: "8-5; pre-#609 saved grouped-cleanup continuation", ownerIssue: 609, detail: "A malformed old save that calls native cleanup again at its already-performed `cleanup` stage interrupts instead of replaying departed cards or pending battle-end Autos. Actual old-main paused choices resume through the stored runner frame." },
  { id: "arena-vm-notyet-cleanup-final-reentry", file: "src/lib/arena/vm/battle.ts", ordinal: 2, kind: "not-yet", classification: "validated-guard", citation: "8-5-10; persisted battle-end checkpoint continuation", ownerIssue: 609, detail: "A malformed saved frame that re-enters completed native battle-end work interrupts instead of announcing the 8-5-9 group a second time; normal pauses resume through the checkpoint runner." },
  { id: "arena-vm-notyet-cleanup-projected-replacement", file: "src/lib/arena/vm/battle.ts", ordinal: 3, kind: "not-yet", classification: "current-runtime-unsupported", citation: "8-5-6/7; 9-6-9-1-3; 9-10", ownerIssue: 609, detail: "If a replacement keeps a pre-announced generic Combo-to-Drop subject in Combo or redirects it elsewhere, the projected new-area information is unresolved and the game interrupts. The ordinary same-player Drop path and replacements without a qualifying generic watcher remain supported." },
  { id: "arena-vm-notyet-cleanup-projection-refused", file: "src/lib/arena/vm/battle.ts", ordinal: 4, kind: "not-yet", classification: "validated-guard", citation: "8-5-6; projected movement subject invariant", ownerIssue: 609, detail: "If a predicted Drop move cannot be represented on the cloned board after a Drop route was selected, the VM refuses to invent subject information. No current valid fixture reaches this invariant guard." },
  { id: "arena-vm-notyet-cleanup-changed-destination", file: "src/lib/arena/vm/battle.ts", ordinal: 5, kind: "not-yet", classification: "current-runtime-unsupported", citation: "8-5-6..8-5-8; 9-6-9-1-3; 9-10", ownerIssue: 609, detail: "If 8-5-7 work changes the eventual destination of a subject whose generic Drop occurrence was already announced, the VM interrupts at physical departure instead of silently assigning that Auto a guessed destination. A card moved out of Combo before 8-5-8 is not swept a second time." },
  {"id": "arena-vm-notyet-aegis-action-price", "file": "src/lib/arena/vm/aegis-costs.ts", "ordinal": 1, "kind": "not-yet", "classification": "current-runtime-unsupported", "citation": "22-30-3; additional Aegis action-price boundary", "ownerIssue": 595, "detail": "Aegis with a compiled additional action price interrupts before color/resource payment; it is not resolved for free."},
  {"id": "arena-vm-notyet-aegis-pool-replacement", "file": "src/lib/arena/vm/aegis-costs.ts", "ordinal": 2, "kind": "not-yet", "classification": "declaration-extension", "citation": "22-30-3; 9-10; native pool declaration contract", "ownerIssue": 595, "detail": "A declared in-play additional payment pool needing optional or competing replacements interrupts before additional resource charges. Proof uses a synthetic battle pool; current DBS Burst/Z-Energy pools do not establish a printed-card gap."},
  { id: "arena-vm-notyet-auto-search-budget", file: "src/lib/arena/vm/auto-costs.ts", ordinal: 1, kind: "not-yet", classification: "current-runtime-unsupported", citation: "9-6-4; 5-8-2-2; Auto price declaration contract", ownerIssue: 549, detail: "Bounded search beyond 2,000 visited states interrupts explicitly; no free effect or false unaffordability claim." },
  { id: "arena-vm-notyet-auto-price-op", file: "src/lib/arena/vm/auto-costs.ts", ordinal: 2, kind: "not-yet", classification: "current-runtime-unsupported", citation: "9-6-4; 5-8-2-2; Auto price declaration contract", ownerIssue: 549, detail: "Only choose/discard/mill/switchMode/hidden/moveTo/removeMarker action prices are supported; play/under movement and other instructions interrupt before payment." },
  { id: "arena-vm-notyet-auto-unread-cost", file: "src/lib/arena/vm/auto-costs.ts", ordinal: 3, kind: "not-yet", classification: "referee-boundary", citation: "9-6-4; 5-8-2-2; Auto price declaration contract", detail: "An unread printed price interrupts before effect or payment; this ingestion boundary does not implement the unread mechanic." },
  { id: "arena-vm-notyet-auto-x-bounds", file: "src/lib/arena/vm/auto-costs.ts", ordinal: 4, kind: "not-yet", classification: "validated-guard", citation: "9-6-4; 5-8-2-2; Auto price declaration contract", detail: "Malformed negative/noninteger/inverted X bounds are refused; finite valid bounds are capped by available resources." },
  { id: "arena-vm-notyet-auto-pooled-instruction", file: "src/lib/arena/vm/auto-costs.ts", ordinal: 5, kind: "not-yet", classification: "declaration-extension", citation: "9-6-4; 5-8-2-2; Auto price declaration contract", detail: "A pooled cost declaration outside the current moveTo shape cannot be verified as a complete Auto payment." },
  { id: "arena-vm-notyet-granted-hook-identity", file: "src/lib/arena/vm/flow.ts", ordinal: 1, kind: "not-yet", classification: "validated-guard", citation: "22-35-3; persisted hook identity contract", historicalIssues: [602], detail: "A legacy or unrecognized qualifying hook with no individual identity interrupts before any draw. Current timed and Permanent grants carry individual provenance; this guard does not claim legacy saved-hook migration." },
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
  "arena-vm-notyet-combo-entry-origin": 'pendAutos|-|match.trigger === "comboUsed" && comboEntryFromHand(sk) > origin === undefined',
  "arena-vm-notyet-combo-origin-save": "pendAutos|-|comboBattleEndFromHand(sk) > origin === undefined",
  "arena-vm-notyet-cleanup-old-reentry": '<top-level>|-|game.id === "dbs" && end > end.stage === "cleanup"',
  "arena-vm-notyet-cleanup-final-reentry": '<top-level>|-|game.id === "dbs" && end > end.stage === "battleEndCheckpoint"',
  "arena-vm-notyet-cleanup-projected-replacement": '<top-level>|-|game.id === "dbs" && end > end.stage === "checkpoint" > route.stays || route.to !== "drop"',
  "arena-vm-notyet-cleanup-projection-refused": '<top-level>|-|game.id === "dbs" && end > end.stage === "checkpoint" > !placed.ok || placed.move.to !== "drop"',
  "arena-vm-notyet-cleanup-changed-destination": '<top-level>|-|game.id === "dbs" && end > end.stage === "departures" > holder > after?.zone !== "drop" && end.preDropTriggeredSubjects?.includes(id)',
  "arena-vm-notyet-aegis-action-price": "stepAegisCost|-|cost.line.script?.price?.ops?.length",
  "arena-vm-notyet-aegis-pool-replacement": "stepAegisCost|-|choices.length > 1 || choices.some((r) => r.optional)",
  "arena-vm-notyet-auto-search-budget": "canFinishAutomaticPrice|-|--budget < 0",
  "arena-vm-notyet-auto-price-op": "readableAutomaticPrice|-|![\"choose\", \"discard\", \"mill\", \"switchMode\", \"hidden\", \"moveTo\", \"removeMarker\"].includes(op.op)\n      || (op.op === \"moveTo\" && (op.to === \"under\" || op.to === \"play\"))",
  "arena-vm-notyet-auto-unread-cost": "prepareAutomaticCost|-|bound.unreadable",
  "arena-vm-notyet-auto-x-bounds": "prepareAutomaticCost|-|!Number.isInteger(min) || min < 0 || (declaredMax !== undefined && (!Number.isInteger(declaredMax) || declaredMax < min))",
  "arena-vm-notyet-auto-pooled-instruction": "chargeAutomaticPayment|-|op?.op !== \"moveTo\"",
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

export function capabilityForLegacySkip(where: string): CapabilityEvidence {
  const row = CAPABILITY_EVIDENCE.find((item) => item.legacyWhere === where);
  if (!row) throw new Error(`legacyOnly has no capability inventory row: ${where}`);
  return row;
}
