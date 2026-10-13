/**
 * #654, TEST-ONLY: the local match worker with a fault switch, for `scripts/arena-local-ownership-browser.mts`.
 * It is `src/lib/arena/local/worker-entry.ts` plus one proof message the page may send:
 *
 *   { __proof: "arm", fault: "hold" }   the next commit queues its decisions inside its (fenced)
 *                                       transaction, tells the page `{ __proof: "holding" }` and keeps
 *                                       the transaction open until the page kills this worker — a
 *                                       death before the commit is persisted;
 *   { __proof: "arm", fault: "after" }  the next commit is persisted, then the worker tells the page
 *                                       `{ __proof: "persisted" }` and never answers — a death after it.
 *
 * It journals into the real `dbs-arena-local` database of the origin, fenced like the real entry, so
 * the real entry (or another copy of this one) resumes what it left. The production entry has no switch.
 */
import { createLocalMatchHost, type JournalStore } from "../../src/lib/arena/local/worker";
import { indexedDbJournalStore } from "../../src/lib/arena/local/storage";

interface Scope {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}
const scope = globalThis as unknown as Scope;
let armed: "hold" | "after" | null = null;

const inner = indexedDbJournalStore({
  faults: {
    duringWrite({ decisions, added }) {
      if (armed !== "hold") return;
      armed = null;
      scope.postMessage({ __proof: "holding", added });
      // Keep the transaction alive with an endless chain of reads: it can only end by the kill.
      const spin = () => { decisions.get(["__proof", -1]).onsuccess = spin; };
      spin();
    },
  },
});
const store: JournalStore = {
  get: (matchId) => inner.get(matchId),
  async put(journal, fence) {
    await inner.put(journal, fence);
    if (armed === "after") {
      armed = null;
      scope.postMessage({ __proof: "persisted", revision: journal.entries.length + 1 });
      await new Promise(() => {});
    }
  },
};
const host = createLocalMatchHost({ post: (m) => scope.postMessage(m), store });
scope.addEventListener("message", (event) => {
  const d = event.data as { __proof?: string; fault?: "hold" | "after" } | null;
  if (d && d.__proof === "arm") { armed = d.fault ?? null; scope.postMessage({ __proof: "armed", fault: armed }); return; }
  void host.handle(event.data);
});
host.hello();
inner.warm();
