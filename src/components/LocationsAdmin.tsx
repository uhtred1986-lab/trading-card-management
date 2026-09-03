"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { archiveLocationAction, createLocationAction, deleteLocationAction, renameLocationAction, setLocationNoteAction, type LocationResult } from "@/app/settings/locations/actions";
import type { StorageLocation } from "@/lib/collection/locations";

/** Maintain the list of places cards are kept. */
export function LocationsAdmin({ locations }: { locations: StorageLocation[] }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<LocationResult | null>(null);
  const [draft, setDraft] = useState({ name: "", note: "" });

  const run = (fn: () => Promise<LocationResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setNote(r);
      if (r.ok) after?.();
    });

  const input = "tap rounded-md border border-space-600 bg-space-900 px-2 py-1.5 text-sm text-space-100";

  return (
    <div className="space-y-4">
      {note ? (
        <p className={`rounded-xl border p-2 text-sm ${note.ok ? "border-gain/40 bg-gain/5 text-gain" : "border-loss/40 bg-loss/5 text-loss"}`}>{note.ok ? note.message : note.error}</p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-space-700/70">
        <table className="w-full text-sm">
          <thead className="bg-space-900 text-left text-xs uppercase tracking-wide text-space-300">
            <tr>
              <th className="px-3 py-2">Location</th>
              <th className="px-3 py-2">Note</th>
              <th className="w-20 px-3 py-2 text-right">Cards</th>
              <th className="w-44 px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {locations.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-space-300">
                  No locations yet — add your first below.
                </td>
              </tr>
            ) : null}
            {locations.map((l) => (
              <tr key={l.id} className={`border-t border-space-800 align-middle ${l.isArchived ? "opacity-60" : ""}`}>
                <td className="px-3 py-2">
                  <input
                    defaultValue={l.name}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== l.name) run(() => renameLocationAction(l.id, v));
                    }}
                    className={`${input} w-44`}
                    aria-label={`Name of ${l.name}`}
                  />
                  {l.isArchived ? <span className="ml-2 text-[10px] uppercase tracking-wide text-space-400">archived</span> : null}
                </td>
                <td className="px-3 py-2">
                  <input
                    defaultValue={l.note ?? ""}
                    placeholder="e.g. top shelf, blue binder"
                    onBlur={(e) => {
                      if (e.target.value.trim() !== (l.note ?? "")) run(() => setLocationNoteAction(l.id, e.target.value));
                    }}
                    className={`${input} w-full`}
                    aria-label={`Note for ${l.name}`}
                  />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {l.cards > 0 ? (
                    <Link href={`/collection?view=list&location=${l.id}`} className="text-space-100 hover:text-ki-300">
                      {l.cards}
                    </Link>
                  ) : (
                    <span className="text-space-500">0</span>
                  )}
                  {l.decks > 0 ? (
                    <Link href={`/decks`} className="ml-1 text-[11px] text-space-400 hover:text-ki-300">
                      +{l.decks} deck{l.decks === 1 ? "" : "s"}
                    </Link>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap justify-end gap-1">
                    <button onClick={() => run(() => archiveLocationAction(l.id, !l.isArchived))} disabled={pending} className="tap rounded-md border border-space-600 px-2 py-1 text-xs text-space-200 hover:bg-space-800">
                      {l.isArchived ? "Restore" : "Archive"}
                    </button>
                    <button
                      onClick={() => {
                        const filed = [l.cards ? `${l.cards} card${l.cards === 1 ? "" : "s"}` : "", l.decks ? `${l.decks} deck${l.decks === 1 ? "" : "s"}` : ""].filter(Boolean);
                        const warn = filed.length ? `${filed.join(" and ")} filed there will show no location. ` : "";
                        if (window.confirm(`Delete "${l.name}"? ${warn}Archiving keeps the label instead.`)) run(() => deleteLocationAction(l.id));
                      }}
                      disabled={pending}
                      className="tap rounded-md border border-space-600 px-2 py-1 text-xs text-space-300 hover:bg-space-800 hover:text-loss"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
        <h2 className="mb-2 text-sm font-semibold text-space-50">Add a location</h2>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Binder 1" className={input} />
          <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="note (optional)" className={input} />
          <button
            onClick={() => run(() => createLocationAction(draft.name, draft.note), () => setDraft({ name: "", note: "" }))}
            disabled={pending || !draft.name.trim()}
            className="tap rounded-md bg-ki-500 px-3 py-1.5 text-sm font-semibold text-space-950 hover:bg-ki-400 disabled:opacity-50"
          >
            {pending ? "…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
