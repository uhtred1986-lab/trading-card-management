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
    label: "Unread skill handed to a referee",
    status: "unsupported",
    evidence: "runtime-gap",
    citation: "Rule text ingestion and resolution boundary (`src/lib/arena/vm/flow.ts`)",
    ownerIssue: 544,
    skipWhere: "compiler: an unread skill put to the referee",
    proof: "scripts/verify/compiler.ts — unread skill scenario is named and not asserted on rules engine",
    detail: "An unread skill resolves to a note; the rules engine has no referee path for that skill.",
  },
  {
    id: "arena-auto-own-cost",
    label: "An Auto pays its own printed cost",
    status: "unsupported",
    evidence: "runtime-gap",
    citation: "9-6-4",
    ownerIssue: 549,
    skipWhere: "compiler: AUTOCOST's [Auto] price, declined and paid (9-6-4)",
    proof: "scripts/verify/compiler.ts — AUTOCOST price scenario",
    detail: "The rules engine does not charge an Auto's own price.",
  },
  {
    id: "arena-zero-power-rule-processing",
    label: "A Battle Card at zero or less power is processed",
    status: "unsupported",
    evidence: "runtime-gap",
    citation: "21-6; `contract/probe-rules-parity.json` rule-processing cause",
    ownerIssue: 548,
    delivery: { state: "pending", reference: "PR #587" },
    skipWhere: "compiler: TOUGH at 0 power (21-6)",
    proof: "scripts/verify/compiler.ts — TOUGH scenario; intentionally retained unchanged while PR #587 is pending",
    detail: "The current base leaves a Battle Card in play at zero or less power. Pending delivery is not current-base runtime evidence.",
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
    status: "unsupported",
    evidence: "runtime-gap",
    citation: "9-1-5; `DEFERRED_STATICS.negateKeyword`",
    ownerIssue: 553,
    skipWhere: "compiler: SELFMUTE negates its own [Blocker] (9-1-5)",
    proof: "scripts/verify/compiler.ts — SELFMUTE static scenario",
    detail: "The static reader does not apply `negateKeyword`.",
  },
  {
    id: "arena-static-gains-trait",
    label: "A Permanent grants a trait in all areas",
    status: "unsupported",
    evidence: "runtime-gap",
    citation: "20-1; `DEFERRED_STATICS.gains`",
    ownerIssue: 553,
    skipWhere: "compiler: BECOMES gains ≪Saiyan≫ in all areas (20-1)",
    proof: "scripts/verify/compiler.ts — BECOMES static scenario",
    detail: "The static reader does not apply the `gains` operation.",
  },
  {
    id: "arena-static-gains-name",
    label: "A Permanent grants a name",
    status: "unsupported",
    evidence: "runtime-gap",
    citation: "20-1; `DEFERRED_STATICS.gains`",
    ownerIssue: 553,
    skipWhere: "compiler: RENAMED also treated as {Planet M-2} (20-1)",
    proof: "scripts/verify/compiler.ts — RENAMED static scenario",
    detail: "The static reader does not apply the `gains` operation.",
  },
  {
    id: "arena-static-gains-colors",
    label: "A Permanent grants colors in all areas",
    status: "unsupported",
    evidence: "runtime-gap",
    citation: "20-1; `DEFERRED_STATICS.gains`",
    ownerIssue: 553,
    skipWhere: "compiler: RECOLOR's colours in all of your areas (BT2-001)",
    proof: "scripts/verify/compiler.ts — RECOLOR static scenario",
    detail: "The static reader does not apply the `gains` operation.",
  },
  {
    id: "arena-combo-card-to-z-energy",
    label: "A combo card becomes Z-Energy at battle end",
    status: "unsupported",
    evidence: "runtime-gap",
    citation: "5-4, 8-5-2; `vm/index.ts` zEnergyFromCombo action",
    ownerIssue: 551,
    skipWhere: "compiler: ZCHEAP paid with one Z-Energy made from a combo (5-4, 8-5-2)",
    proof: "scripts/verify/compiler.ts — ZCHEAP scenario",
    detail: "The rules engine does not offer the spent combo card as Z-Energy at the end of battle.",
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
    status: "unsupported",
    evidence: "runtime-gap",
    citation: "22-30-3",
    ownerIssue: 555,
    skipWhere: "readings: [Aegis red/blue] asks only for the colour still to cover (22-30-3)",
    proof: "scripts/verify/readings.ts — Aegis red/blue choice scenario",
    detail: "After its first choice, the rules engine offers every card in hand rather than only cards covering a missing color.",
  },
  {
    id: "arena-heroic-once-per-turn",
    label: "Heroic triggers only once per turn on that card",
    status: "unsupported",
    evidence: "runtime-gap",
    citation: "22-35-3",
    ownerIssue: 554,
    skipWhere: "wordings: [Heroic] pays out once a turn (22-35-3)",
    proof: "scripts/verify/wordings.ts — Heroic self-negation scenario",
    detail: "The afterSkill hook does not negate its own skill for the turn, so it can trigger more than once.",
  },
  {
    id: "arena-face-up-life-trigger",
    label: "A face-up Life card event fires its Auto",
    status: "unsupported",
    evidence: "runtime-gap",
    citation: "3-9-2-1; `vm/host.ts` setFaceUp event emission",
    ownerIssue: 556,
    skipWhere: "wordings: LIFEWATCH's [Auto] when it is flipped face up in life (3-9-2-1)",
    proof: "scripts/verify/wordings.ts — LIFEWATCH face-up trigger scenario",
    detail: "setFaceUp emits no faceUpTurned moment and the rules engine does not pend the trigger.",
  },
  {
    id: "arena-static-gains-list-attributes",
    label: "A Permanent grants list attributes",
    status: "unsupported",
    evidence: "runtime-gap",
    citation: "20-1; `DEFERRED_STATICS.gains`",
    ownerIssue: 553,
    skipWhere: "language: a [Permanent] list attribute",
    proof: "scripts/verify/language.ts — `gains` and modifyAttr list-attribute scenario",
    detail: "Neither `gains` nor modifyAttr with values is read by the static layer.",
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
    label: "AI VM suite converted to fixed expectations",
    status: "untested",
    evidence: "suite-migration",
    citation: "#459 fixed expected-state migration (test-lane status; no gameplay rule citation)",
    ownerIssue: 459,
    suite: "ai-vm",
    proof: "scripts/verify/ai-vm.ts — stateText, decklistText and stubbed request still compare to legacy",
    detail: "The language state-text fixture is a checked-in half, but the suite's engine comparison remains. This is separate from #575 runtime behavior.",
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

export const DEFERRED_STATIC_EVIDENCE = [
  { operation: "negateKeyword", capabilityIds: ["arena-static-negate-keyword"], ownerIssue: 553, citation: "9-1-5" },
  {
    operation: "gains",
    capabilityIds: ["arena-static-gains-trait", "arena-static-gains-name", "arena-static-gains-colors", "arena-static-gains-list-attributes"],
    ownerIssue: 553,
    citation: "20-1",
  },
] as const;

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
  kind: "not-yet" | "silent-exit";
  classification: "current-runtime-unsupported" | "validated-guard" | "declaration-extension" | "referee-boundary" | "menu-gate";
  citation: string;
  detail: string;
  ownerIssue?: number;
  historicalIssues?: readonly number[];
  /** For silent exits, a stable distinctive source fragment checked verbatim. */
  sourceNeedle?: string;
}

