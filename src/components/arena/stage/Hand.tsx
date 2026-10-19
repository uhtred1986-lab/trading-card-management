"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CardView } from "@/lib/arena/view";
import { preloadCardArt } from "../ArenaCard";
import { ZoneAnchor } from "./anchors";
import { HandPeek } from "./HandPeek";
import { StageCard } from "./StageCard";
import styles from "./phone-board.module.css";
import handStyles from "./Hand.module.css";

/** A hand card at phone scale (`--arena` multiplies it from `sm` up): the redesign's 84 × 117. */
export const HAND_W = 84;

/** A horizontal hand: crowded cards keep a 44px exposed target and can scroll. */
export function Hand({
  cards,
  cardProps,
  dragId = null,
  dragFor,
  chargeable,
  decisionHint,
  onZones,
  handStatus,
  handAction,
  onHandAction,
  defending = false,
  browseEnabled = true,
  onPeek,
  sendingId = null,
}: {
  cards: CardView[];
  cardProps: (c: CardView) => React.ComponentProps<typeof StageCard>;
  /** The card being dragged out of the hand (rd-03): it fades where it sits. */
  dragId?: string | null;
  /** The pointer handlers that make one card draggable, or null when it is not. */
  dragFor?: (id: string) => React.HTMLAttributes<HTMLDivElement> | null;
  /** In the Charge phase: this card can be charged, so it wears the dashed outline (rd-04). */
  chargeable?: (id: string) => boolean;
  /** Current engine hand decision, placed beside its existing inspection control. */
  decisionHint?: string;
  onZones?: () => void;
  handStatus?: (id: string) => "playable" | "targets" | "noTarget" | "skill" | "unaffordable" | "counter" | "charge" | null;
  handAction?: (id: string) => string | null;
  /** The chip (and, in the fan, the dot) does what it says: play, charge, combo, or open the card when it needs a closer look. */
  onHandAction?: (id: string) => void;
  defending?: boolean;
  browseEnabled?: boolean;
  /** The card whose preview is open (null when none), so the board can offer its action — a charge — for it. */
  onPeek?: (id: string | null) => void;
  /** A card just tapped and on its way to the fight (a combo): it lifts toward it at once. */
  sendingId?: string | null;
}) {
  // Measure the hand and card at the current board scale for overlap spacing.
  const fan = useRef<HTMLDivElement | null>(null);
  const [room, setRoom] = useState<{ width: number; card: number; desktop: boolean } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const n = cards.length;
  // Fetch and decode the hand's art ahead of drawing it, so a re-render never shows empty boxes.
  useEffect(() => { preloadCardArt(cards, defending ? 66 : HAND_W); }, [cards, defending]);
  const cardWidth = defending ? 66 : HAND_W;
  const wide = room?.desktop ?? false;
  const fanMode = !wide && n > 6;
  useLayoutEffect(() => {
    const el = fan.current;
    if (!el) return;
    const measure = () => {
      const scale = parseFloat(getComputedStyle(el).getPropertyValue("--arena")) || 1;
      // Less the side padding (px-2.5): the fan lays out inside it.
      const next = { width: el.clientWidth - 20, card: cardWidth * scale, desktop: window.matchMedia("(min-width: 1024px)").matches };
      setRoom((current) => current?.width === next.width && current.card === next.card && current.desktop === next.desktop ? current : next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [cardWidth]);

  const [peek, setPeek] = useState<{ id: string; top: number; skin: string; offset: number } | null>(null);
  const pointer = useRef<number | null>(null);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const suppressedClick = useRef(0);
  const browsing = browseEnabled;
  const visiblePeek = browsing ? cards.find(c => c.id === peek?.id) : null;
  const peekedId = visiblePeek?.id ?? null;
  useEffect(() => {
    onPeek?.(peekedId);
    return () => onPeek?.(null);
  }, [peekedId, onPeek]);
  const showPeek = (id: string, x?: number) => {
    const el = fan.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPeek({ id, top: rect.top, skin: el.closest("[data-skin]")?.getAttribute("data-skin") ?? "anime", offset: x == null ? 0 : Math.max(-12, Math.min(12, (x - rect.left - rect.width / 2) * .06)) });
  };
  const scrub = (x: number) => {
    const el = fan.current;
    if (!el) return;
    const candidates = [...el.querySelectorAll<HTMLElement>("[data-hand-browse-card]")];
    // Later cards overlap earlier ones, so the rightmost exposed face wins.
    const hit = candidates.filter(node => { const r = node.getBoundingClientRect(); return x >= r.left && x <= r.right; }).at(-1);
    if (hit) showPeek(hit.dataset.handBrowseCard!, x);
  };
  useEffect(() => {
    if (!visiblePeek) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setPeek(null); };
    window.addEventListener("keydown", key);
    let frame = 0;
    const tick = () => {
      const el = fan.current, point = lastPoint.current;
      if (pointer.current != null && el && point) {
        const r = el.getBoundingClientRect();
        const step = point.x < r.left + 28 ? -5 : point.x > r.right - 28 ? 5 : 0;
        if (step) { el.scrollLeft += step; scrub(point.x); }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("keydown", key); };
  });

  const first = cards[0];
  const firstProps = first ? cardProps(first) : null;
  const card = room?.card ?? cardWidth;
  // Every exposed card has a full finger target; excess cards scroll instead
  // of becoming ever narrower slivers. Expand separates all the artwork.
  // Leave room for the card's rounded corners around a 44px touch square.
  const step = fanMode && room ? Math.max(22, Math.min(card, (room.width - card - 64) / (n - 1))) : expanded ? card + 8 : n > 1 && room ? Math.max(wide ? 44 : 52, Math.min(card + 8, (room.width - card) / (n - 1))) : card + 8;
  const middle = (n - 1) / 2;
  const charging = cards.some((c) => chargeable?.(c.id));

  return (
    <section className="arena-field arena-hand relative" aria-label="Your hand" data-hand-expanded={expanded}>
      <ZoneAnchor zone="p1:hand" />
      {/* Below lg the toolbar is only the decision's hint (#783): a hand card that cannot act opens its
          review on a tap, and the public zones are in the board's menu, so a phone keeps the row for
          the cards themselves. */}
      {(firstProps?.onInspect || onZones) && (
        <div data-hand-toolbar className={`flex-wrap items-center justify-end gap-2 px-3 ${decisionHint ? "flex" : "hidden lg:flex"}`}>
          <span className="mr-auto hidden text-xs font-semibold text-space-100 lg:inline">Hand · {n}<span className="ml-2 font-normal">Click a card to review it · drag to play</span></span>
          {decisionHint && <span className="min-w-0 flex-1 text-xs font-semibold leading-snug text-space-100">{decisionHint}</span>}
          {firstProps?.onInspect && <button
            type="button"
            onClick={firstProps.onInspect}
            aria-label={`Inspect your hand, starting with ${first?.hidden ? "face-down card" : first?.name ?? "first card"}`}
            className="tap hidden min-h-[44px] items-center gap-2 rounded-lg border border-space-600 bg-space-900/90 px-3 text-xs font-semibold text-space-100 lg:inline-flex hover:border-ki-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ki-400"
          >
            <span aria-hidden="true">⌕</span>
            <span>Inspect hand</span>
          </button>}
          {n > 0 && <button type="button" className={`${styles.handControl} tap hidden rounded-lg border border-space-600 px-2 text-xs font-semibold text-space-100 lg:block`} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Compact" : "Expand"}</button>}
          {onZones && <button type="button" className={`${styles.handControl} tap hidden rounded-lg border border-space-600 px-2 text-xs font-semibold text-space-100 lg:block`} onClick={onZones} aria-label="Inspect public zones">Zones</button>}
        </div>
      )}
      {fanMode && <p className={styles.handFanHeader}>Your hand · {n} · {cards.filter((c) => ["playable", "targets", "noTarget"].includes(handStatus?.(c.id) ?? "")).length} playable · tap a card to browse</p>}
      <div className={`${fanMode ? styles.handRow : ""}`} data-hand-fan={fanMode ? "" : undefined}>
      <div ref={fan}
        onKeyDown={e => {
          if (!wide || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
          const current = (e.target as HTMLElement).closest<HTMLElement>("[data-hand-browse-card]");
          if (!current) return;
          const index = cards.findIndex(c => c.id === current.dataset.handBrowseCard);
          const next = cards[index + (e.key === "ArrowRight" ? 1 : -1)];
          if (!next) return;
          e.preventDefault();
          e.currentTarget.querySelector<HTMLButtonElement>(`[data-hand-browse-card="${CSS.escape(next.id)}"] button`)?.focus();
          cardProps(next).onInspect?.();
        }}
        onPointerDownCapture={e => {
          if (!browsing || !e.isPrimary || e.button !== 0 || (wide && e.pointerType === "mouse")) return;
          const target = (e.target as HTMLElement).closest<HTMLElement>("[data-hand-browse-card]");
          if (!target) return;
          e.preventDefault(); e.stopPropagation();
          pointer.current = e.pointerId; lastPoint.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
          showPeek(target.dataset.handBrowseCard!, e.clientX);
        }}
        onPointerMove={e => {
          if (pointer.current !== e.pointerId) return;
          e.preventDefault(); e.stopPropagation();
          lastPoint.current = { x: e.clientX, y: e.clientY }; scrub(e.clientX);
        }}
        onPointerUp={e => {
          if (pointer.current !== e.pointerId) return;
          e.preventDefault(); e.stopPropagation(); pointer.current = null; lastPoint.current = null;
          suppressedClick.current = Date.now();
          setPeek(value => value && { ...value, offset: 0 });
        }}
        onPointerCancel={() => { pointer.current = null; lastPoint.current = null; suppressedClick.current = Date.now(); setPeek(null); }}
        onClickCapture={e => { if (browsing && Date.now() - suppressedClick.current < 400) { e.preventDefault(); e.stopPropagation(); } }}
        style={browsing ? { touchAction: "none" } : undefined}
        className={`${styles.handViewport} ${fanMode ? styles.fanViewport : ""}`} tabIndex={0} aria-label="Scrollable hand cards">
      <div
        className={`${styles.handCards} flex items-end ${fanMode ? "justify-start" : "justify-center"} px-2.5 ${wide ? "pb-6" : "pb-3"} ${charging ? "pt-4" : "pt-3"}`}
        // One card's height and its dip, so an empty hand keeps the board's shape. A fan starts at the
        // left edge, where its cost and power overlays are placed (`left: 10 + i * step`).
          style={{ minHeight: n ? `calc(${Math.round((cardWidth * 88) / 63)}px * var(--arena, 1) + 32px)` : 0 }}
      >
        {cards.map((c, i) => {
          const off = i - middle;
          const handlers = dragFor?.(c.id) ?? null;
          const tilt = wide && n <= 8 && !expanded ? off * 2.4 : 0;
          const dip = wide && n <= 8 && !expanded ? Math.abs(off) * 4 : 0;
          const props = cardProps(c);
          const status = handStatus?.(c.id) ?? null;
          const up = props.state === "selected";
          return (
            <div
              key={c.id}
              {...(!wide && browsing ? {} : handlers)}
              data-hand-browse-card={c.id}
              className={`${styles.handCard} relative shrink-0 transition-[opacity,filter,transform] duration-150 ${chargeable?.(c.id) ? "arena-chargeable" : ""}`}
              style={{
                marginLeft: i === 0 ? 0 : step - card,
                zIndex: wide && up ? 60 : i + 1,
                // Keep horizontal swipes for browsing while retaining vertical drags.
                touchAction: browsing ? "none" : handlers ? (wide ? "none" : "pan-x") : undefined,
                transform: visiblePeek?.id === c.id ? "translateY(-12px)" : sendingId === c.id ? "translateY(-44px) scale(1.1)" : undefined,
                ...(dragId === c.id ? { opacity: 0.22, filter: "grayscale(0.7)" } : sendingId === c.id ? { opacity: 0.55 } : null),
              }}
            >
              <StageCard {...props} onTap={browsing ? () => wide ? props.onInspect?.() : showPeek(c.id) : props.onTap} onDoubleTap={props.onDoubleTap} width={cardWidth} fan={fanMode || up ? 0 : tilt} lift={fanMode ? 0 : dip} lifts holdLock={dragId === c.id} unaffordable={status === "unaffordable"} />
              {!fanMode && status && <span className={`${styles.handStatus} ${styles[`status_${status}`]}`} aria-label={status} title={status} />}
              {/* Under the card, wherever its fan dip has put it: anchored to the slot, it would sit on the power. */}
              {!fanMode && handAction?.(c.id) && (onHandAction
                ? <button type="button" data-hand-action className={`${styles.handAction} ${styles.handActionButton} ${styles[`action_${status ?? "playable"}`]}`} style={dip ? { bottom: -17 - dip } : undefined} title={handAction(c.id) ?? undefined} aria-label={`${handAction(c.id)}: ${c.name}`} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onHandAction(c.id); }}>{handAction(c.id)}</button>
                : <span data-hand-action className={`${styles.handAction} ${styles[`action_${status ?? "playable"}`]}`} style={dip ? { bottom: -17 - dip } : undefined} title={handAction(c.id) ?? undefined}>{handAction(c.id)}</span>)}
            </div>
          );
        })}
        {fanMode && <div className={styles.handFanOverlays}>
          {cards.map((c, i) => {
            const status = handStatus?.(c.id) ?? null;
            const left = 10 + i * step;
            return <div key={c.id} className={styles.handFanOverlay} style={{ left }}>
              {c.power != null && !c.hidden && <span aria-hidden className={handStyles.fanPower}>{c.power >= 1000 ? `${+(c.power / 1000).toFixed(1)}k` : c.power}</span>}
              {c.cost != null && <span aria-hidden className={`${styles.fanCost} ${status === "unaffordable" ? styles.status_unaffordable : ""}`}>{c.cost}</span>}
              {status && (onHandAction && handAction?.(c.id)
                ? <button type="button" className={`${styles.handStatus} ${styles.handStatusButton} ${styles[`status_${status}`]}`} aria-label={`${handAction(c.id)}: ${c.name}`} title={handAction(c.id) ?? undefined} data-hand-action={c.id} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onHandAction(c.id); }} />
                : <span aria-hidden className={`${styles.handStatus} ${styles[`status_${status}`]}`} />)}
              {/* The fan is a dense overview: full action words belong in the card review. */}
            </div>;
          })}
        </div>}
      </div>
      </div>
      {fanMode && firstProps?.onInspect && <button type="button" onClick={firstProps.onInspect} className={`${styles.handOpen} tap rounded-xl border-2 border-space-950 bg-space-800 text-space-50`} aria-label={`Open the whole hand, ${n} cards`}><b>{n}</b><span>Open hand</span></button>}
      </div>
      {visiblePeek && peek && <HandPeek card={visiblePeek} handTop={peek.top} skin={peek.skin} offset={peek.offset} onClose={() => setPeek(null)} onInspect={() => { setPeek(null); cardProps(visiblePeek).onInspect?.(); }} />}
    </section>
  );
}
