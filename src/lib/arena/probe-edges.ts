/**
 * Boards made from a rule's condition (#470): the edge where it flips.
 *
 * The probe's own boards are chosen by the rule's *trigger* — "it attacks",
 * "you play it" — and say nothing about the IF. "3 or more blue cards in your
 * drop area" is exactly the clause a builder gets wrong (3 or 2? or more, or
 * fewer?), and the only board that shows it is the pair on either side of
 * the line: 3 blue cards, and 2. So for every condition a rule carries — its
 * IF, its COST's condition, and the condition of each `if` among its steps —
 * this module names that pair as **knobs**: the few numbers the condition
 * itself reads (how many cards in that zone, a life total, whose turn it is),
 * keyed by the condition's `RulePath`. `probe.ts` stages the board the
 * trigger needs and then turns the knobs.
 *
 * | condition                 | boards                                       |
 * |---------------------------|----------------------------------------------|
 * | `count` (atLeast n)       | n and n − 1 matching cards in the zone       |
 * | `count` (atMost n)        | n and n + 1                                  |
 * | `life`                    | the threshold, and one past it               |
 * | `isTurnPlayer`            | your turn and theirs                         |
 * | `all` / `any` / `not`     | the pairs of its parts, the rest held so the part decides |
 * | anything else             | no pair; `edgeNotes` says so                  |
 *
 * A board is a scenario like any other: its key is the base board's key, a
 * `|`, and the knobs (`attack|cond=3`), so a judged board can be re-staged
 * from the key alone (`scenarioFromKey`) after the rule that made it has
 * changed. Pure and client-safe: no engine, no database.
 */
import type { Rule } from "./lang/ast";
import { childPath, resolvePath, type RulePath } from "./lang/path";
import type { Cond, CostRecord, Op, Selector } from "./vm/script";
import { describeFilter } from "./vm/script-schema";
import type { BoardKnobs, KnobValue, ProbeRule, ProbeScenario } from "./probe-types";
import { looksHoisted } from "./probe-trace";

// ── the rule as the language holds it ───────────────────────────────────────

/**
 * The rule a probe is trying, as a `Rule` — the shape `RulePath` is relative
 * to. A hoisted row's program is its IF wrapped back around its steps
 * (`programOf`); this unwraps it again. Only the fields a path can reach are
 * filled: the price is the record's two halves the probe carries.
 */
export function ruleViewOf(rule: ProbeRule): Rule {
  const hoisted = rule.hoisted ?? looksHoisted(rule.ops);
  const wrapper = hoisted && rule.ops[0]?.op === "if" ? rule.ops[0] : null;
  const cost = rule.price.condition || rule.price.ops ? ({ condition: rule.price.condition, program: rule.price.ops } as unknown as CostRecord) : null;
  return {
    kind: rule.kind,
    trigger: rule.trigger as Rule["trigger"],
    cost,
    cond: wrapper ? wrapper.cond : null,
    ops: wrapper ? wrapper.then : rule.ops,
  };
}

/** Every condition in a rule that a board can be built around, with its path. */
export function conditionSites(view: Rule): { path: RulePath; cond: Cond }[] {
  const out: { path: RulePath; cond: Cond }[] = [];
  if (view.cond) out.push({ path: "cond", cond: view.cond });
  const priceCond = (view.cost as { condition?: Cond | null } | null)?.condition;
  if (priceCond) out.push({ path: "cost.condition", cond: priceCond });
  const walk = (ops: Op[], base: RulePath) =>
    ops.forEach((op, i) => {
      const at = childPath(base, i);
      if (op.op === "if") {
        out.push({ path: childPath(at, "cond"), cond: op.cond });
        walk(op.then, childPath(at, "then"));
        if (op.else) walk(op.else, childPath(at, "else"));
      } else if (op.op === "may" || op.op === "delay") walk(op.ops, childPath(at, "ops"));
      else if (op.op === "chooseMode") op.modes.forEach((m, k) => walk(m.ops, childPath(at, "modes", k, "ops")));
    });
  walk(view.ops, "ops");
  return out;
}

// ── the knobs ───────────────────────────────────────────────────────────────

export type KnobKind = "count" | "life" | "turn";

/** One thing the "Change board" sheet can set: a condition leaf the probe knows how to stage. */
export interface KnobSpec {
  path: RulePath;
  kind: KnobKind;
  /** What the control sets, in words: "blue cards in your drop area", "your life", "whose turn it is". */
  label: string;
  min: number;
  max: number;
}

const LIFE_MAX = 8;
const COUNT_MAX = 10;

