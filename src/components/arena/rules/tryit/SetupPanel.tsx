"use client";

import { useRef, useState } from "react";
import { SETUP_FILLER, SETUP_LIMITS, isEmptySetup, type BoardSetup, type SetupCardHit } from "@/lib/arena/sandbox/setup";
import { Sheet } from "./sheets";

/**
 * "Set up the board" (play-test): change the staged position — Leaders, hand,
 * Battle Area, Drop, energy, life — then Reset plays on it. A bottom sheet on
 * a phone, a centred card from `sm` up (the `Sheet` Try it uses). Real cards
 * come from the catalog through `search`; the sheet only holds ids and the
 * names it was shown, and hands a `BoardSetup` back.
 *
 * Whose turn it is and the phase are not here: they come from the board
 * picked above (e.g. "the opponent attacks"), which is what the rule waits for.
 */
export type SetupSearch = (query: string, leadersOnly: boolean) => Promise<{ error: string | null; hits: SetupCardHit[] }>;

const chip = "tap inline-flex min-h-11 items-center gap-1 rounded-lg border border-space-600 px-2 text-[13px] text-space-100";
const sub = "text-[13px] font-semibold text-space-200";
const ghost = "tap inline-flex min-h-11 items-center justify-center rounded-lg border border-space-600 px-3 text-[14px] font-semibold text-space-200 hover:bg-space-800";

