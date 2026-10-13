/**
 * #652: the local match host behind an in-process channel that behaves like a Worker's message
 * port — every message structurally cloned, every delivery a separate macrotask — so the page
 * client and the host can be proved without a browser. Browser-safe (no `node:`); the Chrome
 * harness uses it to compute the reference run it compares the real Worker against.
 */
import { createLocalMatchHost, memoryJournalStore, type JournalStore, type LocalHostOptions, type LocalMatchHost } from "../../src/lib/arena/local/worker";
import type { LocalResponse } from "../../src/lib/arena/local/protocol";
import type { WorkerPort } from "../../src/components/arena/session/local";

export interface Channel {
  port: WorkerPort;
  host: LocalMatchHost;
  store: JournalStore;
  /** Every message the host posted, in order (clones). */
  posted: LocalResponse[];
  /** Deliver a forged message to the page side at once, as if the worker had sent it. */
  inject(data: unknown): void;
}

export function inProcessChannel(options: Partial<Omit<LocalHostOptions, "post">> & { onPost?: (message: LocalResponse, host: LocalMatchHost) => void } = {}): Channel {
  const listeners: { message: ((e: { data: unknown }) => void)[]; error: ((e: { message?: string }) => void)[] } = { message: [], error: [] };
  const posted: LocalResponse[] = [];
  const store = options.store ?? memoryJournalStore();
  const deliver = (data: unknown) => { for (const l of listeners.message) l({ data: structuredClone(data) }); };
  const host: LocalMatchHost = createLocalMatchHost({
    ...options,
    store,
    post: (message) => {
      const copy = structuredClone(message);
      posted.push(copy);
      options.onPost?.(copy, host);
      setTimeout(() => deliver(copy), 0);
    },
  });
  const port: WorkerPort = {
    postMessage: (message) => {
      const copy = structuredClone(message);
      setTimeout(() => { void host.handle(copy); }, 0);
    },
    addEventListener: ((type: "message" | "error", listener: never) => { (listeners[type] as unknown[]).push(listener); }) as WorkerPort["addEventListener"],
  };
  host.hello();
  return { port, host, store, posted, inject: deliver };
}
