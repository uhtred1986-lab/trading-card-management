/**
 * Versioned offline deck packs (#655, plan O4-02): the portable half — types,
 * sealing, validation, qualification and instantiation. The build-time half,
 * which reads the committed catalog snapshot and runs the compiler, is
 * `scripts/build-arena-offline-pack.mts`.
 *
 * A pack is one deck pair with everything a local game needs and nothing it
 * may not carry: the pinned card definitions (both faces), the compiled
 * programs (`id` and `id#back`), the ruleset files, the artwork references,
 * the decklists, any generated/token dependency, the interpreter revision the
 * programs were compiled for, a transitive completeness manifest, the inputs
 * that are known to be missing, and the audit's blocker register with issue
 * links. The card payload is a #640 replay bundle (`replay-core.ts`), reused
 * as is, so a pack's bundle is exactly what `browser.ts` plays.
 *
 * `qualification.playable` is never trusted: validation recomputes it, and it
 * is true only when no blocker for the pack's decks is open, no input is
 * missing, no required program has an unread clause, and (when the caller
 * names its interpreter) the revision matches.
 *
 * Boundary, checked by `scripts/verify/arena-offline-pack.mts`: like
 * `browser.ts` — no database, Drizzle, auth, AI, cache, catalog source, Node
 * builtin, package or `process.env`, and no compiler or card-text reader of its
 * own. Nothing here performs I/O; the pack and the interpreter revision are
 * handed in by the caller.
 */
import type { CardDef, DeckInput, GameEvent } from "../types";
import type { CardScripts } from "../vm/script";
import type { CardArt } from "../view";
import { VM_STATE_VERSION } from "../vm/state";
import { CONTRACT_VERSION } from "../snapshot-core";
import {
  REPLAY_BUNDLE_FORMAT, RUNTIME_REVISION_PATTERN, canonicalJson, makeReplayBundle, pinnedDefinition, replayHash, validateReplayBundle,
  type ReplayBundle, type ReplayBundleRecord,
} from "../replay-core";
import { createPinnedMatch, type PinnedMatch } from "../browser";

export const OFFLINE_PACK_KIND = "dbs-arena-offline-pack";
export const OFFLINE_PACK_FORMAT = 1;
export const ISSUE_URL = "https://github.com/uhtred1986-lab/trading-card-management/issues/";

/** `open`, `missing-input` and `decision` all block; only `resolved` does not. */
export type BlockerStatus = "open" | "resolved" | "missing-input" | "decision";

export interface PackIssueLink { issue: number; url: string }

export interface PackBlocker {
  /** The audit register's id (`U1`..`U8`) or a named decision. */
  id: string;
  summary: string;
  /** Deck keys of this pack the blocker applies to. */
  decks: string[];
  cards: string[];
  /** Existing issues that own (or are nearest to) the blocker; empty means unowned. */
  issues: PackIssueLink[];
  status: BlockerStatus;
}

export interface PackDeck {
  key: string;
  name: string;
  /** Optional display metadata; older packs are ordinary decks. */
  isTesting?: boolean;
  /** Where the decklist comes from (the importer's own description). */
  source: string;
  deck: DeckInput;
  legality: { status: string; illegal: string[]; warnings: string[] };
}

/** A card a deck card can create or fetch from outside the decklist (a token, a generated card). */
export interface PackDependency { from: string; to: string; kind: "generated" | "token" }

export interface ManifestEntry {
  card: string;
  faces: ("front" | "back")[];
  /** Program keys in the bundle: `id`, and `id#back` for a second face. */
  programs: string[];
  art: ("front" | "back")[];
  /** Why the card is in the pack: `deck A` / `dependency of X`. */
  requiredBy: string[];
}

export interface PackManifest { cards: ManifestEntry[]; rulesetFiles: string[] }

/** An input the pack needs and could not carry; it keeps the pack unplayable. */
export interface MissingInput { card: string; field: "specifiedCost"; source: string; blocker: string }

export interface PackCompatibility {
  packFormat: number;
  replayBundleFormat: number;
  /** The interpreter revision the programs were compiled for; a local runtime must equal it. */
  runtimeRevision: string;
  vmStateVersion: number;
  contractVersion: number;
  engine: "rules";
}

