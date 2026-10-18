"use client";

import { useEffect, useRef, useState } from "react";
import type { CardView } from "@/lib/arena/view";
import { useArenaAdmin } from "./admin-context";
import { cardImage, cardImageSizeFor } from "@/lib/catalog/card-image";
import styles from "./ArenaCard.module.css";

const COLOR_BAR: Record<string, string> = {
  Red: "bg-dbs-red",
  Blue: "bg-dbs-blue",
  Green: "bg-dbs-green",
  Yellow: "bg-dbs-yellow",
  Black: "bg-dbs-black",
  White: "bg-dbs-white",
  Colorless: "bg-space-500",
};

/** Colour badge fills (literal: the badge sits on art, not on a themed panel). */
const COLOR_HEX: Record<string, string> = {
  Red: "#e5484d",
  Blue: "#3b82f6",
  Green: "#2fb36d",
  Yellow: "#f2c230",
  Black: "#3a3f4d",
  White: "#f1f3f8",
  Colorless: "#8b93a7",
};

/** Art that has already been fetched and decoded this session: a remounted card shows it at once. */
const decodedArt = new Set<string>();
const requestedArt = new Set<string>();

/**
 * Fetch and decode card art ahead of drawing it (a hand, the Battle Area), so a re-render that
 * remounts a card never flashes an empty box. Safe to call on every render: each URL loads once.
 */
export function preloadCardArt(cards: readonly Pick<CardView, "imageUrl" | "hidden">[], width: number) {
  if (typeof window === "undefined") return;
  for (const c of cards) {
    if (!c.imageUrl || c.hidden) continue;
    const src = cardImage(c.imageUrl, cardImageSizeFor(width));
    if (!src || decodedArt.has(src) || requestedArt.has(src)) continue;
    requestedArt.add(src);
    const img = new window.Image();
    img.decoding = "async";
    img.src = src;
    img.decode().then(() => decodedArt.add(src), () => requestedArt.delete(src));
  }
}

/**
 * The keyword skills that change how a card behaves *while it sits on the
 * board*, and the glyph each gets. The rest (Evolve, Union, Arrival â€¦) matter
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
 * engine cannot apply what it says (review Â§3.5). The face says "this card
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
 * `dead`: the card has no move but the engine can say why â€” it sits a little
 * desaturated and its cost badge turns red, so the board says "not this one"
 * before you even tap it (docs/arena-workflow-spec.md Â§4).
 */
export type CardState = "plain" | "legal" | "selected" | "dim" | "attacker" | "guard" | "dead";

