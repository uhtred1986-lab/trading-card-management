/** #897: offline provenance over the exact match loader, without a compiler fallback. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { validateRule } from "../src/lib/arena/lang/validate";
import { canonicalJson } from "../src/lib/arena/replay-core";
import { compileCard } from "../src/lib/arena/compile";
import { rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../src/lib/arena/rules-store";
import { parseSkills, skillLines } from "../src/lib/arena/text/cards";
import { comboBattleEndSelf, comboBattleEndOpponentTurn, comboBattleEndYourTurn, comboBattleEndFromHand, comboEntryOrigins, comboEntryQualifier, comboEntrySelf, whiteCellPlayedSubjectFilter } from "../src/lib/arena/text/triggers";
import { needsPaymentRecord } from "../src/lib/arena/vm/skill-payment";
import type { CardDef, Skill } from "../src/lib/arena/types";

export type ProgramMode = "compiler" | "stored";
export type ExportedRule = Record<string, unknown>;
export const hashOf = (value: unknown): string => createHash("sha256").update(canonicalJson(value)).digest("hex");
export const fileHash = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");
export function treeHash(path: string): string {
  const files: [string, string][] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) files.push([file, fileHash(file)]);
    }
  };
  visit(path);
  return hashOf(files);
}
const at = (id: string, side: string, index: number) => `${id}/${side}/${index}`;
const required = ["cardId", "side", "skillIndex", "printed", "kind", "trigger", "cost", "cond", "ops", "status", "source", "unread", "version"];

/** Accept the supported DB-export snake case and application's camel case. Preserve all fields. */
export function normalizeRows(exports: ExportedRule[]): { rows: RuleRow[]; malformed: string[] } {
  const rows: RuleRow[] = [];
  const malformed: string[] = [];
  for (const [i, raw] of exports.entries()) {
    const row: ExportedRule = {};
    let invalid = false;
    for (const [key, value] of Object.entries(raw)) {
      const name = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      if (name in row && hashOf(row[name]) !== hashOf(value)) { malformed.push(`row ${i}: conflicting ${name}`); invalid = true; }
      row[name] = value;
    }
    const missing = required.filter((key) => !(key in row));
    if (missing.length) { malformed.push(`row ${i}: incomplete export (${missing.join(", ")})`); continue; }
    if (typeof row.cardId !== "string" || !["front", "back"].includes(String(row.side)) || !Number.isInteger(row.skillIndex)
      || typeof row.printed !== "string" || typeof row.kind !== "string" || !Array.isArray(row.ops) || !Array.isArray(row.unread)
      || !(row.trigger === null || Array.isArray(row.trigger)) || !["open", "draft", "confirmed", "corrected"].includes(String(row.status))
      || typeof row.source !== "string" || !Number.isInteger(row.version) || Number(row.version) < 1
      || !(row.cost === null || typeof row.cost === "object" && !Array.isArray(row.cost))) {
      malformed.push(`row ${i}: invalid executable record fields`); continue;
    }
    if (!invalid) {
      const bad = validateRule({ ...row, trigger: row.trigger ?? [] }, String(row.kind));
      if (bad) malformed.push(`row ${i}: invalid ${bad.field}: ${bad.message}`);
      else rows.push(row as unknown as RuleRow);
    }
  }
  return { rows, malformed };
}

/** Boundaries where the match still obtains meaningful metadata from printed text. */
function textDependencies(sk: Skill): string[] {
  const fields: string[] = [];
  if (sk.keyword && ["Union", "Over Realm", "Evolve", "Swap", "Arrival", "Aegis", "Revive", "Successor", "Rejuvenate", "Z-Awaken", "Z-Stack"].includes(sk.keyword.name)) fields.push(`keyword.${sk.keyword.name} activation/material contract`);
  const activated = sk.kind.startsWith("activate:") || needsPaymentRecord(sk);
  if (!activated && Object.values(sk.energyCost).some(Boolean)) fields.push("cost.orbs");
  if (!activated && sk.energyEither.length) fields.push("cost.either");
  if (!activated) for (const [key, value] of Object.entries({ marker: sk.markerCost, burst: sk.burst, spiritBoost: sk.spiritBoost })) {
    if (value !== null) fields.push(`cost.${key}`);
  }
  for (const [key, value] of Object.entries({ oncePerTurn: sk.oncePerTurn || null, limit: sk.limit, bond: sk.bond, sparking: sk.sparking })) {
    if (value !== null) fields.push(key);
  }
  if (sk.kind === "auto") {
    if (comboBattleEndSelf(sk) || comboBattleEndOpponentTurn(sk) || comboBattleEndYourTurn(sk) || comboBattleEndFromHand(sk) || comboEntryOrigins(sk) || comboEntryQualifier(sk) || comboEntrySelf(sk)) fields.push("trigger.combo qualification/bindings");
    if (whiteCellPlayedSubjectFilter(sk)) fields.push("trigger.played subject qualification");
  }
  return fields;
}

