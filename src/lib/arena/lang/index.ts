/**
 * The rules language: one grammar, one parser, one printer, one validator.
 *
 * Client-safe — the workbench's text view imports this straight into the
 * browser, so nothing here may reach the database. Three uses are planned
 * (the plan of 9 Sep 2026): a card's rule, which is what Stage 1 built; a
 * game's definition (`rulesets/*.rules`, Stage 3); and the referee's answers.
 * They share this module rather than each growing a dialect.
 */
export { printRule, printOps, printOp, printCond, printCost, printSelector, printFilter, printAmount, printRef, printDefinition, printDefinitions, canonical, deepEqual } from "./print";
export { parseRule, parseCond, parseDefinitions } from "./parse";
export { validateRule, readRule, type Invalid } from "./validate";
export { lex, positionOf, LangSyntaxError, type Token } from "./tokens";
export {
  DEFINE_KINDS,
  DEFINE_SCHEMA,
  EXPR_SCHEMA,
  FILTER_FIELDS,
  PARAM_TYPES,
  RESERVED,
  SELECTOR_FIELDS,
  fieldsOf,
  type Definition,
  type DefineField,
  type DefineFieldType,
  type DefineHook,
  type DefineKind,
  type DefineParam,
  type DefineSpec,
  type EventPattern,
  type LangError,
  type Parsed,
  type ParamType,
  type PatternValue,
  type Rule,
} from "./ast";
