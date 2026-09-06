/**
 * Something in force, put into a shape a client can draw
 * (`docs/arena-compiler-workflow-review.md` §3.3).
 *
 * The engine keeps two kinds of standing rule: continuous effects with a
 * duration (`state.effects`, 9-9) and the static effects [Permanent] skills
 * emit while their card is where the skill is valid (9-5-1). Neither used to
 * reach a client as a *thing* — a card simply had a different number. This is
 * the one place either becomes a short label, a kind and a duration, used by
 * the board view (what is on a card right now), the beat stream (an effect
 * beginning or ending) and the wording of a refusal.
 *
 * Pure: no database, no React. Covered by `npm test`, and the table the
 * Android app carries in Kotlin.
 */
import { FORBIDDEN_IN_WORDS, describeFilter } from "./engine/compile";
import type { StaticEffect } from "./engine/state";
import type { ContinuousEffect, EffectUntil, KeywordSkill, Permission, PlayerId, Prohibition, SkillKindPrefix } from "./engine/types";

export type EffectKind = "power" | "comboPower" | "keyword" | "negate" | "forbid" | "permit" | "cost" | "other";

/** One rule in force on a card or a player, as the board shows it. */
export interface EffectView {
  kind: EffectKind;
  /** What it does, as a short phrase: "+5000 power", "[Critical]", "can't attack", "skills negated", "costs 1 less". */
  label: string;
  /** How long it holds; "permanent" while the source card's [Permanent] skill is valid. */
  until: EffectUntil;
  /** The card whose skill made it — an instance id — or null when the rules themselves did. */
  source: string | null;
  /** That card's name, captured now, because the card may leave the board. */
  sourceName: string | null;
  /** Whose skill made it. */
  by: PlayerId | null;
  /** The keyword granted, when `kind` is "keyword", so a client can mark that glyph as granted rather than printed. */
  keyword?: string;
}

/** The printed name of a keyword, with its number folded in: [Double Strike], [Over Realm 4]. */
export function keywordName(k: KeywordSkill): string {
  switch (k.name) {
    case "Strike":
      return { 2: "Double Strike", 3: "Triple Strike", 4: "Quadruple Strike" }[k.x];
    case "Attack":
      return k.x === 2 ? "Dual Attack" : "Triple Attack";
    case "Over Realm":
      return `${k.dark ? "Dark " : ""}Over Realm ${k.x}`;
    case "Swap":
      return `Swap ${k.x}`;
    case "Spirit Boost":
      return `Spirit Boost ${k.x}`;
    case "Z-Stack":
      return `Z-Stack ${k.x}`;
    case "Empower":
      return `Empower ${k.color ?? ""} ${k.x}`.replace(/\s+/g, " ").trim();
    case "Arrival":
    case "Aegis":
    case "Alliance":
    case "Revive":
      return `${k.name} ${k.colors.join("/")}`;
    case "Evolve":
      return k.variant;
    case "Union":
      return `Union-${k.variant}`;
    default:
      return k.name;
  }
}

const KIND_WORDS: Record<SkillKindPrefix, string> = { auto: "Auto", activate: "Activate", counter: "Counter", permanent: "Permanent" };

const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toLocaleString("en")}`;

function forbidLabel(f: Prohibition): string {
  const what = FORBIDDEN_IN_WORDS[f.what];
  const which = f.name ? `copies of ${f.name}` : f.filter ? describeFilter(f.filter) : "";
  // "…can't play **cards**" already names the object; a description of which
  // cards replaces that word rather than following it.
  return `can't ${which ? what.replace(/\s+cards?$/, "") : what}${which ? ` ${which}` : ""}`;
}

function permitLabel(p: Permission): string {
  return `can attack ${p.filter ? describeFilter(p.filter) : "cards"} in Active Mode`;
}

