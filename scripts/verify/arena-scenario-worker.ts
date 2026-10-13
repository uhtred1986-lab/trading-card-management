/**
 * #642: the module worker `scripts/arena-scenario.mts --browser` starts. It loads the portable
 * scenario runner (and through it only `browser.ts`'s graph), says it is ready, then runs the named
 * scenarios on the bundle it is sent — the page is offline by then, so the bundle arrives in the
 * message and nothing else is fetched.
 */
import { runScenarios, type RunInput } from "./arena-scenarios";

interface WorkerScope {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: RunInput & { ids: string[] } }) => void) | null;
}
const scope = globalThis as unknown as WorkerScope & Record<string, unknown>;

function environment() {
  return {
    worker: typeof scope.importScripts === "function" && typeof scope.document === "undefined" && typeof scope.window === "undefined",
    process: typeof scope.process !== "undefined",
    require: typeof scope.require !== "undefined",
    buffer: typeof scope.Buffer !== "undefined",
    subtle: !!(globalThis.crypto && globalThis.crypto.subtle),
    secure: scope.isSecureContext === true,
  };
}

scope.onmessage = (event) => {
  const { ids, ...input } = event.data;
  runScenarios(ids, input).then(
    (evidence) => scope.postMessage({ ok: true, env: environment(), evidence }),
    (error: unknown) => scope.postMessage({ ok: false, env: environment(), error: error instanceof Error ? error.message : String(error) }),
  );
};
scope.postMessage({ ready: true, env: environment() });