const ZONE_WORDS: Record<string, string> = {
  drop: "drop area",
  battle: "Battle Area",
  hand: "hand",
  energy: "Energy Area",
  life: "life",
  combo: "Combo Area",
  unison: "Unison Area",
  leader: "Leader Area",
  deck: "deck",
  warp: "Warp",
};

/** Whose zone a count reads, as the probe stages it: "both" is staged on your side. */
export function countSide(sel: Selector): "you" | "opponent" {
  return sel.side === "opponent" ? "opponent" : "you";
}

/** The one area a count is staged in: the first it names, or the Battle Area. */
export function countArea(sel: Selector): string {
  return sel.areas?.[0] ?? sel.area ?? "battle";
}

/** The areas the probe can put a counted card into. */
export const STAGEABLE_AREAS = ["hand", "battle", "energy", "drop", "combo", "life"] as const;

function cardsWords(sel: Selector, n: number | null): string {
  const what = sel.filter ? describeFilter(sel.filter).trim() : "";
  const plural = n !== 1;
  let noun: string;
  if (/\bcards?$/i.test(what)) noun = what.replace(/\bcards?$/i, plural ? "cards" : "card");
  else noun = `${what ? `${what} ` : ""}${plural ? "cards" : "card"}`;
  const whose = countSide(sel) === "opponent" ? "your opponent's" : "your";
  const area = countArea(sel);
  return `${n === null ? "" : `${n} `}${noun} in ${whose} ${ZONE_WORDS[area] ?? area}`;
}

/** The knob a condition leaf offers, or null when the probe cannot stage it. */
export function knobOf(path: RulePath, cond: Cond): KnobSpec | null {
  if (cond.kind === "count") return { path, kind: "count", label: cardsWords(cond.sel, null), min: 0, max: COUNT_MAX };
  if (cond.kind === "life") return { path, kind: "life", label: cond.side === "opponent" ? "your opponent's life" : "your life", min: 1, max: LIFE_MAX };
  if (cond.kind === "isTurnPlayer") return { path, kind: "turn", label: "whose turn it is", min: 0, max: 1 };
  return null;
}

/** Every knob the rule's conditions offer, for the "Change board" sheet. */
export function knobSpecs(view: Rule): KnobSpec[] {
  const out: KnobSpec[] = [];
  const leaf = (cond: Cond, path: RulePath) => {
    if (cond.kind === "all" || cond.kind === "any") cond.conds.forEach((c, i) => leaf(c, childPath(path, "conds", i)));
    else if (cond.kind === "not") leaf(cond.cond, childPath(path, "cond"));
    else {
      const k = knobOf(path, cond);
      if (k) out.push(k);
    }
  };
  for (const site of conditionSites(view)) leaf(site.cond, site.path);
  return out;
}

/** One knob's setting, in words: "3 blue cards in your drop area", "your life at 4", "the opponent's turn". */
export function knobWords(view: Rule, path: RulePath, value: KnobValue): string {
  const cond = resolvePath(view, path) as Cond | undefined;
  if (!cond || typeof cond !== "object") return `${path} = ${value}`;
  if (cond.kind === "count") return cardsWords(cond.sel, typeof value === "number" ? value : 0);
  if (cond.kind === "life") return `${cond.side === "opponent" ? "your opponent's" : "your"} life at ${value}`;
  if (cond.kind === "isTurnPlayer") return value === "opponent" ? "the opponent's turn" : "your turn";
  return `${path} = ${value}`;
}

// ── the met / not-met pairs ─────────────────────────────────────────────────

/** The knob values that make one condition come out `want`, or null when the probe cannot. */
function setting(cond: Cond, path: RulePath, want: boolean): BoardKnobs | null {
  switch (cond.kind) {
    case "count":
    case "life": {
      const floor = cond.kind === "life" ? 1 : 0;
      const ceil = cond.kind === "life" ? LIFE_MAX : COUNT_MAX;
      const lo = cond.atLeast ?? (cond.atMost === undefined ? (cond.kind === "count" ? 1 : null) : null);
      const hi = cond.atMost ?? null;
      let v: number | null;
      if (want) v = lo ?? hi ?? null;
      else if (lo !== null && lo - 1 >= floor) v = lo - 1;
      else if (hi !== null) v = hi + 1;
      else v = null;
      if (v === null || v < floor || v > ceil) return null;
      return { [path]: v };
    }
    case "isTurnPlayer": {
      const mine = (cond.who ?? "you") === "you";
      return { [path]: mine === want ? "you" : "opponent" };
    }
    case "not":
      return setting(cond.cond, childPath(path, "cond"), !want);
    case "all":
    case "any": {
      // Every part `want` for an `all` that holds / an `any` that fails; one
      // part decides otherwise. The first part the probe can set is that one.
      const everyPart = (cond.kind === "all") === want;
      const parts = cond.conds.map((c, i) => setting(c, childPath(path, "conds", i), everyPart ? want : !want));
      if (everyPart) return parts.every((p) => p) ? Object.assign({}, ...parts) : null;
      const decider = cond.conds.findIndex((c, i) => setting(c, childPath(path, "conds", i), want));
      if (decider < 0) return null;
      const rest = parts.filter((_, i) => i !== decider);
      if (!rest.every((p) => p)) return null;
      return Object.assign({}, ...rest, setting(cond.conds[decider], childPath(path, "conds", decider), want));
    }
    default:
      return null;
  }
}

