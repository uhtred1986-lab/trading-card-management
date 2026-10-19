/** A bounded, disposable Main Phase projection. No stored state or services enter this module. */
import type { EngineState } from "./engines";
import { RULES } from "./vm";
import type { Action, EngineContext, GameEvent, PlayerId } from "./types";
import type { CardArt, SideView } from "./view";
import { leaderOf, unisonOf, zoneOf } from "./engine-state";
import { parseSkills } from "./text/cards";
import { autoTriggerMatches } from "./text/triggers";
import type { Script } from "./vm/script";
import type { LoadedGame } from "./games";

import { PLAN_TYPES, planMoves, sameValue, validPlanActions, type GameplanPreview, type PlanBudget } from "./gameplan-types";

function budget(side: SideView): PlanBudget {
  const colors = new Map<string, { ready: number; total: number }>();
  const energy = side.energy.map((card) => {
    const paymentColors = side.energyColors?.find((row) => row.card === card.id)?.paymentColors ?? card.colors;
    for (const color of paymentColors) {
      const count = colors.get(color) ?? { ready: 0, total: 0 };
      count.total++;
      if (card.mode === "active") count.ready++;
      colors.set(color, count);
    }
    return { id: card.id, name: card.name, imageUrl: card.imageUrl, ready: card.mode === "active", paymentColors };
  });
  return { source: side.energyColors ? "payment" : "printed", ready: side.activeEnergy, total: side.energy.length, markers: side.energyMarkers, colors: [...colors].map(([color, count]) => ({ color, ...count })), energy };
}

/** Refuse rules whose cost or outcome can inspect a concealed zone or an
 * arbitrary condition/selector. A condition can silently change payment even
 * when apply emits no draw or reveal event. Inspect only the proposed own card
 * and visible field cards, never opponent hand identities. */
function unsafeRules(ctx: EngineContext, state: EngineState, action: Action): boolean {
  const ids: string[] = [];
  for (const player of ["p1", "p2"] as PlayerId[]) {
    ids.push(leaderOf(state, player));
    const unison = unisonOf(state, player);
    if (unison) ids.push(unison);
    ids.push(...zoneOf(state, player, "battle"), ...zoneOf(state, player, "energy"));
  }
  if ("card" in action && typeof action.card === "string") ids.push(action.card);
  const fixedRest = (script: Script): boolean => !script.unsupported.length &&
    !script.price?.condition && !script.price?.ops?.length && !script.price?.x && !script.price?.payWith?.length &&
    script.ops.every((op) => op.op === "switchMode" && op.mode === "rest" && "sel" in op.target && op.target.sel.special === "self");
  // A fixed-price activation can switch its source to Rest Mode and announce
  // its skill. These are the only effect moments we permit past this guard.
  // Unrelated attack/charge/awaken lines are never run by these moments.
  const reachable = ["restedBySkill", "restedTheirsBySkill", "extraActivated", "unionActivated", "unionAbsorbActivated", "overlordActivated"] as const;
  let selectedFound = false;
  for (const instance of ids) {
    const card = state.cards[instance];
    if (!card) return true;
    // A Hidden Mode card has no showing skills. Its identity is private even
    // though its face-down instance occupies a public field position.
    if (card.hidden) {
      if (instance === ("card" in action ? action.card : null)) return true;
      continue;
    }
    const def = card && ctx.defs[card.cardId];
    if (!def) return true;
    const face = card.flipped && def.back ? "back" : "front";
    const skills = parseSkills(face === "back" ? def.back?.skill : def.skill);
    const scripts = ctx.scripts?.[`${card.cardId}${face === "back" ? "#back" : ""}`];
    for (const skill of skills) {
      const selected = instance === ("card" in action ? action.card : null) && action.type === "activate" && skill.index === action.skill;
      if (selected) {
        selectedFound = true;
        if (!skill.kind.startsWith("activate:main") || skill.keyword || skill.burst != null ||
            skill.spiritBoost != null || skill.markerCost != null || action.alt || action.x != null || action.onto) return true;
      }
      const staticLayer = skill.kind === "permanent";
      const watcher = skill.kind === "auto" && reachable.some((trigger) =>
        scripts?.bySkill[skill.index]?.trigger?.includes(trigger) ?? autoTriggerMatches(skill, trigger));
      if (!selected && !staticLayer && !watcher) continue;
      const script = scripts?.bySkill[skill.index];
      if (!script || scripts?.unsupported.length || !scripts.complete) return true;
      if (selected ? !fixedRest(script) : script.unsupported.length || script.ops.length > 0 ||
          !!script.price?.condition || !!script.price?.ops?.length) return true;
    }
  }
  if (action.type === "activate" && !selectedFound) return true;
  // Existing continuous/copy/grant effects can change effective skills or
  // costs without a new event. No queued program is projected through.
  return !!state.effects.length || !!state.delayed?.length ||
    ("pending" in state && !!state.pending.length) || ("programs" in state && !!state.programs.length);
}

function uncertain(events: GameEvent[], player: PlayerId): string | null {
  for (const event of events) {
    if (event.type === "draw" || event.type === "damage") return "A draw or hidden card was reached. Plan stops here.";
    if (event.type === "move") {
      if (event.owner !== player || event.from !== "hand" || !["battle", "energy", "unison"].includes(event.to)) return "A card moved through an unresolved zone. Plan stops here.";
      continue;
    }
    if (event.type === "action" || event.type === "mode" || event.type === "energyMarker" || event.type === "markers" || event.type === "skill") continue;
    return "An effect or uncertain outcome was reached. Plan stops here.";
  }
  return null;
}

