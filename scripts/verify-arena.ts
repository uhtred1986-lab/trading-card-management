/**
 * Arena engine checks — pure, no database. Run with `tsx`.
 *
 * Synthetic cards exercise the rules one at a time; the numbers in comments
 * are Rule Manual sections. The checks are in `scripts/verify/`, one file per
 * area, and **this order is the contract**: the files add cards to the shared
 * `DEFS` as they go, so a later file may rely on what an earlier one defined.
 * They were one 7,400-line file until they reached TypeScript's control-flow
 * limit, which silently widened three lambda parameters to `any`.
 */
import "./verify/text";
import "./verify/setup";
import "./verify/battles";
import "./verify/compiler";
import "./verify/keywords";
import "./verify/readings";
import "./verify/wordings";
import "./verify/workflow";
import "./verify/contract";
import "./verify/language";
import "./verify/lang";
import "./verify/rulesets";
import "./verify/probe";
import "./verify/vm";

console.log("verify-arena: all checks passed");
