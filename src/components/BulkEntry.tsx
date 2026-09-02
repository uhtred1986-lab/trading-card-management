"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { addLots, printsForCardAction, type LotInput } from "@/app/collection/actions";
import { CONDITIONS } from "@/lib/collection/queries";
import type { DeckOption } from "@/lib/decks/add";
import { CardImage } from "./CardImage";
import { CardSearchInput, type CardHit as Hit } from "./CardSearchInput";
import { DeckPicker } from "./DeckPicker";
type Print = { id: string; label: string };

interface Row {
  key: number;
  card: Hit | null;
  prints: Print[];
  printId: string;
  quantity: number;
  condition: string;
  finish: string;
  pricePaid: string;
}

let nextKey = 1;
const blank = (): Row => ({ key: nextKey++, card: null, prints: [], printId: "", quantity: 1, condition: "NM", finish: "normal", pricePaid: "" });

/**
 * Path B: keyboard-only table entry. Type a few letters or a number, pick a
 * match with ↑/↓ + Enter, tab across qty/condition, Enter on the last field
 * commits the row and opens a new one. "Save all" writes every row at once.
 */
export function BulkEntry({ decks }: { decks: DeckOption[] }) {
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [active, setActive] = useState(0);
  const [saved, setSaved] = useState<{ added: number; deckAdded: number; deckId: number | null } | null>(null);
  const [deckId, setDeckId] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const [defaults, setDefaults] = useState({ condition: "NM", finish: "normal", acquiredOn: "", language: "EN" });

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const pick = async (i: number, hit: Hit) => {
    const prints = await printsForCardAction(hit.id);
    update(i, { card: hit, prints, printId: prints[0]?.id ?? "" });
  };

  const addRow = () => {
    setRows((rs) => [...rs, { ...blank(), condition: defaults.condition, finish: defaults.finish }]);
    setActive(rows.length);
  };

  const save = () =>
    start(async () => {
      const inputs: LotInput[] = rows
        .filter((r) => r.card && r.printId)
        .map((r) => ({ printId: r.printId, quantity: r.quantity, condition: r.condition, finish: r.finish, pricePaid: r.pricePaid || null, acquiredOn: defaults.acquiredOn || null, language: defaults.language }));
      const { added, deckAdded } = await addLots(inputs, deckId);
      setSaved({ added, deckAdded, deckId });
      setRows([blank()]);
      setActive(0);
    });

  const ready = rows.filter((r) => r.card && r.printId);
  const input = "tap w-full rounded-md border border-space-600 bg-space-900 px-2 py-1 text-sm text-space-100";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-space-700/70 bg-space-900/50 p-3 text-xs text-space-300">
        <label>
          Default condition
          <select value={defaults.condition} onChange={(e) => setDefaults({ ...defaults, condition: e.target.value })} className={input}>
            {CONDITIONS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Default finish
          <select value={defaults.finish} onChange={(e) => setDefaults({ ...defaults, finish: e.target.value })} className={input}>
            <option value="normal">Non-foil</option>
            <option value="foil">Foil</option>
          </select>
        </label>
        <label>
          Language
          <input value={defaults.language} onChange={(e) => setDefaults({ ...defaults, language: e.target.value.toUpperCase() })} className={`${input} w-16`} maxLength={3} />
        </label>
        <label>
          Acquired on
          <input type="date" value={defaults.acquiredOn} onChange={(e) => setDefaults({ ...defaults, acquiredOn: e.target.value })} className={input} />
        </label>
        <button onClick={save} disabled={pending || ready.length === 0} className="tap ml-auto rounded-md bg-ki-500 px-4 py-2 text-sm font-semibold text-space-950 hover:bg-ki-400 disabled:opacity-50">
          {pending ? "Saving…" : `Save ${ready.reduce((n, r) => n + r.quantity, 0)} card${ready.length === 1 && ready[0].quantity === 1 ? "" : "s"}`}
        </button>
      </div>

      <DeckPicker decks={decks} value={deckId} onChange={(id) => setDeckId(id)} />

      {saved != null ? (
        <p className="rounded-xl border border-gain/40 bg-gain/5 p-2 text-sm text-gain">
          Saved {saved.added} card{saved.added === 1 ? "" : "s"}
          {saved.deckId ? (
            <>
              {" "}
              and put {saved.deckAdded} in{" "}
              <Link href={`/decks/${saved.deckId}`} className="underline">
                the deck
              </Link>
            </>
          ) : null}
          . <Link href="/collection" className="underline">View collection</Link>
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-space-700/70">
        <table className="w-full text-sm">
          <thead className="bg-space-900 text-left text-xs uppercase tracking-wide text-space-300">
            <tr>
              <th className="px-2 py-2">Card</th>
              <th className="px-2 py-2">Print</th>
              <th className="w-16 px-2 py-2">Qty</th>
              <th className="w-20 px-2 py-2">Cond.</th>
              <th className="w-24 px-2 py-2">Finish</th>
              <th className="w-24 px-2 py-2">Paid €</th>
              <th className="w-10 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} className="border-t border-space-800 align-top">
                <td className="min-w-[16rem] px-2 py-1.5">
                  <CardPicker
                    row={r}
                    autoFocus={i === active}
                    onPick={(hit) => pick(i, hit)}
                    onClear={() => update(i, { card: null, prints: [], printId: "" })}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <select value={r.printId} onChange={(e) => update(i, { printId: e.target.value })} className={input} disabled={!r.card}>
                    {r.prints.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <input type="number" min={1} value={r.quantity} onChange={(e) => update(i, { quantity: Math.max(1, Number(e.target.value) || 1) })} className={input} />
                </td>
                <td className="px-2 py-1.5">
                  <select value={r.condition} onChange={(e) => update(i, { condition: e.target.value })} className={input}>
                    {CONDITIONS.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <select value={r.finish} onChange={(e) => update(i, { finish: e.target.value })} className={input}>
                    <option value="normal">Non-foil</option>
                    <option value="foil">Foil</option>
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <input
                    value={r.pricePaid}
                    inputMode="decimal"
                    placeholder="1,50"
                    onChange={(e) => update(i, { pricePaid: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && r.card) {
                        e.preventDefault();
                        if (i === rows.length - 1) addRow();
                        else setActive(i + 1);
                      }
                    }}
                    className={input}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <button onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : [blank()]))} className="tap rounded px-2 text-space-400 hover:text-loss" aria-label="Remove row">
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={addRow} className="tap rounded-md border border-space-600 px-3 py-1.5 text-sm text-space-100 hover:bg-space-800">
        + Row (or press Enter in the last field)
      </button>
    </div>
  );
}

function CardPicker({ row, autoFocus, onPick, onClear }: { row: Row; autoFocus: boolean; onPick: (h: Hit) => void; onClear: () => void }) {
  if (row.card) {
    return (
      <div className="flex items-center gap-2">
        <div className="w-8 shrink-0">
          <CardImage src={row.card.imageUrl} alt={row.card.name} sizes="32px" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-space-50">{row.card.name}</div>
          <div className="font-mono text-xs text-space-300">{row.card.id}</div>
        </div>
        <button onClick={onClear} className="tap rounded px-2 text-xs text-space-400 hover:text-space-50">
          change
        </button>
      </div>
    );
  }

  return <CardSearchInput autoFocus={autoFocus} onPick={onPick} />;
}
