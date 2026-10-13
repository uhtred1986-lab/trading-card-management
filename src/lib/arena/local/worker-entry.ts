/**
 * The module Web Worker that owns one local match (#652, plan O3-02): a thin
 * shell binding `createLocalMatchHost` (`./worker.ts`) to the worker scope.
 * Start it with `new Worker(<url of this module>, { type: "module" })`; the page
 * side is `src/components/arena/session/local.ts`.
 *
 * Every request is answered by the host. An exception that escapes it anyway,
 * or an unhandled rejection, is reported as an `internal` error with no request
 * id, so the page learns the worker is unwell instead of waiting forever.
 * Nothing here exposes the host's state.
 */
import { createLocalMatchHost } from "./worker";
import { ERROR_SENTENCE, envelope, type LocalResponse } from "./protocol";

interface WorkerScope {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "error" | "unhandledrejection", listener: (event: { message?: string; reason?: unknown; preventDefault?: () => void }) => void): void;
}
const scope = globalThis as unknown as WorkerScope;
const post = (message: LocalResponse) => scope.postMessage(message);

const host = createLocalMatchHost({ post });
const failed = (detail: string) => post({ ...envelope(), type: "error", requestId: null, sessionId: null, ok: false, code: "internal", message: `${ERROR_SENTENCE.internal}: ${detail}` });

scope.addEventListener("message", (event) => { void host.handle(event.data); });
scope.addEventListener("error", (event) => failed(event.message ?? "uncaught error"));
scope.addEventListener("unhandledrejection", (event) => {
  event.preventDefault?.();
  failed(event.reason instanceof Error ? event.reason.message : String(event.reason));
});
host.hello();
