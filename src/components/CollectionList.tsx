"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { bulkAddToDeckAction, bulkDeleteCopiesAction, bulkSetFinishAction, bulkSetLocationAction, bulkSetOwnerAction, cloneCopyAction } from "@/app/collection/actions";
import type { CollectionCopy } from "@/lib/collection/queries";
import type { DeckOption } from "@/lib/decks/add";
import type { StorageLocation } from "@/lib/collection/locations";
import { formatCents } from "@/lib/money";
import { CardImage } from "./CardImage";

const NONE = "__none";
const NEW = "__new";

/**
 * The collection as one row per physical card, with multiselect.
 *
 * This is the half of the toggle the grid cannot do: the grid aggregates by
 * card id, so there is no way to point at *this* copy and hand it to someone
 * else. Here the row is the copy, and every bulk action takes lot ids.
 */
export function CollectionList({ rows, owners, decks, locations }: { rows: CollectionCopy[]; owners: string[]; decks: DeckOption[]; locations: StorageLocation[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  const [newOwner, setNewOwner] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  /** Anchor for shift-click, so a long run of copies is two clicks. */
  const anchor = useRef<number | null>(null);

  const ids = useMemo(() => rows.map((r) => r.id), [rows]);
  const chosen = useMemo(() => ids.filter((id) => selected.has(id)), [ids, selected]);
  const allOn = chosen.length > 0 && chosen.length === ids.length;

  const ownerNames = useMemo(
    () => [...new Set([...owners, ...rows.map((r) => r.owner).filter((o): o is string => !!o)])].sort((a, b) => a.localeCompare(b)),
    [owners, rows],
  );

  const toggleOne = (lotId: number, index: number, shift: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const turningOn = !next.has(lotId);
      const from = anchor.current == null ? -1 : ids.indexOf(anchor.current);
      if (shift && from >= 0) {
        const [a, b] = from < index ? [from, index] : [index, from];
        for (let i = a; i <= b; i += 1) {
          if (turningOn) next.add(ids[i]);
          else next.delete(ids[i]);
        }
      } else if (turningOn) {
        next.add(lotId);
      } else {
        next.delete(lotId);
      }
      anchor.current = lotId;
      return next;
    });
  };

  const run = (fn: () => Promise<string>, clearSelection = false) =>
    start(async () => {
      const message = await fn();
      if (clearSelection) setSelected(new Set());
      setNote(message);
      router.refresh();
    });

  const setOwner = (owner: string | null) =>
    run(async () => {
      const r = await bulkSetOwnerAction(chosen, owner);
      return `${r.updated} ${r.updated === 1 ? "copy" : "copies"} now owned by ${owner ?? "nobody"}.`;
    });

  const commitDraft = () => {
    const name = draft.trim();
    setNewOwner(false);
    setDraft("");
    if (name) setOwner(name);
  };

  const cell = "px-2 py-1.5 align-middle";
  const head = "px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-space-400";

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-xl border border-space-700/70 bg-space-900/40">
        <table className="w-full min-w-[620px] border-collapse text-sm">
          <thead className="border-b border-space-700 bg-space-900/80">
            <tr>
              <th className={`${head} w-8`}>
                <input
                  type="checkbox"
                  aria-label={allOn ? "Deselect every copy" : "Select every copy"}
                  checked={allOn}
                  ref={(el) => {
                    if (el) el.indeterminate = chosen.length > 0 && !allOn;
                  }}
                  onChange={() => {
                    anchor.current = null;
                    setSelected(allOn ? new Set() : new Set(ids));
                  }}
                  className="h-4 w-4 accent-ki-500"
                />
              </th>
              <th className={`${head} w-10`} />
              <th className={head}>Card</th>
              <th className={`${head} hidden sm:table-cell`}>Print</th>
              <th className={`${head} w-12 text-center`}>Foil</th>
              <th className={head}>Owner</th>
              <th className={`${head} hidden lg:table-cell`}>Location</th>
              <th className={`${head} hidden text-right md:table-cell`}>Paid</th>
              <th className={`${head} text-right`}>Value</th>
              <th className={`${head} text-right`}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const on = selected.has(r.id);
              return (
                <tr key={r.id} className={`border-b border-space-800/70 last:border-0 ${on ? "bg-ki-500/10" : "hover:bg-space-800/40"}`}>
                  <td className={cell}>
                    <input
                      type="checkbox"
                      aria-label={`Select the ${r.name} copy #${r.id}`}
                      checked={on}
                      onChange={(e) => toggleOne(r.id, i, (e.nativeEvent as MouseEvent).shiftKey)}
                      className="h-4 w-4 accent-ki-500"
                    />
                  </td>
                  <td className={cell}>
                    <Link href={`/cards/${encodeURIComponent(r.cardId)}`} className="block w-9">
                      <CardImage src={r.imageUrl} alt={r.name} sizes="36px" />
                    </Link>
                  </td>
                  <td className={cell}>
                    <Link href={`/cards/${encodeURIComponent(r.cardId)}`} className="block min-w-0">
                      <span className="block truncate font-medium text-space-50 hover:text-ki-300">{r.name}</span>
                      <span className="font-mono text-[11px] text-space-400">
                        {r.cardId} · {r.rarityCode}
                      </span>
                    </Link>
                  </td>
                  <td className={`${cell} hidden text-xs text-space-300 sm:table-cell`}>
                    <span className="block truncate">{r.printLabel}</span>
                    <span className="text-[11px] text-space-400">
                      {r.condition} · {r.language}
                    </span>
                  </td>
                  <td className={`${cell} text-center`}>
                    {r.finish === "foil" ? (
                      <span className="text-amber-300" title="Foil">
                        ✦
                      </span>
                    ) : (
                      <span className="text-space-600">—</span>
                    )}
                  </td>
                  <td className={`${cell} text-xs ${r.owner ? "text-space-200" : "text-space-500"}`}>{r.owner ?? "—"}</td>
                  <td className={`${cell} hidden text-xs lg:table-cell ${r.locationName ? "text-space-200" : "text-space-500"}`}>{r.locationName ?? "—"}</td>
                  <td className={`${cell} hidden text-right text-xs text-space-300 md:table-cell`}>
                    {r.pricePaidCents != null ? formatCents(r.pricePaidCents, r.currency) : "—"}
                  </td>
                  <td className={`${cell} text-right text-xs`}>
                    {r.marketEurCents != null ? (
                      <span className="font-medium text-space-100">{formatCents(r.marketEurCents)}</span>
                    ) : (
                      <span className="text-space-500">unpriced</span>
                    )}
                  </td>
                  <td className={`${cell} text-right`}>
                    <button
                      onClick={() =>
                        run(async () => {
                          const c = await cloneCopyAction(r.id);
                          return c.added ? `Added another ${r.name} — same print, condition and place.` : "That copy is gone; nothing cloned.";
                        })
                      }
                      disabled={pending}
                      title={`Add another copy exactly like this one${r.locationName ? ` (${r.printLabel}, ${r.condition}, in ${r.locationName})` : ` (${r.printLabel}, ${r.condition})`}`}
                      className="tap rounded-md border border-space-600 px-1.5 py-1 text-[11px] text-space-300 hover:bg-space-800 hover:text-space-50 disabled:opacity-40"
                    >
                      Clone
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {note ? <p className="text-xs text-gain">{note}</p> : null}

      {chosen.length > 0 ? (
        <div className="sticky bottom-16 z-30 flex flex-wrap items-center gap-2 rounded-xl border border-ki-500/40 bg-space-950/95 p-2 shadow-xl backdrop-blur sm:bottom-3">
          <span className="text-xs font-semibold text-space-100">
            {chosen.length} {chosen.length === 1 ? "copy" : "copies"}
          </span>
          <button onClick={() => setSelected(new Set())} className="tap rounded-md border border-space-700 px-2 py-1 text-xs text-space-300 hover:bg-space-800">
            Clear
          </button>

          {newOwner ? (
            <span className="flex items-center gap-1">
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitDraft();
                  }
                  if (e.key === "Escape") setNewOwner(false);
                }}
                placeholder="owner name"
                className="tap w-28 rounded-md border border-space-600 bg-space-900 px-2 py-1 text-xs text-space-100"
              />
              <button onClick={commitDraft} className="tap rounded-md bg-ki-500 px-2 py-1 text-xs font-semibold text-space-950 hover:bg-ki-400">
                Use
              </button>
            </span>
          ) : (
            <select
              value=""
              disabled={pending}
              onChange={(e) => {
                const v = e.target.value;
                e.target.value = "";
                if (!v) return;
                if (v === NEW) setNewOwner(true);
                else setOwner(v === NONE ? null : v);
              }}
              className="tap rounded-md border border-space-600 bg-space-900 px-2 py-1 text-xs text-space-100 disabled:opacity-40"
            >
              <option value="">Set owner…</option>
              {ownerNames.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
              <option value={NONE}>no owner</option>
              <option value={NEW}>someone else…</option>
            </select>
          )}

          {/* Filing a shelf-full in one go is the whole point of the multiselect. */}
          <select
            value=""
            disabled={pending}
            onChange={(e) => {
              const v = e.target.value;
              e.target.value = "";
              if (!v) return;
              const locationId = v === NONE ? null : Number(v);
              start(async () => {
                const r = await bulkSetLocationAction(chosen, locationId);
                const where = locationId ? locations.find((l) => l.id === locationId)?.name : null;
                setNote(`Filed ${r.updated} ${r.updated === 1 ? "copy" : "copies"} ${where ? `in ${where}` : "as unfiled"}.`);
                setSelected(new Set());
                router.refresh();
              });
            }}
            className="tap rounded-md border border-space-600 bg-space-900 px-2 py-1 text-xs text-space-100 disabled:opacity-40"
          >
            <option value="">File in…</option>
            {locations
              .filter((l) => !l.isArchived)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            <option value={NONE}>no location</option>
          </select>

          <button
            disabled={pending}
            onClick={() =>
              run(async () => {
                const r = await bulkSetFinishAction(chosen, true);
                return `${r.updated} marked foil.`;
              })
            }
            className="tap rounded-md border border-amber-400/40 px-2 py-1 text-xs text-amber-300 hover:bg-amber-400/10 disabled:opacity-40"
          >
            ✦ Foil
          </button>
          <button
            disabled={pending}
            onClick={() =>
              run(async () => {
                const r = await bulkSetFinishAction(chosen, false);
                return `${r.updated} marked non-foil.`;
              })
            }
            className="tap rounded-md border border-space-600 px-2 py-1 text-xs text-space-200 hover:bg-space-800 disabled:opacity-40"
          >
            Non-foil
          </button>

          <select
            value=""
            disabled={pending || decks.length === 0}
            onChange={(e) => {
              const deckId = Number(e.target.value);
              e.target.value = "";
              if (!deckId) return;
              const deck = decks.find((d) => d.id === deckId);
              run(async () => {
                const r = await bulkAddToDeckAction(chosen, deckId);
                return `Added ${r.added} to ${deck?.name ?? "deck"}.`;
              });
            }}
            className="tap rounded-md border border-space-600 bg-space-900 px-2 py-1 text-xs text-space-100 disabled:opacity-40"
          >
            <option value="">{decks.length ? "Add to deck…" : "No decks yet"}</option>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.isBuilt ? " (built)" : ""}
              </option>
            ))}
          </select>

          <button
            disabled={pending}
            onClick={() => {
              if (!confirm(`Delete ${chosen.length} ${chosen.length === 1 ? "copy" : "copies"} from your collection?`)) return;
              run(async () => {
                const r = await bulkDeleteCopiesAction(chosen);
                return `${r.deleted} ${r.deleted === 1 ? "copy" : "copies"} deleted.`;
              }, true);
            }}
            className="tap ml-auto rounded-md border border-loss/50 px-2 py-1 text-xs text-loss hover:bg-loss/10 disabled:opacity-40"
          >
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}
