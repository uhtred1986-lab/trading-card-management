/**
 * The skill explainer (`docs/arena-skill-explainer.md`): a skill told the way a player says it at a real table —
 * who uses what, each thing it does, then what changed. The Explain pace's whole story, and the default pace since
 * the owner's decisions of 13 Nov 2026.
 *
 * Pure and React-free. The beat player asks `explainRoles` how long each beat is held at the Explain pace
 * (`stage/motion.ts`), and the presenter (`stage/SkillExplainer.tsx`) asks `explainMoment` what to say. Both read
 * the one grouping below, so the timing and the words cannot disagree about which beat is which step.
 *
 * A moment is a `skill` beat and the beats its `steps` says it did — or a `resume` beat and the beats it did after a
 * decision, told as more of the same skill without a second callout. That count is the engine's (`relateBeats`):
 * only a batch knows where one action's story ends, and a client guessing from the merged stream would take the
 * next action's energy payment for the last skill's effect. Inside a moment:
 *
 *  - a beat that only trails another joins its step: the draw marker after its card flew, the card a KO sends to
 *    the Drop. Life cards leaving before a damage beat lead into the damage.
 *  - several of the same thing in a row — three cards milled, two energy rested, two cards drawn — are one step,
 *    said in one sentence (`narrateRun`). The last of them holds the step, so the sentence is on screen once all of
 *    them have happened, never before.
 *
 * Nothing here decides what is shown: the beats are already masked for the viewer (`maskBeats`), and a card is
 * named only where `narrate` would name it.
 */
import type { Beat, NumberedBeat } from "./beats";
import type { PlayerId } from "./types";
import { KEYWORD_RULES } from "./keyword-rules.generated";
import { narrateRun, type Narrator } from "./narration";
import { dbsWords, type BoardWords } from "./board-words";

/** What one beat is in a skill being explained. Beats outside every moment have none. */
export type ExplainRole =
  /** The skill beat: the callout. `mine` when it is the viewer's own skill; `steps`, how many steps follow. */
  | { kind: "callout"; mine: boolean; steps: number }
  /** A skill going on after a decision (`resume`): no callout again, only its further steps. */
  | { kind: "resume"; mine: boolean; steps: number }
  /**
   * A beat of step `index` of `of`. `hold` on the beat the step is held after (at least `EXPLAIN.step` at the
   * Explain pace); `receipt` on the moment's last beat, which the receipt is held after.
   */
  | { kind: "step"; index: number; of: number; hold: boolean; receipt: boolean };

type SkillBeat = Extract<NumberedBeat, { t: "skill" }> | Extract<NumberedBeat, { t: "resume" }>;

interface Step {
  beats: NumberedBeat[];
  /** The beat the step is held after. */
  hold: NumberedBeat;
  /** The beats its sentence is made from. */
  said: Beat[];
}

interface Moment {
  skill: SkillBeat;
  steps: Step[];
  /** The moment's last beat, the skill beat itself when it has no steps. */
  last: NumberedBeat;
}

/** A beat that only finishes the one before it. */
function trails(head: NumberedBeat, b: NumberedBeat): boolean {
  if (b.t === "draw") return head.t === "move" && head.from === "deck" && head.to === "hand" && head.owner === b.player;
  if (b.t === "move") return head.t === "ko" && head.card === b.card;
  return false;
}

/** The run a unit belongs to, or null when it is never told together with the next. */
function runKey(unit: { beats: NumberedBeat[]; head: NumberedBeat }): string | null {
  const h = unit.head;
  switch (h.t) {
    case "move":
      return unit.beats.some((b) => b.t === "draw") ? `draw:${h.owner}` : `move:${h.from}>${h.to}:${h.owner}`;
    case "mode":
      return `mode:${h.mode}`;
    case "ko":
      return "ko";
    case "under":
      return `under:${h.host}`;
    case "effect":
      return h.card ? `effect:${h.kind}:${h.label}:${h.until}` : null;
    default:
      return null;
  }
}

