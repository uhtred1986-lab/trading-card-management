"use client";

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { isZoomed, ZOOM_REST, zoomReducer, zoomTransform, type ZoomBox } from "@/lib/viewer-zoom";

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
 *
 * Zoom (`src/lib/viewer-zoom.ts`): double tap or double click toggles 2.2x on the card under the finger,
 * a pinch (or ctrl + wheel) zooms between 1x and 4x, a drag pans while zoomed, `+` `-` `0` zoom in, out
 * and back. Zoomed, the rail does not scroll (a swipe pans); Escape and the close button zoom out first.
 * From `lg` up `detailColumn` shows the detail as a fixed column on the right instead of a sheet.
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
  /** Bring the item with this id into view at once. An id the list does not hold yet is jumped to as soon as it does (add the item first, then call this). */
  jumpTo: (id: string) => void;
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
  /** From `lg` (1024 px) up, show the detail as a fixed right column instead of a sheet. Needs `renderDetail`. */
  detailColumn?: boolean;
}

const WIDE = "(min-width: 1024px)";
const subscribeWide = (cb: () => void) => {
  const mq = window.matchMedia?.(WIDE);
  mq?.addEventListener("change", cb);
  return () => mq?.removeEventListener("change", cb);
};
const isWide = () => typeof window !== "undefined" && !!window.matchMedia?.(WIDE).matches;

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

