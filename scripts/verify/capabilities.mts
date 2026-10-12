import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { CAPABILITY_EVIDENCE, DEFERRED_STATIC_EVIDENCE, NAMED_RUNTIME_GAPS, ORACLE_MIGRATION_GAPS, VM_NOT_YET_AST_SIGNATURES, VM_UNSUPPORTED_SOURCE_SITES, type VmUnsupportedSourceSite } from "../../src/lib/arena/capability-inventory";
import { KEYWORDS } from "../../src/lib/arena/glossary";
import { HOOK_POINTS } from "../../src/lib/arena/rulesets/hooks";
import { FILES } from "../../src/lib/arena/rulesets/dbs/files";
import { OP_CLASS } from "../../src/lib/arena/vm/script-schema";
import { DEFERRED_STATICS } from "../../src/lib/arena/vm/effects";

const root = process.cwd();
const output = resolve(root, "docs/arena-capability-inventory.md");
const checkOnly = process.argv.includes("--check");
const sourceSiteByAddress = (file: string, kind: VmUnsupportedSourceSite["kind"], ordinal: number): VmUnsupportedSourceSite => {
  const row = VM_UNSUPPORTED_SOURCE_SITES.find((site) => site.file === file && site.kind === kind && site.ordinal === ordinal);
  if (!row) throw new Error(`unknown VM source site: ${file} ${kind} #${ordinal}`);
  return row;
};
const sourceIds = VM_UNSUPPORTED_SOURCE_SITES.map((row) => row.id);
assert.equal(new Set(sourceIds).size, sourceIds.length, "VM source-site IDs must be unique");
assert.ok(VM_UNSUPPORTED_SOURCE_SITES.every((row) => row.id.startsWith("arena-vm-") && row.citation.trim() && row.detail.trim()), "VM source sites require stable IDs, citations, and explanations");
assert.ok(VM_UNSUPPORTED_SOURCE_SITES.filter((row) => row.classification === "current-runtime-unsupported").every((row) => row.ownerIssue), "runtime unsupported sites need a precise live owner");
assert.deepEqual(Object.keys(VM_NOT_YET_AST_SIGNATURES).sort(), VM_UNSUPPORTED_SOURCE_SITES.filter((row) => row.kind === "not-yet").map((row) => row.id).sort(), "every NotYet record needs one semantic AST identity");
assert.throws(() => sourceSiteByAddress("src/lib/arena/vm/unknown.ts", "not-yet", 1), /unknown VM source site/, "the source-site resolver must reject unknown source sites");

