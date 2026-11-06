/** R473: standing Drop permission and native combo payment occurrences. */
import type { PlayerId } from "../types";
import type { CardFilter } from "../text/filters";

import type { EngineContext } from "../types";
import type { GameDefinition } from "../rulesets";
import type { VmState } from "./state";
import { permissions, permitted } from "./program";
import { canonicalTaxValue } from "./tax-receipt";
import { IllegalAction } from "./illegal-action";
import { filterProblem } from "./script-schema";
import { findCard } from "./zones";
import { rebuildScope } from "./skill-play-scope";

export interface ComboDeclaration {
  version: 1;
  player: PlayerId;
  source: { card: string; cardId: string; epoch: number; area: "hand" | "battle" | "drop" };
  permissions?: { card: string; epoch: number; flipped: boolean; filter?: CardFilter }[];
  energy: { card: string; epoch: number }[];
}


function dropComboPermissions(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, card: string) {
  if (!state.sides[player].zones.drop.includes(card) || state.cards[card]?.owner !== player || ctx.defs[state.cards[card]?.cardId]?.type !== "BATTLE") return [];
  return permissions(ctx, game, state, "comboFromDrop").filter(permit => permit.master === player && state.cards[permit.target] && permitted(ctx, game, state, permit.filter, card));
}

export function dropComboPermission(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, card: string) {
  return dropComboPermissions(ctx, game, state, player, card)[0];
}

export function captureComboDeclaration(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, card: string): ComboDeclaration {
  const area = findCard(state, card)?.zone;
  if (area !== "hand" && area !== "battle" && area !== "drop") throw new IllegalAction("that card has no combo source area");
  const grants = area === "drop" ? dropComboPermissions(ctx, game, state, player, card) : [];
  if (area === "drop" && !grants.length) throw new IllegalAction("that card has no permission to combo from Drop");
  return {
    version: 1, player,
    source: { card, cardId: state.cards[card].cardId, epoch: state.cards[card].zoneEpoch ?? 0, area },
    ...(area === "drop" ? { permissions: grants.map(permit => ({ card: permit.target, epoch: state.cards[permit.target].zoneEpoch ?? 0, flipped: state.cards[permit.target].flipped, ...(permit.filter ? { filter: structuredClone(permit.filter) } : {}) })) } : {}),
    energy: state.sides[player].zones.energy.map(id => ({ card: id, epoch: state.cards[id].zoneEpoch ?? 0 })),
  };
}

/** Validate the complete saved contract before considering a stale occurrence.
 * Unselected energy is not spent and need not retain its old occurrence. */
export function requireComboDeclaration(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, card: string, declaration: ComboDeclaration | undefined, selectedEnergy?: readonly string[]): void {
  const epoch = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
  if (selectedEnergy !== undefined && (!Array.isArray(selectedEnergy) || selectedEnergy.some(id => typeof id !== "string") || new Set(selectedEnergy).size !== selectedEnergy.length)) rebuildScope("rebuild this saved native combo energy selection");
  if (!declaration || declaration.version !== 1 || declaration.player !== player || declaration.source?.card !== card ||
    typeof declaration.source.cardId !== "string" || !epoch(declaration.source.epoch) || !["hand", "battle", "drop"].includes(declaration.source.area) ||
    (declaration.source.area === "drop" ? !Array.isArray(declaration.permissions) || !declaration.permissions.length || declaration.permissions.some(grant => !grant || typeof grant.card !== "string" || !epoch(grant.epoch) || typeof grant.flipped !== "boolean" || grant.filter !== undefined && filterProblem(grant.filter) !== null) : declaration.permissions !== undefined) ||
    !Array.isArray(declaration.energy) || declaration.energy.some(item => !item || typeof item.card !== "string" || !epoch(item.epoch)) ||
    new Set(declaration.energy.map(item => item.card)).size !== declaration.energy.length) {
    rebuildScope("rebuild this saved native combo declaration");
  }
  const source = state.cards[card];
  if (!source || source.cardId !== declaration.source.cardId || (source.zoneEpoch ?? 0) !== declaration.source.epoch ||
    !state.sides[player].zones[declaration.source.area].includes(card) || declaration.source.area === "drop" && source.owner !== player) throw new IllegalAction("the original combo card left its area");
  const live = dropComboPermissions(ctx, game, state, player, card);
  if (declaration.source.area === "drop" && !declaration.permissions!.some(original => {
    const grant = state.cards[original.card];
    return grant && (grant.zoneEpoch ?? 0) === original.epoch && grant.flipped === original.flipped &&
      live.some(permit => permit.target === original.card && canonicalTaxValue(permit.filter) === canonicalTaxValue(original.filter));
  })) throw new IllegalAction("the original Drop combo permissions no longer apply");
  for (const id of selectedEnergy ?? []) {
    const original = declaration.energy.find(item => item.card === id);
    if (!original) rebuildScope("rebuild this saved native combo energy choice");
    if (!state.sides[player].zones.energy.includes(id) || (state.cards[id]?.zoneEpoch ?? 0) !== original.epoch) throw new IllegalAction("the original combo energy payer left its area");
  }
}