function Picker({ label, leadersOnly, search, onPick }: { label: string; leadersOnly: boolean; search: SetupSearch; onPick: (hit: SetupCardHit) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SetupCardHit[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const seq = useRef(0);
  const run = async (text: string) => {
    setQ(text);
    const mine = ++seq.current;
    if (text.trim().length < 2) {
      setHits([]);
      setNote(null);
      return;
    }
    try {
      const r = await search(text, leadersOnly);
      if (mine !== seq.current) return;
      setHits(r.hits);
      setNote(r.error ?? (r.hits.length ? null : "Nothing found."));
    } catch (e) {
      if (mine === seq.current) setNote(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="mt-1">
      <input
        type="search"
        value={q}
        onChange={(e) => void run(e.target.value)}
        placeholder={label}
        aria-label={label}
        className="tap min-h-11 w-full rounded-lg border border-space-700 bg-space-950 px-3 text-[14px] text-space-100"
      />
      {note && <p className="mt-1 text-[12px] text-space-500">{note}</p>}
      {hits.length > 0 && (
        <ul className="mt-1 max-h-44 overflow-auto rounded-lg border border-space-800">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                className="tap flex min-h-11 w-full items-center justify-between gap-2 px-3 text-left text-[13px] text-space-100 hover:bg-space-800"
                onClick={() => {
                  onPick(h);
                  setQ("");
                  setHits([]);
                  seq.current++;
                }}
              >
                <span className="min-w-0 truncate">{h.name}</span>
                <span className="shrink-0 font-mono text-[11px] text-space-400">
                  {h.id} · {h.type.toLowerCase()}
                  {h.cost ? ` · ${h.cost}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stepper({ label, value, min, max, onChange, zero }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; zero?: string }) {
  const step = "tap inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-space-600 text-xl font-semibold text-space-100 disabled:opacity-40";
  return (
    <div className="flex items-center gap-2">
      <button type="button" className={step} disabled={value <= min} onClick={() => onChange(value - 1)} aria-label={`Fewer: ${label}`}>
        −
      </button>
      <output className="min-w-12 text-center font-mono text-lg font-semibold text-space-50" aria-live="polite">
        {value === 0 && zero ? zero : value}
      </output>
      <button type="button" className={step} disabled={value >= max} onClick={() => onChange(value + 1)} aria-label={`More: ${label}`}>
        +
      </button>
      <span className="text-[13px] text-space-300">{label}</span>
    </div>
  );
}

export function SetupSheet({ value, names: known, search, onApply, onClose }: { value: BoardSetup; names: Record<string, string>; search: SetupSearch; onApply: (setup: BoardSetup, names: Record<string, string>) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<BoardSetup>(value);
  const [names, setNames] = useState<Record<string, string>>(known);
  const nameOf = (id: string) => (id === SETUP_FILLER ? "Any card" : (names[id] ?? id));
  const learn = (h: SetupCardHit) => setNames((n) => ({ ...n, [h.id]: h.name }));
  const area = (key: "hand" | "battle" | "drop", title: string) => {
    const list = draft[key] ?? [];
    const full = list.length >= SETUP_LIMITS.cards;
    return (
      <section>
        <h3 className={sub}>
          {title} <span className="font-normal text-space-500">({list.length})</span>
        </h3>
        {list.length > 0 && (
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {list.map((id, i) => (
              <li key={`${id}-${i}`}>
                <button type="button" className={chip} onClick={() => setDraft((d) => ({ ...d, [key]: (d[key] ?? []).filter((_, j) => j !== i) }))} aria-label={`Remove ${nameOf(id)}`}>
                  {nameOf(id)} <span aria-hidden="true">×</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-1 flex gap-1.5">
          <button type="button" className={ghost} disabled={full} onClick={() => setDraft((d) => ({ ...d, [key]: [...(d[key] ?? []), SETUP_FILLER] }))}>
            + Any card
          </button>
        </div>
        {!full && (
          <Picker
            label={`Add a card to ${title.toLowerCase()} (name or number)`}
            leadersOnly={false}
            search={search}
            onPick={(h) => {
              learn(h);
              setDraft((d) => ({ ...d, [key]: [...(d[key] ?? []), h.id] }));
            }}
          />
        )}
      </section>
    );
  };
  const leader = (key: "leader" | "theirLeader", title: string) => (
    <section>
      <h3 className={sub}>{title}</h3>
      <p className="mt-0.5 text-[13px] text-space-300">
        {draft[key] ? nameOf(draft[key] as string) : "As the board has it"}
        {draft[key] && (
          <button type="button" className="tap ml-2 min-h-11 rounded-lg px-2 text-[12px] text-space-400 underline" onClick={() => setDraft((d) => ({ ...d, [key]: undefined }))}>
            Clear
          </button>
        )}
      </p>
      <Picker
        label={`Search a Leader (name or number)`}
        leadersOnly
        search={search}
        onPick={(h) => {
          learn(h);
          setDraft((d) => ({ ...d, [key]: h.id }));
        }}
      />
    </section>
  );
  const energy = draft.energy ?? { active: 6, rested: 0 };
  return (
    <Sheet title="Set up the board" onClose={onClose}>
      <p className="mt-1 text-[12px] text-space-400">Changes the staged position. Reset then starts a new game on it. Whose turn it is comes from the board you picked.</p>
      <div className="mt-3 space-y-4">
        {leader("leader", "Your Leader")}
        {leader("theirLeader", "Opponent's Leader")}
        {area("hand", "Your hand")}
        {area("battle", "Your Battle Area")}
        {area("drop", "Your Drop")}
        <section>
          <h3 className={sub}>Your energy</h3>
          <div className="mt-1 space-y-1.5">
            <Stepper label="active" value={energy.active} min={0} max={SETUP_LIMITS.energy} onChange={(v) => setDraft((d) => ({ ...d, energy: { active: v, rested: Math.min(energy.rested, SETUP_LIMITS.energy - v) } }))} />
            <Stepper label="rested" value={energy.rested} min={0} max={SETUP_LIMITS.energy - energy.active} onChange={(v) => setDraft((d) => ({ ...d, energy: { active: energy.active, rested: v } }))} />
          </div>
        </section>
        <section>
          <h3 className={sub}>Life</h3>
          <div className="mt-1 space-y-1.5">
            <Stepper label="your life" value={draft.life?.you ?? 0} min={0} max={SETUP_LIMITS.life} zero="board" onChange={(v) => setDraft((d) => ({ ...d, life: { ...d.life, you: v || undefined } }))} />
            <Stepper label="their life" value={draft.life?.them ?? 0} min={0} max={SETUP_LIMITS.life} zero="board" onChange={(v) => setDraft((d) => ({ ...d, life: { ...d.life, them: v || undefined } }))} />
          </div>
        </section>
      </div>
      <div className="mt-4 flex gap-2">
        <button type="button" className={`${ghost} flex-1`} onClick={() => setDraft({})} disabled={isEmptySetup(draft)}>
          Clear all
        </button>
        <button type="button" className="tap min-h-11 flex-1 rounded-xl bg-ki-500 text-[15px] font-semibold text-space-950" onClick={() => onApply(draft, names)}>
          Apply and Reset
        </button>
      </div>
    </Sheet>
  );
}
