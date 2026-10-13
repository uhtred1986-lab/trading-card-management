/**
 * #651: the module worker `scripts/arena-policy-browser.mts` plays the local policy in — a thin
 * message shell around `arena-policy-browser-jobs.ts`.
 */
import { runJobs, type Job } from "./arena-policy-browser-jobs";

interface WorkerScope {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: { jobs: Job[]; maxMoves: number } }) => void) | null;
}
const scope = globalThis as unknown as WorkerScope;

scope.onmessage = (event) => {
  runJobs(event.data.jobs, event.data.maxMoves).then(
    (results) => scope.postMessage({ ok: true, results }),
    (error: unknown) => scope.postMessage({ ok: false, error: error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error) }),
  );
};
scope.postMessage({ ready: true });