export interface PackSource {
  catalog: { path: string; url: string; retrieved: string; cardsHash: string };
  audit: string;
}

export interface PackQualification { playable: boolean; reasons: string[] }

export interface OfflinePack {
  kind: typeof OFFLINE_PACK_KIND;
  format: number;
  /** SHA-256 of the canonical JSON of every other field. */
  hash: string;
  id: string;
  /** Offline packs are dbs-only in this milestone: the offline worker and its pinned bundle carry no Fusion World ruleset (plan §1). */
  game: "dbs";
  compatibility: PackCompatibility;
  source: PackSource;
  decks: PackDeck[];
  bundle: ReplayBundle;
  dependencies: PackDependency[];
  manifest: PackManifest;
  missingInputs: MissingInput[];
  blockers: PackBlocker[];
  qualification: PackQualification;
}

/** The exact top-level field set of a pack; anything else is refused. */
export const PACK_FIELDS = ["blockers", "bundle", "compatibility", "decks", "dependencies", "format", "game", "hash", "id", "kind", "manifest", "missingInputs", "qualification", "source"] as const;
/** The catalog fields a pinned definition may carry (`CardDef` as `cardDefFrom` builds it). */
export const DEF_FIELDS = ["back", "characters", "colors", "comboCost", "comboPower", "energyCost", "id", "name", "power", "skill", "specifiedCost", "traits", "type", "zEnergyCost"] as const;
export const DECK_INPUT_FIELDS = ["leader", "main", "name", "z"] as const;
export const PACK_DECK_FIELDS = ["deck", "key", "legality", "name", "source", "isTesting"] as const;
/** Key names that would mean account or private-collection data has leaked into a pack. */
const PRIVATE_KEY = /owner|user|email|account|collection|^lots?$|paid|purchase|session|cookie|password|secret|wishlist|^wants?$|reserv|device/i;

const sorted = <T>(xs: Iterable<T>) => [...xs].sort((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));
const deckCards = (d: DeckInput) => [d.leader, ...d.main, ...(d.z ?? [])];

/**
 * The manifest a pack must have, computed from its decks, definitions and
 * dependencies — never read from the pack itself. Every deck card, and
 * transitively every dependency, needs its definition, a program per face and
 * art per face. A Leader always has a second face.
 */
export function requiredManifest(decks: PackDeck[], defs: Record<string, CardDef>, dependencies: PackDependency[], rulesetFiles: string[]): { manifest: PackManifest; errors: string[] } {
  const errors: string[] = [];
  const why = new Map<string, Set<string>>();
  const queue: [string, string][] = [];
  for (const d of decks) for (const id of deckCards(d.deck)) queue.push([id, `deck ${d.key}`]);
  while (queue.length) {
    const [id, reason] = queue.shift()!;
    const known = why.get(id);
    if (known) { known.add(reason); continue; }
    why.set(id, new Set([reason]));
    for (const dep of dependencies) if (dep.from === id) queue.push([dep.to, `dependency of ${id}`]);
  }
  const cards: ManifestEntry[] = [];
  for (const id of sorted(why.keys())) {
    const def = defs[id];
    if (!def) { errors.push(`${id}: no pinned definition`); continue; }
    if (def.type === "LEADER" && !def.back) errors.push(`${id}: a Leader with no second face`);
    const faces: ("front" | "back")[] = def.back ? ["front", "back"] : ["front"];
    cards.push({ card: id, faces, programs: faces.map((f) => (f === "back" ? `${id}#back` : id)), art: faces, requiredBy: sorted(why.get(id)!) });
  }
  return { manifest: { cards, rulesetFiles: sorted(rulesetFiles) }, errors };
}

