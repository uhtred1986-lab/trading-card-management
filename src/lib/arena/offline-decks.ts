/**
 * A player's decks for offline play (#793): which of them can go on the device, and the device's
 * one pack — the built-in starters plus every deck the player chose — built from live data.
 *
 * A deck is read exactly the way the online arena reads it for a game (`startGame` in `games.ts`):
 * `deckInputFor` for the list, `cardDefFrom` over the catalog rows for the definitions, the
 * catalog's art, and `rulesFromRows` over the stored `card_rules` records for the programs. Nothing
 * is compiled here: rules are records. So a deck plays offline by the same rules it plays online.
 *
 * The gate (owner's ruling 1 of #793, "refuse until fixed"): a deck goes offline only when every
 * skill of every card is playable by the engine — no skill without a current record, no open
 * (unread) record, no clause the engine cannot carry out (`runtimeSupportOfRow`), no missing input
 * (a Unison or X-cost card without its specified cost) and a picture for every face the pack must
 * carry. `checkOfflineDecks` names each blocking card in plain words; `buildDeviceOfflinePack`
 * refuses (`OfflineDeckRefused`) rather than build a pack with such a deck, and there is no flag
 * to force it. The sealed pack's own `qualificationReasons` must agree, or the build throws.
 *
 * Scope: every read takes the looker's `OwnerScope` (`currentScope()`); a deck outside it is
 * reported as not found, never read. Only `dbs` decks: the arena does not play Fusion World.
 *
 * The pack carries the deck lists and public card data only (`privateDataViolations`): a deck's
 * name and list, never its owner, its lots or anything of the collection.
 */
