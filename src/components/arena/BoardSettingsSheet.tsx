"use client";

import { useOptimistic, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { chooseSkin, chooseStaging } from "@/app/arena/actions";
import { feel, feelPrefs, serverFeelPrefs, setFeelPrefs, subscribeFeel } from "@/lib/arena/feel";
import { PACES, pacePref, serverPacePref, setPacePref, subscribePace, type Pace } from "@/lib/arena/pace";
import { ARENA_SKINS, type ArenaSkin } from "@/lib/arena/skin";
import { ARENA_STAGINGS, STAGING_LABEL, type ArenaStaging } from "@/lib/arena/staging";

const SKIN_LABEL: Record<ArenaSkin, string> = { anime: "Sky", night: "Night" };
const PACE_LABEL: Record<Pace, string> = { slow: "Slow", normal: "Normal", step: "Step" };

/**
 * "Board settings" from Play's ⋯ menu (#370): the board's four per-device
 * preferences, before any game exists. Same storage as the in-game controls
 * (`SkinToggle`, `PaceToggle`, `StagingToggle`, `FeelToggle`): the skin and
 * staging cookies, which the game page reads on the server so the board opens
 * in the chosen skin on the first paint, and the pace and haptics
 * `localStorage` keys. A native `<dialog>` like `DeckPreviewSheet`: a bottom
 * sheet on a phone, a right panel from `sm` up. The dialog is portalled to
 * `<body>` because the trigger sits inside a `<details>` menu, whose closed
 * content would hide it.
 */
export function BoardSettingsSheet({ skin, staging, className = "" }: { skin: ArenaSkin; staging: ArenaStaging; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const show = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Close the menu; the dialog lives outside it.
    e.currentTarget.closest("details")?.removeAttribute("open");
    flushSync(() => setOpen(true));
    dialog.current?.showModal();
  };
  return (
    <>
      <button type="button" onClick={show} className={className}>
        Board settings
      </button>
      {open &&
        createPortal(
          <dialog
            ref={dialog}
            aria-labelledby="board-settings-title"
            onClose={() => setOpen(false)}
            onClick={(e) => e.target === dialog.current && dialog.current?.close()}
            className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[85dvh] w-full max-w-none overflow-hidden rounded-t-2xl border border-space-700 bg-space-950 p-0 text-space-100 backdrop:bg-black/60 sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:h-full sm:w-96 sm:rounded-none sm:rounded-l-2xl"
          >
            <Body skin={skin} staging={staging} onClose={() => dialog.current?.close()} />
          </dialog>,
          document.body,
        )}
    </>
  );
}

function Body({ skin, staging, onClose }: { skin: ArenaSkin; staging: ArenaStaging; onClose: () => void }) {
  const [, start] = useTransition();
  const [skinNow, setSkin] = useOptimistic(skin);
  const [stagingNow, setStaging] = useOptimistic(staging);
  const pace = useSyncExternalStore(subscribePace, pacePref, serverPacePref);
  const prefs = useSyncExternalStore(subscribeFeel, feelPrefs, serverFeelPrefs);

  return (
    <div className="flex max-h-[85dvh] flex-col sm:max-h-none sm:h-full">
      <header className="flex items-center gap-2 border-b border-space-700 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 id="board-settings-title" className="text-base font-semibold text-space-50">
            Board settings
          </h2>
          <p className="text-xs text-space-400">Kept on this device. Your next game opens with them.</p>
        </div>
        <button type="button" autoFocus onClick={onClose} aria-label="Close" className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-space-600 bg-space-900 text-lg">
          ×
        </button>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
        <Row label="Sky or night">
          {ARENA_SKINS.map((s) => (
            <Seg
              key={s}
              on={s === skinNow}
              onClick={() =>
                start(async () => {
                  setSkin(s);
                  await chooseSkin(undefined, s);
                })
              }
            >
              {SKIN_LABEL[s]}
            </Seg>
          ))}
        </Row>
        <Row label="Pace">
          {PACES.map((p) => (
            <Seg key={p} on={p === pace} onClick={() => setPacePref(p)}>
              {PACE_LABEL[p]}
            </Seg>
          ))}
        </Row>
        <Row label="Battle staging">
          {ARENA_STAGINGS.map((s) => (
            <Seg
              key={s}
              on={s === stagingNow}
              onClick={() =>
                start(async () => {
                  setStaging(s);
                  await chooseStaging(undefined, s);
                })
              }
            >
              {STAGING_LABEL[s]}
            </Seg>
          ))}
        </Row>
        <Row label="Haptics">
          {[true, false].map((v) => (
            <Seg
              key={String(v)}
              on={prefs.haptics === v}
              onClick={() => {
                setFeelPrefs({ ...prefs, haptics: v });
                // Answer with the buzz, as `FeelToggle` does; the tap is also the gesture audio needs.
                if (v) feel("tap");
              }}
            >
              {v ? "On" : "Off"}
            </Seg>
          ))}
        </Row>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="space-y-2">
      <div className="text-xs uppercase tracking-widest text-space-400">{label}</div>
      <div className="flex gap-1 rounded-lg bg-space-900 p-1">{children}</div>
    </div>
  );
}

function Seg({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`tap flex-1 rounded-md px-2 text-sm font-medium ${on ? "bg-space-700 text-space-50" : "text-space-300 hover:text-space-100"}`}
    >
      {children}
    </button>
  );
}
