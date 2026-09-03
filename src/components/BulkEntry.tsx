"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { addLots, printsForCardAction, type LotInput } from "@/app/collection/actions";
import { CONDITIONS } from "@/lib/collection/queries";
import type { DeckOption } from "@/lib/decks/add";
import { CardImage } from "./CardImage";
import { CardSearchInput, type CardHit as Hit } from "./CardSearchInput";
import { DeckPicker } from "./DeckPicker";
import { VoiceEntry } from "./VoiceEntry";
type Print = { id: string; label: string };

interface Row {
  key: number;
  card: Hit | null;
  prints: Print[];
  printId: string;
  /** Kept as text so the field can be empty mid-typing; parsed on save. */
  quantity: string;
  condition: string;
  finish: string;
  pricePaid: string;
}

let nextKey = 1;
const blank = (): Row => ({ key: nextKey++, card: null, prints: [], printId: "", quantity: "1", condition: "NM", finish: "normal", pricePaid: "" });

const qtyOf = (r: Row) => Math.max(1, parseInt(r.quantity, 10) || 1);

/**
 * Path B: keyboard-only table entry. One row is three keystroke groups and
 * never needs the mouse: type a few letters or a number → ↑/↓ to pick a
 * suggestion → **Tab** takes it and lands on Amount → **Tab** to the Foil
 * box (space toggles) → **Tab** opens a fresh row.
 *
 * Print, condition and price are deliberately *outside* that tab order
 * (`tabIndex={-1}`) so the common path stays three stops; they default
 * sensibly and are still clickable when a row needs them.
 */
