"use client";

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

/**
 * The full-screen card viewer: one card at a time, swipe sideways to look through a list
 * (docs/pokemon/design.md §3). Generic on purpose: it knows nothing about a game. A screen gives it
 * a list of items and fills the slots (`renderFooter` for the verbs under the card, `renderDetail`
 * for the detail sheet, `renderStatus` for a line over the footer); the Pokémon screens fill them
 * with Hab ich / Wunsch / Ins Deck, and the Dragon Ball screens can fill them later.
 *
 * Built on CSS scroll snapping, no library, so it keeps the phone's own momentum. The image of the
 * card in view and of the next two (and the one before) are loaded, the rest wait. Swipe or arrow
 * keys move, the close button, Escape and a pull down close it; focus moves into it, stays in it
 * and goes back to what opened it. Nothing here loops, and motion is off under reduced motion.
 */

export interface SwipeItem {
  /** Stable id, the key of the slide. */
  id: string;
  /** Picture URL, or null for the placeholder with the title. */
  image: string | null;
  /** Alt text; the title when missing. */
  alt?: string;
  title: string;
  /** Small lines under the title (set and number, type and HP ...). */
  subtitle?: string[];
  /** Top-right of the info row, e.g. a price. */
  side?: React.ReactNode;
}

export interface SwipeSlotContext<T extends SwipeItem> {
  item: T;
  index: number;
  count: number;
  close: () => void;
}

export interface ViewerLabels {
  close: string;
  position: (index: number, count: number) => string;
  previous: string;
  next: string;
  details: string;
  detailsAria: string;
  cardOf: (title: string, index: number, count: number) => string;
  noImage: string;
}

const EN: ViewerLabels = {
  close: "Close viewer",
  position: (i, n) => `${i} / ${n}`,
  previous: "Previous card",
  next: "Next card",
  details: "Details",
  detailsAria: "Card details",
  cardOf: (t, i, n) => `${t}, card ${i} of ${n}`,
  noImage: "No picture",
};

export interface CardSwipeViewerProps<T extends SwipeItem = SwipeItem> {
  items: T[];
  /** Index shown first (default 0). Read once, on open. */
  startIndex?: number;
  onClose: () => void;
  /** Called when a card comes into view (and once for the first), e.g. to load its details. */
  onActive?: (item: T, index: number) => void;
  /** The verbs under the card. Rendered for the card in view; may render sheets with `ViewerSheet`. */
  renderFooter?: (ctx: SwipeSlotContext<T>) => React.ReactNode;
  /** The content of the detail sheet. When given, the info row shows a Details button. */
  renderDetail?: (ctx: SwipeSlotContext<T>) => React.ReactNode;
  /** A short message line over the footer (a saved or failed note). */
  renderStatus?: (ctx: SwipeSlotContext<T>) => React.ReactNode;
  labels?: Partial<ViewerLabels>;
}

