import type { Beats, NumberedBeat } from "@/lib/arena/beats";
import type { PlayerId } from "@/lib/arena/types";

/**
 * Skills that resolved and did nothing anyone could see (#783): "Vegeta's KO: no valid target".
 *
 * Read from the beats the board already gets — no engine change, no new Snapshot field. Two ways a
 * skill is known to have done nothing:
 *
 *  - **`noEffect`**, set by the engine's own beat translation (`relateBeats`, `beats-core.ts`): the
 *    batch's last beat, outside a battle, with the game back at a Main Phase prompt.
 *  - **Inferred here** for what `noEffect` does not cover — a skill inside a battle, or one followed by
 *    more of the turn. A `skill` beat is logged *before* its effect runs (`printedEffect`,
 *    `vm/script.ts`), so a skill whose next beat is another skill, an attack, a clash, a new phase or
 *    the end of the game moved no card, changed no mode and started no effect. Only a skill whose text
 *    targets something (it KOs, chooses, or takes "up to" some cards) is reported that way: a skill
 *    that only looks at cards, reveals or shuffles changes nothing a beat would show, and "nothing
 *    happened" would be false of it. A skill still waiting on its owner's answer (the prompt is a
 *    choice) is not reported.
 *
 * What it cannot see: a skill whose only effect is one no beat carries (a note in the engine's log)
 * still counts as having done something, so a no-target skill of that kind goes unreported rather
 * than a working one being called empty.
 */
export interface QuietSkill {
  /** The beat's number: a notice is acknowledged once, by this. */
  n: number;
  owner: PlayerId;
  /** The card's name as the beat's face carries it. */
  name: string;
  /** The skill kind ("Auto", "Activate: Main"…). */
  label: string;
  /** The printed effect, one line. */
  effect: string;
  /** True when the engine said so (`noEffect`); false when read off the beats around it. */
  engine: boolean;
}

/** What the next beat being one of these says: the skill before it resolved and changed nothing. */
const BOUNDARY = new Set<NumberedBeat["t"]>(["skill", "autoDeclared", "attack", "clash", "phase", "over"]);
/** Targeting words: the skill was after a card. */
const TARGETS = /\bK\.?\s?O\b|\bchoose\b|\bup to\b|\btarget/i;
/** Skills whose effect leaves no beat behind even when it works. */
const SILENT = /\blook at\b|\breveal\b|\bshuffle\b|\bsearch\b/i;
/** Prompts that mean a skill is still asking its owner something. */
const ASKING = new Set(["chooseCards", "chooseMode", "optionalCost", "payCost", "orderPending", "replaceMove", "empowerCarry", "offering", "zEnergyFromCombo", "referee"]);

const oneLine = (text: string) => {
  const clause = text.replace(/\s+/g, " ").trim().replace(/\.$/, "");
  return clause.length > 120 ? `${clause.slice(0, 118).replace(/[\s,.;:]+$/, "")}…` : `${clause}.`;
};

export function quietSkills(list: readonly NumberedBeat[], art: Beats["art"], promptKind: string): QuietSkill[] {
  const out: QuietSkill[] = [];
  list.forEach((b, i) => {
    if (b.t !== "skill") return;
    // A masked skill (the viewer may not see the card) is told as "uses a skill" and nothing more.
    const face = art[b.card];
    if (!face || !b.label) return;
    let engine = false;
    if (b.noEffect) engine = true;
    else {
      if (!TARGETS.test(b.text) || SILENT.test(b.text)) return;
      const next = list[i + 1];
      if (next) {
        if (!BOUNDARY.has(next.t)) return;
      } else if (!b.inBattle || ASKING.has(promptKind)) return;
    }
    out.push({ n: b.n, owner: b.owner, name: face.name, label: b.label, effect: oneLine(b.text), engine });
  });
  return out;
}

/**
 * Whether the skill prints a condition ("if there is a ≪Saiyan≫ card…"). The beats cannot tell an unmet
 * condition from a missing target, so a conditional skill's notice names both rather than guess.
 */
export const conditional = (q: QuietSkill) => /\bif\b|\bwhile\b|\bunless\b/i.test(q.effect);

/**
 * Whether the skill prints a cost before its effect ("Choose 1 card in your life and add it to your
 * hand: When this card attacks…"). An optional cost that was declined also leaves nothing behind, and
 * the beats cannot tell that from a missing target either.
 */
export const costed = (q: QuietSkill) => {
  const head = /^([^.:]*):/.exec(q.effect.replace(/\[[^\]]*\]/g, " ").trim());
  return !!head && !/^\s*(if|while|unless)\b/i.test(head[1]);
};

const uncertain = (q: QuietSkill) => conditional(q) || costed(q);

/** The notice's heading. */
export const quietTitle = (q: QuietSkill) => (uncertain(q) ? "Nothing happened" : "No valid target");

/** The notice's sentence, read from the viewer's chair. */
export function quietSentence(q: QuietSkill, viewer: PlayerId, them: string): string {
  const whose = q.owner === viewer ? "Your" : `${them}'s`;
  const why = uncertain(q) ? `it had no valid target, or its ${conditional(q) && costed(q) ? "condition or cost" : conditional(q) ? "condition" : "cost"} was not met` : "no valid target";
  return `${whose} ${q.name} — ${q.label}: ${why}, so nothing happened.`;
}

/** The chip a player sees: the card and two words ("Guldo · No effect"), nothing of the engine's reasoning. */
export const quietShort = (q: QuietSkill) => `${q.name} · No effect`;
