"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Panel } from "@/components/ui";

/**
 * "Play the computer" (#896): the built-in computer opponent as a first-class choice on the Arena
 * Play tab. It is the existing offline flow (`/arena/offline`, `LocalArena`): the match runs in this
 * browser on the heuristic computer player, saved on the device. No Claude, no AI tokens, no server.
 *
 * What the card says comes only from this browser's storage (a prepared-device mark and the saved-match
 * pointer, the same keys `shell.ts` and `local-board.ts` write), so it is a hint, never the authority:
 * `/arena/offline` re-checks the device (`assess`) and shows the real preparation, update and refusal
 * reasons. The keys are repeated here so the Arena page does not load the board code.
 */
const PREPARED_KEY = "dbs-arena-offline-prepared"; // = shell.ts PREPARED_KEY
const POINTER_KEY = "dbs-arena-local-pointer"; // = local-board.ts POINTER_KEY

type Saved = { vs: string; seat: "first" | "second" } | null;

const read = (): string => {
  try {
    return JSON.stringify({ prepared: localStorage.getItem(PREPARED_KEY) === "1", raw: localStorage.getItem(POINTER_KEY) });
  } catch { return JSON.stringify({ prepared: false, raw: null }); }
};
const subscribe = (notify: () => void) => { window.addEventListener("storage", notify); return () => window.removeEventListener("storage", notify); };

function parse(snapshot: string | null): { prepared: boolean; saved: Saved } {
  if (!snapshot) return { prepared: false, saved: null };
  const { prepared, raw } = JSON.parse(snapshot) as { prepared: boolean; raw: string | null };
  let saved: Saved = null;
  try {
    const p = raw ? (JSON.parse(raw) as { human?: string; names?: { p1?: string; p2?: string } }) : null;
    if (p && (p.human === "p1" || p.human === "p2") && p.names) saved = { vs: String(p.names[p.human === "p1" ? "p2" : "p1"] ?? "the computer"), seat: p.human === "p1" ? "first" : "second" };
  } catch { /* an unreadable pointer is simply no saved match */ }
  return { prepared, saved };
}

export function ComputerPlayCard() {
  // The server snapshot is null: the first paint is the same for everyone, then the device's own state fills in.
  const snapshot = useSyncExternalStore(subscribe, read, () => null);
  const { prepared, saved } = parse(snapshot);
  const cta = saved ? "Continue your match" : prepared ? "Start a match" : "Set up and play";
  return (
    <Panel className="space-y-3" aria-label="Play the computer" data-computer-play>
      <div>
        <p className="journey-eyebrow">BUILT-IN COMPUTER · FREE</p>
        <h2 className="text-lg font-semibold text-space-50">Play the computer</h2>
        <p className="mt-1 text-sm text-space-300">
          A computer player built into the app, not Claude: no AI tokens and no connection once set up. The match runs on this device and is saved after every move.
        </p>
      </div>
      {saved ? (
        <p role="status" className="text-sm text-space-200">Saved match against {saved.vs} · you play {saved.seat}. Continue it or start a new one.</p>
      ) : prepared ? (
        <p role="status" className="text-sm text-space-200">This device is set up. Pick your deck, the computer’s deck and your seat.</p>
      ) : (
        <p role="status" className="text-sm text-space-300">First time: one short download puts the starter decks and the game on this device. After that you can play offline.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Link href="/arena/offline" data-computer-play-cta className="tap inline-flex items-center justify-center rounded-lg bg-ki-500 px-4 py-2 text-sm font-bold text-space-950 hover:bg-ki-400">{cta} →</Link>
        {saved && prepared && <Link href="/arena/offline" className="tap inline-flex items-center justify-center rounded-lg border border-space-600 px-4 py-2 text-sm text-space-100 hover:border-space-400">New match</Link>}
      </div>
    </Panel>
  );
}