export function CardSwipeViewer<T extends SwipeItem>({ items, startIndex = 0, onClose, onActive, renderFooter, renderDetail, renderStatus, labels, detailColumn = false }: CardSwipeViewerProps<T>) {
  const t = { ...EN, ...labels };
  const count = items.length;
  const first = Math.min(Math.max(0, startIndex), Math.max(0, count - 1));
  const [active, setActive] = useState(first);
  const [detailOpen, setDetailOpen] = useState(false);
  const wide = useSyncExternalStore(subscribeWide, isWide, () => false);
  const column = detailColumn && wide && !!renderDetail;
  const [zoom, dispatchZoom] = useReducer(zoomReducer, ZOOM_REST);
  const zoomRef = useRef(zoom);
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
    zoomRef.current = zoom;
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

  // A new card is looked at from 1x (before the first paint, so no frame shows the old zoom on it).
  useLayoutEffect(() => {
    dispatchZoom({ type: "reset" });
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

  /** The size of the card in view at 1x (layout size, so the zoom itself does not count). */
  const zoomBox = useCallback((): ZoomBox => {
    const el = railRef.current?.querySelector<HTMLElement>(`.csv-slide[data-index="${activeRef.current}"] :is(img, .csv-noimg)`);
    return { w: el?.offsetWidth ?? 0, h: el?.offsetHeight ?? 0 };
  }, []);

  // Touch: a double tap toggles, two fingers pinch, one finger pans while zoomed. The listeners are added
  // by hand (not as React props) because they must be able to cancel the rail's own scroll.
  const touch = useRef({ mode: "none" as "none" | "pan" | "pinch", x: 0, y: 0, dist: 1, mx: 0, my: 0, sx: 0, sy: 0, moved: false, lastTap: 0, lastX: 0, lastY: 0, at: 0, pinched: false });
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const centre = () => {
      const r = rail.querySelector<HTMLElement>(`.csv-slide[data-index="${activeRef.current}"]`)?.getBoundingClientRect();
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: 0, y: 0 };
    };
    const pair = (e: TouchEvent) => {
      const a = e.touches[0];
      const b = e.touches[1];
      return { dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, mx: (a.clientX + b.clientX) / 2, my: (a.clientY + b.clientY) / 2 };
    };
    const t = touch.current;
    const start = (e: TouchEvent) => {
      t.at = Date.now();
      if (sheets.any()) return;
      if (e.touches.length >= 2) {
        e.preventDefault();
        const p = pair(e);
        Object.assign(t, { mode: "pinch", dist: p.dist, mx: p.mx, my: p.my, moved: true, pinched: true });
        return;
      }
      const f = e.touches[0];
      Object.assign(t, { x: f.clientX, y: f.clientY, sx: f.clientX, sy: f.clientY, moved: false, mode: "none", pinched: false });
      if (isZoomed(zoomRef.current)) {
        e.preventDefault();
        t.mode = "pan";
      }
    };
    const move = (e: TouchEvent) => {
      if (t.mode === "pinch" && e.touches.length >= 2) {
        e.preventDefault();
        const p = pair(e);
        const c = centre();
        dispatchZoom({ type: "gesture", factor: p.dist / t.dist, px: p.mx - c.x, py: p.my - c.y, dx: p.mx - t.mx, dy: p.my - t.my, box: zoomBox() });
        Object.assign(t, { dist: p.dist, mx: p.mx, my: p.my });
      } else if (t.mode === "pan" && e.touches.length === 1) {
        e.preventDefault();
        const f = e.touches[0];
        dispatchZoom({ type: "gesture", factor: 1, px: 0, py: 0, dx: f.clientX - t.x, dy: f.clientY - t.y, box: zoomBox() });
        if (Math.hypot(f.clientX - t.sx, f.clientY - t.sy) > 12) t.moved = true;
        t.x = f.clientX;
        t.y = f.clientY;
      } else if (e.touches.length === 1 && Math.hypot(e.touches[0].clientX - t.sx, e.touches[0].clientY - t.sy) > 12) t.moved = true;
    };
    const end = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        const wasPinch = t.mode === "pinch" || t.pinched;
        if (t.mode === "pinch") dispatchZoom({ type: "settle" });
        const f = e.changedTouches[0];
        if (!wasPinch && !t.moved && f && !sheets.any()) {
          const now = Date.now();
          if (t.lastTap && now - t.lastTap < 320 && Math.hypot(f.clientX - t.lastX, f.clientY - t.lastY) < 40) {
            e.preventDefault();
            const c = centre();
            dispatchZoom({ type: "toggle", px: f.clientX - c.x, py: f.clientY - c.y, box: zoomBox() });
            t.lastTap = 0;
          } else {
            t.lastTap = now;
            t.lastX = f.clientX;
            t.lastY = f.clientY;
          }
        } else t.lastTap = 0;
        t.mode = "none";
      } else if (e.touches.length === 1 && t.mode === "pinch") {
        // One finger is left of a pinch: it pans (when still zoomed), nothing more is a tap.
        t.x = e.touches[0].clientX;
        t.y = e.touches[0].clientY;
        t.mode = "pan";
        dispatchZoom({ type: "settle" });
      }
    };
    const cancel = () => {
      t.mode = "none";
      t.lastTap = 0;
    };
    // A pinch on a trackpad arrives as ctrl + wheel.
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey || sheets.any()) return;
      e.preventDefault();
      const c = centre();
      dispatchZoom({ type: "gesture", factor: Math.exp(-e.deltaY * 0.01), px: e.clientX - c.x, py: e.clientY - c.y, dx: 0, dy: 0, box: zoomBox() });
    };
    const opts = { passive: false } as const;
    rail.addEventListener("touchstart", start, opts);
    rail.addEventListener("touchmove", move, opts);
    rail.addEventListener("touchend", end, opts);
    rail.addEventListener("touchcancel", cancel);
    rail.addEventListener("wheel", wheel, opts);
    return () => {
      rail.removeEventListener("touchstart", start);
      rail.removeEventListener("touchmove", move);
      rail.removeEventListener("touchend", end);
      rail.removeEventListener("touchcancel", cancel);
      rail.removeEventListener("wheel", wheel);
    };
  }, [sheets, zoomBox, count]);

  // A mouse pans a zoomed card by dragging it.
  const drag = useRef<{ x: number; y: number } | null>(null);

  // `jumpTo` is a request the effect below carries out once the item is in `items` (an item added just
  // before the call is there one render later).
  const [jumpReq, setJumpReq] = useState<{ id: string } | null>(null);
  const jumpDone = useRef<{ id: string } | null>(null);
  const jumpTo = useCallback((id: string) => {
    setDetailOpen(false);
    setJumpReq({ id });
  }, []);
  useEffect(() => {
    const rail = railRef.current;
    if (!jumpReq || jumpDone.current === jumpReq || !rail) return;
    const i = items.findIndex((x) => x.id === jumpReq.id);
    if (i < 0) return;
    jumpDone.current = jumpReq;
    rail.scrollTo({ left: i * rail.clientWidth, behavior: "auto" });
  }, [jumpReq, items]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A sheet keeps its own focus and keys (`ViewerSheet`).
      if (sheets.any()) return;
      if (e.key === "Tab") return trapTab(e, rootRef.current);
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
      if (e.key === "Escape") {
        // Zoomed in: the first Escape zooms out.
        if (isZoomed(zoomRef.current)) dispatchZoom({ type: "reset" });
        else onCloseRef.current();
      } else if (plain && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        dispatchZoom({ type: "step", dir: 1, box: zoomBox() });
      } else if (plain && (e.key === "-" || e.key === "_")) {
        e.preventDefault();
        dispatchZoom({ type: "step", dir: -1, box: zoomBox() });
      } else if (plain && e.key === "0") {
        e.preventDefault();
        dispatchZoom({ type: "reset" });
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goTo(activeRef.current + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goTo(activeRef.current - 1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [goTo, sheets, zoomBox]);

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
  const ctx: SwipeSlotContext<T> = { item, index: active, count, close: onClose, jumpTo };
  const zoomed = isZoomed(zoom);
  const animate = zoom.jump && !reduceMotion();
  const zoomStyle: React.CSSProperties = { transform: zoomTransform(zoom), transition: animate ? "transform .18s ease-out" : "none", willChange: zoomed ? "transform" : undefined };
  const closeOrUnzoom = () => (isZoomed(zoomRef.current) ? dispatchZoom({ type: "reset" }) : onClose());

  const main = (
    <div className="csv-main">
      <div className="csv-stage">
        <button type="button" className="csv-arrow csv-prev" onClick={() => goTo(active - 1)} disabled={active === 0} aria-label={t.previous}>
          <span aria-hidden>‹</span>
        </button>
        <div
          ref={railRef}
          className="csv-rail"
          data-zoomed={zoomed ? 1 : undefined}
          style={{ touchAction: zoomed ? "none" : "pan-x", overflowX: zoomed ? "hidden" : undefined, cursor: zoomed ? "grab" : undefined }}
          onScroll={onScroll}
          onDoubleClick={(e) => {
            // A touch double tap is handled by the touch listeners; a browser may still send a dblclick after it.
            if (Date.now() - touch.current.at < 800) return;
            const r = (e.target as HTMLElement).closest<HTMLElement>(".csv-slide")?.getBoundingClientRect();
            if (!r) return;
            dispatchZoom({ type: "toggle", px: e.clientX - (r.left + r.width / 2), py: e.clientY - (r.top + r.height / 2), box: zoomBox() });
          }}
          onPointerDown={(e) => {
            pull.current = e.isPrimary ? { x: e.clientX, y: e.clientY } : null;
            if (e.pointerType === "mouse" && e.button === 0 && isZoomed(zoomRef.current)) {
              drag.current = { x: e.clientX, y: e.clientY };
              e.currentTarget.setPointerCapture?.(e.pointerId);
            }
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            dispatchZoom({ type: "gesture", factor: 1, px: 0, py: 0, dx: e.clientX - d.x, dy: e.clientY - d.y, box: zoomBox() });
            drag.current = { x: e.clientX, y: e.clientY };
          }}
          onPointerUp={(e) => {
            const s = pull.current;
            pull.current = null;
            drag.current = null;
            if (s && e.pointerType === "touch" && !isZoomed(zoomRef.current) && !touch.current.pinched && e.clientY - s.y > 140 && Math.abs(e.clientX - s.x) < 50) onClose();
          }}
          onPointerCancel={() => {
            pull.current = null;
            drag.current = null;
          }}
        >
          {items.map((it, i) => (
            <div key={it.id} className="csv-slide" aria-hidden={i !== active} data-index={i}>
              {Math.abs(i - active) <= 2 && i >= active - 1 ? (
                it.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.image} alt={it.alt ?? it.title} decoding="async" draggable={false} style={i === active ? zoomStyle : undefined} />
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
          {renderDetail && !column ? (
            <button type="button" className="csv-ibtn" onClick={() => setDetailOpen(true)} aria-label={t.detailsAria}>
              {t.details}
            </button>
          ) : null}
        </div>
        {item.side ? <div className="csv-info-side">{item.side}</div> : null}
      </div>

      {renderStatus ? renderStatus(ctx) : null}
      {renderFooter ? <div className="csv-foot">{renderFooter(ctx)}</div> : null}
    </div>
  );

  return (
    <Sheets.Provider value={sheets}>
      <div ref={rootRef} className="csv" data-column={column ? 1 : undefined} role="dialog" aria-modal="true" aria-label={t.cardOf(item.title, active + 1, count)} tabIndex={-1}>
        <div className="csv-bar">
          <button type="button" onClick={closeOrUnzoom} aria-label={t.close}>
            <span aria-hidden>✕</span>
          </button>
          <output aria-live="off">{t.position(active + 1, count)}</output>
        </div>

        {column && renderDetail ? (
          <div className="csv-body">
            {main}
            <aside className="csv-col" aria-label={t.detailsAria}>
              <h2>{item.title}</h2>
              {renderDetail(ctx)}
            </aside>
          </div>
        ) : (
          main
        )}

        {detailOpen && renderDetail && !column ? (
          <ViewerSheet title={item.title} onClose={() => setDetailOpen(false)} closeLabel={t.close}>
            {renderDetail(ctx)}
          </ViewerSheet>
        ) : null}
      </div>
    </Sheets.Provider>
  );
}
