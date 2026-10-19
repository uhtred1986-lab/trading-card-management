"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

const noop = () => () => {};

/**
 * A decision the board waits on, in the middle of the screen rather than in the dock (owner, 19 Oct 2026:
 * which energy pays for a move). Portalled to the body so no transformed or sticky ancestor can pin it;
 * the board's skin is copied across so its buttons keep their look.
 */
export function CenterPrompt({ label, children }: { label: string; children: React.ReactNode }) {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  if (!mounted) return null;
  const skin = document.querySelector("[data-skin]")?.getAttribute("data-skin") ?? undefined;
  return createPortal(
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-label={label} data-skin={skin} data-center-prompt>
      <div className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-2xl border-2 border-space-950 shadow-2xl">{children}</div>
    </div>,
    document.body,
  );
}