/** The kind, label and keyword of a continuous effect (9-9). */
export function describeEffect(e: ContinuousEffect): Pick<EffectView, "kind" | "label" | "keyword"> {
  switch (e.kind) {
    case "power":
      return { kind: "power", label: `${signed(e.value as number)} power` };
    case "comboPower":
      return { kind: "comboPower", label: `${signed(e.value as number)} combo power` };
    case "keyword": {
      const k = e.value as KeywordSkill;
      return { kind: "keyword", label: `[${keywordName(k)}]`, keyword: k.name };
    }
    case "negateSkills":
      return { kind: "negate", label: "skills negated" };
    case "negateSkill":
      return { kind: "negate", label: "one skill negated" };
    case "negateSkillKind":
      return { kind: "negate", label: `[${KIND_WORDS[e.value as SkillKindPrefix]}] skills negated` };
    case "forbid":
      return { kind: "forbid", label: e.forbid ? forbidLabel(e.forbid) : "forbidden" };
    case "permit":
      return { kind: "permit", label: e.permit ? permitLabel(e.permit) : "permitted" };
  }
}

/** The same for a standing effect a [Permanent] skill emits. */
export function describeStatic(e: StaticEffect): Pick<EffectView, "kind" | "label" | "keyword"> {
  switch (e.kind) {
    case "power":
      return { kind: "power", label: `${signed(e.value as number)} power` };
    case "comboPower":
      return { kind: "comboPower", label: `${signed(e.value as number)} combo power` };
    case "keyword": {
      const k = e.value as KeywordSkill;
      return { kind: "keyword", label: `[${keywordName(k)}]`, keyword: k.name };
    }
    case "cost": {
      const n = e.value as number;
      return { kind: "cost", label: n < 0 ? `costs ${-n} more` : `costs ${n} less` };
    }
    case "comboCost": {
      const n = e.value as number;
      return { kind: "cost", label: n < 0 ? `combo costs ${-n} more` : `combo costs ${n} less` };
    }
    case "negateKeyword":
      return { kind: "negate", label: `[${e.value as string}] negated` };
    case "forbid":
      return { kind: "forbid", label: forbidLabel(e.value as Prohibition) };
    case "permit":
      return { kind: "permit", label: permitLabel(e.value as Permission) };
    case "gains": {
      const g = e.value as { traits: string[]; characters: string[]; colors: string[] };
      const bits = [...g.colors.map((c) => c.toLowerCase()), ...g.traits.map((t) => `≪${t}≫`), ...g.characters.map((c) => `<${c}>`)];
      return { kind: "other", label: `counts as ${bits.join(" ") || "more"}` };
    }
    case "replaceLeave": {
      const r = e.value as { to: string };
      return { kind: "other", label: `goes to the ${r.to} instead of leaving` };
    }
    case "altCost":
      return { kind: "cost", label: "another way to pay" };
  }
}

/**
 * How long a rule holds, from the viewer's chair. The two turn-relative
 * durations are written from the *master's* point of view, so "until the end
 * of your opponent's turn" on Claude's effect is your turn, not Claude's.
 */
export function untilWords(until: EffectUntil, o: { master: PlayerId | null; viewer: PlayerId; them: string; sourceName?: string | null }): string {
  const mine = o.master === o.viewer;
  switch (until) {
    case "turn":
      return "until the end of the turn";
    case "battle":
      return "for the battle";
    case "nextTurn":
      // Ends as the master's next turn begins.
      return mine ? "until the start of your next turn" : `until the start of ${o.them}'s next turn`;
    case "opponentTurn":
      // Ends as the master's opponent's next turn begins.
      return mine ? `until the start of ${o.them}'s next turn` : "until the start of your next turn";
    case "afterNextCharge":
      return "through the next Charge Phase";
    case "game":
      return "for the rest of the game";
    case "permanent":
      return o.sourceName ? `while ${o.sourceName} is in play` : "while its card is in play";
  }
}

/** One line for a rule in force, as the card sheet lists it: what, how long, from whom. */
export function effectLine(e: EffectView, o: { viewer: PlayerId; them: string; self?: string }): string {
  const when = untilWords(e.until, { master: e.by, viewer: o.viewer, them: o.them, sourceName: e.sourceName });
  const from = e.source && e.source === o.self ? "its own [Permanent]" : e.sourceName;
  return `${e.label} · ${when}${from && e.until !== "permanent" ? ` · from ${from}` : from && e.source === o.self ? ` · ${from}` : ""}`;
}
