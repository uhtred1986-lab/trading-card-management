/** A policy-only Worker: receives restricted JSON inputs, never engine state. */
import { searchDecision } from "../../src/lib/arena/policy/search";
import { policyRng } from "../../src/lib/arena/policy/rng";
import type { PolicyInput } from "../../src/lib/arena/policy/contract";

const scope = globalThis as unknown as { postMessage(v: unknown): void; onmessage: ((e: { data: { inputs: Record<string, PolicyInput> } }) => void) | null };
scope.onmessage = (event) => {
  try {
    const cases = Object.fromEntries(Object.entries(event.data.inputs).map(([name, input]) => {
      const ms: number[] = [];
      let nodes = 0;
      let reservedBytes = 0;
      const statuses: Record<string, number> = {};
      for (let i = 0; i < 200; i++) {
        const start = performance.now();
        const r = searchDecision(input, policyRng(i));
        ms.push(performance.now() - start);
        nodes = Math.max(nodes, r.nodes);
        reservedBytes = Math.max(reservedBytes, r.reservedBytes);
        statuses[r.status] = (statuses[r.status] ?? 0) + 1;
      }
      const deadline = performance.now();
      const cancelled = searchDecision(input, policyRng(1), { stop: () => "cancelled" });
      const expired = searchDecision(input, policyRng(1), { stop: () => performance.now() >= deadline ? "deadline" : null });
      ms.sort((a, b) => a - b);
      return [name, { n: ms.length, p95Ms: ms[189], maxMs: ms[199], nodes, reservedBytes, statuses,
        cancellation: cancelled.status, deadline: expired.status, fallbackId: cancelled.answer.id, deadlineId: expired.answer.id }];
    }));
    scope.postMessage({ ok: true, cases });
  } catch (error) {
    scope.postMessage({ ok: false, error: String(error) });
  }
};
scope.postMessage({ ready: true });
