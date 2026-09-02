"use client";

import { useState, useTransition } from "react";
import { explainCartAction, refreshWantsAction } from "@/app/cart/actions";
import type { CartExplanation } from "@/lib/ai/cart";
import type { Want } from "@/lib/marketplace/optimizer";

export function CartTools({ wants, aiEnabled, listingsCached, fetchedAt }: { wants: Want[]; aiEnabled: boolean; listingsCached: number; fetchedAt: string | null }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<CartExplanation | null>(null);

  const refresh = () =>
    start(async () => {
      setMsg(null);
      const r = await refreshWantsAction(wants);
      setMsg(r.ok ? `Fetched listings for ${r.cards} card${r.cards === 1 ? "" : "s"}.` : r.error);
    });
  const explain = () =>
    start(async () => {
      setMsg(null);
      const r = await explainCartAction(wants);
      if (r.ok) setExplanation(r.explanation);
      else setMsg(r.error);
    });

  const btn = "tap rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-50";
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={refresh} disabled={pending} className={`${btn} bg-ki-500 text-space-950 hover:bg-ki-400`}>
          {pending ? "…" : "Fetch live listings from CardTrader"}
        </button>
        <button onClick={explain} disabled={pending || !aiEnabled || listingsCached === 0} className={`${btn} border border-space-600 text-space-100 hover:bg-space-800`}>
          Explain with Claude
        </button>
        <span className="text-xs text-space-400">
          {listingsCached} cached listing{listingsCached === 1 ? "" : "s"}
          {fetchedAt ? ` · oldest fetched ${fetchedAt.replace("T", " ").slice(0, 16)}` : ""}
        </span>
      </div>
      {msg ? <p className="text-xs text-space-300">{msg}</p> : null}
      {explanation ? (
        <div className="rounded-lg border border-space-700 bg-space-950/60 p-2 text-sm">
          <p className="text-space-100">{explanation.recommendation}</p>
          {explanation.tradeoffs.length ? (
            <ul className="mt-1 list-inside list-disc text-xs text-space-300">
              {explanation.tradeoffs.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          ) : null}
          {explanation.warnings.length ? (
            <ul className="mt-1 list-inside list-disc text-xs text-loss">
              {explanation.warnings.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
