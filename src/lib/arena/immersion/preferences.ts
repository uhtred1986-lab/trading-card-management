"use client";
import { useSyncExternalStore } from "react";
export interface ImmersionPreferences { banners: boolean; sound: boolean; volume: number }
const defaults: ImmersionPreferences = { banners: true, sound: false, volume: .35 };
const key = "arena.immersion.v1";
let cached: ImmersionPreferences | null = null;
const listeners = new Set<() => void>();
function read() {
  if (cached) return cached;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "{}");
    cached = { banners: saved.banners !== false, sound: saved.sound === true, volume: typeof saved.volume === "number" && Number.isFinite(saved.volume) ? Math.max(0, Math.min(1, saved.volume)) : defaults.volume };
  } catch { cached = defaults; }
  return cached;
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  const storage = (event: StorageEvent) => { if (event.key === key || event.key === null) { cached = null; fn(); } };
  window.addEventListener("storage", storage);
  return () => { listeners.delete(fn); window.removeEventListener("storage", storage); };
}
export function setImmersionPreferences(update: Partial<ImmersionPreferences>) {
  cached = { ...read(), ...update };
  try { localStorage.setItem(key, JSON.stringify(cached)); } catch { /* Session preference still works. */ }
  listeners.forEach(fn => fn());
}
export function useImmersionPreferences() { return useSyncExternalStore(subscribe, read, () => defaults); }
