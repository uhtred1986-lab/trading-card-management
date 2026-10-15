"use client";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CardView } from "@/lib/arena/view";
import { CardReader } from "../CardReader";
import styles from "./HandPeek.module.css";

/** Non-modal so the original hand keeps the pointer throughout a scrub. */
export function HandPeek({ card, handTop, skin, offset, onClose, onInspect }: {
  card: CardView; handTop: number; skin: string; offset: number;
  onClose: () => void; onInspect: () => void;
}) {
  const drag = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  return createPortal(<div className={styles.layer} data-skin={skin} data-hand-peek={card.id}>
    <button className={styles.dismiss} style={{ height: handTop }} tabIndex={-1} aria-label="Dismiss card preview" onClick={onClose} />
    <section className={styles.popup} style={{ bottom: Math.max(12, window.innerHeight - handTop + 8), transform: `translate(${position.x + offset}px, ${position.y}px) rotate(${(position.x + offset) / 15}deg)` }} aria-label={`${card.hidden ? "Face-down card" : card.name}, hand preview`}
      onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
      onPointerDown={e => {
        if (!(e.target as HTMLElement).closest("[data-reader-drag-handle]")) return;
        drag.current = { x: e.clientX, y: e.clientY }; moved.current = false;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={e => {
        if (!drag.current) return;
        const x = e.clientX - drag.current.x, y = e.clientY - drag.current.y;
        moved.current ||= Math.abs(x) + Math.abs(y) > 8;
        setPosition({ x: Math.max(-45, Math.min(45, x)), y: Math.max(-30, Math.min(30, y)) });
      }}
      onPointerUp={() => { drag.current = null; setPosition({ x: 0, y: 0 }); }}
      onPointerCancel={() => { drag.current = null; setPosition({ x: 0, y: 0 }); }}
      onClickCapture={e => { if (moved.current) { e.preventDefault(); e.stopPropagation(); moved.current = false; } }}>
      <div className={styles.tools}><button onClick={onInspect} aria-label="Card details and actions" title="Card details and actions">⋯</button><button onClick={onClose} aria-label="Close hand preview">×</button></div>
      <CardReader key={`${card.id}:${card.flipped}`} card={card} showAbilities direction="next" />
      <p className={styles.hint}>Slide across your hand to browse</p>
    </section>
  </div>, document.body);
}
