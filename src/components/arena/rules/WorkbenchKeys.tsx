"use client";

import { useEffect } from "react";

/** The find box the `/` key focuses (rendered by the page). */
export const FIND_ID = "queue-find";

/** Keys never fire while typing, or with a modifier held (a browser shortcut stays the browser's). */
function typing(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
}

/**
 * The queue's one key on the computer: `/` focuses Find. Next, Previous and the rest of the
 * per-card keys belong to the card page.
 */
export function QueueKeys() {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || e.key !== "/") return;
      const box = document.getElementById(FIND_ID);
      if (box) {
        e.preventDefault();
        box.focus();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  return null;
}
