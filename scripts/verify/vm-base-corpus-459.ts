/**
 * The printed harness rows as they exist before any verify-arena suite runs.
 * Suites share and mutate DEFS while staging scenarios, so vm.ts must keep
 * this input corpus stable across a direct run and the full suite order.
 * Expected filter and price outcomes are separate checked-in literals.
 */
import { DEFS } from "./harness";

export const VM_BASE_DEFS_459 = structuredClone(DEFS);