/**
 * The glow each state wears is a named class in `globals.css` rather than an
 * arbitrary shadow here, so it is painted from the theme's tokens â€” and so a
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
 * One card on the board. Rest Mode is a 90Â° turn and energy sits upside-down,
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
  onDoubleTap,
  onInspect,
  onHover,
  badge,
  outlined = false,
  holdLock = false,
  unaffordable = false,
}: {
  card: CardView;
  width?: number;
  state?: CardState;
  upsideDown?: boolean;
  onTap?: () => void;
  onDoubleTap?: () => void;
  onInspect?: () => void;
  /**
   * Mouse only: the card's box while the pointer is over it, null when it
   * leaves. The board turns that into a full-size preview beside the card.
   */
  onHover?: (box: DOMRect | null) => void;
  badge?: string | null;
  /** The docked inspector's In play list is on this card's row: outline it on the board. */
  outlined?: boolean;
  /** A drag has begun from this card: the long press it started is over (rd-03). */
  holdLock?: boolean;
  /** The snapshot has no legal play for this card because its exact cost is unaffordable. */
  unaffordable?: boolean;
}) {
  // Keyed to the URL that failed: a leader keeps its instance when it awakens
  // and its art switches to the back, so a plain flag would hide the new face.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const height = Math.round((width * 88) / 63);
  const rested = card.mode === "rest";
  const rotation = rested ? 90 : upsideDown ? 180 : 0;
  const box = rested ? Math.max(width, height) : height;
  const showArt = !!card.imageUrl && failedSrc !== card.imageUrl && !card.hidden;
  const src = showArt ? cardImage(card.imageUrl!, cardImageSizeFor(width)) : null;
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const ready = !!src && (loadedSrc === src || decodedArt.has(src));
  const c1 = COLOR_HEX[card.colors[0] ?? ""];
  const c2 = COLOR_HEX[card.colors[1] ?? ""];
  const colourStyle = c1 ? ({ "--c1": c1, "--c2": c2 ?? c1 } as React.CSSProperties) : null;

  // A long press opens the inspector; the timer has to survive re-renders.
  // `held` is what draws the bar that fills while you hold â€” without it the
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

  useEffect(() => {
    // Only the timer: the bar is hidden by `holdLock` below, and the next
    // press or leave resets `held` itself.
    if (holdLock && press.current) {
      clearTimeout(press.current);
      press.current = null;
    }
  }, [holdLock]);

  // The REF badge is an engine internal: an admin's board draws it, a player's does not (#350).
  const admin = useArenaAdmin();
  const hoverable = !!onHover && !card.hidden;
  // Energy sits upside-down and its cost, power and combo mean nothing there â€”
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
        onDoubleClick={onDoubleTap}
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
        // Keyboard focus reviews a card the way hover does. `:focus-visible`
        // keeps a mouse or finger click (which also focuses a button) out of it.
        onFocus={(e) => {
          if (hoverable && e.currentTarget.matches(":focus-visible")) onHover!(e.currentTarget.getBoundingClientRect());
        }}
        onBlur={() => {
          if (hoverable) onHover!(null);
        }}
        disabled={!onTap && !onInspect && !hoverable}
        aria-label={card.hidden ? "Face-down card" : `${card.name}${card.power != null ? `, ${card.power} power` : ""}`}
        className={`arena-card ${styles.face} absolute rounded-[6px] border-2 border-[#12161f] bg-[#12161f] text-left transition-all duration-200 ${RING[state]} ${onTap ? "cursor-pointer" : ""} ${hoverable ? "hover:brightness-125" : ""} ${outlined ? "outline outline-[3px] outline-offset-2 outline-ki-300" : ""} ${rested ? "brightness-90 saturate-[0.8]" : ""}`}
        style={{ width: px(width), height: px(height), transform: `rotate(${rotation}deg)`, ["--cw" as string]: px(width) }}
      >
        {card.hidden ? (
          <span className="arena-card-back absolute inset-0 grid place-items-center">
            <span className="block h-[62%] w-[62%] rounded-full border border-ki-400/35" />
          </span>
        ) : (
          <span className={styles.clip}>
            {showArt ? (
              // A plain img, kept mounted across renders; it fades in once decoded and a source that
              // was already decoded this session starts visible.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src!}
                alt={card.name}
                decoding="async"
                draggable={false}
                ref={(el) => {
                  if (el?.complete && el.naturalWidth > 0) {
                    decodedArt.add(src!);
                    setLoadedSrc((cur) => (cur === src ? cur : src));
                  }
                }}
                onLoad={() => {
                  decodedArt.add(src!);
                  setLoadedSrc(src);
                }}
                onError={() => setFailedSrc(card.imageUrl)}
                className={`${styles.art} ${ready ? styles.artReady : ""}`}
              />
            ) : (
              <>
                <span className={`block h-[18%] ${COLOR_BAR[card.colors[0] ?? "Colorless"]}`} />
                <span className={styles.fallbackName}>{card.name}</span>
              </>
            )}
            {chrome && card.power != null && width >= 30 && (
              <span className={styles.powerPlate}>
                <span
                  className={`arena-power ${styles.power} ${delta > 0 ? `arena-power-up ${styles.powerUp}` : delta < 0 ? `arena-power-down ${styles.powerDown}` : ""}`}
                  title={delta ? `${card.basePower!.toLocaleString("en")} printed, ${delta > 0 ? "+" : ""}${delta.toLocaleString("en")} in force` : undefined}
                >
                  {delta > 0 ? "â–²" : delta < 0 ? "â–¼" : ""}
                  {card.power.toLocaleString("en")}
                </span>
              </span>
            )}
          </span>
        )}
        {card.cost && chrome && (
          <span className={`arena-cost ${styles.cost} ${unaffordable ? styles.costShort : ""}`}>{card.cost}</span>
        )}
        {chrome && width >= 40 && colourStyle && (
          <span className={`${styles.colour} ${card.colors.length > 1 ? styles.colour2 : ""}`} style={colourStyle} title={card.colors.join(" / ")} aria-hidden />
        )}
        {/* What this card does while it stands there, without having to hover it:
            its keywords (a granted one in green), and its [Permanent] chip. */}
        {chrome && width >= 40 && (
          <span className={styles.kws}>
            {perm && (
              <span key="perm" title={PERMANENT_CHIP[perm].title} className={`${styles.kw} ${PERMANENT_CHIP[perm].className}`}>
                âˆž
              </span>
            )}
            {card.keywords
              .filter((k) => KEYWORD_GLYPH[k])
              .slice(0, perm ? 2 : 3)
              .map((k) => (
                <span key={k} title={granted.has(k) ? `${k} (granted by a skill)` : k} className={`${styles.kw} ${granted.has(k) ? styles.kwGranted : ""}`}>
                  {KEYWORD_GLYPH[k]}
                </span>
              ))}
          </span>
        )}
        {/* The long press, made visible: it fills, then the inspector opens. */}
        {held && !holdLock && <span className="arena-hold pointer-events-none absolute inset-x-0 bottom-0 h-[2px] origin-left bg-ki-400" aria-hidden />}
        {/* Combo is the number that decides a battle from hand â€” worth its own badge. */}
        {card.comboPower != null && card.comboPower > 0 && chrome && (
          <span className={styles.combo}>+{Math.round(card.comboPower / 1000)}k</span>
        )}
      </button>

      {rested && !card.hidden && width >= 30 && <span className={`${styles.tag} ${styles.tagRest}`} style={{ ["--cw" as string]: px(width) }}>REST</span>}

      {card.markers > 0 && (
        <span className="pointer-events-none absolute -right-1 -top-1 flex gap-[2px]">
          {Array.from({ length: Math.min(card.markers, 6) }, (_, i) => (
            // Keyed by position, so a marker arriving pops in on its own rather
            // than the whole row restarting.
            <span key={i} className="arena-chip rounded-full border border-space-950 bg-ki-400" style={{ width: px(9), height: px(9), animationDelay: `${i * 40}ms` }} />
          ))}
          {card.markers > 6 && (
            <span className="arena-num text-ki-300" style={{ fontSize: px(8) }}>
              +{card.markers - 6}
            </span>
          )}
        </span>
      )}
      {card.underCount > 0 && (
        <span className="pointer-events-none absolute -bottom-1 -left-1 rounded bg-space-700 px-1 arena-num text-space-100" style={{ fontSize: px(8) }}>
          Ã—{card.underCount + 1}
        </span>
      )}
      {admin && card.referee && chrome && (
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
