/**
 * #641: the module worker `arena-browser-engine-browser.mts` starts. It loads the portable
 * scenario (and through it only `browser.ts`'s graph), says it is ready, then runs the scenario
 * on the bundle it is sent — with no network: the bundle arrives in the message, and the page
 * has been taken offline before it does.
 */
import { runBrowserScenario } from "./arena-browser-scenario";

interface WorkerScope {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: Parameters<typeof runBrowserScenario>[0] }) => void) | null;
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
  const started = Date.now();
  runBrowserScenario(event.data).then(
    (result) => scope.postMessage({ ok: true, env: environment(), ms: Date.now() - started, result }),
    (error: unknown) => scope.postMessage({ ok: false, env: environment(), error: error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error) }),
  );
};
scope.postMessage({ ready: true, env: environment() });
