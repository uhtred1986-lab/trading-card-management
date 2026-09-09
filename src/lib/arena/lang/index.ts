/**
 * The rules language: one grammar, one parser, one printer, one validator.
 *
 * Client-safe — the workbench's text view imports this straight into the
 * browser, so nothing here may reach the database. Three uses are planned
 * (the plan of 9 Sep 2026): a card's rule, which is what Stage 1 built; a
 * game's definition (`rulesets/*.rules`, Stage 3); and the referee's answers.
 * They share this module rather than each growing a dialect.
 */
export { printRule, printOps, printOp, printCond, printCost, printSelector, printFilter, printAmount, printRef, canonical, deepEqual } from "./print";
export { parseRule, parseCond } from "./parse";
export { validateRule, readRule, type Invalid } from "./validate";
export { lex, positionOf, LangSyntaxError, type Token } from "./tokens";
export { EXPR_SCHEMA, FILTER_FIELDS, SELECTOR_FIELDS, type LangError, type Parsed, type Rule } from "./ast";
