/**
 * The compiler's public barrel (`compile/` is the implementation).
 *
 * The entry points are re-exported **by name** as well as by `export *`: a
 * module graph that reaches this barrel through a cycle — which every `.mts`
 * script that imports both the compiler and the engine does — leaves an
 * `export *` name uninstantiated, and `arena:tally` and `arena:readings` both
 * died on `does not provide an export named "compileSkill"` while every other
 * entry point worked. A named re-export is bound eagerly and does not.
 */
export { compileSkill, compileCard, compileCardCached } from "./compile/index";
export * from "./compile/index";
export { compileCostProgram, costIsOnlyOrbs, costText, priceCondition } from "./compile/prices";
export { parseConditionClause, splitDisjunction } from "./compile/conditions";
export { splitClauses, stripNotes } from "./compile/clauses";
export { parseTarget } from "./compile/targets";
