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
    proof: "scripts/verify/compiler.ts — AUTOCOST paid/declined; scripts/verify/auto-costs-549.ts — full action/resource costs, X, reload, stale and atomic rejection",
    detail: "Supported orb/action/X prices complete before the effect; condition-only Autos remain compulsory. The instruction whitelist and bounded search interrupt explicitly; general binding remains #550 and broader price coverage remains #549.",
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
    status: "unsupported",
    evidence: "runtime-gap",
    citation: "1-13-2; `engines.ts` damageTaken contract",
    ownerIssue: 557,
    skipWhere: "compiler: E-LIFE's life cost",
    proof: "scripts/verify/compiler.ts — E-LIFE life-cost scenario",
    detail: "The rules engine has no damage count to read for the distinction asserted by this fixture.",
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
    detail: "Both players get ordered optional choices with persisted continuation and a checkpoint before cleanup. Selected combo contributions remain through that checkpoint; Combo-to-Drop/end-of-battle Auto grouping remains separately tracked under #609.",
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
    id: "arena-keyword-original-colors",
    label: "Arrival, Aegis and unpriced Revive use original payment colors",
    status: "supported",
    evidence: "runtime-scenario",
    citation: "22-29-3; 22-30-3; 22-34-3",
    ownerIssue: 597,
    proof: "scripts/verify/original-colors-597.ts — actual keyword eligibility, payment candidates, mono/multicolor, reload, source removal, expiry and private views",
    detail: "Only declared original-color filters and coverage read the shown printed face before identity layers. Ordinary filters retain effective colors. Revive additional-price ordering remains outside this narrow proof; no exhaustive keyword-cost support is claimed.",
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
    detail: "The declared hook retains its printed skill identity and applies ordinary per-turn negation. Identity-less granted Heroic interrupts before sibling draws under #602; copied identity is not established here.",
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
  {"id": "arena-vm-notyet-aegis-action-price", "file": "src/lib/arena/vm/aegis-costs.ts", "ordinal": 1, "kind": "not-yet", "classification": "current-runtime-unsupported", "citation": "22-30-3; additional Aegis action-price boundary", "ownerIssue": 595, "detail": "Aegis with a compiled additional action price interrupts before color/resource payment; it is not resolved for free."},
  {"id": "arena-vm-notyet-aegis-pool-replacement", "file": "src/lib/arena/vm/aegis-costs.ts", "ordinal": 2, "kind": "not-yet", "classification": "declaration-extension", "citation": "22-30-3; 9-10; native pool declaration contract", "ownerIssue": 595, "detail": "A declared in-play additional payment pool needing optional or competing replacements interrupts before additional resource charges. Proof uses a synthetic battle pool; current DBS Burst/Z-Energy pools do not establish a printed-card gap."},
  { id: "arena-vm-notyet-auto-search-budget", file: "src/lib/arena/vm/auto-costs.ts", ordinal: 1, kind: "not-yet", classification: "current-runtime-unsupported", citation: "9-6-4; 5-8-2-2; Auto price declaration contract", ownerIssue: 549, detail: "Bounded search beyond 2,000 visited states interrupts explicitly; no free effect or false unaffordability claim." },
  { id: "arena-vm-notyet-auto-price-op", file: "src/lib/arena/vm/auto-costs.ts", ordinal: 2, kind: "not-yet", classification: "current-runtime-unsupported", citation: "9-6-4; 5-8-2-2; Auto price declaration contract", ownerIssue: 549, detail: "Only choose/discard/mill/switchMode/hidden/moveTo/removeMarker action prices are supported; play/under movement and other instructions interrupt before payment." },
  { id: "arena-vm-notyet-auto-unread-cost", file: "src/lib/arena/vm/auto-costs.ts", ordinal: 3, kind: "not-yet", classification: "referee-boundary", citation: "9-6-4; 5-8-2-2; Auto price declaration contract", detail: "An unread printed price interrupts before effect or payment; this ingestion boundary does not implement the unread mechanic." },
  { id: "arena-vm-notyet-auto-x-bounds", file: "src/lib/arena/vm/auto-costs.ts", ordinal: 4, kind: "not-yet", classification: "validated-guard", citation: "9-6-4; 5-8-2-2; Auto price declaration contract", detail: "Malformed negative/noninteger/inverted X bounds are refused; finite valid bounds are capped by available resources." },
  { id: "arena-vm-notyet-auto-pooled-instruction", file: "src/lib/arena/vm/auto-costs.ts", ordinal: 5, kind: "not-yet", classification: "declaration-extension", citation: "9-6-4; 5-8-2-2; Auto price declaration contract", detail: "A pooled cost declaration outside the current moveTo shape cannot be verified as a complete Auto payment." },
  { id: "arena-vm-notyet-granted-hook-identity", file: "src/lib/arena/vm/flow.ts", ordinal: 1, kind: "not-yet", classification: "current-runtime-unsupported", citation: "22-35-3; individual granted skill identity", ownerIssue: 602, detail: "A qualifying granted Heroic without individual skill identity interrupts before any hook body draws; sibling programs are discarded." },
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
  "arena-vm-notyet-aegis-action-price": "stepAegisCost|-|cost.line.script?.price?.ops?.length",
  "arena-vm-notyet-aegis-pool-replacement": "stepAegisCost|-|choices.length > 1 || choices.some((r) => r.optional)",
  "arena-vm-notyet-auto-search-budget": "canFinishAutomaticPrice|-|--budget < 0",
  "arena-vm-notyet-auto-price-op": "readableAutomaticPrice|-|![\"choose\", \"discard\", \"mill\", \"switchMode\", \"hidden\", \"moveTo\", \"removeMarker\"].includes(op.op)\n      || (op.op === \"moveTo\" && (op.to === \"under\" || op.to === \"play\"))",
  "arena-vm-notyet-auto-unread-cost": "prepareAutomaticCost|-|bound.unreadable",
  "arena-vm-notyet-auto-x-bounds": "prepareAutomaticCost|-|!Number.isInteger(min) || min < 0 || (declaredMax !== undefined && (!Number.isInteger(declaredMax) || declaredMax < min))",
  "arena-vm-notyet-auto-pooled-instruction": "chargeAutomaticPayment|-|op?.op !== \"moveTo\"",
  "arena-vm-notyet-granted-hook-identity": "stepProgram|-|frame.pendingHookIdentityMissing",
  "arena-vm-notyet-concede-program": "apply|-|action.type === \"concede\" > def.do.length",
  "arena-vm-notyet-apply-pass": "apply|\"pass\"|took === \"none\"",
  "arena-vm-notyet-apply-activate": "apply|\"activate\"|took === \"none\"",
  "arena-vm-notyet-apply-other-action": "apply|default|took === \"none\"",
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