export function BulkEntry({ decks }: { decks: DeckOption[] }) {
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [active, setActive] = useState(0);
  const [saved, setSaved] = useState<{ added: number; deckAdded: number; deckId: number | null } | null>(null);
  const [deckId, setDeckId] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const [defaults, setDefaults] = useState({ condition: "NM", finish: "normal", acquiredOn: "", language: "EN" });

  // Keyed by row key so a removed row can't leave focus pointing at the wrong input.
  const qtyRefs = useRef(new Map<number, HTMLInputElement | null>());
  const foilRefs = useRef(new Map<number, HTMLInputElement | null>());

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  /** Picking a card — by Tab, Enter or click — always advances to Amount. */
  const pick = async (i: number, hit: Hit) => {
    const key = rows[i]?.key;
    const prints = await printsForCardAction(hit.id);
    update(i, { card: hit, prints, printId: prints[0]?.id ?? "" });
    if (key != null) setTimeout(() => qtyRefs.current.get(key)?.focus(), 0);
  };

  /** A voice hit fills the trailing blank row if there is one, else appends. */
  const addVoiceRow = (card: Hit, prints: Print[], quantity: number) => {
    setRows((rs) => {
      const row: Row = {
        key: nextKey++,
        card,
        prints,
        printId: prints[0]?.id ?? "",
        quantity: String(quantity),
        condition: defaults.condition,
        finish: defaults.finish,
        pricePaid: "",
      };
      const last = rs[rs.length - 1];
      return last && !last.card ? [...rs.slice(0, -1), row] : [...rs, row];
    });
  };

  const addRow = () => {
    setRows((rs) => [...rs, { ...blank(), condition: defaults.condition, finish: defaults.finish }]);
    setActive(rows.length);
  };

  const save = () =>
    start(async () => {
      const inputs: LotInput[] = rows
        .filter((r) => r.card && r.printId)
        .map((r) => ({ printId: r.printId, quantity: qtyOf(r), condition: r.condition, finish: r.finish, pricePaid: r.pricePaid || null, acquiredOn: defaults.acquiredOn || null, language: defaults.language }));
      const { added, deckAdded } = await addLots(inputs, deckId);
      setSaved({ added, deckAdded, deckId });
      setRows([blank()]);
      setActive(0);
    });

  const ready = rows.filter((r) => r.card && r.printId);
  const totalCards = ready.reduce((n, r) => n + qtyOf(r), 0);
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
          {pending ? "Saving…" : `Save ${totalCards} card${totalCards === 1 ? "" : "s"}`}
        </button>
      </div>

      <VoiceEntry onCard={addVoiceRow} />

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
              <th className="w-20 px-2 py-2">Amount</th>
              <th className="w-16 px-2 py-2">Foil</th>
              <th className="px-2 py-2 font-normal normal-case text-space-400">Print</th>
              <th className="w-20 px-2 py-2 font-normal normal-case text-space-400">Cond.</th>
              <th className="w-24 px-2 py-2 font-normal normal-case text-space-400">Paid €</th>
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
                  <input
                    ref={(el) => {
                      qtyRefs.current.set(r.key, el);
                    }}
                    value={r.quantity}
                    inputMode="numeric"
                    aria-label="Amount"
                    // Typed, not stepped: arrows stay free for the suggestion list
                    // and tabbing in selects the value so you can just type over it.
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => update(i, { quantity: e.target.value.replace(/\D/g, "").slice(0, 3) })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        foilRefs.current.get(r.key)?.focus();
                      }
                    }}
                    className={`${input} text-center tabular-nums`}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <label className="flex items-center gap-1.5 py-1 text-xs text-space-300">
                    <input
                      ref={(el) => {
                        foilRefs.current.set(r.key, el);
                      }}
                      type="checkbox"
                      checked={r.finish === "foil"}
                      onChange={(e) => update(i, { finish: e.target.checked ? "foil" : "normal" })}
                      onKeyDown={(e) => {
                        // Last stop in the row: Tab (or Enter) opens the next one.
                        if (e.key !== "Tab" && e.key !== "Enter") return;
                        if (e.key === "Tab" && e.shiftKey) return;
                        e.preventDefault();
                        if (i === rows.length - 1) addRow();
                        else qtyRefs.current.get(rows[i + 1].key)?.focus();
                      }}
                      className="h-4 w-4"
                    />
                    Foil
                  </label>
                </td>
                <td className="px-2 py-1.5">
                  <select tabIndex={-1} value={r.printId} onChange={(e) => update(i, { printId: e.target.value })} className={input} disabled={!r.card} aria-label="Print">
                    {r.prints.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <select tabIndex={-1} value={r.condition} onChange={(e) => update(i, { condition: e.target.value })} className={input} aria-label="Condition">
                    {CONDITIONS.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <input
                    tabIndex={-1}
                    value={r.pricePaid}
                    inputMode="decimal"
                    placeholder="1,50"
                    aria-label="Price paid"
                    onChange={(e) => update(i, { pricePaid: e.target.value })}
                    className={input}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <button
                    tabIndex={-1}
                    onClick={() => {
                      qtyRefs.current.delete(r.key);
                      foilRefs.current.delete(r.key);
                      setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : [blank()]));
                    }}
                    className="tap rounded px-2 text-space-400 hover:text-loss"
                    aria-label="Remove row"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={addRow} className="tap rounded-md border border-space-600 px-3 py-1.5 text-sm text-space-100 hover:bg-space-800">
          + Row
        </button>
        <p className="text-xs text-space-400">
          Keyboard: type a name or number, <Key>↑</Key>
          <Key>↓</Key> to choose, <Key>Tab</Key> takes it → <Key>Tab</Key> amount → <Key>Tab</Key> foil (<Key>space</Key> toggles) → <Key>Tab</Key> next row. Print, condition and price are click-only.
        </p>
      </div>
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return <kbd className="mx-px rounded border border-space-600 bg-space-900 px-1 font-sans text-[10px] text-space-200">{children}</kbd>;
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
        <button tabIndex={-1} onClick={onClear} className="tap rounded px-2 text-xs text-space-400 hover:text-space-50">
          change
        </button>
      </div>
    );
  }

  return <CardSearchInput autoFocus={autoFocus} onPick={onPick} />;
}