/** The [met, not met] pairs a condition gives: one per leaf the probe can stage, its siblings held so it decides. */
function pairsOf(cond: Cond, path: RulePath): [BoardKnobs, BoardKnobs][] {
  switch (cond.kind) {
    case "count":
    case "life":
    case "isTurnPlayer": {
      const met = setting(cond, path, true);
      const unmet = setting(cond, path, false);
      return met && unmet ? [[met, unmet]] : [];
    }
    case "not":
      return pairsOf(cond.cond, childPath(path, "cond")).map(([a, b]) => [b, a]);
    case "all":
    case "any": {
      // An `all` holds its other parts true, an `any` holds them false, so the
      // part under test is the one that decides.
      const hold = cond.kind === "all";
      const out: [BoardKnobs, BoardKnobs][] = [];
      cond.conds.forEach((part, i) => {
        const others = cond.conds.map((c, j) => (j === i ? {} : setting(c, childPath(path, "conds", j), hold)));
        if (others.some((o) => o === null)) return;
        const held = Object.assign({}, ...others) as BoardKnobs;
        for (const [a, b] of pairsOf(part, childPath(path, "conds", i))) out.push([{ ...held, ...a }, { ...held, ...b }]);
      });
      return out;
    }
    default:
      return [];
  }
}

/** The condition kinds in a rule the probe has no edge board for yet — said on the default board. */
export function edgeNotes(view: Rule): string[] {
  const kinds = new Set<string>();
  const leaf = (cond: Cond) => {
    if (cond.kind === "all" || cond.kind === "any") cond.conds.forEach(leaf);
    else if (cond.kind === "not") leaf(cond.cond);
    else if (!["count", "life", "isTurnPlayer"].includes(cond.kind)) kinds.add(cond.kind);
  };
  for (const site of conditionSites(view)) leaf(site.cond);
  return [...kinds].map((k) => `no edge board for ${k} yet`);
}

// ── keys and titles ─────────────────────────────────────────────────────────

/** `cond=3,cost.condition=opponent` — paths sorted, so one board has one key. */
export function encodeKnobs(knobs: BoardKnobs): string {
  return Object.keys(knobs)
    .sort()
    .map((p) => `${p}=${knobs[p]}`)
    .join(",");
}

export function decodeKnobs(text: string): BoardKnobs {
  const out: BoardKnobs = {};
  for (const part of text.split(",")) {
    if (!part) continue;
    const eq = part.lastIndexOf("=");
    if (eq < 1) continue;
    const raw = part.slice(eq + 1);
    out[part.slice(0, eq)] = raw === "you" || raw === "opponent" ? raw : Number(raw);
  }
  return out;
}

/** The base board's key and the knobs, from a board key: `attack|cond=3` → `attack` + `{cond: 3}`. */
export function splitKey(key: string): { base: string; knobs: BoardKnobs } {
  const bar = key.indexOf("|");
  return bar < 0 ? { base: key, knobs: {} } : { base: key.slice(0, bar), knobs: decodeKnobs(key.slice(bar + 1)) };
}

export function keyOf(base: string, knobs: BoardKnobs): string {
  const k = encodeKnobs(knobs);
  return k ? `${base}|${k}` : base;
}

/** The base board in a word or two, for an edge board's title: "Attacks · 3 blue cards in your drop area". */
export function edgeTitle(view: Rule, short: string, knobs: BoardKnobs): string {
  return [short, ...Object.keys(knobs).sort().map((p) => knobWords(view, p, knobs[p]))].join(" · ");
}

/** The edge boards for a rule, built on its default board. Met first, then not met; no key twice. */
export function edgeScenarios(rule: ProbeRule, base: ProbeScenario, short: string): ProbeScenario[] {
  const view = ruleViewOf(rule);
  const out: ProbeScenario[] = [];
  const seen = new Set<string>([base.key]);
  for (const site of conditionSites(view)) {
    for (const pair of pairsOf(site.cond, site.path)) {
      for (const knobs of pair) {
        const key = keyOf(base.key, knobs);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ...base, key, title: edgeTitle(view, short, knobs), knobs });
      }
    }
  }
  return out;
}
