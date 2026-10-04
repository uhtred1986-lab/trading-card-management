"use client";

import { useActionState } from "react";

type State = { ok: boolean; message: string } | null;

/** A settings form whose server action answers with a message instead of throwing (so a refused edit is read on the page). */
export function AiForm({ action, children, button = "Save" }: { action: (prev: State, f: FormData) => Promise<State>; children: React.ReactNode; button?: string }) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="space-y-3">
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} aria-busy={pending} className="tap rounded-md bg-ki-500 px-3 py-1.5 text-sm font-semibold text-space-950 hover:bg-ki-400 disabled:opacity-50">
          {pending ? "Saving…" : button}
        </button>
        {state ? (
          <span role="status" className={`text-xs ${state.ok ? "text-gain" : "text-loss"}`}>
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
