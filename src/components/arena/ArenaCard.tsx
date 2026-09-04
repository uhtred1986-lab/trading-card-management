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

/**
 * The keyword skills that change how a card behaves *while it sits on the
 * board*, and the glyph each gets. The rest (Evolve, Union, Arrival …) matter
 * when a card is played, not after, so they stay off the face and live in the
 * card's detail panel instead.
 */
const KEYWORD_GLYPH: Record<string, string> = {
  Blocker: "BLK",
  Critical: "CRT",
  Barrier: "BAR",
  Indestructible: "IND",
  Deflect: "DFL",
  Revenge: "RVG",
  Strike: "STR",
  Attack: "ATK",
  "Over Realm": "ORL",
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
  drop = false,
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
  /** Battle Area cards drop in when they arrive; the animation runs once, on mount. */
  drop?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const height = Math.round((width * 88) / 63);
  const rested = card.mode === "rest";
  const rotation = rested ? 90 : upsideDown ? 180 : 0;
  const box = rested ? Math.max(width, height) : height;
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
  // Energy sits upside-down and its cost, power and combo mean nothing there —
  // badges would just be clutter on a 22px card.
  const chrome = !card.hidden && !upsideDown;

  return (
    // The id is in the DOM so the attack beam can find both of its ends.
    <div data-arena-card={card.id} className={`relative flex shrink-0 items-center justify-center ${drop ? "arena-drop" : ""}`} style={{ width: px(width), height: px(box) }}>
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
        className={`absolute overflow-hidden rounded-[4px] border border-space-600 bg-space-800 text-left transition-all duration-200 ${RING[state]} ${onTap ? "cursor-pointer" : ""} ${hoverable ? "hover:brightness-125" : ""} ${rested ? "brightness-75 saturate-[0.7]" : ""}`}
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
        {/* Rest Mode is already a 90° turn; the band is what names it at a glance. */}
        {rested && !card.hidden && (
          <span
            className="absolute inset-x-0 top-1/2 -translate-y-1/2 bg-space-950/70 text-center font-bold uppercase tracking-[0.2em] text-space-100"
            style={{ fontSize: px(7) }}
          >
            rest
          </span>
        )}
        {chrome && card.power != null && (
          <span
            className="absolute inset-x-0 bottom-0 bg-space-950/85 px-[3px] py-[1px] text-center font-mono font-bold text-space-50"
            style={{ fontSize: px(9) }}
          >
            {card.power.toLocaleString("en")}
          </span>
        )}
        {card.cost && chrome && (
          <span
            className="absolute left-[2px] top-[2px] grid place-items-center rounded-full bg-ki-500 font-mono font-bold leading-none text-space-950 shadow-[0_1px_3px_rgba(0,0,0,0.6)]"
            style={{ fontSize: px(8), width: px(13), height: px(13) }}
          >
            {card.cost}
          </span>
        )}
        {/* What this card does while it stands there, without having to hover it. */}
        {chrome && width >= 40 && (
          <span className="absolute inset-x-0 bottom-[11%] flex flex-wrap justify-center gap-[3px] px-[2px]">
            {card.keywords
              .filter((k) => KEYWORD_GLYPH[k])
              .slice(0, 3)
              .map((k) => (
                <span
                  key={k}
                  title={k}
                  className="rounded-[2px] bg-space-950/85 px-[2px] font-bold leading-tight text-ki-300 ring-[0.5px] ring-ki-500/40"
                  style={{ fontSize: px(6) }}
                >
                  {KEYWORD_GLYPH[k]}
                </span>
              ))}
          </span>
        )}
        {/* Combo is the number that decides a battle from hand — worth its own badge. */}
        {card.comboPower != null && card.comboPower > 0 && chrome && (
          <span
            className="absolute right-[2px] top-[2px] rounded-full bg-dbs-blue/90 px-[3px] font-mono font-bold leading-none text-space-50"
            style={{ fontSize: px(7), paddingBlock: px(2) }}
          >
            +{Math.round(card.comboPower / 1000)}k
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
      {card.referee && chrome && (
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
