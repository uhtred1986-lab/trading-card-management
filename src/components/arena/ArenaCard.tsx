"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import type { CardView } from "@/lib/arena/view";

const COLOR_BAR: Record<string, string> = {
  Red: "bg-dbs-red",
  Blue: "bg-dbs-blue",
  Green: "bg-dbs-green",
  Yellow: "bg-dbs-yellow",
  Black: "bg-dbs-black",
  Colorless: "bg-space-500",
};

export type CardState = "plain" | "legal" | "selected" | "dim" | "attacker" | "guard";

const RING: Record<CardState, string> = {
  plain: "",
  legal: "ring-2 ring-ki-400 shadow-[0_0_14px_rgba(242,140,15,0.55)]",
  selected: "ring-2 ring-ki-300 shadow-[0_0_18px_rgba(242,140,15,0.8)] -translate-y-2 scale-105",
  dim: "opacity-40 saturate-50",
  attacker: "ring-2 ring-ki-300 shadow-[0_0_18px_rgba(242,140,15,0.7)]",
  guard: "ring-2 ring-loss shadow-[0_0_14px_rgba(248,113,113,0.6)]",
};

/**
 * Every fixed size here is a phone size scaled by `--arena` (globals.css), so a
 * laptop gets the same board with cards big enough to read.
 */
const px = (n: number) => `calc(${n}px * var(--arena, 1))`;

/**
 * One card on the board. Rest Mode is a 90° turn and energy sits upside-down,
 * exactly as at the table (1-10-1-1-2), which is what makes the board readable
 * at a glance. The wrapper keeps the upright footprint so a rotated card does
 * not shove its neighbours around.
 */
export function ArenaCard({
  card,
  width = 56,
  state = "plain",
  upsideDown = false,
  onTap,
  onInspect,
  onHover,
  badge,
}: {
  card: CardView;
  width?: number;
  state?: CardState;
  upsideDown?: boolean;
  onTap?: () => void;
  onInspect?: () => void;
  /**
   * Mouse only: the card's box while the pointer is over it, null when it
   * leaves. The board turns that into a full-size preview beside the card.
   */
  onHover?: (box: DOMRect | null) => void;
  badge?: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const height = Math.round((width * 88) / 63);
  const rotation = card.mode === "rest" ? 90 : upsideDown ? 180 : 0;
  const box = card.mode === "rest" ? Math.max(width, height) : height;
  const showArt = !!card.imageUrl && !failed && !card.hidden;
  const long = card.name.length > 18;

  // A long press opens the inspector; the timer has to survive re-renders.
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPress = () => {
    if (!onInspect) return;
    press.current = setTimeout(onInspect, 450);
  };
  const endPress = () => {
    if (press.current) clearTimeout(press.current);
    press.current = null;
  };

  const hoverable = !!onHover && !card.hidden;

  return (
    <div className="relative flex shrink-0 items-center justify-center" style={{ width: px(width), height: px(box) }}>
      <button
        type="button"
        onClick={onTap}
        onContextMenu={(e) => {
          if (!onInspect) return;
          e.preventDefault();
          onInspect();
        }}
        onPointerDown={startPress}
        onPointerUp={endPress}
        // A finger gets the long press, a mouse gets the preview. Enter/leave
        // rather than over/out: those bubble from the art inside and the
        // preview would flicker as the pointer crossed it.
        onPointerEnter={(e) => {
          if (hoverable && e.pointerType === "mouse") onHover!(e.currentTarget.getBoundingClientRect());
        }}
        onPointerLeave={(e) => {
          endPress();
          if (hoverable && e.pointerType === "mouse") onHover!(null);
        }}
        disabled={!onTap && !onInspect && !hoverable}
        aria-label={card.hidden ? "Face-down card" : `${card.name}${card.power != null ? `, ${card.power} power` : ""}`}
        className={`absolute overflow-hidden rounded-[4px] border border-space-600 bg-space-800 text-left transition-all duration-200 ${RING[state]} ${onTap ? "cursor-pointer" : ""} ${hoverable ? "hover:brightness-125" : ""}`}
        style={{ width: px(width), height: px(height), transform: `rotate(${rotation}deg)` }}
      >
        {card.hidden ? (
          <span className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_50%_50%,#f28c0f_0_11%,#0f1220_12%_30%,#2c3550_31%_33%,#0f1220_34%)]">
            <span className="block h-[62%] w-[62%] rounded-full border border-ki-400/35" />
          </span>
        ) : showArt ? (
          <Image src={card.imageUrl!} alt={card.name} fill sizes={`${width * 3}px`} className="object-cover" onError={() => setFailed(true)} unoptimized />
        ) : (
          <>
            <span className={`block h-[18%] ${COLOR_BAR[card.colors[0] ?? "Colorless"]}`} />
            <span className="absolute inset-x-[3px] top-[20%] block font-semibold leading-tight text-space-50" style={{ fontSize: px(long ? 7 : 8) }}>
              {card.name}
            </span>
          </>
        )}
        {!card.hidden && card.power != null && (
          <span className="absolute inset-x-0 bottom-0 bg-space-950/85 px-[3px] py-[1px] font-mono text-space-100" style={{ fontSize: px(8) }}>
            {card.power.toLocaleString("en")}
          </span>
        )}
        {card.cost && !card.hidden && (
          <span className="absolute left-[2px] top-[2px] rounded bg-space-950/80 px-[3px] font-mono text-ki-300" style={{ fontSize: px(8) }}>
            {card.cost}
          </span>
        )}
      </button>

      {card.markers > 0 && (
        <span className="pointer-events-none absolute -right-1 -top-1 flex gap-[2px]">
          {Array.from({ length: Math.min(card.markers, 6) }, (_, i) => (
            <span key={i} className="rounded-full border border-space-950 bg-ki-400" style={{ width: px(9), height: px(9) }} />
          ))}
          {card.markers > 6 && (
            <span className="font-mono text-ki-300" style={{ fontSize: px(8) }}>
              +{card.markers - 6}
            </span>
          )}
        </span>
      )}
      {card.underCount > 0 && (
        <span className="pointer-events-none absolute -bottom-1 -left-1 rounded bg-space-700 px-1 font-mono text-space-100" style={{ fontSize: px(8) }}>
          ×{card.underCount + 1}
        </span>
      )}
      {card.referee && !card.hidden && (
        <span className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 rounded bg-dbs-yellow px-1 font-bold tracking-wide text-space-950" style={{ fontSize: px(7) }}>
          REF
        </span>
      )}
      {badge && (
        <span className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 rounded bg-ki-500 px-1 font-bold tracking-wide text-space-950" style={{ fontSize: px(7) }}>
          {badge}
        </span>
      )}
    </div>
  );
}
