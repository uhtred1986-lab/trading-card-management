/**
 * #643: the module worker `scripts/arena-worker-bench.mts` measures: a thin message shell around
 * `arena-bench-core.ts`. `ready` carries `performance.now()` at the end of module evaluation — the
 * time from worker creation to every module in the graph being fetched, compiled and run.
 */
import { dispatch, type Request } from "./arena-bench-core";

interface WorkerScope {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: Request }) => void) | null;
}
const scope = globalThis as unknown as WorkerScope & Record<string, unknown>;

scope.onmessage = (event) => {
  dispatch(event.data).then(
    (result) => scope.postMessage({ ok: true, type: event.data.type, result }),
    (error: unknown) => scope.postMessage({ ok: false, type: event.data.type, error: error instanceof Error ? error.message : String(error) }),
  );
};
scope.postMessage({ ready: true, loadMs: performance.now(), isolated: scope.crossOriginIsolated === true });
