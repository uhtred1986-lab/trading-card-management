"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

const noop = () => () => {};

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])";

/**
 * A decision the board waits on, in the middle of the screen rather than in the dock (owner, 19 Oct 2026:
 * which energy pays for a move; then "active decisions need to be visible in the middle of the screen").
 * Portalled to the body so no transformed or sticky ancestor can pin it; the board's skin is copied across
 * so its buttons keep their look.
 *
 * - `peek` adds a "Show board" button: the prompt folds into a pill at the foot of the screen that
 *   reopens it, so the player can read the board the question is about. Key the component on the
 *   question so the next one opens unfolded.
 * - Focus moves into the prompt (the element marked `data-centre-focus`, else the first button) and
 *   Tab stays inside it. Escape runs `onEscape` (the legal pass answer) when there is one, else it
 *   folds the prompt away; a prompt with no `peek` and no `onEscape` ignores Escape.
 * - The scrim is the skin's own canvas colour, so a dark skin darkens and a light one lightens.
 */
export function CenterPrompt({
  label,
  children,
  peek = false,
  onEscape,
  pillLabel,
}: {
  label: string;
  children: React.ReactNode;
  peek?: boolean;
  onEscape?: () => void;
  pillLabel?: string;
}) {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const [folded, setFolded] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const open = mounted && !folded;
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = box.current;
    const first = root?.querySelector<HTMLElement>("[data-centre-focus], [data-centre-option], [data-defend-action], [data-action-label]") ?? root?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (onEscape) { e.preventDefault(); onEscape(); } else if (peek) { e.preventDefault(); setFolded(true); }
        return;
      }
      if (e.key !== "Tab" || !root) return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : at === items.length - 1 ? 0 : at + 1;
      e.preventDefault();
      items[next].focus();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onEscape, peek]);
  if (!mounted) return null;
  const skin = document.querySelector("[data-skin]")?.getAttribute("data-skin") ?? undefined;
  if (folded) {
    return createPortal(
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[70] flex justify-center px-4" data-skin={skin} data-center-pill>
        <button
          type="button"
          onClick={() => setFolded(false)}
          className="arena-btn tap pointer-events-auto min-h-11 max-w-full rounded-full border-2 border-space-950 bg-ki-500 px-5 py-2 text-sm font-bold text-space-950 shadow-2xl"
          aria-label={`Show the decision again: ${pillLabel ?? label}`}
        >
          <span className="block truncate">Decision waiting · {pillLabel ?? label} · Show</span>
        </button>
      </div>,
      document.body,
    );
  }
  return createPortal(
    <div className="fixed inset-0 z-[70] grid place-items-center p-4" style={{ background: "color-mix(in srgb, var(--ds-canvas) 62%, transparent)" }} role="dialog" aria-modal="true" aria-label={label} data-skin={skin} data-center-prompt>
      <div ref={box} className="flex max-h-[88dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl border-2 border-space-950 shadow-2xl lg:max-w-xl">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {peek && (
          <button type="button" onClick={() => setFolded(true)} className="arena-btn tap min-h-11 w-full shrink-0 border-t border-space-600 bg-space-800 px-4 text-sm font-semibold text-space-50" data-center-peek>
            Show board
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