export const VM_UNSUPPORTED_SOURCE_SITES: readonly VmUnsupportedSourceSite[] = [
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
  { id: "arena-vm-note-unread-auto", file: "src/lib/arena/vm/flow.ts", ordinal: 1, kind: "silent-exit", classification: "referee-boundary", citation: "Rule text ingestion / referee outcome contract", detail: "An Auto with no readable program logs a note and resolves no effect; #544 concerns representing this interruption outcome, not implementing the mechanic.", ownerIssue: 544, sourceNeedle: "no rule this engine can read says what happens" },
  { id: "arena-vm-note-auto-action-price", file: "src/lib/arena/vm/flow.ts", ordinal: 2, kind: "silent-exit", classification: "current-runtime-unsupported", citation: "9-6-4; 4-3-3; 20-5", detail: "An Auto with its own action or X price is noted and does not resolve.", ownerIssue: 549, sourceNeedle: "charging an action price or an X price" },
  { id: "arena-vm-static-own-prohibition-unread", file: "src/lib/arena/vm/effects.ts", ordinal: 1, kind: "silent-exit", classification: "current-runtime-unsupported", citation: "9-1-5; `DEFERRED_STATICS`", detail: "An unread Permanent is omitted from own-prohibition evaluation; this is the deferred static-reading boundary.", ownerIssue: 553, sourceNeedle: "if (!program || program.unsupported.length) continue;" },
  { id: "arena-vm-static-unread", file: "src/lib/arena/vm/effects.ts", ordinal: 2, kind: "silent-exit", classification: "current-runtime-unsupported", citation: "20-1; `DEFERRED_STATICS`", detail: "An unread Permanent is omitted from static evaluation.", ownerIssue: 553, sourceNeedle: "program.unsupported.length || (only && !only(program.ops))" },
  { id: "arena-vm-static-view-unread", file: "src/lib/arena/vm/program.ts", ordinal: 1, kind: "silent-exit", classification: "current-runtime-unsupported", citation: "20-1; `DEFERRED_STATICS`", detail: "The view helper returns no static effects for an unread Permanent.", ownerIssue: 553, sourceNeedle: "if (!program || program.unsupported.length) return [];" },
  { id: "arena-vm-skill-view-referee", file: "src/lib/arena/vm/view.ts", ordinal: 1, kind: "silent-exit", classification: "referee-boundary", citation: "Rule text ingestion / referee outcome contract", detail: "An unread skill is surfaced as requiring a referee; this display flag does not itself implement its mechanic.", ownerIssue: 544, sourceNeedle: "if (sc.unsupported.length) referee = true;" },
] as const;

/** Semantic AST identities: function, switch case, and enclosing guard chain. */
export const VM_NOT_YET_AST_SIGNATURES: Readonly<Record<string, string>> = {
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
