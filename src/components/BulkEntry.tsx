"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { addLots, printsForCardAction, type LotInput } from "@/app/collection/actions";
import { CONDITIONS } from "@/lib/collection/queries";
import type { DeckOption } from "@/lib/decks/add";
import { CardImage } from "./CardImage";
import { CardSearchInput, type CardHit as Hit } from "./CardSearchInput";
import { DeckPicker } from "./DeckPicker";
import { OwnerPicker } from "./OwnerPicker";
import { LocationPicker } from "./LocationPicker";
import type { StorageLocation } from "@/lib/collection/locations";
import { VoiceEntry } from "./VoiceEntry";

type Print = { id: string; label: string };

interface Row {
  key: number;
  card: Hit | null;
  prints: Print[];
  printId: string;
  /** Kept as text so a field can be empty mid-typing; parsed on save. */
  normal: string;
  foil: string;
  condition: string;
  pricePaid: string;
}

let nextKey = 1;
const blank = (): Row => ({ key: nextKey++, card: null, prints: [], printId: "", normal: "1", foil: "0", condition: "NM", pricePaid: "" });

/** Empty means none — unlike the quantity field, 0 is a normal value here. */
const countOf = (v: string) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(99, n) : 0;
};
const totalOf = (r: Row) => countOf(r.normal) + countOf(r.foil);

/**
 * Path B: keyboard-only table entry. One row per card, with separate non-foil
 * and foil counters — a row saying 3 and 1 stores four individual cards,
 * because the collection is one row per physical card.
 *
 * Three keystroke groups and never the mouse: type a few letters or a number →
 * ↑/↓ to pick a suggestion → **Tab** takes it and lands on Non-foil → **Tab**
 * to Foil → **Tab** opens a fresh row. Print, condition and price sit outside
 * that tab order (`tabIndex={-1}`); they default sensibly and stay clickable.
 */