function stepsOf(span: NumberedBeat[]): Step[] {
  // Units first: a head with the beats leading into it and trailing it.
  const units: { beats: NumberedBeat[]; head: NumberedBeat }[] = [];
  let lead: NumberedBeat[] = [];
  for (const b of span) {
    const prev = units[units.length - 1];
    if (!lead.length && prev && trails(prev.head, b)) {
      prev.beats.push(b);
      continue;
    }
    if (b.t === "move" && b.from === "life") {
      lead.push(b);
      continue;
    }
    if (b.t === "damage") {
      units.push({ beats: [...lead, b], head: b });
      lead = [];
      continue;
    }
    for (const l of lead) units.push({ beats: [l], head: l });
    lead = [];
    units.push({ beats: [b], head: b });
  }
  for (const l of lead) units.push({ beats: [l], head: l });

  // Then runs of the same thing, told as one step.
  const steps: Step[] = [];
  let run: typeof units = [];
  const close = () => {
    if (!run.length) return;
    const draws = runKey(run[0])?.startsWith("draw:") ?? false;
    steps.push({
      beats: run.flatMap((u) => u.beats),
      hold: run[run.length - 1].head,
      said: draws ? run.map((u) => u.beats.find((b) => b.t === "draw") ?? u.head) : run.map((u) => u.head),
    });
    run = [];
  };
  for (const u of units) {
    const key = runKey(u);
    if (run.length && (key === null || key !== runKey(run[0]))) close();
    run.push(u);
    if (key === null) close();
  }
  close();
  return steps;
}

/** Every skill beat in `list` with the beats it did, as steps. */
function momentsOf(list: readonly NumberedBeat[]): Moment[] {
  const out: Moment[] = [];
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (b.t !== "skill" && b.t !== "resume") continue;
    const span = list.slice(i + 1, i + 1 + (b.steps ?? 0));
    out.push({ skill: b, steps: stepsOf(span), last: span[span.length - 1] ?? b });
  }
  return out;
}

/**
 * The role of every beat that is part of a skill being explained, keyed by beat number. The beat player reads it
 * to hold each beat at the Explain pace (`msFor`); the presenter reads it to know whether a beat is the callout or
 * which step it belongs to.
 */
export function explainRoles(list: readonly NumberedBeat[], viewer: PlayerId): Map<number, ExplainRole> {
  const roles = new Map<number, ExplainRole>();
  for (const m of momentsOf(list)) {
    roles.set(m.skill.n, { kind: m.skill.t === "resume" ? "resume" : "callout", mine: m.skill.owner === viewer, steps: m.steps.length });
    m.steps.forEach((s, j) => {
      for (const b of s.beats) roles.set(b.n, { kind: "step", index: j + 1, of: m.steps.length, hold: b === s.hold, receipt: b === m.last });
    });
  }
  return roles;
}

/** What the presenter says about one moment. */
export interface ExplainedMoment {
  /** The skill beat's number: the moment's identity. */
  key: number;
  card: string;
  owner: PlayerId;
  mine: boolean;
  /** The card's name, when the viewer may see it. */
  name: string | null;
  /** The skill's tag ("Swap 2", "Auto"), "Skill" when masked. */
  label: string;
  /** The speech bubble's line: "I use 《Swap 2》" from the opponent, "You use 《Swap 2》" for yours. */
  headline: string;
  /** The words of the printed text that say when it fires ("When this card attacks,"), shown highlighted. */
  trigger: string | null;
  /** The rest of the printed text, its leading tags taken off (they are on the label). */
  body: string;
  /** The keyword's one-line meaning, when the skill is a keyword skill the glossary knows. */
  keyword: { name: string; meaning: string } | null;
  /** One sentence per step. */
  steps: string[];
  /** What changed, said once the last step has happened. Null when nothing visible did. */
  receipt: string | null;
  /** The skill found nothing to act on (`relateBeats`). */
  noEffect: boolean;
  /** More of a skill told before a decision (`resume`): no callout, only steps. */
  resumed: boolean;
}

