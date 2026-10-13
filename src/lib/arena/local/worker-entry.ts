/**
 * The module Web Worker that owns one local match (#652, plan O3-02): a thin
 * shell binding `createLocalMatchHost` (`./worker.ts`) to the worker scope.
 * Start it with `new Worker(<url of this module>, { type: "module" })`; the page
 * side is `src/components/arena/session/local.ts`.
 *
 * Every request is answered by the host. An exception that escapes it anyway,
 * or an unhandled rejection, is reported as an `internal` error with no request
 * id, so the page learns the worker is unwell instead of waiting forever.
 * Nothing here exposes the host's state. Journals go to IndexedDB (`./storage.ts`).
 */
import { createLocalMatchHost } from "./worker";
import { indexedDbJournalStore } from "./storage";
import { ERROR_SENTENCE, envelope, type LocalResponse } from "./protocol";

interface WorkerScope {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "error" | "unhandledrejection", listener: (event: { message?: string; reason?: unknown; preventDefault?: () => void }) => void): void;
}
const scope = globalThis as unknown as WorkerScope;
const post = (message: LocalResponse) => scope.postMessage(message);

// The match is journalled in IndexedDB (#653), one transaction per commit, so it survives a reload or a killed worker.
const store = indexedDbJournalStore();
const host = createLocalMatchHost({ post, store });
const failed = (detail: string) => post({ ...envelope(), type: "error", requestId: null, sessionId: null, ok: false, code: "internal", message: `${ERROR_SENTENCE.internal}: ${detail}` });

scope.addEventListener("message", (event) => { void host.handle(event.data); });
scope.addEventListener("error", (event) => failed(event.message ?? "uncaught error"));
scope.addEventListener("unhandledrejection", (event) => {
  event.preventDefault?.();
  failed(event.reason instanceof Error ? event.reason.message : String(event.reason));
});
host.hello();
// Open the database while the page prepares its first request: a first start then does not wait for it.
store.warm();