/** Which sheets are open, so Escape and the arrow keys leave the viewer alone while one is. */
interface SheetRegistry {
  enter: () => () => void;
  any: () => boolean;
}
const Sheets = createContext<SheetRegistry | null>(null);

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function trapTab(e: KeyboardEvent, root: HTMLElement | null) {
  if (e.key !== "Tab" || !root) return;
  const nodes = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
  if (nodes.length === 0) {
    e.preventDefault();
    root.focus();
    return;
  }
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const active = document.activeElement as HTMLElement | null;
  if (e.shiftKey && (active === first || !root.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !root.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

const reduceMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * A bottom sheet inside the viewer. Escape and a tap on the dimmed area close it; focus moves in,
 * stays in and goes back to what opened it.
 */
export function ViewerSheet({ title, onClose, closeLabel = "Close", children }: { title: string; onClose: () => void; closeLabel?: string; children: React.ReactNode }) {
  const registry = useContext(Sheets);
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const leave = registry?.enter();
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Capture phase on the document: runs before the viewer's own Escape handler and stops it.
        e.stopImmediatePropagation();
        e.preventDefault();
        onCloseRef.current();
      } else trapTab(e, ref.current);
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      leave?.();
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [registry]);

  return (
    <div
      className="csv-scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={ref} className="csv-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <h2 id={titleId}>
          <span>{title}</span>
          <button type="button" onClick={onClose} aria-label={closeLabel}>
            <span aria-hidden>✕</span>
          </button>
        </h2>
        {children}
      </div>
    </div>
  );
}

export function CardSwipeViewer<T extends SwipeItem>({ items, startIndex = 0, onClose, onActive, renderFooter, renderDetail, renderStatus, labels }: CardSwipeViewerProps<T>) {
  const t = { ...EN, ...labels };
  const count = items.length;
  const first = Math.min(Math.max(0, startIndex), Math.max(0, count - 1));
  const [active, setActive] = useState(first);
  const [detailOpen, setDetailOpen] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [sheets] = useState<SheetRegistry>(() => {
    const state = { open: 0 };
    return {
      enter: () => {
        state.open += 1;
        return () => {
          state.open -= 1;
        };
      },
      any: () => state.open > 0,
    };
  });
  const activeRef = useRef(first);
  const frame = useRef(0);
  const onCloseRef = useRef(onClose);
  const onActiveRef = useRef(onActive);
  const itemsRef = useRef(items);
  // The latest props for the listeners below, which are set up once.
  useEffect(() => {
    onCloseRef.current = onClose;
    onActiveRef.current = onActive;
    itemsRef.current = items;
  });

  // The first card is in view before the first paint.
  useLayoutEffect(() => {
    const rail = railRef.current;
    if (rail) rail.scrollLeft = first * rail.clientWidth;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Say which card is in view (for loading its details), once on open and on every change.
  useEffect(() => {
    const item = itemsRef.current[active];
    if (item) onActiveRef.current?.(item, active);
  }, [active]);

  // Focus in, keep it in, give it back; no scrolling behind the viewer.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    rootRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  const goTo = useCallback((i: number) => {
    const rail = railRef.current;
    if (!rail) return;
    const target = Math.min(Math.max(0, i), itemsRef.current.length - 1);
    rail.scrollTo({ left: target * rail.clientWidth, behavior: reduceMotion() ? "auto" : "smooth" });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A sheet keeps its own focus and keys (`ViewerSheet`).
      if (sheets.any()) return;
      if (e.key === "Tab") return trapTab(e, rootRef.current);
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.key === "Escape") onCloseRef.current();
      else if (e.key === "ArrowRight") {
        e.preventDefault();
        goTo(activeRef.current + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goTo(activeRef.current - 1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [goTo, sheets]);

  // A turned phone or a resized window keeps the same card in view.
  useEffect(() => {
    const onResize = () => {
      const rail = railRef.current;
      if (rail) rail.scrollLeft = activeRef.current * rail.clientWidth;
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const onScroll = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const rail = railRef.current;
      if (!rail || rail.clientWidth === 0) return;
      const i = Math.min(Math.max(0, Math.round(rail.scrollLeft / rail.clientWidth)), itemsRef.current.length - 1);
      if (i !== activeRef.current) {
        activeRef.current = i;
        setActive(i);
      }
    });
  };

  // A pull down on the picture closes (vertical moves are ours: the rail only pans sideways).
  const pull = useRef<{ x: number; y: number } | null>(null);

  if (count === 0) return null;
  const item = items[active] ?? items[0];
  const ctx: SwipeSlotContext<T> = { item, index: active, count, close: onClose };

  return (
    <Sheets.Provider value={sheets}>
      <div ref={rootRef} className="csv" role="dialog" aria-modal="true" aria-label={t.cardOf(item.title, active + 1, count)} tabIndex={-1}>
        <div className="csv-bar">
          <button type="button" onClick={onClose} aria-label={t.close}>
            <span aria-hidden>✕</span>
          </button>
          <output aria-live="off">{t.position(active + 1, count)}</output>
        </div>

        <div className="csv-stage">
          <button type="button" className="csv-arrow csv-prev" onClick={() => goTo(active - 1)} disabled={active === 0} aria-label={t.previous}>
            <span aria-hidden>‹</span>
          </button>
          <div
            ref={railRef}
            className="csv-rail"
            style={{ touchAction: "pan-x" }}
            onScroll={onScroll}
            onPointerDown={(e) => {
              pull.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerUp={(e) => {
              const s = pull.current;
              pull.current = null;
              if (s && e.pointerType === "touch" && e.clientY - s.y > 140 && Math.abs(e.clientX - s.x) < 50) onClose();
            }}
            onPointerCancel={() => {
              pull.current = null;
            }}
          >
            {items.map((it, i) => (
              <div key={it.id} className="csv-slide" aria-hidden={i !== active} data-index={i}>
                {Math.abs(i - active) <= 2 && i >= active - 1 ? (
                  it.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.image} alt={it.alt ?? it.title} decoding="async" draggable={false} />
                  ) : (
                    <div className="csv-noimg">{it.title}</div>
                  )
                ) : null}
              </div>
            ))}
          </div>
          <button type="button" className="csv-arrow csv-next" onClick={() => goTo(active + 1)} disabled={active === count - 1} aria-label={t.next}>
            <span aria-hidden>›</span>
          </button>
        </div>

        <div className="csv-info">
          <div className="min-w-0">
            <b>{item.title}</b>
            {(item.subtitle ?? []).map((line, i) => (
              <small key={i}>{line}</small>
            ))}
            {renderDetail ? (
              <button type="button" className="csv-ibtn" onClick={() => setDetailOpen(true)} aria-label={t.detailsAria}>
                {t.details}
              </button>
            ) : null}
          </div>
          {item.side ? <div className="csv-info-side">{item.side}</div> : null}
        </div>

        {renderStatus ? renderStatus(ctx) : null}
        {renderFooter ? <div className="csv-foot">{renderFooter(ctx)}</div> : null}

        {detailOpen && renderDetail ? (
          <ViewerSheet title={item.title} onClose={() => setDetailOpen(false)} closeLabel={t.close}>
            {renderDetail(ctx)}
          </ViewerSheet>
        ) : null}
      </div>
    </Sheets.Provider>
  );
}
