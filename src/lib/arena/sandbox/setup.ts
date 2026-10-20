/**
 * "Set up the board" (play-test): what the owner changes about the staged
 * position before a game starts — which Leader each side has, the cards in
 * your hand, Battle Area and Drop, your energy, each side's life.
 *
 * Pure and browser-safe: the shape, its limits, `sanitizeSetup` (the server
 * action trusts nothing a client sends) and the `sessionStorage` key it is
 * kept under. The staging itself is `applySetup` in `probe.ts`, so the
 * sandbox's board is still the one a Try it row is judged on, plus these
 * changes. A setup is *data about the position*, never about the rule: the
 * card under test keeps the builder's unsaved rule whatever is set here.
 */
import type { CardDef } from "../types";
import type { CardScripts } from "../vm/script";

/** The entry that stands for "any card": the probe's own filler. */
export const SETUP_FILLER = "filler";

export const SETUP_LIMITS = { cards: 12, energy: 12, life: 8 } as const;

export interface BoardSetup {
  /** Your Leader, a catalog card id (a Leader). */
  leader?: string;
  /** The opponent's Leader. */
  theirLeader?: string;
  /** Catalog card ids, or `SETUP_FILLER`, one entry per card. */
  hand?: string[];
  battle?: string[];
  drop?: string[];
  /** Your energy: how many are active and how many are rested. */
  energy?: { active: number; rested: number };
  life?: { you?: number; them?: number };
}

/** A setup with the catalog read for it: the definitions and the stored rules of every card it names. */
export interface ResolvedSetup {
  setup: BoardSetup;
  defs: Record<string, CardDef>;
  scripts: Record<string, CardScripts>;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/;
const int = (v: unknown, min: number, max: number): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.trunc(v))) : null);
const idList = (v: unknown): string[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string" && (x === SETUP_FILLER || ID.test(x))).slice(0, SETUP_LIMITS.cards);
  return out;
};

/** Whatever arrived, as a setup within the limits; unknown fields are dropped. */
export function sanitizeSetup(raw: unknown): BoardSetup {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: BoardSetup = {};
  if (typeof r.leader === "string" && ID.test(r.leader)) out.leader = r.leader;
  if (typeof r.theirLeader === "string" && ID.test(r.theirLeader)) out.theirLeader = r.theirLeader;
  for (const area of ["hand", "battle", "drop"] as const) {
    const list = idList(r[area]);
    if (list) out[area] = list;
  }
  const e = r.energy as Record<string, unknown> | undefined;
  if (e && typeof e === "object") {
    const active = int(e.active, 0, SETUP_LIMITS.energy);
    const rested = int(e.rested, 0, SETUP_LIMITS.energy);
    if (active !== null && rested !== null) out.energy = { active, rested: Math.min(rested, SETUP_LIMITS.energy - active) };
  }
  const l = r.life as Record<string, unknown> | undefined;
  if (l && typeof l === "object") {
    const you = int(l.you, 1, SETUP_LIMITS.life);
    const them = int(l.them, 1, SETUP_LIMITS.life);
    if (you !== null || them !== null) out.life = { ...(you !== null ? { you } : {}), ...(them !== null ? { them } : {}) };
  }
  return out;
}

/** One card a search found, for the panel to offer. */
export interface SetupCardHit {
  id: string;
  name: string;
  type: string;
  colors: string[];
  cost: string | null;
}

/** The catalog ids a setup needs read (fillers are the probe's own). */
export function setupIds(setup: BoardSetup): string[] {
  return [...new Set([setup.leader, setup.theirLeader, ...(setup.hand ?? []), ...(setup.battle ?? []), ...(setup.drop ?? [])].filter((x): x is string => !!x && x !== SETUP_FILLER))];
}

/** Does it change anything? */
export function isEmptySetup(setup: BoardSetup): boolean {
  return !setup.leader && !setup.theirLeader && !setup.hand?.length && !setup.battle?.length && !setup.drop?.length && !setup.energy && !(setup.life?.you || setup.life?.them);
}

/** Where the owner's setup waits: one `sessionStorage` key per rule (or per development fixture), like the draft. */
export function setupKey(ruleId: number | null, fixture?: string): string {
  return ruleId != null ? `arena:sandbox:setup:rule:${ruleId}` : `arena:sandbox:setup:fixture:${fixture ?? ""}`;
}
