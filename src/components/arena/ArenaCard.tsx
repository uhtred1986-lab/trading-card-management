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

/**
 * The one chip a card wears for its [Permanent] skills, summarising the best
 * of them: lit while any is in force, dim while none is, and marked when the
 * engine cannot apply what it says (review §3.5). The face says "this card
 * has a standing rule and here is whether it is doing anything"; the sheet
 * says what.
 */
const PERMANENT_CHIP: Record<NonNullable<CardView["permanents"]>[number]["state"], { title: string; className: string }> = {
  on: { title: "[Permanent] in force", className: "arena-perm-on bg-space-950/85 text-ki-300 ring-[0.5px] ring-ki-400/70" },
  off: { title: "[Permanent] not applying right now", className: "bg-space-950/70 text-space-500 ring-[0.5px] ring-space-600/60" },
  inert: { title: "[Permanent] the engine cannot apply yet", className: "bg-space-950/85 text-dbs-yellow ring-[0.5px] ring-dbs-yellow/50 line-through" },
  unread: { title: "[Permanent] the engine cannot read", className: "bg-space-950/85 text-dbs-yellow ring-[0.5px] ring-dbs-yellow/50 line-through" },
};

/** The state a card's permanent chip shows: the most alive of its skills' states. */
export function permanentState(card: CardView): keyof typeof PERMANENT_CHIP | null {
  const states = card.permanents?.map((p) => p.state) ?? [];
  if (!states.length) return null;
  for (const s of ["on", "off", "inert", "unread"] as const) if (states.includes(s)) return s;
  return null;
}

/**
 * `dead`: the card has no move but the engine can say why — it sits a little
 * desaturated and its cost badge turns red, so the board says "not this one"
 * before you even tap it (docs/arena-workflow-spec.md §4).
 */
export type CardState = "plain" | "legal" | "selected" | "dim" | "attacker" | "guard" | "dead";

/**
 * The glow each state wears is a named class in `globals.css` rather than an
 * arbitrary shadow here, so it is painted from the theme's tokens — and so a
 * skin can turn the ring into an aura without this file knowing.
 */
const RING: Record<CardState, string> = {
  plain: "",
  dead: "saturate-[0.6] opacity-90",
  legal: "arena-ring-legal ring-2 ring-ki-400",
  selected: "arena-ring-selected ring-2 ring-ki-300 -translate-y-2 scale-105",
  dim: "opacity-40 saturate-50",
  attacker: "arena-ring-attacker ring-2 ring-ki-300",
  guard: "arena-ring-guard ring-2 ring-loss",
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
  const rested = card.mode === "rest";
  const rotation = rested ? 90 : upsideDown ? 180 : 0;
  const box = rested ? Math.max(width, height) : height;
  const showArt = !!card.imageUrl && !failed && !card.hidden;
  const long = card.name.length > 18;

  // A long press opens the inspector; the timer has to survive re-renders.
  // `held` is what draws the bar that fills while you hold — without it the
  // long press is a secret, and a card you keep pressing just sits there.
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [held, setHeld] = useState(false);
  const startPress = () => {
    if (!onInspect) return;
    setHeld(true);
    press.current = setTimeout(onInspect, 450);
  };
  const endPress = () => {
    if (press.current) clearTimeout(press.current);
    press.current = null;
    setHeld(false);
  };

  const hoverable = !!onHover && !card.hidden;
  // Energy sits upside-down and its cost, power and combo mean nothing there —
  // badges would just be clutter on a 22px card.
  const chrome = !card.hidden && !upsideDown;
  // A rule in force changes the number and the glyphs; the face says so
  // rather than showing a different card. Keywords a skill granted wear a
  // different ring from printed ones, and a power that is not the printed
  // one is coloured by which way it went.
  const granted = new Set((card.effects ?? []).filter((e) => e.kind === "keyword" && e.keyword).map((e) => e.keyword!));
  const delta = card.basePower != null && card.power != null ? card.power - card.basePower : 0;
  const perm = permanentState(card);

  return (
    // The id is in the DOM so the attack beam can find both of its ends.
    <div data-arena-card={card.id} className="relative flex shrink-0 items-center justify-center" style={{ width: px(width), height: px(box) }}>
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
        className={`arena-card absolute overflow-hidden rounded-[4px] border border-space-600 bg-space-800 text-left transition-all duration-200 ${RING[state]} ${onTap ? "cursor-pointer" : ""} ${hoverable ? "hover:brightness-125" : ""} ${rested ? "brightness-75 saturate-[0.7]" : ""}`}
        style={{ width: px(width), height: px(height), transform: `rotate(${rotation}deg)` }}
      >
        {card.hidden ? (
          <span className="arena-card-back absolute inset-0 grid place-items-center">
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
            className={`arena-power absolute inset-x-0 bottom-0 bg-space-950/85 px-[3px] py-[1px] text-center font-mono font-bold ${delta > 0 ? "arena-power-up text-gain" : delta < 0 ? "arena-power-down text-loss" : "text-space-50"}`}
            style={{ fontSize: px(9) }}
            title={delta ? `${card.basePower!.toLocaleString("en")} printed, ${delta > 0 ? "+" : ""}${delta.toLocaleString("en")} in force` : undefined}
          >
            {delta > 0 ? "▲" : delta < 0 ? "▼" : ""}
            {card.power.toLocaleString("en")}
          </span>
        )}
        {card.cost && chrome && (
          <span
            className={`arena-cost absolute left-[2px] top-[2px] grid place-items-center rounded-full font-mono font-bold leading-none ${state === "dead" ? "bg-loss text-space-50" : "bg-ki-500 text-space-950"}`}
            style={{ fontSize: px(8), width: px(13), height: px(13) }}
          >
            {card.cost}
          </span>
        )}
        {/* What this card does while it stands there, without having to hover it:
            its keywords (a granted one ringed green), and its [Permanent] chip. */}
        {chrome && width >= 40 && (
          <span className="absolute inset-x-0 bottom-[11%] flex flex-wrap justify-center gap-[3px] px-[2px]">
            {perm && (
              <span key="perm" title={PERMANENT_CHIP[perm].title} className={`rounded-[2px] px-[2px] font-bold leading-tight ${PERMANENT_CHIP[perm].className}`} style={{ fontSize: px(6) }}>
                ∞
              </span>
            )}
            {card.keywords
              .filter((k) => KEYWORD_GLYPH[k])
              .slice(0, perm ? 2 : 3)
              .map((k) => (
                <span
                  key={k}
                  title={granted.has(k) ? `${k} (granted by a skill)` : k}
                  className={`rounded-[2px] bg-space-950/85 px-[2px] font-bold leading-tight ring-[0.5px] ${granted.has(k) ? "text-gain ring-gain/70" : "text-ki-300 ring-ki-500/40"}`}
                  style={{ fontSize: px(6) }}
                >
                  {KEYWORD_GLYPH[k]}
                </span>
              ))}
          </span>
        )}
        {/* The long press, made visible: it fills, then the inspector opens. */}
        {held && <span className="arena-hold pointer-events-none absolute inset-x-0 bottom-0 h-[2px] origin-left bg-ki-400" aria-hidden />}
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
            // Keyed by position, so a marker arriving pops in on its own rather
            // than the whole row restarting.
            <span key={i} className="arena-chip rounded-full border border-space-950 bg-ki-400" style={{ width: px(9), height: px(9), animationDelay: `${i * 40}ms` }} />
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
