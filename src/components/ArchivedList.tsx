"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { bulkPurgeCopiesAction, bulkRestoreCopiesAction, purgeLotAction, restoreLotAction } from "@/app/collection/actions";
import type { ArchivedCopy } from "@/lib/collection/queries";
import { CardImage } from "./CardImage";

/**
 * Copies removed from the collection, restorable one at a time or in bulk.
 * "Delete forever" is the only irreversible action here — everything else on
 * this page is what undoes the collection's own "delete".
 */
export function ArchivedList({ rows }: { rows: ArchivedCopy[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const ids = useMemo(() => rows.map((r) => r.id), [rows]);
  const chosen = useMemo(() => ids.filter((id) => selected.has(id)), [ids, selected]);
  const allOn = chosen.length > 0 && chosen.length === ids.length;

  const toggleOne = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = (fn: () => Promise<string>, clearSelection = false) =>
    start(async () => {
      const message = await fn();
      if (clearSelection) setSelected(new Set());
      setNote(message);
      router.refresh();
    });

  if (rows.length === 0) {
    return <p className="rounded-xl border border-dashed border-space-700 p-8 text-center text-space-300">Nothing archived — deleted copies show up here.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-xl border border-space-700/70 bg-space-900/40">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-space-700/70">
              <th className="w-8 px-2 py-1.5">
                <input
                  type="checkbox"
                  checked={allOn}
                  onChange={(e) => setSelected(e.target.checked ? new Set(ids) : new Set())}
                  className="h-3.5 w-3.5 accent-ki-500"
                />
              </th>
              <th className="px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-space-400">Card</th>
              <th className="px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-space-400">Print</th>
              <th className="px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-space-400">Archived</th>
              <th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-space-800/70 last:border-0">
                <td className="px-2 py-1.5 align-middle">
                  <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} className="h-3.5 w-3.5 accent-ki-500" />
                </td>
                <td className="px-2 py-1.5 align-middle">
                  <div className="flex items-center gap-2">
                    <CardImage src={r.imageUrl} alt={r.name} className="w-8 shrink-0" />
                    <div className="min-w-0">
                      <div className="truncate text-space-100">{r.name}</div>
                      <div className="font-mono text-[10px] text-space-500">{r.cardId}</div>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-1.5 align-middle text-space-300">
                  {r.printLabel} · {r.condition}
                  {r.finish === "foil" ? <span className="ml-1 rounded bg-amber-200/90 px-1 text-[10px] text-space-950">✦</span> : null}
                </td>
                <td className="px-2 py-1.5 align-middle text-xs text-space-400">{new Date(r.archivedAt).toLocaleDateString()}</td>
                <td className="px-2 py-1.5 align-middle text-right">
                  <div className="flex justify-end gap-1">
                    <button
                      disabled={pending}
                      onClick={() => run(async () => ((await restoreLotAction(r.id)).ok ? "Restored." : "Could not restore."))}
                      className="tap rounded-md border border-space-600 px-2 py-1 text-xs text-space-100 hover:bg-space-800 disabled:opacity-40"
                    >
                      Restore
                    </button>
                    <button
                      disabled={pending}
                      onClick={() => {
                        if (!confirm(`Permanently delete this copy of ${r.name}? This cannot be undone.`)) return;
                        run(async () => ((await purgeLotAction(r.id)).ok ? "Deleted forever." : "Could not delete."));
                      }}
                      className="tap rounded-md border border-loss/50 px-2 py-1 text-xs text-loss hover:bg-loss/10 disabled:opacity-40"
                    >
                      Delete forever
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {chosen.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-space-700/70 bg-space-900/60 p-2">
          <span className="text-xs text-space-300">{chosen.length} selected</span>
          {note ? <span className="text-xs text-gain">{note}</span> : null}
          <button
            disabled={pending}
            onClick={() =>
              run(async () => {
                const r = await bulkRestoreCopiesAction(chosen);
                return `${r.restored} ${r.restored === 1 ? "copy" : "copies"} restored.`;
              }, true)
            }
            className="tap rounded-md border border-space-600 px-2 py-1 text-xs text-space-100 hover:bg-space-800 disabled:opacity-40"
          >
            Restore
          </button>
          <button
            disabled={pending}
            onClick={() => {
              if (!confirm(`Permanently delete ${chosen.length} ${chosen.length === 1 ? "copy" : "copies"}? This cannot be undone.`)) return;
              run(async () => {
                const r = await bulkPurgeCopiesAction(chosen);
                return `${r.purged} ${r.purged === 1 ? "copy" : "copies"} deleted forever.`;
              }, true);
            }}
            className="tap ml-auto rounded-md border border-loss/50 px-2 py-1 text-xs text-loss hover:bg-loss/10 disabled:opacity-40"
          >
            Delete forever
          </button>
        </div>
      ) : null}
    </div>
  );
}