/** Why a pack is not playable, from its own content; empty means playable. */
export function qualificationReasons(pack: Omit<OfflinePack, "hash" | "qualification">, interpreterRevision?: string | null): string[] {
  const reasons: string[] = [];
  const deckKeys = new Set(pack.decks.map((d) => d.key));
  for (const b of pack.blockers) {
    if (b.status === "resolved" || !b.decks.some((k) => deckKeys.has(k))) continue;
    const owners = b.issues.length ? b.issues.map((o) => `#${o.issue}`).join(", ") : "unowned";
    reasons.push(`blocker ${b.id} (${b.status}; ${owners}): ${b.summary}`);
  }
  for (const m of pack.missingInputs) reasons.push(`missing input: ${m.card} ${m.field} (${m.source}; ${m.blocker})`);
  for (const entry of pack.manifest.cards) {
    for (const key of entry.programs) {
      const unread = pack.bundle.payload.scripts[key]?.unsupported ?? [];
      if (unread.length) reasons.push(`unresolved mechanic: ${key} has ${unread.length} unread clause(s)`);
    }
  }
  if (interpreterRevision !== undefined && interpreterRevision !== pack.compatibility.runtimeRevision) {
    reasons.push(`runtime ${interpreterRevision ?? "unknown"} is not the pack's interpreter revision ${pack.compatibility.runtimeRevision}`);
  }
  return reasons;
}

/** A pack without its seal (`hash`, `qualification`): what both are computed from. */
export function packContent(pack: OfflinePack): Omit<OfflinePack, "hash" | "qualification"> {
  const content: Partial<OfflinePack> = { ...pack };
  delete content.hash;
  delete content.qualification;
  return content as Omit<OfflinePack, "hash" | "qualification">;
}

/** Recompute `qualification` and `hash` over a pack's content. */
export async function sealOfflinePack(content: Omit<OfflinePack, "hash" | "qualification">): Promise<OfflinePack> {
  const reasons = qualificationReasons(content);
  const body = { ...structuredClone(content), qualification: { playable: reasons.length === 0, reasons } };
  return { ...body, hash: await replayHash(body) } as OfflinePack;
}

export interface MakeOfflinePackInput {
  id: string;
  defs: Record<string, CardDef>;
  scripts: Record<string, CardScripts>;
  art: Record<string, CardArt>;
  rulesetFiles: Record<string, string>;
  runtimeRevision: string;
  source: PackSource;
  decks: PackDeck[];
  dependencies: PackDependency[];
  missingInputs: MissingInput[];
  blockers: PackBlocker[];
}