/** A tag as a player reads it: "ex-evolve" → "Ex-Evolve", "dual attack" → "Dual Attack". */
function titled(tag: string): string {
  return tag.replace(/(^|[\s-])([a-z])/g, (_, before: string, c: string) => before + c.toUpperCase());
}

const spelling = (s: string) => s.toLowerCase().replace(/[[\]]/g, "").replace(/\s*:\s*/g, ": ").replace(/[\s-]+/g, " ").trim();
const KEYWORD_SPELLINGS = KEYWORD_RULES.flatMap((rule) => rule.spellings.map((s) => [spelling(s), rule] as const)).sort((a, b) => b[0].length - a[0].length);

/** The glossary's meaning for a skill's tag ("Swap 2", "Over Realm 7", "Union Absorb"), or null for a skill type. */
function keywordOf(label: string): { name: string; meaning: string } | null {
  const t = spelling(label);
  const rule = KEYWORD_SPELLINGS.find(([s]) => t === s || t.startsWith(`${s} `))?.[1];
  return rule ? { name: titled(label.replace(/[[\]]/g, "").trim()), meaning: rule.meaning } : null;
}

/** The skill-type labels a card's own tag says nothing more than (`SKILL_LABELS`): a receipt does not repeat them. */
const GENERIC = /^(?:auto|permanent|keyword|skill|activate: ?(?:main|battle|main\/battle)|counter(?:: ?[a-z ]+)?)$/i;

/** The label to show: the engine's tag, or for a bare "Keyword" the first tag the printed text opens with. */
function shownLabel(label: string, text: string): string {
  const bare = label.replace(/[[\]]/g, "").trim() || "Skill";
  const first = /^\s*\[([^\]]+)\]/.exec(text)?.[1]?.trim();
  return titled(/^keyword$/i.test(bare) && first ? first : bare);
}

/** The printed text split at its trigger words, the leading tags taken off. */
export function splitTrigger(text: string): { trigger: string | null; body: string } {
  const plain = text.replace(/\s+/g, " ").trim().replace(/^(?:\s*\[[^\]]+\])+\s*/, "").trim();
  const m = /^((?:when(?:ever)?|each time|at the (?:start|end|beginning) of|during|after)\b[^,.:]*[,:])\s*/i.exec(plain);
  return m ? { trigger: m[1].trim(), body: plain.slice(m[0].length).trim() } : { trigger: null, body: plain };
}

/** The receipt's short items, at most three: "Son Goku in play", "2 cards drawn", "Bardock +5000 power [Critical]". */
function receiptItems(m: Moment, n: Narrator): string[] {
  const name = (id: string) => n.art[id]?.name ?? null;
  const out: string[] = [];
  // Several effects on one card are one item: "The Masked Saiyan [Critical] +5,000 power".
  const effectsOn = new Map<string, number>();
  for (const s of m.steps) {
    const h = s.hold;
    const count = s.said.length;
    let item: string | null = null;
    switch (h.t) {
      case "move": {
        if (s.beats.some((b) => b.t === "draw")) item = `${count} card${count === 1 ? "" : "s"} drawn`;
        else {
          const named = count === 1 ? name(h.card) : null;
          const who = named ?? `${count} card${count === 1 ? "" : "s"}`;
          const hiddenEnd = (a: string) => a === "deck" || a === "life";
          if (h.onto && (h.to === "battle" || h.to === "unison" || h.to === "leader")) item = `${who} on top of ${name(h.onto) ?? "a card"}`;
          else if (h.to === "battle" || h.to === "unison" || h.to === "leader") item = `${who} in play`;
          else if (h.to === "hand" && !hiddenEnd(h.from)) item = `${who} in hand`;
          else if (h.to === "hand") item = `${count} card${count === 1 ? "" : "s"} to hand`;
          else if (h.to === "drop") item = `${who} in the Drop`;
          else if (h.to === "warp") item = `${who} in the Warp`;
          else if (h.to === "removed") item = `${who} removed`;
          else if (h.to === "energy") item = `${count} to energy`;
        }
        break;
      }
      case "ko":
        item = count === 1 ? `${name(h.card) ?? "a card"} KO'd` : `${count} cards KO'd`;
        break;
      case "effect": {
        const on = count === 1 && h.card ? (name(h.card) ?? "a card") : null;
        const at = on ? effectsOn.get(on) : undefined;
        if (on && at !== undefined) {
          out[at] = `${out[at]} ${h.label}`;
          continue;
        }
        item = on ? `${on} ${h.label}` : h.card ? `${count} cards ${h.label}` : h.label;
        if (on) effectsOn.set(on, out.length);
        break;
      }
      case "look":
        item = h.search ? "deck searched" : `looked at ${h.count}`;
        break;
      case "markers":
        item = `${name(h.card) ?? "a card"}: ${h.total} marker${h.total === 1 ? "" : "s"}`;
        break;
      case "damage":
        item = `${h.amount} damage`;
        break;
      case "negated":
        item = "attack negated";
        break;
      case "flip":
        item = `${name(h.card) ?? "a card"} awakened`;
        break;
      case "under":
        item = `${count === 1 ? (name(h.card) ?? "a card") : `${count} cards`} under ${name(h.host) ?? "a card"}`;
        break;
      case "token":
        item = `${name(h.card) ?? "a token"} in play`;
        break;
      default:
        item = null;
    }
    if (item && !out.includes(item)) out.push(item);
  }
  return out.slice(0, 3);
}

