"use client";

import { useActionState } from "react";

type State = { ok: boolean; message: string } | null;

/** One tiny prompt to one provider; a paid call on a paid provider, so it runs only when this is pressed. */
export function TestConnection({ provider, action }: { provider: string; action: (prev: State, f: FormData) => Promise<State> }) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="provider" value={provider} />
      <button type="submit" disabled={pending} aria-busy={pending} className="tap rounded-md border border-space-600 px-3 py-1 text-xs text-space-100 hover:bg-space-800 disabled:opacity-50">
        {pending ? "Testing…" : "Test connection"}
      </button>
      {state ? <span className={`break-words text-xs ${state.ok ? "text-gain" : "text-loss"}`}>{state.message}</span> : null}
    </form>
  );
}