export function previewGameplan(input: {
  ctx: EngineContext; state: EngineState; art: Record<string, CardArt>;
  player: PlayerId; actions: Action[];
}): GameplanPreview {
  const { player } = input;
  const engine = RULES;
  // The engine clones in apply today. Clone at this boundary too: a future
  // implementation cannot accidentally modify the loaded row's state.
  let state = structuredClone(input.state);
  const ctx = { ...input.ctx };
  const result: GameplanPreview = { steps: [], next: [], stopped: null };
  if (input.actions.length < 1 || input.actions.length > 2) return { ...result, stopped: "Choose one or two moves." };
  if (state.prompt.kind !== "main" || state.prompt.player !== player) return { ...result, stopped: "Plan is available on your Main Phase." };
  const first = input.actions[0];
  if (!first || !PLAN_TYPES.has(first.type) || first.player !== player ||
      ("card" in first && (typeof first.card !== "string" || state.cards[first.card]?.owner !== player))) {
    return { ...result, stopped: "That move is not available for this plan." };
  }
  if (unsafeRules(ctx, state, first)) return { ...result, stopped: "A rule or current effect cannot be projected safely. Plan stops here." };
  const before = budget(engine.boardView(ctx, state, player, input.art).you);
  result.steps.push({ label: "Now", budget: before });

  for (const proposed of input.actions) {
    if (!proposed || !PLAN_TYPES.has(proposed.type) || proposed.player !== player ||
        ("card" in proposed && (typeof proposed.card !== "string" || state.cards[proposed.card]?.owner !== player))) {
      result.stopped = "That move is not available for this plan.";
      break;
    }
    if (unsafeRules(ctx, state, proposed)) {
      result.stopped = "A rule or current effect cannot be projected safely. Plan stops here.";
      break;
    }
    if (proposed.type === "play" || proposed.type === "playUnison" || proposed.type === "playZ" || proposed.type === "growUnison" ||
        (proposed.type === "activate" && ctx.defs[state.cards[proposed.card]?.cardId]?.type === "EXTRA")) {
      result.stopped = "An opponent response may open. Plan stops before this move.";
      break;
    }
    const legal = engine.legalActions(ctx, state);
    const entry = legal.find((l) => PLAN_TYPES.has(l.action.type) && l.action.player === player && sameValue(l.action, proposed));
    if (!entry) { result.stopped = "That move is no longer legal. Refresh the board and choose again."; break; }
    try {
      const applied = engine.apply(ctx, state, entry.action);
      // Never publish a projection across random or hidden effects. The local
      // clone may have advanced, but neither live RNG nor the stored row did.
      if (applied.state.rngState !== state.rngState) { result.stopped = "A random outcome was reached. Plan stops here."; break; }
      const why = uncertain(applied.events, player);
      if (why) { result.stopped = why; break; }
      state = applied.state;
      const after = budget(engine.boardView(ctx, state, player, input.art).you);
      result.steps.push({ label: entry.label, budget: after });
      if (state.prompt.kind !== "main" || state.prompt.player !== player) {
        result.stopped = state.prompt.kind === "counter" || state.prompt.kind === "blocker" || state.prompt.kind === "combo"
          ? "An opponent response is open. Plan stops here."
          : "A choice, search, or effect is open. Plan stops here.";
        break;
      }
    } catch {
      result.stopped = "This move needs an outcome the plan cannot preview.";
      break;
    }
  }
  if (!result.stopped && result.steps.length === 2) result.next = planMoves(engine.legalActions(ctx, state), player)
    .filter((move) => move.action.type === "activate" &&
      ctx.defs[state.cards[move.action.card]?.cardId]?.type !== "EXTRA" && !unsafeRules(ctx, state, move.action));
  return result;
}

/** The read-only server boundary, also exercised against a reloaded PGlite row. */
export function previewLoadedGame(
  game: LoadedGame,
  basedOn: number,
  actions: Action[],
  versusSeat: PlayerId | null,
): { error: string | null; preview: GameplanPreview | null } {
  if (!Number.isInteger(basedOn) || basedOn < 0 || !validPlanActions(actions)) return { error: "choose one or two moves from this board", preview: null };
  if (game.mode === "versus" && !versusSeat) return { error: "it is not your turn", preview: null };
  if (!("player" in game.state.prompt) || !game.state.prompt.player) return { error: "a plan is only available during Main Phase", preview: null };
  const player = game.state.prompt.player;
  if (game.mode === "versus" && versusSeat !== player) return { error: "it is not your turn", preview: null };
  if (game.mode !== "hotseat" && game.mode !== "versus" && player !== "p1") return { error: "it is not your turn", preview: null };
  if (game.version !== basedOn) return { error: "the board changed; refresh the plan", preview: null };
  if (game.status !== "playing" || game.state.prompt.kind !== "main") return { error: "a plan is only available during Main Phase", preview: null };
  return { error: null, preview: previewGameplan({ ctx: game.ctx, state: game.state, art: game.art, player, actions }) };
}