export function programProvenance(defs: Record<string, CardDef>, mode: ProgramMode, exports: ExportedRule[] | null) {
  if (mode === "stored" && !exports) throw new Error("stored mode requires complete exported --stored-rules");
  if (mode === "compiler" && exports) throw new Error("--stored-rules requires stored mode; compiler mode cannot claim stored provenance");
  const { rows, malformed } = normalizeRows(exports ?? []);
  const compiled = Object.fromEntries(Object.values(defs).flatMap((def) => [
    [def.id, compileCard(def, "front")], ...(def.back ? [[`${def.id}#back`, compileCard(def, "back")]] : []),
  ]));
  const scripts = mode === "stored" ? rulesFromRows(rows, defs) : compiled;
  const manifest = [];
  const usedKeys = new Set<string>();
  for (const def of Object.values(defs).sort((a, b) => a.id.localeCompare(b.id))) for (const side of ["front", "back"] as const) {
    if (side === "back" && !def.back) continue;
    const text = side === "front" ? def.skill : def.back?.skill;
    const lines = skillLines(text);
    const programKey = side === "front" ? def.id : `${def.id}#back`;
    for (const sk of parseSkills(text)) {
      const key = at(def.id, side, sk.index);
      usedKeys.add(key);
      const printed = lines[Math.floor(sk.index / 10)] ?? sk.raw;
      const requiredRow = !!sk.effect.trim() || needsPaymentRecord(sk);
      const found = rows.filter((row) => at(row.cardId, row.side, row.skillIndex) === key);
      const row = found.length === 1 ? found[0] : undefined;
      const current = !requiredRow ? "native" : mode === "compiler" ? "generated" : !found.length ? "missing" : found.length > 1 ? "duplicate" : row!.printed !== printed ? "stale" : "current";
      const blockers: string[] = [];
      if (mode === "stored") blockers.push(...textDependencies(sk).map((field) => `${field} is derived from printed text at runtime, not the stored executable contract`));
      if (mode === "stored" && requiredRow) {
        if (current !== "current") blockers.push(`stored record ${current}`);
        if (row && current === "current") {
          if (row.kind !== sk.kind) blockers.push("stored kind does not match expected skill kind");
          if (row.status === "open") blockers.push("stored record open (no executable program)");
          blockers.push(...runtimeSupportOfRow(row).unsupported);
          if (sk.kind === "auto" && !row.trigger?.length) blockers.push("missing stored trigger names");
          if (sk.cost.trim() && row.cost === null) blockers.push("missing stored activation cost/condition metadata");
          const cost = row.cost as Record<string, unknown> | null;
          if (cost) for (const field of Object.keys(cost)) {
            if (["version", "readable", "orbs", "either", "marker", "burst", "spiritBoost", "condition", "program", "x", "payWith"].includes(field)) continue;
            const value = cost[field];
            const meaningful = value != null && value !== "" && (!Array.isArray(value) || value.length > 0) && (typeof value !== "object" || Object.keys(value).length > 0);
            // `text` is display/source only; chargeability comes from the versioned typed contract.
            if (meaningful && field !== "text") blockers.push(`cost.${field} is dropped by match loader priceOfRow`);
          }
          const loaded = scripts[programKey]?.bySkill[sk.index];
          if (!loaded) blockers.push("match loader produced no program");
          else blockers.push(...loaded.unsupported);
        }
      }
      const loaded = scripts[programKey]?.bySkill[sk.index] ?? null;
      const fresh = compiled[programKey]?.bySkill[sk.index] ?? null;
      manifest.push({ key, cardId: def.id, side, skillIndex: sk.index, kind: sk.kind, printed, sourceHash: hashOf(printed), faceSourceHash: hashOf(text ?? null), requiredRow,
        contract: requiredRow ? "stored executable record" : "native keyword interpreted by pinned ruleset/engine; no stored row required",
        freshness: current, humanReview: row ? { status: row.status, confirmed: ["confirmed", "corrected"].includes(row.status) && !row.reviewFlag, flagged: row.reviewFlag ?? null } : null,
        rowVersion: row?.version ?? null, rowSource: row?.source ?? null, rowHash: row ? hashOf(row) : null,
        programHash: hashOf(loaded), compilerProgramHash: hashOf(fresh), differsFromCompiler: hashOf(loaded) !== hashOf(fresh),
        executable: mode === "compiler" ? !!loaded && loaded.unsupported.length === 0 || !requiredRow : blockers.length === 0,
        blockers: [...new Set(blockers)],
      });
    }
  }
  const unexpectedRows = rows.filter((row) => row.cardId in defs && !usedKeys.has(at(row.cardId, row.side, row.skillIndex))).map((row) => at(row.cardId, row.side, row.skillIndex));
  return { scripts, manifest, rows, exports, malformed, unexpectedRows, exportsHash: hashOf(exports), rowsHash: hashOf(rows), manifestHash: hashOf(manifest) };
}
