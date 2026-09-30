"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** The find box the `/` key focuses (rendered by the page). */
export const FIND_ID = "queue-find";

/** Keys never fire while typing, or with a modifier held (a browser shortcut stays the browser's). */
function typing(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
}

/**
 * The workbench's keys on the computer (issue #361): `j`/`k` the next and
 * previous rule in the queue, `c` confirm, `e` edit as text, `s` skip, `/`
 * find. Mounted only inside the workbench, so they exist nowhere else in the
 * app; `c` and `e` are events the record answers with what its buttons do.
 * Also keeps the open row in view in the queue as the selection moves.
 */
export function WorkbenchKeys({ prev, next, skip, current }: { prev: string | null; next: string | null; skip: string | null; current: number | null }) {
  const router = useRouter();

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      const to = (href: string | null) => href && router.push(href, { scroll: false });
      switch (e.key) {
        case "j":
          return void to(next);
        case "k":
          return void to(prev);
        case "s":
          return void to(skip);
        case "c":
          return void window.dispatchEvent(new CustomEvent("workbench:action", { detail: "confirm" }));
        case "e":
          // The record focuses its text box itself; keep the letter out of it.
          e.preventDefault();
          return void window.dispatchEvent(new CustomEvent("workbench:action", { detail: "edit" }));
        case "/": {
          const box = document.getElementById(FIND_ID);
          if (box) {
            e.preventDefault();
            box.focus();
          }
        }
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [router, prev, next, skip]);

  useEffect(() => {
    document.querySelector('[data-queue-row][aria-current="true"]')?.scrollIntoView({ block: "nearest" });
  }, [current]);

  return (
    <p className="hidden border-t border-space-700/70 p-2 text-[10px] leading-relaxed text-space-500 lg:block">
      <Kbd>j</Kbd>/<Kbd>k</Kbd> move · <Kbd>c</Kbd> confirm · <Kbd>e</Kbd> edit · <Kbd>s</Kbd> skip · <Kbd>/</Kbd> find
    </p>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-space-600 bg-space-950 px-1 font-mono text-space-300">{children}</kbd>;
}
