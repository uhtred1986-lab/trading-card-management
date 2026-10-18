"use client";

import { useEffect, useState } from "react";
import type { InputMode } from "@/lib/arena/tutorial/lessons";

/** Keys a keyboard player uses to move through and operate the board. Typing elsewhere does not count. */
const NAVIGATION_KEYS = new Set(["Tab", "Enter", " ", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Escape"]);

/** What the device says before the player has done anything: a coarse primary pointer is a touch screen. */
export function initialInputMode(): InputMode {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "mouse";
  if (window.matchMedia("(pointer: coarse)").matches) return "touch";
  if (window.matchMedia("(pointer: fine)").matches) return "mouse";
  return window.matchMedia("(any-pointer: coarse)").matches ? "touch" : "mouse";
}

/**
 * The way the player is operating the board right now: `pointer: coarse` / `fine` at first, then the
 * last real input event (a touch or pen pointer, a mouse pointer, or a navigation key). Viewport width
 * is never consulted: a narrow desktop window is still a mouse, and a tablet can be used with a keyboard.
 * The returned mode is the one the coach words its instructions for.
 */
export function useInputMode(): InputMode {
  const [mode, setMode] = useState<InputMode>("mouse");
  useEffect(() => {
    // Reading the device once on mount is an external-system synchronisation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(initialInputMode());
    const onPointer = (event: PointerEvent) => setMode(event.pointerType === "mouse" ? "mouse" : "touch");
    const onKey = (event: KeyboardEvent) => { if (!event.ctrlKey && !event.metaKey && !event.altKey && NAVIGATION_KEYS.has(event.key)) setMode("keyboard"); };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("pointerdown", onPointer, true); window.removeEventListener("keydown", onKey, true); };
  }, []);
  return mode;
}