import { and, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { cards as cardsTable, decks as decksTable } from "@/db/schema";
import { deckScope, type OwnerScope } from "@/lib/collection/scope";
import { legalityForDecks } from "@/lib/decks/legality";
import { cardDefFrom, deckInputFor } from "./load";
import { loadRules, rulesFromRows, runtimeSupportOfRow, type RuleRow } from "./rules-store";
import { parseSkills, skillLines, specifiedCostUnknown } from "./text/cards";
import { deckListHash, offlineDeckKey } from "./local/device-decks";
import { makeOfflinePack, qualificationReasons, type MakeOfflinePackInput, type OfflinePack, type PackDeck } from "./local/pack";
import type { CardDef, DeckInput } from "./types";
import type { CardScripts } from "./vm/script";
import type { CardArt } from "./view";

/** The most decks one device pack may carry besides the starters. */
export const MAX_OFFLINE_DECKS = 12;

export interface BlockingCard {
  card: string;
  name: string;
  /** Plain words, one per problem. */
  reasons: string[];
}

export interface OfflineDeckCheck {
  deckId: number;
  key: string;
  name: string;
  /** True when the deck can be downloaded. */
  ready: boolean;
  /** Problems of the deck as a whole (no leader, wrong game). */
  problems: string[];
  /** The cards that keep it off the device, and why. */
  blocking: BlockingCard[];
  /** The list's fingerprint (`deckListHash`), null when the deck cannot be read as a game deck. */
  listHash: string | null;
}

/** What a deck brings to a pack: its list and the definitions, programs and art of its cards. */
interface LiveDeck {
  check: OfflineDeckCheck;
  deck: DeckInput | null;
  legality: PackDeck["legality"];
  defs: Record<string, CardDef>;
  scripts: Record<string, CardScripts>;
  art: Record<string, CardArt>;
}

/** A deck the player asked for is not theirs to read, does not exist, or cannot go offline. */
export class OfflineDeckRefused extends Error {
  constructor(readonly code: "not-found" | "blocked" | "too-many", message: string, readonly checks: OfflineDeckCheck[] = []) {
    super(message);
    this.name = "OfflineDeckRefused";
  }
}

const NO_PROGRAM: CardScripts = { bySkill: {}, complete: false, unsupported: [] };
const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * Why one card cannot be played offline, in plain words; empty when it can. Reads the same
 * records `rulesFromRows` does, skill by skill, and then cross-checks the programs it produced:
 * anything `qualificationReasons` would refuse is refused here too.
 */
export function cardBlockers(def: CardDef, art: CardArt, rules: RuleRow[], scripts: Record<string, CardScripts>): string[] {
  const out: string[] = [];
  for (const side of ["front", "back"] as const) {
    const text = side === "front" ? def.skill : def.back?.skill;
    const lines = skillLines(text);
    const where = side === "back" ? " (back side)" : "";
    for (const sk of parseSkills(text)) {
      if (!sk.effect.trim()) continue; // a native keyword needs no record
      const printed = lines[Math.floor(sk.index / 10)] ?? sk.raw;
      const quote = `“${short(printed)}”${where}`;
      const row = rules.find((r) => (r.side === "back" ? "back" : "front") === side && r.skillIndex === sk.index && r.printed === printed);
      if (!row) {
        out.push(`${quote}: no game rule has been written for this skill yet.`);
        continue;
      }
      if (row.status === "open") {
        out.push(`${quote}: this skill has not been read yet, so it would do nothing.`);
        continue;
      }
      const support = runtimeSupportOfRow(row);
      if (support.unsupported.length) out.push(`${quote}: the game cannot do this yet (${short(support.unsupported.join("; "), 160)}).`);
    }
  }
  if (!out.length) {
    // The programs are what the pack's qualification reads; never let the two disagree.
    for (const key of def.back ? [def.id, `${def.id}#back`] : [def.id]) {
      const unread = scripts[key]?.unsupported ?? [];
      if (unread.length) out.push(`${key.endsWith("#back") ? "Its back side" : "Its skill"} has a part the game cannot do yet (${short(unread.join("; "), 160)}).`);
    }
  }
  if (def.type === "UNISON" && !def.specifiedCost) out.push("Its specified cost (the coloured energy it needs) has not been entered.");
  else if (specifiedCostUnknown(def)) out.push("Its specified cost (the coloured energy its X cost needs) has not been entered.");
  if (!art.front) out.push("There is no picture of this card to download.");
  if (def.back && !art.back) out.push("There is no picture of its back side to download.");
  return out;
}

/** Read the decks, visible to `scope`, as the online arena would load them for a game. */
async function liveDecks(db: Db, scope: OwnerScope, deckIds: number[]): Promise<Map<number, LiveDeck>> {
  const ids = [...new Set(deckIds)].filter((n) => Number.isInteger(n) && n > 0);
  const out = new Map<number, LiveDeck>();
  if (!ids.length) return out;
  const scoped = deckScope(scope);
  const visible = await db
    .select({ id: decksTable.id, name: decksTable.name, game: decksTable.game })
    .from(decksTable)
    .where(scoped ? and(inArray(decksTable.id, ids), scoped) : inArray(decksTable.id, ids));
  if (!visible.length) return out;
  const legal = await legalityForDecks(db, visible.map((d) => d.id));
  for (const d of visible) {
    const key = offlineDeckKey(d.id);
    const lg = legal.get(d.id);
    const legality = {
      status: lg?.status ?? "incomplete",
      illegal: (lg?.issues ?? []).filter((i) => i.severity === "illegal").map((i) => i.message),
      warnings: (lg?.issues ?? []).filter((i) => i.severity === "warning").map((i) => i.message),
    };
    const base: OfflineDeckCheck = { deckId: d.id, key, name: d.name, ready: false, problems: [], blocking: [], listHash: null };
    if (d.game !== "dbs") {
      base.problems.push("This is a Fusion World deck; the arena plays the original Dragon Ball Super Card Game only.");
      out.set(d.id, { check: base, deck: null, legality, defs: {}, scripts: {}, art: {} });
      continue;
    }
    const input = await deckInputFor(db, d.id);
    if (!input) {
      base.problems.push("The deck has no leader yet.");
      out.set(d.id, { check: base, deck: null, legality, defs: {}, scripts: {}, art: {} });
      continue;
    }
    if (!input.input.main.length) base.problems.push("The main deck is empty.");
    const cardIds = [...new Set(input.cardIds)];
    const rows = await db.select().from(cardsTable).where(inArray(cardsTable.id, cardIds));
    const defs: Record<string, CardDef> = {};
    const art: Record<string, CardArt> = {};
    for (const r of rows) {
      defs[r.id] = cardDefFrom(r);
      art[r.id] = { front: r.imageUrl, back: r.backImageUrl };
    }
    const ruleRows = await loadRules(db, cardIds);
    const scripts = rulesFromRows(ruleRows, defs);
    // A face with no record at all is a face with no program: what the engine plays online (`NO_RULES`).
    for (const def of Object.values(defs)) {
      scripts[def.id] ??= { ...NO_PROGRAM };
      if (def.back) scripts[`${def.id}#back`] ??= { ...NO_PROGRAM };
    }
    for (const id of cardIds) if (!defs[id]) base.problems.push(`${id} is not in the card catalog.`);
    for (const id of cardIds.sort()) {
      const def = defs[id];
      if (!def) continue;
      const reasons = cardBlockers(def, art[id], ruleRows.filter((r) => r.cardId === id), scripts);
      if (reasons.length) base.blocking.push({ card: id, name: def.name, reasons });
    }
    base.blocking.sort((a, b) => a.name.localeCompare(b.name) || a.card.localeCompare(b.card));
    const deck: DeckInput = { name: input.input.name, leader: input.input.leader, main: input.input.main, ...(input.input.z?.length ? { z: input.input.z } : {}) };
    base.listHash = await deckListHash(deck);
    base.ready = base.problems.length === 0 && base.blocking.length === 0;
    out.set(d.id, { check: base, deck, legality, defs, scripts, art });
  }
  return out;
}

/** Whether each deck can go offline, and if not which cards block it. A deck outside `scope` is absent. */
export async function checkOfflineDecks(db: Db, scope: OwnerScope, deckIds: number[]): Promise<Map<number, OfflineDeckCheck>> {
  const live = await liveDecks(db, scope, deckIds);
  return new Map([...live].map(([id, d]) => [id, d.check]));
}

/**
 * The device pack's inputs: the starters as built, plus each live deck. Cards both carry play by
 * the live records (the player's deck must play offline as it does online); their art stays the
 * starters' verified picture.
 */
export function deviceOfflinePackInput(starters: MakeOfflinePackInput, live: { key: string; name: string; deck: DeckInput; legality: PackDeck["legality"]; defs: Record<string, CardDef>; scripts: Record<string, CardScripts>; art: Record<string, CardArt> }[]): MakeOfflinePackInput {
  if (!live.length) return starters;
  const defs = { ...starters.defs };
  const scripts = { ...starters.scripts };
  const art = { ...starters.art };
  for (const d of live) {
    Object.assign(defs, d.defs);
    for (const id of Object.keys(d.defs)) {
      scripts[id] = d.scripts[id];
      if (d.defs[id].back) scripts[`${id}#back`] = d.scripts[`${id}#back`];
      else delete scripts[`${id}#back`];
      if (!starters.art[id]) art[id] = d.art[id];
    }
  }
  return {
    ...starters,
    defs,
    scripts,
    art,
    source: { ...starters.source, audit: `${starters.source.audit}; player decks: the app's catalog and stored card_rules records (#793)` },
    decks: [...starters.decks, ...live.map((d) => ({ key: d.key, name: d.name, source: "Your deck (the app's database)", deck: d.deck, legality: d.legality }))],
  };
}

/**
 * The device's one pack: the starters plus the chosen decks, sealed and validated. Refuses a deck
 * outside `scope` (`not-found`) or one that cannot be played (`blocked`, with every check).
 */
export async function buildDeviceOfflinePack(db: Db, scope: OwnerScope, deckIds: number[], starters: MakeOfflinePackInput): Promise<OfflinePack> {
  const ids = [...new Set(deckIds)];
  if (ids.length > MAX_OFFLINE_DECKS) throw new OfflineDeckRefused("too-many", `A device holds at most ${MAX_OFFLINE_DECKS} of your decks.`);
  const live = await liveDecks(db, scope, ids);
  const missing = ids.filter((id) => !live.has(id));
  if (missing.length) throw new OfflineDeckRefused("not-found", `No deck ${missing.join(", ")}.`);
  const checks = ids.map((id) => live.get(id)!.check);
  const blocked = checks.filter((c) => !c.ready);
  if (blocked.length) throw new OfflineDeckRefused("blocked", `${blocked.map((c) => `"${c.name}"`).join(", ")} cannot be played offline yet.`, checks);
  const input = deviceOfflinePackInput(starters, ids.map((id) => {
    const d = live.get(id)!;
    return { key: d.check.key, name: d.check.name, deck: d.deck!, legality: d.legality, defs: d.defs, scripts: d.scripts, art: d.art };
  }));
  const pack = await makeOfflinePack(input);
  // The plain-word gate and the pack's own qualification must agree; a disagreement is a bug, not a pack.
  const reasons = qualificationReasons(pack);
  if (!pack.qualification.playable || reasons.length) throw new Error(`the device pack is not playable although every deck passed the check: ${reasons.join("; ")}`);
  return pack;
}

/** `?decks=1,2,3` → `[1, 2, 3]`; null when malformed. */
export function parseDeckIds(param: string | null): number[] | null {
  if (param == null || param.trim() === "") return [];
  const parts = param.split(",").map((s) => s.trim());
  if (!parts.every((p) => /^\d{1,9}$/.test(p))) return null;
  return [...new Set(parts.map(Number))];
}