/** Build and seal a pack from already-compiled inputs. Throws when the inputs are incomplete. */
export async function makeOfflinePack(input: MakeOfflinePackInput): Promise<OfflinePack> {
  if (!RUNTIME_REVISION_PATTERN.test(input.runtimeRevision)) throw new Error(`runtime revision ${input.runtimeRevision} is not a commit SHA`);
  const { manifest, errors } = requiredManifest(input.decks, input.defs, input.dependencies, Object.keys(input.rulesetFiles));
  if (errors.length) throw new Error(`offline pack ${input.id} is incomplete: ${errors.join("; ")}`);
  const bundle = await makeReplayBundle({ defs: input.defs, scripts: input.scripts, art: input.art, rulesetFiles: input.rulesetFiles, runtime: input.runtimeRevision.toLowerCase() });
  const pack = await sealOfflinePack({
    kind: OFFLINE_PACK_KIND,
    format: OFFLINE_PACK_FORMAT,
    id: input.id,
    game: "dbs",
    compatibility: {
      packFormat: OFFLINE_PACK_FORMAT,
      replayBundleFormat: REPLAY_BUNDLE_FORMAT,
      runtimeRevision: input.runtimeRevision.toLowerCase(),
      vmStateVersion: VM_STATE_VERSION,
      contractVersion: CONTRACT_VERSION,
      engine: "rules",
    },
    source: input.source,
    decks: input.decks,
    bundle,
    dependencies: sorted(input.dependencies.map((d) => JSON.stringify([d.from, d.to, d.kind]))).map((s) => { const [from, to, kind] = JSON.parse(s); return { from, to, kind }; }),
    manifest,
    missingInputs: input.missingInputs,
    blockers: input.blockers,
  });
  const check = await validateOfflinePack(pack);
  if (!check.ok) throw new Error(`offline pack ${input.id} failed its own validation: ${check.errors.join("; ")}`);
  return pack;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Key paths that look like account or private-collection data, and fields outside the pack's declared sets. */
export function privateDataViolations(pack: unknown): string[] {
  const out: string[] = [];
  if (!isRecord(pack)) return ["not an object"];
  const exact = (where: string, obj: unknown, allowed: readonly string[]) => {
    if (!isRecord(obj)) { out.push(`${where}: not an object`); return; }
    for (const k of Object.keys(obj)) if (!allowed.includes(k)) out.push(`${where}.${k}: field outside the pack format`);
  };
  exact("pack", pack, PACK_FIELDS);
  const bundle = pack.bundle as ReplayBundle | undefined;
  for (const [id, def] of Object.entries(bundle?.payload?.defs ?? {})) exact(`defs.${id}`, def, DEF_FIELDS);
  for (const [key, s] of Object.entries(bundle?.payload?.scripts ?? {})) exact(`scripts.${key}`, s, ["bySkill", "complete", "unsupported"]);
  for (const [id, a] of Object.entries(bundle?.payload?.art ?? {})) exact(`art.${id}`, a, ["back", "front"]);
  for (const [i, d] of ((pack.decks as unknown[]) ?? []).entries()) {
    exact(`decks[${i}]`, d, PACK_DECK_FIELDS);
    if (isRecord(d)) {
      exact(`decks[${i}].deck`, d.deck, DECK_INPUT_FIELDS);
      if (d.isTesting !== undefined && typeof d.isTesting !== "boolean") out.push(`decks[${i}].isTesting: expected a boolean`);
    }
  }
  // Every key outside the compiled programs (whose ops legitimately name a `price`) and the ruleset text.
  const walk = (v: unknown, where: string) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${where}[${i}]`));
    if (!isRecord(v)) return;
    for (const [k, x] of Object.entries(v)) {
      const at = `${where}.${k}`;
      if (at === "pack.bundle.payload.scripts" || at === "pack.bundle.payload.rulesetFiles") continue;
      if (PRIVATE_KEY.test(k)) out.push(`${at}: private-looking field`);
      walk(x, at);
    }
  };
  walk(pack, "pack");
  return out;
}

/**
 * Key order is not content: a pack read back from the builder's file (canonical JSON, keys sorted)
 * must compare equal to the manifest computed here (#658 found that it did not).
 */
const sameJson = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

/**
 * Validate a pack completely: format and versions, every content hash, the
 * transitive completeness manifest (recomputed), every pinned item present and
 * nothing unlisted, the ruleset loadable, the field set, and the recorded
 * qualification. Never throws.
 */
export async function validateOfflinePack(pack: OfflinePack): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = [];
  try {
    if (!isRecord(pack)) return { ok: false, errors: ["not an object"] };
    if (pack.kind !== OFFLINE_PACK_KIND) errors.push(`kind ${String(pack.kind)} is not ${OFFLINE_PACK_KIND}`);
    if (pack.format !== OFFLINE_PACK_FORMAT) errors.push(`unsupported pack format ${String(pack.format)}`);
    const c = pack.compatibility;
    if (!isRecord(c)) errors.push("no compatibility record");
    else {
      if (c.packFormat !== OFFLINE_PACK_FORMAT) errors.push(`unsupported compatibility.packFormat ${String(c.packFormat)}`);
      if (c.replayBundleFormat !== REPLAY_BUNDLE_FORMAT) errors.push(`unsupported replay bundle format ${String(c.replayBundleFormat)}`);
      if (c.vmStateVersion !== VM_STATE_VERSION) errors.push(`vm state version ${String(c.vmStateVersion)} is not this runtime's ${VM_STATE_VERSION}`);
      if (c.contractVersion !== CONTRACT_VERSION) errors.push(`snapshot contract ${String(c.contractVersion)} is not this runtime's ${CONTRACT_VERSION}`);
      if (c.engine !== "rules") errors.push(`engine ${String(c.engine)} is not the rules engine`);
      if (pack.bundle?.runtimeRevision !== c.runtimeRevision || !c.runtimeRevision) errors.push("the bundle's interpreter revision is missing or differs from the pack's");
    }
    if (!(await validateReplayBundle(pack.bundle))) errors.push("the card bundle fails content-hash validation");
    errors.push(...privateDataViolations(pack));
    if (errors.length) return { ok: false, errors };

    const payload = pack.bundle.payload;
    const { manifest, errors: missing } = requiredManifest(pack.decks, payload.defs, pack.dependencies, Object.keys(payload.rulesetFiles));
    errors.push(...missing);
    if (!sameJson(manifest, pack.manifest)) errors.push("the completeness manifest is not the one the decks and dependencies require");
    const want = { defs: new Set<string>(), scripts: new Set<string>(), art: new Set<string>() };
    for (const e of pack.manifest.cards) {
      want.defs.add(e.card);
      want.art.add(e.card);
      for (const p of e.programs) {
        want.scripts.add(p);
        if (!isRecord(payload.scripts[p])) errors.push(`${p}: no program`);
      }
      const art = payload.art[e.card];
      for (const face of e.art) if (!art || typeof art[face] !== "string" || !art[face]) errors.push(`${e.card}: no ${face} art`);
    }
    for (const id of Object.keys(payload.defs)) if (!want.defs.has(id)) errors.push(`defs.${id}: not in the manifest`);
    for (const key of Object.keys(payload.scripts)) if (!want.scripts.has(key)) errors.push(`scripts.${key}: not in the manifest`);
    for (const id of Object.keys(payload.art)) if (!want.art.has(id)) errors.push(`art.${id}: not in the manifest`);
    for (const dep of pack.dependencies) if (!payload.defs[dep.to]) errors.push(`dependency ${dep.from} -> ${dep.to}: not pinned`);
    for (const f of pack.manifest.rulesetFiles) if (typeof payload.rulesetFiles[f] !== "string") errors.push(`ruleset ${f}: missing`);
    try { pinnedDefinition(pack.bundle); } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }
    for (const b of pack.blockers ?? []) {
      for (const o of b.issues) if (o.url !== `${ISSUE_URL}${o.issue}`) errors.push(`blocker ${b.id}: issue link ${o.url} is not #${o.issue}`);
    }

    const { hash, qualification, ...content } = pack;
    const reasons = qualificationReasons(content);
    if (!sameJson(qualification, { playable: reasons.length === 0, reasons })) errors.push("the recorded qualification is not the one the pack's content gives");
    if (hash !== (await replayHash({ ...content, qualification }))) errors.push("the pack hash does not match its content");
  } catch (e) {
    errors.push(`unreadable pack: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { ok: errors.length === 0, errors };
}

/** Whether this runtime may play the pack: valid, qualified, and on the pack's interpreter. */
export async function qualifyOfflinePack(pack: OfflinePack, interpreterRevision: string | null): Promise<PackQualification> {
  const valid = await validateOfflinePack(pack);
  if (!valid.ok) return { playable: false, reasons: valid.errors.map((e) => `invalid pack: ${e}`) };
  const reasons = qualificationReasons(packContent(pack), interpreterRevision);
  return { playable: reasons.length === 0, reasons };
}

export interface InstantiateInput {
  pack: OfflinePack;
  /** Deck keys of the pack for each seat (a mirror is allowed). */
  p1: string;
  p2: string;
  seed: number;
  interpreterRevision: string | null;
  /**
   * Play a pack that is valid but not qualified (open blockers). For
   * development and evidence only; a player-facing caller never sets it.
   */
  allowUnqualified?: true;
}

/** Validate, qualify and create a local game from a pack, through `browser.ts` alone. */
export async function instantiateOfflinePack(input: InstantiateInput): Promise<{ match: PinnedMatch; events: GameEvent[] }> {
  const valid = await validateOfflinePack(input.pack);
  if (!valid.ok) throw new Error(`offline pack is invalid: ${valid.errors.join("; ")}`);
  const q = await qualifyOfflinePack(input.pack, input.interpreterRevision);
  if (!q.playable && !input.allowUnqualified) throw new Error(`offline pack is not playable: ${q.reasons.join("; ")}`);
  return matchFromPack(input);
}

/**
 * Create the game of a pack the caller has already validated and qualified
 * (#652's worker does both itself, to name every refusal). The card bundle's
 * hashes are still checked by `createPinnedMatch`.
 */
export function matchFromPack(input: Omit<InstantiateInput, "allowUnqualified">): Promise<{ match: PinnedMatch; events: GameEvent[] }> {
  const deck = (key: string) => {
    const d = input.pack.decks.find((x) => x.key === key);
    if (!d) throw new Error(`offline pack has no deck ${key}`);
    return structuredClone(d.deck);
  };
  const record: ReplayBundleRecord = { ...structuredClone(input.pack.bundle), decks: { p1: deck(input.p1), p2: deck(input.p2) } };
  return createPinnedMatch({ bundle: record, seed: input.seed, interpreterRevision: input.interpreterRevision });
}
