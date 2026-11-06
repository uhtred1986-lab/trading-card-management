/** Private synchronous lifetime shared by the standing readers and writer guards.
 * Only readingStandingBoard creates a lifetime, after full native validation.
 * Nothing here is serialized or retained after its callback returns.
 */
import type { EngineContext } from "../types";
import type { GameDefinition } from "../rulesets";
import type { VmState } from "./state";

interface ReadScope {
  ctx: EngineContext;
  game: GameDefinition;
  state: VmState;
  stateGame: string;
  pinned: GameDefinition | undefined;
  histories: readonly unknown[];
  revoked: boolean;
}
const scopes: ReadScope[] = [];
let uncached = 0;
const histories = (state: VmState) => [state.standingNegationHistory, state.mixedStandingNegationHistory, state.underStandingNegationHistory];
const pinned = (ctx: EngineContext) => (ctx as EngineContext & { rulesetDefinition?: GameDefinition }).rulesetDefinition;
function current(state: VmState): ReadScope | undefined {
  if (uncached) return undefined;
  const scope = scopes.at(-1);
  if (!scope || scope.state !== state || scope.revoked || scope.stateGame !== state.game
    || scope.game.id !== state.game || scope.pinned !== pinned(scope.ctx)
    || histories(state).some((history, index) => history !== scope.histories[index])
    || scopes.some(item => item.state === state && item.revoked)) return undefined;
  return scope;
}
export function scopedStandingReadMatches(ctx: EngineContext, state: VmState): boolean {
  return current(state)?.ctx === ctx;
}
export function scopedStandingReadContext(state: VmState): EngineContext | undefined {
  return current(state)?.ctx;
}
export function scopedStandingReadGame(ctx: EngineContext, state: VmState): GameDefinition | undefined {
  const scope = current(state);
  return scope?.ctx === ctx ? scope.game : undefined;
}
/** Disables every shortcut, including no-context readers; never grants authority. */
export function withUncachedStandingReads<T>(read: () => T): T {
  uncached++;
  try { return read(); } finally { uncached--; }
}
export function standingReadIsUncached(): boolean { return uncached > 0; }
export function standingReadWasRevoked(state: object): boolean {
  return scopes.some(scope => scope.state === state && scope.revoked);
}
export function invalidateScopedStandingRead(state: object): void {
  for (const scope of scopes) if (scope.state === state) scope.revoked = true;
}
export function requireUnscopedStandingWrite(state: object): void {
  if (!scopes.some(scope => scope.state === state)) return;
  invalidateScopedStandingRead(state);
  throw new Error("Cannot mutate a board during a standing read");
}
/** @internal Sole owner: standing-negation-runtime.readingStandingBoard.
 * Internal lifetime primitive: the closed runtime wrapper owns validation and
 * the immutable entry/exit witness. Callers cannot pass a validity flag or seal.
 */
export function withStandingReadLifetime<T>(ctx: EngineContext, game: GameDefinition, state: VmState, read: () => T): T {
  const scope: ReadScope = { ctx, game, state, stateGame: state.game, pinned: pinned(ctx), histories: histories(state), revoked: false };
  scopes.push(scope);
  try { return read(); } finally { scopes.pop(); }
}