export function BulkEntry({ decks, owner, owners, locations }: { decks: DeckOption[]; owner: string | null; owners: string[]; locations: StorageLocation[] }) {
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [active, setActive] = useState(0);
  const [saved, setSaved] = useState<{ added: number; deckAdded: number; deckId: number | null } | null>(null);
  const [deckId, setDeckId] = useState<number | null>(null);
  const [asOwner, setAsOwner] = useState<string | null>(owner);
  /** One place for the whole batch — a box being entered goes back in that box. */
  const [locationId, setLocationId] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const [defaults, setDefaults] = useState({ condition: "NM", acquiredOn: "", language: "EN" });

  // Keyed by row key so a removed row can't leave focus pointing at the wrong input.
  const normalRefs = useRef(new Map<number, HTMLInputElement | null>());
  const foilRefs = useRef(new Map<number, HTMLInputElement | null>());
  const rowRefs = useRef(new Map<number, HTMLTableRowElement | null>());
  /** The row last touched — dictating hands-free, you want it on screen. */
  const [latest, setLatest] = useState<number | null>(null);

  useEffect(() => {
    if (latest == null) return;
    rowRefs.current.get(latest)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [latest, rows]);

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  /** Picking a card — by Tab, Enter or click — always advances to the counters. */
  const pick = async (i: number, hit: Hit) => {
    const key = rows[i]?.key;
    const prints = await printsForCardAction(hit.id);
    update(i, { card: hit, prints, printId: prints[0]?.id ?? "" });
    if (key != null) setTimeout(() => normalRefs.current.get(key)?.focus(), 0);
  };

  /** Voice keeps one row per card: a second mention of the same card adds to its counters. */
  const addVoiceRow = (card: Hit, prints: Print[], counts: { foil: number; normal: number }) => {
    // The key is settled out here so the row can be scrolled to straight after.
    const key = rows.find((r) => r.card?.id === card.id)?.key ?? nextKey++;
    setRows((rs) => {
      const at = rs.findIndex((r) => r.key === key);
      if (at >= 0) {
        const r = rs[at];
        const merged = { ...r, normal: String(countOf(r.normal) + counts.normal), foil: String(countOf(r.foil) + counts.foil) };
        return rs.map((x, j) => (j === at ? merged : x));
      }
      const row: Row = {
        key,
        card,
        prints,
        printId: prints[0]?.id ?? "",
        normal: String(counts.normal),
        foil: String(counts.foil),
        condition: defaults.condition,
        pricePaid: "",
      };
      const last = rs[rs.length - 1];
      return last && !last.card ? [...rs.slice(0, -1), row] : [...rs, row];
    });
    setLatest(key);
  };

  const addRow = () => {
    const row = { ...blank(), condition: defaults.condition };
    setRows((rs) => [...rs, row]);
    setActive(rows.length);
    setLatest(row.key);
  };

  /** Step a counter without touching the keyboard flow. */
  const step = (i: number, field: "normal" | "foil", by: number) => {
    const r = rows[i];
    update(i, { [field]: String(Math.max(0, Math.min(99, countOf(r[field]) + by))) });
    setLatest(r.key);
  };

  const save = () =>
    start(async () => {
      // One LotInput per finish; addLots then writes one row per physical card.
      const inputs: LotInput[] = [];
      for (const r of rows) {
        if (!r.card || !r.printId) continue;
        const common = { printId: r.printId, condition: r.condition, pricePaid: r.pricePaid || null, acquiredOn: defaults.acquiredOn || null, language: defaults.language, owner: asOwner, locationId };
        const n = countOf(r.normal);
        const f = countOf(r.foil);
        if (n > 0) inputs.push({ ...common, quantity: n, finish: "normal" });
        if (f > 0) inputs.push({ ...common, quantity: f, finish: "foil" });
      }
      const { added, deckAdded } = await addLots(inputs, deckId);
      setSaved({ added, deckAdded, deckId });
      setRows([blank()]);
      setActive(0);
    });

  const ready = rows.filter((r) => r.card && r.printId && totalOf(r) > 0);
  const totalCards = ready.reduce((n, r) => n + totalOf(r), 0);
  const input = "tap w-full rounded-md border border-space-600 bg-space-900 px-2 py-1 text-sm text-space-100";
  // Not `input`: inside the stepper the field has to flex between the two
  // buttons, and `w-full` there squeezes the digits out of sight.
  const counter = "tap w-10 min-w-0 flex-1 rounded-md border border-space-600 bg-space-900 px-1 py-1 text-center text-sm tabular-nums text-space-100";

  return (
    <div className="space-y-3">
      <VoiceEntry onCard={addVoiceRow} />

      <div className="grid gap-2 sm:grid-cols-2">
        <OwnerPicker owners={owners} value={asOwner} onChange={setAsOwner} label="These cards belong to" />
        <DeckPicker decks={decks} value={deckId} onChange={(id) => setDeckId(id)} />
        <LocationPicker locations={locations} value={locationId} onChange={setLocationId} />
      </div>

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
              <th className="w-32 px-2 py-2">Non-foil</th>
              <th className="w-32 px-2 py-2 text-amber-300">✦ Foil</th>
              <th className="px-2 py-2 font-normal normal-case text-space-400">Print</th>
              <th className="w-20 px-2 py-2 font-normal normal-case text-space-400">Cond.</th>
              <th className="w-24 px-2 py-2 font-normal normal-case text-space-400">Paid €</th>
              <th className="w-10 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.key}
                ref={(el) => {
                  rowRefs.current.set(r.key, el);
                }}
                className={`border-t border-space-800 align-top transition-colors ${latest === r.key ? "bg-ki-500/5" : ""}`}
              >
                <td className="min-w-[16rem] px-2 py-1.5">
                  <CardPicker row={r} autoFocus={i === active} onPick={(hit) => pick(i, hit)} onClear={() => update(i, { card: null, prints: [], printId: "" })} />
                  {r.card && totalOf(r) > 1 ? (
                    <div className="mt-0.5 text-[10px] text-space-400">saves as {totalOf(r)} separate cards</div>
                  ) : null}
                </td>
                <td className="px-2 py-1.5">
                  <Stepper
                    value={r.normal}
                    onStep={(by) => step(i, "normal", by)}
                    inputProps={{
                      ref: (el: HTMLInputElement | null) => {
                        normalRefs.current.set(r.key, el);
                      },
                      "aria-label": "Non-foil copies",
                      onChange: (e) => update(i, { normal: e.target.value.replace(/\D/g, "").slice(0, 2) }),
                      onKeyDown: (e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          foilRefs.current.get(r.key)?.focus();
                        }
                      },
                      className: counter,
                    }}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <Stepper
                    value={r.foil}
                    tone="foil"
                    onStep={(by) => step(i, "foil", by)}
                    inputProps={{
                      ref: (el: HTMLInputElement | null) => {
                        foilRefs.current.set(r.key, el);
                      },
                      "aria-label": "Foil copies",
                      onChange: (e) => update(i, { foil: e.target.value.replace(/\D/g, "").slice(0, 2) }),
                      onKeyDown: (e) => {
                        // Last stop in the row: Tab (or Enter) opens the next one.
                        if (e.key !== "Tab" && e.key !== "Enter") return;
                        if (e.key === "Tab" && e.shiftKey) return;
                        e.preventDefault();
                        if (i === rows.length - 1) addRow();
                        else normalRefs.current.get(rows[i + 1].key)?.focus();
                      },
                      className: `${counter} ${countOf(r.foil) > 0 ? "border-amber-400/60 text-amber-300" : ""}`,
                    }}
                  />
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
                  <input tabIndex={-1} value={r.pricePaid} inputMode="decimal" placeholder="1,50" aria-label="Price paid" onChange={(e) => update(i, { pricePaid: e.target.value })} className={input} />
                </td>
                <td className="px-2 py-1.5">
                  <button
                    tabIndex={-1}
                    onClick={() => {
                      normalRefs.current.delete(r.key);
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
          <Key>↓</Key> to choose, <Key>Tab</Key> takes it → <Key>Tab</Key> non-foil → <Key>Tab</Key> foil → <Key>Tab</Key> next row. Each copy is stored separately, so 3 non-foil + 1 foil saves as four cards.
        </p>
      </div>
    </div>
  );
}

/**
 * A counter you can type into or tap. The − and + are out of the tab order so
 * the keyboard path (card → non-foil → foil → next row) is unchanged.
 */
function Stepper({
  value,
  onStep,
  inputProps,
  tone,
}: {
  value: string;
  onStep: (by: number) => void;
  inputProps: React.InputHTMLAttributes<HTMLInputElement> & { ref: (el: HTMLInputElement | null) => void };
  tone?: "foil";
}) {
  const n = parseInt(value, 10) || 0;
  const button = `h-7 w-6 shrink-0 rounded-md border border-space-600 text-sm leading-none ${
    tone === "foil" ? "text-amber-300 hover:bg-amber-400/10" : "text-space-200 hover:bg-space-800"
  } disabled:opacity-30`;
  return (
    <div className="flex items-center gap-1">
      <button type="button" tabIndex={-1} onClick={() => onStep(-1)} disabled={n <= 0} className={button} aria-label="One fewer">
        −
      </button>
      <input {...inputProps} value={value} inputMode="numeric" onFocus={(e) => e.currentTarget.select()} />
      <button type="button" tabIndex={-1} onClick={() => onStep(1)} disabled={n >= 99} className={button} aria-label="One more">
        +
      </button>
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