const vmFiles = (dir: string): string[] => readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap((entry) => {
  const relative = `${dir}/${entry.name}`;
  return entry.isDirectory() ? vmFiles(relative) : entry.isFile() && entry.name.endsWith(".ts") ? [relative] : [];
});
const actualNotYetSites: string[] = [];
for (const file of vmFiles("src/lib/arena/vm")) {
  const text = readFileSync(resolve(root, file), "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const hits: string[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "NotYet") {
      let parent = node.parent;
      let functionName = "<top-level>";
      let caseName = "-";
      const guards: string[] = [];
      while (parent) {
        if (ts.isIfStatement(parent)) guards.unshift(parent.expression.getText(source));
        if (ts.isCaseClause(parent)) caseName = parent.expression.getText(source);
        if (ts.isDefaultClause(parent)) caseName = "default";
        if (ts.isFunctionDeclaration(parent)) {
          functionName = parent.name?.getText(source) ?? "<anonymous>";
          break;
        }
        parent = parent.parent;
      }
      hits.push(`${functionName}|${caseName}|${guards.join(" > ") || "-"}`);
    }
    ts.forEachChild(node, walk);
  };
  walk(source);
  for (let ordinal = 1; ordinal <= hits.length; ordinal++) actualNotYetSites.push(`${file}#${ordinal}=${hits[ordinal - 1]}`);
  for (let ordinal = 1; ordinal <= hits.length; ordinal++) sourceSiteByAddress(file, "not-yet", ordinal);
}
const expectedNotYetSites = VM_UNSUPPORTED_SOURCE_SITES.filter((row) => row.kind === "not-yet").map((row) => `${row.file}#${row.ordinal}=${VM_NOT_YET_AST_SIGNATURES[row.id]}`).sort();
const assertNotYetSiteIdentity = (actual: readonly string[]): void => assert.deepEqual(
  expectedNotYetSites,
  [...actual].sort(),
  "every actual NotYet expression must match its stable ID's semantic function/case/guard signature; same-count replacements must fail",
);
assertNotYetSiteIdentity(actualNotYetSites);
assert.throws(
  () => assertNotYetSiteIdentity(actualNotYetSites.map((site, index) => index === 0 ? site.replace(/\|[^|]+$/, "|different-guard") : site)),
  /same-count replacements must fail/,
  "a same-count NotYet guard replacement must be rejected",
);
for (const row of VM_UNSUPPORTED_SOURCE_SITES.filter((site) => site.kind === "silent-exit")) {
  const source = readFileSync(resolve(root, row.file), "utf8");
  assert.ok(row.sourceNeedle && source.includes(row.sourceNeedle), `silent-exit source site drifted: ${row.id}`);
  assert.equal(source.indexOf(row.sourceNeedle), source.lastIndexOf(row.sourceNeedle), `silent-exit source needle must be unique: ${row.id}`);
}
const ids = CAPABILITY_EVIDENCE.map((row) => row.id);
assert.equal(new Set(ids).size, ids.length, "capability IDs must be unique");
assert.ok(CAPABILITY_EVIDENCE.every((row) => row.id.startsWith("arena-")), "capability IDs must use the stable arena- prefix");
assert.ok(CAPABILITY_EVIDENCE.every((row) => row.citation.trim() && row.proof.trim()), "every capability row needs a citation and evidence source");
assert.ok(CAPABILITY_EVIDENCE.filter((row) => row.status === "unsupported").every((row) => row.ownerIssue), "every unsupported behavior needs an owner issue");
assert.ok(CAPABILITY_EVIDENCE.filter((row) => row.evidence === "runtime-gap").every((row) => row.status === "unsupported"), "runtime gaps must remain visibly unsupported");
assert.ok(CAPABILITY_EVIDENCE.filter((row) => row.delivery?.state === "pending").every((row) => row.status !== "supported"), "pending delivery cannot mark the base runtime supported");

