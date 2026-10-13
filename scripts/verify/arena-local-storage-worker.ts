/**
 * #653, TEST-ONLY: the local match worker with a fault switch, for `scripts/arena-local-storage-browser.mts`.
 * It is `src/lib/arena/local/worker-entry.ts` plus one proof message the page may send:
 *
 *   { __proof: "arm", fault: "hold" }   the next commit queues its decisions, tells the page
 *                                       `{ __proof: "holding" }` and keeps its transaction open
 *                                       (a request loop) until the page kills this worker;
 *   { __proof: "arm", fault: "abort" }  the next commit's transaction is aborted.
 *
 * It journals into the same database as the real entry (`dbs-arena-local`), so the real entry
 * resumes what this one left. The production entry has no such switch.
 */
import { createLocalMatchHost } from "../../src/lib/arena/local/worker";
import { indexedDbJournalStore } from "../../src/lib/arena/local/storage";

interface Scope {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}
const scope = globalThis as unknown as Scope;
let armed: "hold" | "abort" | null = null;

const store = indexedDbJournalStore({
  faults: {
    duringWrite({ tx, decisions, added }) {
      const fault = armed;
      armed = null;
      if (fault === "abort") tx.abort();
      if (fault === "hold") {
        scope.postMessage({ __proof: "holding", added });
        // Keep the transaction alive with an endless chain of reads: it can only end by the kill.
        const spin = () => { decisions.get(["__proof", -1]).onsuccess = spin; };
        spin();
      }
    },
  },
});
const host = createLocalMatchHost({ post: (m) => scope.postMessage(m), store });
scope.addEventListener("message", (event) => {
  const d = event.data as { __proof?: string; fault?: "hold" | "abort" } | null;
  if (d && d.__proof === "arm") { armed = d.fault ?? null; scope.postMessage({ __proof: "armed", fault: armed }); return; }
  void host.handle(event.data);
});
host.hello();
