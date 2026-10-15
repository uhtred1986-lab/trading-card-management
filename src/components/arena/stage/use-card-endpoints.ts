"use client";

import { useEffect, useState, type RefObject } from "react";

type Box = { x: number; y: number; w: number; h: number };
type Endpoints = { from: Box; to: Box };

/** Both beams follow the rendered cards, including Motion transforms and
 * staging replacements. ResizeObserver alone cannot see a transform or a
 * sibling moving a card without changing its size. Only runs while mounted. */
export function useCardEndpoints(from: string, to: string, hostRef: RefObject<HTMLDivElement | null>) {
  const [points, setPoints] = useState<Endpoints | null>(null);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      const host = hostRef.current;
      const find = (id: string) => [...(host?.querySelectorAll<HTMLElement>(`[data-arena-card="${CSS.escape(id)}"]`) ?? [])]
        .find((el) => el.getClientRects().length && el.getBoundingClientRect().width > 0);
      const a = find(from), b = find(to);
      let next: Endpoints | null = null;
      if (host && a && b) {
        const h = host.getBoundingClientRect();
        const box = (el: HTMLElement): Box => {
          const r = el.getBoundingClientRect();
          return { x: r.left - h.left, y: r.top - h.top, w: r.width, h: r.height };
        };
        next = { from: box(a), to: box(b) };
      }
      setPoints((prev) => JSON.stringify(prev) === JSON.stringify(next) ? prev : next);
      frame = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(frame);
  }, [from, to, hostRef]);
  return points;
}
