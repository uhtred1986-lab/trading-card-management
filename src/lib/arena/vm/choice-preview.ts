/** A bounded, read-only preview of a choice reached by a legal play or hand Extra activation. */
import type { EngineContext, LegalAction } from "../types";
import type { GameDefinition } from "../rulesets";
import type { ChoicePreview } from "../view";
import type { VmState } from "./state";
import type { Op, ScriptFrame, Selector } from "./script";
import { describeCond, describeSelector } from "./script-schema";
import { attrsNow, condHolds, hasKeyword, resolveSelector } from "./program";
import { skillsShowing } from "./triggers";
import { findCard } from "./zones";

const PUBLIC_AREAS = new Set(["battle", "unison", "combo", "energy", "drop", "warp", "zEnergy", "leader"]);

/** Only a first, independent choice can be predicted before the move is committed. */
function firstChoice(ops: Op[], ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame):
  | { choice: Extract<Op, { op: "choose" }> }
  | { condition: string }
  | null {
  if (ops.length === 0) return null;
  const first = ops[0];
  if (first.op === "if") {
    // Costs or the play itself can change other conditions before this skill
    // resolves. A Leader's printed match remains stable for this first pick.
    if (first.cond.kind !== "leaderMatches" && first.cond.kind !== "leaderColor") return null;
    if (first.else?.length) return null;
    if (!condHolds(ctx, game, state, frame, first.cond)) return { condition: `Condition not met: ${describeCond(first.cond)}.` };
    return firstChoice(first.then, ctx, game, state, frame);
  }
  return first.op === "choose" ? { choice: first } : null;
}

function safeSelector(sel: Selector): boolean {
  return !sel.special && !sel.fromVar && !sel.underHost && !sel.areas && !sel.sumAtMost
    && !sel.printed && !sel.take && !sel.differentNames && !sel.differentCharacters && !sel.distinctColors && !sel.notSelf && !sel.notIn
    && PUBLIC_AREAS.has(sel.area ?? "battle") && (sel.side === "you" || sel.side === "opponent");
}

function rejectionReason(ctx: EngineContext, game: GameDefinition, state: VmState, id: string, sel: Selector): string {
  const area = findCard(state, id)?.zone;
  if (area !== (sel.area ?? "battle")) return `Requires a ${sel.area === "unison" ? "Unison Card" : sel.area === "battle" || !sel.area ? "Battle Card" : `${sel.area} card`}.`;
  const attrs = attrsNow(ctx, game, state, id);
  const filter = sel.filter;
  const power = typeof attrs.power === "number" ? attrs.power : null;
  if (filter?.powerMax != null && power != null && power > filter.powerMax) return `Power exceeds ${filter.powerMax}.`;
  if (filter?.powerMin != null && power != null && power < filter.powerMin) return `Power is below ${filter.powerMin}.`;
  const colors = Array.isArray(attrs.colors) ? attrs.colors : [];
  if (filter?.colors?.length && !filter.colors.some((color) => colors.includes(color))) return `Requires ${filter.colors.join(" or ")} color.`;
  if (filter?.type && attrs.type !== filter.type) return `Requires a ${filter.type} card.`;
  if (sel.side === "opponent" && !sel.ignoreBarrier && hasKeyword(ctx, game, state, id, "Barrier")) return "Barrier prevents this card being chosen.";
  return "Does not satisfy this skill's target requirements.";
}

export function choicePreviews(ctx: EngineContext, game: GameDefinition, state: VmState, legal: LegalAction[]): ChoicePreview[] {
  const out: ChoicePreview[] = [];
  legal.forEach(({ action }, index) => {
    if (action.type !== "play" && action.type !== "activate") return;
    const placed = findCard(state, action.card);
    if (!placed || placed.zone !== "hand") return;
    const showing = skillsShowing(ctx, state, action.card);
    const skills = action.type === "activate"
      ? showing.skills.filter((skill) => skill.index === action.skill && skill.kind === "activate:main")
      : showing.skills.filter((skill) => skill.kind === "auto" && /when this card is played from your hand/i.test(skill.raw)
        && (showing.scripts.bySkill[skill.index]?.trigger ?? ["played"]).some((t) => t === "played" || t === "playedFromHand"));
    for (const skill of skills) {
      const script = showing.scripts.bySkill[skill.index];
      if (!script || script.unsupported.length) {
        out.push({ action: index, skillIndex: skill.index, state: "notEvaluated" });
        continue;
      }
      const frame: ScriptFrame = { ops: script.ops, ip: 0, vars: {}, card: action.card, master: action.player, skillIndex: skill.index };
      const first = firstChoice(script.ops, ctx, game, state, frame);
      if (!first) { out.push({ action: index, skillIndex: skill.index, state: "notEvaluated" }); continue; }
      if ("condition" in first) {
        out.push({ action: index, skillIndex: skill.index, state: "empty", reason: first.condition, candidates: [] });
        continue;
      }
      const sel = first.choice.sel;
      // A played Battle Card joins its own area before an Auto resolves. Its
      // current hand position cannot answer an own-Battle selector faithfully.
      if (!safeSelector(sel) || (action.type === "play" && sel.side === "you" && (sel.area ?? "battle") === "battle")) {
        out.push({ action: index, skillIndex: skill.index, state: "notEvaluated" }); continue;
      }
      const candidates = resolveSelector(ctx, game, state, frame, sel);
      // Public Leader/Unison/Battle roles remain visible when the skill names
      // just one of them: an opponent Leader is a useful rejected BT6 target.
      const targetSide = sel.side === "you" ? action.player : action.player === "p1" ? "p2" : "p1";
      const publicBoard = ["leader", "unison", "battle"].flatMap((zone) => state.sides[targetSide].zones[zone] ?? []);
      const broadArea = resolveSelector(ctx, game, state, frame, { side: sel.side, area: sel.area, ignoreBarrier: true });
      const broad = [...new Set([...publicBoard, ...broadArea])];
      const accepted = new Set(candidates);
      const rejected = broad.filter((id) => !accepted.has(id) && !state.cards[id]?.hidden)
        .map((card) => ({ card, reason: rejectionReason(ctx, game, state, card, sel) }));
      out.push({ action: index, skillIndex: skill.index, state: candidates.length ? "available" : "empty",
        candidates, ...(rejected.length ? { rejected } : {}),
        ...(!candidates.length ? { reason: `No eligible target for ${describeSelector(sel)}.` } : {}),
      });
    }
  });
  return out;
}
