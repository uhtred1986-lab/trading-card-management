/** Bounded, disposable attack projections from the same rules engine that resolves them. */
import type { EngineContext, LegalAction } from "../types";
import type { GameDefinition } from "../rulesets";
import type { AttackPreview, CardArt } from "../view";
import type { VmState } from "./state";
import { RULES } from "./index";
import { taxesOn } from "./program";
import { vmBattleView } from "./view";
import { skillsShowing } from "./triggers";
import { inPlayZones } from "./zones";

// A target's battle reading can traverse several standing layers. Bound the
// total projections per snapshot; every remaining action gets an explicit
// unevaluated row rather than an inferred result.
const MAX_PROJECTED_ATTACKS = 64;
const UNCERTAIN_EVENTS = new Set(["draw", "look", "reveal", "shuffle", "move", "damage"]);

/**
 * With no attack-time skill or spendable prohibition, declaration changes only
 * the attacker's rest/attack history, both cards' battle history, and the
 * native battle frame. One actual engine transition supplies that frame; the
 * engine's battle reader still resolves every target's standing power and
 * keywords separately. A card that could answer declaration disables reuse.
 */
function plainDeclaration(ctx: EngineContext, game: GameDefinition, state: VmState): boolean {
  if (state.delayed.length || state.effects.some((e) =>
    ["gains", "keyword", "copiedSkills"].includes(e.kind) || (e.kind === "forbid" && (e.forbid?.uses ?? 0) > 0))) return false;
  const passive = new Set(["Awaken", "Wish", "Critical", "Strike", "Indestructible", "Barrier"]);
  for (const side of ["p1", "p2"] as const) for (const zone of inPlayZones(game)) {
    for (const id of state.sides[side].zones[zone] ?? []) {
      if (state.cards[id]?.hidden) return false;
      const { skills } = skillsShowing(ctx, state, id);
      if (skills.some((skill) => skill.kind === "auto" || (skill.kind === "keyword" && (!skill.keyword || !passive.has(skill.keyword.name))))) return false;
    }
  }
  return true;
}

export function attackPreviews(ctx: EngineContext, game: GameDefinition, state: VmState, legal: LegalAction[], viewer: "p1" | "p2", images: Record<string, CardArt>): AttackPreview[] {
  const out: AttackPreview[] = [];
  let projected = 0;
  const reusable = plainDeclaration(ctx, game, state);
  let base: VmState | null = null;
  let previous: Extract<LegalAction["action"], { type: "attack" }> | null = null;
  const taxes = new Map<string, boolean>();
  legal.forEach(({ action }, index) => {
    if (action.type !== "attack") return;
    const unknown = (reason: string): void => { out.push({ action: index, state: "notEvaluated", reason }); };
    if (projected >= MAX_PROJECTED_ATTACKS) { unknown("Too many attack options to preview at once."); return; }
    if (state.pending.length || state.programs.length || state.cards[action.attacker]?.hidden) {
      unknown("A pending skill or hidden attacker prevents a reliable preview."); return;
    }
    try {
      let taxed = taxes.get(action.attacker);
      if (taxed === undefined) {
        taxed = taxesOn(ctx, game, state, "attack", { player: action.player, card: action.attacker }).length > 0;
        taxes.set(action.attacker, taxed);
      }
      if (taxed) {
        unknown("This attack has an additional cost that resolves before the battle."); return;
      }
      projected++;
      // A plain attack can share its engine-opened battle frame. Update only
      // the declaration facts for the next offered pair, then ask the engine
      // reader for that pair's actual target-sensitive power and stakes.
      if (reusable && base && previous) {
        base.cards[previous.attacker] = structuredClone(state.cards[previous.attacker]);
        base.cards[previous.target] = structuredClone(state.cards[previous.target]);
        base.cards[action.attacker] = structuredClone(state.cards[action.attacker]);
        base.cards[action.target] = structuredClone(state.cards[action.target]);
        base.cards[action.attacker].mode = "rest";
        base.cards[action.attacker].attacksThisTurn = (base.cards[action.attacker].attacksThisTurn ?? 0) + 1;
        base.cards[action.attacker].battledThisTurn = true;
        base.cards[action.target].battledThisTurn = true;
        base.battle!.attacker = action.attacker;
        base.battle!.guard = action.target;
        base.battle!.target = action.target;
        previous = action;
        const battle = vmBattleView(ctx, game, base, viewer, images);
        if (!battle?.stakes) { unknown("The battle has no current stakes projection."); return; }
        out.push({ action: index, state: "known", battle });
        return;
      }
      // The engine clones its input before applying the already-offered attack.
      const result = RULES.previewLegalAttack(ctx, state, action);
      const after = result.state as VmState;
      if (after.rngState !== state.rngState || result.events.some((event) => UNCERTAIN_EVENTS.has(event.type))) {
        unknown("The attack reaches a hidden or variable outcome before the response."); return;
      }
      if (after.pending.length || after.programs.length || !after.battle ||
          !["counter", "blocker", "combo"].includes(after.prompt.kind)) {
        unknown("A skill or choice is still resolving after the attack declaration."); return;
      }
      const battle = vmBattleView(ctx, game, after, viewer, images);
      if (!battle?.stakes) { unknown("The battle has no current stakes projection."); return; }
      out.push({ action: index, state: "known", battle });
      if (reusable && result.events.every((event) => ["action", "attack", "mode", "phase", "battleStep"].includes(event.type))) {
        base = after;
        previous = action;
      }
    } catch {
      unknown("The attack needs a decision before its result can be previewed.");
    }
  });
  return out;
}