/**
 * The moment the beat numbered `n` belongs to, said for this viewer, and where in it that beat is: 0 for the
 * callout, `i` for step `i`. Null when the beat is part of no skill being explained.
 */
export function explainMoment(list: readonly NumberedBeat[], n: number, narrator: Narrator, words: BoardWords = dbsWords()): { moment: ExplainedMoment; at: number; role: ExplainRole } | null {
  for (const m of momentsOf(list)) {
    let at = -1;
    if (m.skill.n === n) at = 0;
    else m.steps.forEach((s, j) => s.beats.some((b) => b.n === n) && (at = j + 1));
    if (at < 0) continue;
    const role = explainRoles([m.skill, ...m.steps.flatMap((s) => s.beats)], narrator.viewer).get(n)!;
    const b = m.skill;
    const mine = b.owner === narrator.viewer;
    const name = narrator.art[b.card]?.name ?? null;
    const text = b.t === "skill" ? b.text : "";
    // A skill going on after a decision is named as it was announced: the last `skill` beat of the same card.
    const announced = b.t === "resume" ? [...list].reverse().find((x): x is Extract<NumberedBeat, { t: "skill" }> => x.t === "skill" && x.card === b.card && x.n < b.n) : undefined;
    const label = announced ? shownLabel(announced.label, announced.text) : shownLabel(b.label, text);
    const masked = !name || (b.t === "skill" ? !text : label === "Skill");
    const { trigger, body } = masked || !text ? { trigger: null, body: "" } : splitTrigger(text);
    const extra = b.t === "skill" && !!b.extra;
    const using = extra ? (name ? `the Extra ${name}` : "an Extra card") : masked ? "a skill" : `《${label}》`;
    const items = receiptItems(m, narrator);
    return {
      moment: {
        key: b.n,
        card: b.card,
        owner: b.owner,
        mine,
        name,
        label: masked ? "Skill" : label,
        headline: mine ? `You use ${using}` : `I use ${using}`,
        trigger,
        body,
        keyword: masked ? null : keywordOf(label),
        steps: m.steps.map((s) => narrateRun(s.said, narrator, words) ?? ""),
        receipt: m.steps.length ? (masked || GENERIC.test(label) ? (items.length ? `Done: ${items.join(", ")}` : "Done") : `${label} done${items.length ? `: ${items.join(", ")}` : ""}`) : null,
        noEffect: b.t === "skill" && !!b.noEffect,
        resumed: b.t === "resume",
      },
      at,
      role,
    };
  }
  return null;
}
