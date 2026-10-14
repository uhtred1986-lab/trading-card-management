/** A disposable engine transition for each legal Blocker response. */
import type { EngineContext, LegalAction } from "../types";
import type { GameDefinition } from "../rulesets";
import type { BlockPreview, CardArt } from "../view";
import type { VmState } from "./state";
import { RULES } from "./index";
import { vmBattleView } from "./view";

const MAX_PROJECTED_BLOCKS = 32;
const UNCERTAIN_EVENTS = new Set(["draw", "move", "damage", "hidden", "flip"]);

export function blockPreviews(ctx: EngineContext, game: GameDefinition, state: VmState, legal: LegalAction[], viewer: "p1" | "p2", images: Record<string, CardArt>): BlockPreview[] {
  const out: BlockPreview[] = [];
  let projected = 0;
  legal.forEach(({ action }, index) => {
    if (action.type !== "block" || !action.card) return;
    const unknown = (reason: string): void => { out.push({ action: index, state: "notEvaluated", reason }); };
    if (projected >= MAX_PROJECTED_BLOCKS) { unknown("Too many Blocker options to preview at once."); return; }
    if (state.pending.length || state.programs.length || state.cards[action.card]?.hidden) {
      unknown("A pending skill or hidden Blocker prevents a reliable preview."); return;
    }
    projected++;
    try {
      const result = RULES.previewLegalBlock(ctx, state, action);
      const after = result.state as VmState;
      if (after.rngState !== state.rngState || result.events.some((event) => UNCERTAIN_EVENTS.has(event.type))) {
        unknown("The Blocker reaches a hidden or variable outcome before the next choice."); return;
      }
      if (after.pending.length || after.programs.length || !after.battle ||
          after.battle.guard !== action.card || after.flow.at(-1)?.phase !== "battle") {
        unknown("A skill or choice is still resolving after the Blocker redirects the attack."); return;
      }
      const battle = vmBattleView(ctx, game, after, viewer, images);
      if (!battle?.stakes) { unknown("The battle has no current stakes projection."); return; }
      out.push({ action: index, state: "known", battle });
    } catch {
      unknown("The Blocker needs a decision before its result can be previewed.");
    }
  });
  return out;
}
