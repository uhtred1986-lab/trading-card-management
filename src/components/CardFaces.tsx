"use client";

import { useState } from "react";
import { CardImage } from "./CardImage";

/**
 * Both sides of a leader when a back image exists; otherwise just the front.
 * `layout="pair"` shows front and awakened side by side (card page, deck
 * header); `layout="flip"` shows one face with a tap-to-flip toggle for tight
 * spaces (leaders list).
 */
export function CardFaces({
  front,
  back,
  name,
  backName,
  layout = "pair",
  sizes,
  priority = false,
  className = "",
}: {
  front: string | null | undefined;
  back: string | null | undefined;
  name: string;
  backName?: string | null;
  layout?: "pair" | "flip";
  sizes?: string;
  priority?: boolean;
  className?: string;
}) {
  const [showBack, setShowBack] = useState(false);
  if (!back) return <CardImage src={front} alt={name} sizes={sizes} priority={priority} className={className} />;

  if (layout === "flip") {
    return (
      <button type="button" onClick={() => setShowBack((b) => !b)} className={`group relative block w-full text-left ${className}`} title={showBack ? "Show front" : "Show awakened side"}>
        <CardImage src={showBack ? back : front} alt={showBack ? (backName ?? `${name} (awakened)`) : name} sizes={sizes} priority={priority} />
        <span className="absolute bottom-1 right-1 rounded bg-space-950/80 px-1.5 py-0.5 text-[10px] font-semibold text-space-100 group-hover:bg-ki-500 group-hover:text-space-950">
          {showBack ? "↻ front" : "↻ awakened"}
        </span>
      </button>
    );
  }

  return (
    <div className={`grid grid-cols-2 gap-2 ${className}`}>
      <figure className="space-y-1">
        <CardImage src={front} alt={name} sizes={sizes} priority={priority} />
        <figcaption className="text-center text-[10px] uppercase tracking-wide text-space-400">Front</figcaption>
      </figure>
      <figure className="space-y-1">
        <CardImage src={back} alt={backName ?? `${name} (awakened)`} sizes={sizes} />
        <figcaption className="truncate text-center text-[10px] uppercase tracking-wide text-space-400" title={backName ?? undefined}>
          Awakened
        </figcaption>
      </figure>
    </div>
  );
}
