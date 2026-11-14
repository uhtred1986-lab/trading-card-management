"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { togglePokemonWishAction } from "@/app/pokemon/actions";
import { PK } from "@/lib/pokemon/copy";
import type { PokemonTile } from "@/lib/pokemon/client";

/**
 * The hearts of one screen: the set of wished card ids, a toggle that flips the heart at once and
 * puts it back when the action fails (and says so), and a short-lived notice for a live region.
 */
export function useWishes(initial: Iterable<string>) {
  const [wished, setWished] = useState<Set<string>>(() => new Set(initial));
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const say = useCallback((text: string) => {
    setNotice(text);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNotice(null), 3500);
  }, []);
  useEffect(() => () => void (timer.current && window.clearTimeout(timer.current)), []);

  /** Add the ids a new page of results says are wished (never removes: a toggle in flight stays). */
  const merge = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setWished((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  const toggle = useCallback(
    async (tile: Pick<PokemonTile, "id" | "tcgdexId">) => {
      let was = false;
      setWished((prev) => {
        was = prev.has(tile.id);
        const next = new Set(prev);
        if (was) next.delete(tile.id);
        else next.add(tile.id);
        return next;
      });
      try {
        const r = await togglePokemonWishAction(tile.tcgdexId);
        // The server is the truth: line the heart up with what it says.
        setWished((prev) => {
          if (prev.has(tile.id) === r.wished) return prev;
          const next = new Set(prev);
          if (r.wished) next.add(tile.id);
          else next.delete(tile.id);
          return next;
        });
      } catch {
        setWished((prev) => {
          const next = new Set(prev);
          if (was) next.add(tile.id);
          else next.delete(tile.id);
          return next;
        });
        say(typeof navigator !== "undefined" && navigator.onLine === false ? PK.common.offline : PK.common.error);
      }
    },
    [say],
  );

  return { wished, toggle, merge, notice, say };
}
