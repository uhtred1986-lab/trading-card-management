/** 9-6-3-1-1: a pending [Auto] still in a secret area may be left undeclared. */
import { costIsOnlyOrbs } from "../compile";
import type { EngineContext, Skill } from "../types";
import type { GameDefinition } from "../rulesets";
import type { Script } from "./script";
import type { VmState } from "./state";
import type { VmPendingRecord } from "./triggers";
import { skillsShowing } from "./triggers";
import { findCard } from "./zones";

export function secretAutoSource(game: GameDefinition, state: VmState, pending: VmPendingRecord): boolean {
  if (pending.kind === "hook") return false;
  const at = findCard(state, pending.card);
  const card = state.cards[pending.card];
  const visibility = at && game.zones[at.zone]?.visibility;
  return !!at && !!card && !card.faceUp && (visibility === "none" || visibility === "owner" || visibility === "opponent");
}

export function canWithholdSecretAuto(ctx: EngineContext, game: GameDefinition, state: VmState, pending: VmPendingRecord): boolean {
  if (!secretAutoSource(game, state, pending)) return false;
  if (pending.kind === "hook") return false;
  const showing = skillsShowing(ctx, state, pending.card);
  const skill = showing.skills.find((item) => item.index === pending.skillIndex);
  if (skill?.kind !== "auto") return false;
  return true;
}

/** The one price test used both when offering silence and when resolving. */
export function automaticHasPrice(skill: Skill | undefined, program: Script | undefined): boolean {
  if (!skill) return false;
  const unknownPrice = skill.kind === "auto" && !costIsOnlyOrbs(skill.cost) && !program?.price?.condition && !program?.price?.ops?.length && !program?.price?.x && !program?.price?.payWith?.length;
  return unknownPrice || Object.values(skill.energyCost).some((n) => n > 0) || skill.energyEither.length > 0
    || skill.markerCost != null || skill.burst != null || skill.spiritBoost != null
    || !!program?.price?.ops?.length || !!program?.price?.x;
}
