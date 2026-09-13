import { parseCond as cond, parseRule as parse } from "./parse";
import { words, type Words } from "../rulesets/words";
import type { Cond } from "../engine/script";
import type { Parsed, Rule } from "./ast";

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
export { parseDefinitions, ENGINE_WORDS, SELECTOR_FLAGS } from "./parse";

/**
 * A card's rule, read against the **game's** words: an area is a zone
 * `zones.rules` declares, never a constant kept in the parser (#137). The
 * binding lives here rather than in `parse.ts` because `rulesets/` is built on
 * the grammar — the loader imports `./parse` directly, so the one module that
 * must not ask for the vocabulary it produces does not get it.
 */
export const parseRule = (src: string, vocab: Words = words()): Parsed<Rule> => parse(src, vocab);
export const parseCond = (src: string, vocab: Words = words()): Parsed<Cond> => cond(src, vocab);
export { validateRule, readRule, type Invalid } from "./validate";
export { lex, positionOf, LangSyntaxError, type Token } from "./tokens";
export {
  COST_ITEMS,
  DEFINE_KINDS,
  DEFINE_SCHEMA,
  EXPR_ATTRS,
  EXPR_LITERALS,
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
  type ExprArg,
  type ExprSpec,
  type LangError,
  type Parsed,
  type ParamType,
  type PatternValue,
  type Rule,
} from "./ast";
