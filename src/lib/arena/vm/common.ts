/**
 * The helpers both engines and the compiler share that are not about one
 * engine's state: a card face's records, the copied-skill index (20-18),
 * token ids (19), the replacement redirect test (9-10), side resolution, and
 * the one error an engine throws for a move it will not take. Moved out of the
 * legacy `engine/state.ts` and `engine/engine.ts` (#118).
 *
 * Pure: no database, no network, no `fs`.
 */
import { NO_RULES, type CardScripts, type Op, type Side } from "./script";
import { other, type Area, type CardDef, type Color, type GameContext, type PlayerId } from "../types";

/** The programs of one card face, as the game was given them. */
export function programsOf(ctx: GameContext, d: CardDef, side: "front" | "back"): CardScripts {
  return ctx.scripts?.[side === "back" ? `${d.id}#back` : d.id] ?? NO_RULES;
}

/**
 * Where a copied skill's index starts (20-18). A skill's own index is its line
 * number times ten (`parseSkills`), so a copy needs an index of its own or it
 * would answer to — and be silenced with — a skill the target really prints.
 * The effect's id makes it unique and stable: the same copy keeps the same
 * index for as long as it is in force, so an activation recorded in the action
 * log replays onto the same skill.
 */
export const COPIED_SKILL_BASE = 100000;

export const copiedSkillIndex = (effectId: number, sourceIndex: number): number => COPIED_SKILL_BASE + effectId * 1000 + sourceIndex;

/** Whether a skill index names a copy rather than something the card prints. */
export const isCopiedSkill = (index: number): boolean => index >= COPIED_SKILL_BASE;

/**
 * Tokens (19) are made by effects and have no catalog row, so their whole
 * definition lives in the card id. Encoding it there rather than in a context
 * that only lives for one request keeps a saved game reloadable.
 */
export function tokenCardId(name: string, power: number, comboCost: number | null, comboPower: number | null, colors: Color[]): string {
  return `TOKEN:${encodeURIComponent(name)}:${power}:${comboCost ?? ""}:${comboPower ?? ""}:${colors.join(",")}`;
}

export function tokenDefOf(cardId: string): CardDef {
  const [, name, power, comboCost, comboPower, colors] = cardId.split(":");
  const num = (x: string) => (x === "" ? null : Number(x));
  return {
    id: cardId,
    name: decodeURIComponent(name ?? "Token"),
    type: "TOKEN",
    colors: (colors ? colors.split(",") : []).filter(Boolean) as Color[],
    energyCost: null,
    zEnergyCost: null,
    power: num(power ?? "") ?? 0,
    comboCost: num(comboCost ?? ""),
    comboPower: num(comboPower ?? ""),
    skill: null,
    characters: [],
    traits: [],
  };
}

/**
 * Is this `with` block a plain **redirect** — the card itself going somewhere
 * else — rather than a program standing in for the departure? One move of the
 * card whose event it is, to an area a card can be in, is the shape
 * `replaceLeave` prints and the only one `move()` can honour by changing a
 * destination. Everything else is a substitute, and runs.
 */
export function redirectOf(ops: Op[]): { to: Area; mode?: "active" | "rest" } | null {
  if (ops.length !== 1) return null;
  const only = ops[0];
  if (only.op !== "moveTo" || only.under || only.owner || only.to === "under" || only.to === "play") return null;
  const sel = "sel" in only.target ? only.target.sel : null;
  if (!sel || (sel.special !== "self" && sel.special !== "subject")) return null;
  return { to: only.to as Area, ...(only.mode ? { mode: only.mode } : {}) };
}

export function sideOf(master: PlayerId, side: Side | undefined): PlayerId[] {
  if (side === "opponent") return [other(master)];
  if (side === "both") return [master, other(master)];
  return [master];
}

/**
 * The same condition said from another chair. `describeCond` has no viewer —
 * "you" and "your opponent" in the language are always the script's own master
 * — but a refusal is read by whoever was refused, who is usually the *other*
 * player when a card forbids something. Every `side` in the language means the
 * one thing, so mirroring is flipping that word wherever it appears.
 */
export function mirrorSides<T>(x: T): T {
  if (Array.isArray(x)) return x.map(mirrorSides) as unknown as T;
  if (!x || typeof x !== "object") return x;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    out[k] = k === "side" && (v === "you" || v === "opponent") ? (v === "you" ? "opponent" : "you") : mirrorSides(v);
  }
  return out as T;
}

/** A move the engine will not take: not the asked player's, or not legal now. Both engines throw it. */
export class IllegalAction extends Error {}

/** Deck lists as `CardDef` maps, for building a context from catalog rows. */
export function defsFrom(cards: CardDef[]): Record<string, CardDef> {
  const out: Record<string, CardDef> = {};
  for (const c of cards) out[c.id] = c;
  return out;
}
