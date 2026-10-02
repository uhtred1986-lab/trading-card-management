"use client";

import { useEffect, useState, type ReactNode } from "react";
import { keyOf, splitKey, type KnobSpec } from "@/lib/arena/probe-edges";
import type { BoardKnobs, KnobValue } from "@/lib/arena/probe-types";
import type { TryRow } from "@/lib/arena/tryit-judge";

/**
 * The two sheets Try it opens from a row (#470): "what should have happened"
 * after ✗, and "Change board", whose controls are only the knobs the rule's
 * own condition reads. A bottom sheet on a phone, a centred card from `sm`
 * up; every control a 44 px target.
 */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-space-950/70 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border border-space-700 bg-space-900 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-space-50">{title}</h2>
          <button type="button" className="tap -mr-2 -mt-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-xl text-space-400 hover:text-space-100" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const choice = "tap flex min-h-11 w-full items-center gap-3 rounded-xl border px-3 text-left text-[15px] font-semibold";

/** ✗: what should have happened instead. The choice the board already shows is not offered. */
export function WrongSheet({ row, onClose, onSave }: { row: TryRow; onClose: () => void; onSave: (should: "fire" | "notFire" | "other", note: string) => void }) {
  const fires = row.rules.fires;
  const options: { id: "fire" | "notFire" | "other"; label: string; hint: string }[] = [
    ...(fires ? [] : [{ id: "fire" as const, label: "It should fire", hint: "Fix opens the block that stopped it" }]),
    ...(fires ? [{ id: "notFire" as const, label: "It should not fire", hint: "Fix opens the block that let it" }] : []),
    { id: "other", label: "Something else", hint: fires ? "It should fire, but not like this" : "Say what should happen" },
  ];
  const [should, setShould] = useState<"fire" | "notFire" | "other">(options[0].id);
  const [note, setNote] = useState("");
  return (
    <Sheet title="What should have happened?" onClose={onClose}>
      <p className="mt-1 text-[13px] text-space-400">
        {row.title} → <span className="font-semibold text-space-200">{row.rules.headline}</span>
      </p>
      <div className="mt-3 space-y-2" role="radiogroup" aria-label="What should have happened">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={should === o.id}
            className={`${choice} ${should === o.id ? "border-ki-400 bg-ki-500/10 text-space-50" : "border-space-700 text-space-200"}`}
            onClick={() => setShould(o.id)}
          >
            <span className={`h-5 w-5 shrink-0 rounded-full border-2 ${should === o.id ? "border-ki-400 bg-ki-400" : "border-space-500"}`} />
            <span>
              {o.label}
              <span className="block text-[12px] font-normal text-space-400">{o.hint}</span>
            </span>
          </button>
        ))}
      </div>
      <label className="mt-3 block text-[12px] text-space-400">
        A note {should === "other" ? "(what it should do)" : "(optional)"}
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-xl border border-space-700 bg-space-950 px-3 py-2 text-[15px] text-space-100"
          placeholder={should === "other" ? "draws 2, not 1" : ""}
        />
      </label>
      <div className="mt-3 flex gap-2">
        <button type="button" className="tap min-h-11 flex-1 rounded-xl border border-space-600 text-[15px] font-semibold text-space-200" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="tap min-h-11 flex-1 rounded-xl bg-loss/80 text-[15px] font-semibold text-space-950 disabled:opacity-50"
          disabled={should === "other" && !note.trim()}
          onClick={() => onSave(should, note)}
        >
          Mark wrong
        </button>
      </div>
    </Sheet>
  );
}

/** "Change board": the numbers the rule's condition reads, set by hand. The changed board is one more row; the generated ones stay. */
export function BoardSheet({ row, knobs, start, onClose, onAdd }: { row: TryRow; knobs: KnobSpec[]; start: BoardKnobs; onClose: () => void; onAdd: (key: string) => void }) {
  const [set, setSet] = useState<BoardKnobs>(start);
  const base = splitKey(row.key).base;
  const key = keyOf(base, set);
  const put = (path: string, v: KnobValue) => setSet((s) => ({ ...s, [path]: v }));
  return (
    <Sheet title="Change board" onClose={onClose}>
      <p className="mt-1 text-[13px] text-space-400">Starting from: {row.title}</p>
      <div className="mt-3 space-y-3">
        {knobs.map((k) => (
          <div key={k.path}>
            <p className="text-[13px] font-semibold text-space-200">{k.kind === "turn" ? "Whose turn it is" : k.label.charAt(0).toUpperCase() + k.label.slice(1)}</p>
            {k.kind === "turn" ? (
              <div className="mt-1 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Whose turn it is">
                {(["you", "opponent"] as const).map((who) => (
                  <button
                    key={who}
                    type="button"
                    role="radio"
                    aria-checked={set[k.path] === who}
                    className={`tap min-h-11 rounded-xl border text-[15px] font-semibold ${set[k.path] === who ? "border-ki-400 bg-ki-500/10 text-space-50" : "border-space-700 text-space-300"}`}
                    onClick={() => put(k.path, who)}
                  >
                    {who === "you" ? "Your turn" : "Their turn"}
                  </button>
                ))}
              </div>
            ) : (
              <Stepper label={k.label} value={typeof set[k.path] === "number" ? (set[k.path] as number) : k.min} min={k.min} max={k.max} onChange={(v) => put(k.path, v)} />
            )}
          </div>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <button type="button" className="tap min-h-11 flex-1 rounded-xl border border-space-600 text-[15px] font-semibold text-space-200" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="tap min-h-11 flex-1 rounded-xl bg-ki-500 text-[15px] font-semibold text-space-950 disabled:opacity-50" disabled={key === row.key} onClick={() => onAdd(key)}>
          Try this board
        </button>
      </div>
    </Sheet>
  );
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const step = "tap inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-space-600 text-xl font-semibold text-space-100 disabled:opacity-40";
  return (
    <div className="mt-1 flex items-center gap-3">
      <button type="button" className={step} onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`Fewer: ${label}`}>
        −
      </button>
      <output className="min-w-10 text-center font-mono text-2xl font-semibold text-space-50" aria-live="polite">
        {value}
      </output>
      <button type="button" className={step} onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`More: ${label}`}>
        +
      </button>
    </div>
  );
}