const gapSources = ["scripts/verify/compiler.ts", "scripts/verify/readings.ts", "scripts/verify/wordings.ts", "scripts/verify/language.ts"];
const callsites = gapSources.map((path) => readFileSync(resolve(root, path), "utf8")).join("\n");
for (const row of NAMED_RUNTIME_GAPS) assert.ok(callsites.includes(JSON.stringify(row.skipWhere)), `named gap callsite drifted or disappeared: ${row.id}`);
const discoveredGapLabels = [...callsites.matchAll(/rulesGap\("([^"\n]+)"/g)].map((match) => match[1]);
assert.deepEqual([...discoveredGapLabels].sort(), NAMED_RUNTIME_GAPS.map((row) => row.skipWhere!).sort(), "every rulesGap callsite must have exactly one structured inventory record");
const engineDefaultSource = readFileSync(resolve(root, "scripts/verify/engine-default.ts"), "utf8");
const legacyGap = CAPABILITY_EVIDENCE.filter((row) => row.legacyWhere !== undefined);
const legacyLabels = [...engineDefaultSource.matchAll(/legacyOnly\("([^"\n]+)"/g)].map((match) => match[1]);
assert.deepEqual(legacyLabels.sort(), legacyGap.map((row) => row.legacyWhere!).sort(), "legacyOnly callsites must have stable inventory rows");

const deferredKeys = Object.keys(DEFERRED_STATICS).sort();
assert.deepEqual(DEFERRED_STATIC_EVIDENCE.map((row) => row.operation).sort(), deferredKeys, "every deferred static must have current inventory metadata");
for (const row of DEFERRED_STATIC_EVIDENCE) {
  assert.ok(row.capabilityIds.every((id) => ids.includes(id)), `${row.operation} references unknown capability ID`);
  assert.ok(row.ownerIssue > 0 && row.citation, `${row.operation} needs a live owner and rule citation`);
}
for (const keyword of Object.values(KEYWORDS)) {
  if (keyword.runtimeEvidence) {
    assert.ok(keyword.runtimeEvidence.capabilityIds.every((id) => ids.includes(id)), `${keyword.tag} references unknown capability ID`);
    assert.ok(keyword.runtimeEvidence.capabilityIds.every((id) => CAPABILITY_EVIDENCE.find((row) => row.id === id)?.status === keyword.runtimeEvidence?.status), `${keyword.tag} status disagrees with inventory`);
  }
}

const opsSource = FILES["ops.rules"];
assert.ok(opsSource.includes("`mill` stays a native op"), "ops.rules must keep the native mill rationale");
const macroOps = Object.entries(OP_CLASS).filter(([, category]) => category !== "primitive").map(([op]) => op);
const declaredOps = [...opsSource.matchAll(/^DEFINE OP ([A-Za-z][A-Za-z0-9]*)$/gm)].map((match) => match[1]);
assert.deepEqual(macroOps.filter((op) => !declaredOps.includes(op)), ["mill"], "mill must remain the sole macro exception");
assert.equal((opsSource.match(/^DEFINE OP /gm) ?? []).length, macroOps.length - 1, "the ruleset macro declarations changed; review the mill note");
assert.equal(HOOK_POINTS.length, 17, "hook contract count changed; update the contract/runtime distinction");
assert.ok(readFileSync(resolve(root, "docs/arena-delivery-plan.md"), "utf8").includes("#170 / #135 / #137 | Repair checklist and close stale #170"), "historical #170 reconciliation evidence moved; review the inventory note");
const arenaRunner = readFileSync(resolve(root, "scripts/verify-arena.ts"), "utf8");
const oracleBlockStart = arenaRunner.indexOf("const STILL_ON_THE_ORACLE");
assert.ok(oracleBlockStart >= 0, "the oracle-suite registry is missing");
const oracleBlock = arenaRunner.slice(oracleBlockStart, arenaRunner.indexOf("};", oracleBlockStart));
const oracleSuites = [...oracleBlock.matchAll(/^\s*(?:"([^"]+)"|([A-Za-z][\w-]*)):\s*/gm)].map((match) => match[1] ?? match[2]);
assert.deepEqual(oracleSuites.sort(), ORACLE_MIGRATION_GAPS.map((row) => row.suite!).sort(), "oracle suite inventory drifted from verify-arena.ts");

const statusLabel = { supported: "Supported", unsupported: "Unsupported", untested: "Untested" } as const;
const sourceSites = VM_UNSUPPORTED_SOURCE_SITES.map((row) => {
  const owner = row.ownerIssue ? `[#${row.ownerIssue}](https://github.com/uhtred1986-lab/trading-card-management/issues/${row.ownerIssue})` : "—";
  const history = row.historicalIssues?.length ? `; historical ${row.historicalIssues.map((id) => `#${id}`).join(", ")}` : "";
  const state = row.classification === "current-runtime-unsupported" ? "Unsupported" : "Untested / guard";
  return `| \`${row.id}\` | ${state} | \`${row.file}\` (${row.kind} #${row.ordinal}) | ${row.citation} | ${owner}${history} | ${row.detail} |`;
}).join("\n");
const unownedSites = VM_UNSUPPORTED_SOURCE_SITES.filter((row) => row.classification === "current-runtime-unsupported" && !row.ownerIssue);
const rows = CAPABILITY_EVIDENCE.map((row) => {
  const owner = row.ownerIssue ? `[#${row.ownerIssue}](https://github.com/uhtred1986-lab/trading-card-management/issues/${row.ownerIssue})` : "—";
  const delivery = row.delivery ? `; pending ${row.delivery.reference}` : "";
  return `| \`${row.id}\` | ${statusLabel[row.status]} | ${row.label} | ${row.citation} | ${owner}${delivery} | ${row.proof} |`;
}).join("\n");
const deferred = DEFERRED_STATIC_EVIDENCE.map((row) => `| \`${row.operation}\` | ${row.capabilityIds.map((id) => `\`${id}\``).join(", ")} | #${row.ownerIssue} | ${row.citation} |`).join("\n");
const oracle = ORACLE_MIGRATION_GAPS.map((row) => `| \`${row.id}\` | ${row.suite} | ${statusLabel[row.status]} | [#${row.ownerIssue}](https://github.com/uhtred1986-lab/trading-card-management/issues/${row.ownerIssue}) | ${row.detail} |`).join("\n");
const generated = `# Arena capability and test-gap inventory\n\nGenerated by \`scripts/verify/capabilities.mts\` from structured metadata and checked against current verifier callsites and VM source sites.\n\nA status applies only to the named behavior and proof below. **Supported** means that exact runtime scenario has a positive assertion; it does not imply exhaustive rules coverage. **Unsupported** means the named scenario is deliberately not asserted on the rules engine. **Untested** means there is no runtime assertion in the cited lane. For the #459 and #118 test-lane rows, untested describes that test lane, not the gameplay mechanics. Declaration checks, hook contracts, and corpus counts are not runtime proof. This inventory uses only local source and test fixtures; it does not query the card database.\n\n## Capability and evidence matrix\n\n| Stable ID | Runtime status | Narrow behavior / test lane | Rule/source citation | Owner / delivery | Evidence in this tree |\n|---|---|---|---|---|---|\n${rows}\n\n## VM unsupported and guarded source sites\n\nThe verifier parses every VM TypeScript file, checks exact coverage of every \`new NotYet(...)\` expression, and matches each callsite to a stable ID by its enclosing function, case, and guard chain. A same-count replacement under another guard fails the check. The second group records known deliberate note/no-op exits by a unique source fragment. “Unsupported” means the code can refuse or omit the named behavior; “Untested / guard” means an extension or invalid-input guard with no claim that a current legal mechanic is missing. Historical issue numbers explain source lineage only. \`RulesetBroken\` denotes a broken ruleset invariant and is intentionally excluded from mechanic-unsupported sites.\n\n| Stable ID | Classification | Source | Rule/source citation | Live owner / history | Exact behavior or guard |\n|---|---|---|---|---|---|\n${sourceSites}\n\n${unownedSites.length ? `Reachable unsupported source sites without a verified live owner: ${unownedSites.map((row) => `\`${row.id}\` (${row.file}; ${row.citation})`).join(", ")}. These are surfaced for owner triage rather than assigned closed historical issues.` : "Every reachable unsupported source site has a live owner."}\n\n## Deferred statics\n\nThese are derived from \`DEFERRED_STATICS\` and checked for exact key parity. The historical contract issue recorded beside the VM symbol is not the current implementation owner.\n\n| Operation | Capability rows | Current owner | Citation |\n|---|---|---:|---|\n${deferred}\n\n## Evidence limits and independent work\n\n- There are ${HOOK_POINTS.length} hook points in the declarative contract. Their declarations and the Stage 3 #170/#135/#137 exit checks establish language/declaration shape, not that every printed mechanic executes correctly. The delivery plan records #170 as closed after declaration checks; it also records native \`mill\` as the one macro exception.\n- The current operation table classifies ${macroOps.length} operations as macros: ${macroOps.length - 1} are declared and native \`mill\` is the exception. Its binding is intentionally preserved by the native interpreter because later clauses can name the cards it moved.\n- These rules-only suites still compare to the legacy oracle; they are test-migration gaps tracked separately from #575 runtime behavior and must not be counted as fixed expected-state evidence (#459):\n\n| Stable ID | Suite | Runtime status | Owner | Remaining comparison |\n|---|---|---|---|---|\n${oracle}\n\n- #170 is historical stage/declaration closure, not proof that any row above is implemented. #459's fixed expected-state migration remains a separate gate. Neither this matrix nor a green declaration test changes those statuses.\n- The #118 saved-game legacy-only fixture has its own stable ID and owner in the matrix; it is not rules-mechanic evidence.\n- #548's zero-power processing is supported on this base and has active assertions for simultaneous causes, replacement choices and reload. This is narrow runtime evidence, not a claim of complete rule coverage.\n- Fuzz-40 requires database-backed deck/card fixtures and was not run here; the relevant implementation owner must run it with the approved local fixture environment.\n`;

if (checkOnly) {
  const actual = readFileSync(output, "utf8");
  assert.equal(actual, generated, "docs/arena-capability-inventory.md is stale; run `npx tsx scripts/verify/capabilities.mts` and review the change");
  console.log(`verify/capabilities: ${CAPABILITY_EVIDENCE.length} narrow scenarios, ${NAMED_RUNTIME_GAPS.length} named runtime gaps, ${VM_UNSUPPORTED_SOURCE_SITES.length} VM source sites, deferred statics and macro exception agree`);
} else {
  writeFileSync(output, generated);
  console.log(`wrote ${output}`);
}
