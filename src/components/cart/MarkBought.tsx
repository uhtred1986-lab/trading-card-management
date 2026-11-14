"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { markBoughtAction } from "@/app/cart/actions";
import type { ListingFilter } from "@/lib/marketplace/cart";

export interface MarkBoughtPrint {
  id: string;
  label: string;
}

/**
 * "Mark as bought" on one wished card (SL only, in the cart's "Wishes of …" view): how many copies,
 * what each cost in euros, and for a Pokémon card which variant and language. Left on "cheapest
 * listed" / "filter language" the server picks the defaults. The copies go to the wishing player.
 */
export function MarkBought({ owner, playerName, cardId, name, quantity, prints, filter }: { owner: string; playerName: string; cardId: string; name: string; quantity: number; prints: MarkBoughtPrint[]; filter: ListingFilter }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(String(quantity));
  const [price, setPrice] = useState("");
  const [printId, setPrintId] = useState("");
  const [language, setLanguage] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const field = "tap w-full rounded-md border border-space-600 bg-space-900 px-2 py-1 text-sm text-space-100";
  const submit = () =>
    start(async () => {
      setMsg(null);
      const r = await markBoughtAction({ owner, cardId, quantity: Number(qty), priceEur: price, printId: printId || null, language: language || null, filter });
      if (r.ok) {
        setMsg(`${r.bought}× moved to ${playerName}'s collection (${r.language}).`);
        setOpen(false);
        router.refresh();
      } else setMsg(r.error);
    });

  return (
    <div className="mt-1">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="tap rounded-md border border-space-600 px-2 py-1 text-xs text-space-100 hover:bg-space-700">
          Mark as bought
        </button>
      ) : (
        <div className="grid gap-2 rounded-lg border border-space-700 bg-space-950/60 p-2 sm:grid-cols-2">
          <label className="text-xs text-space-300">
            Copies
            <input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} className={field} />
          </label>
          <label className="text-xs text-space-300">
            Price paid per copy (€)
            <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="4.50" className={field} />
          </label>
          {prints.length > 1 ? (
            <label className="text-xs text-space-300">
              Variant
              <select value={printId} onChange={(e) => setPrintId(e.target.value)} className={field}>
                <option value="">Cheapest listed</option>
                {prints.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {prints.length > 0 ? (
            <label className="text-xs text-space-300">
              Language
              <select value={language} onChange={(e) => setLanguage(e.target.value)} className={field}>
                <option value="">{filter.language === "any" ? "From the cheapest listing" : `Filter (${filter.language.toUpperCase()})`}</option>
                <option value="DE">DE</option>
                <option value="EN">EN</option>
              </select>
            </label>
          ) : null}
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" onClick={submit} disabled={pending} className="tap rounded-md bg-ki-500 px-3 py-1.5 text-sm font-semibold text-space-950 hover:bg-ki-400 disabled:opacity-50">
              {pending ? "Saving…" : `Move to ${playerName}'s collection`}
            </button>
            <button type="button" onClick={() => setOpen(false)} disabled={pending} className="tap rounded-md border border-space-600 px-3 py-1.5 text-sm text-space-100 hover:bg-space-800">
              Cancel
            </button>
          </div>
        </div>
      )}
      {msg ? (
        <p className="mt-1 text-xs text-space-300" aria-label={`Result for ${name}`}>
          {msg}
        </p>
      ) : null}
    </div>
  );
}
