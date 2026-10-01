/**
 * The legacy engine's barrel — and, since #118's first step, nothing else.
 *
 * Everything both engines share moved to its own home: the vocabulary to
 * `../types.ts`, card text to `../text/`, the compiler to `../compile/`, the
 * record interpreter and its schema to `../vm/script*.ts`, the RNG to
 * `../vm/rng.ts`, and the helpers that are not about a legacy `GameState` to
 * `../vm/common.ts`. What is left here is the hand-written engine over
 * `GameState`, and every import of it outside this directory is a reader the
 * retirement still has to replace (`docs/architecture/arena.md`).
 */
export { createGame, apply, legalActions, rejectedActions } from "./engine";
export { koCard, pendTriggers, masterOf } from "./triggers";
export { resolveSelector, permanentStatics, scriptsOfInstance, copiedSkillsOn, emitsStatic } from "./state";
export {
  face,
  powerOf,
  comboPowerOf,
  locate,
  areaOf,
  inPlay,
  keywordsInForce,
  planPayment,
  payersFor,
  pricePayers,
  playCost,
  paymentOptions,
  describePayment,
  staticEffects,
  type StaticEffect,
} from "./state";
