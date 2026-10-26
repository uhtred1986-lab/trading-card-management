"use client";

import Image from "next/image";
import { useState } from "react";
import { GAME_INFO, gameOr } from "@/lib/catalog/games";

/**
 * Which card game this is, in one of three sizes (F1-12). Bandai's own art is hot-linked
 * (`GAME_INFO[game].art`); when an image does not load the mark falls back to the game's short name on
 * its accent colour, never a broken image. Always carries the full game name as a text alternative.
 *
 * - `chip`: a small pill, accent background and the word. The readable mark at 16-20 px; no image.
 * - `logo`: the white wordmark on a dark ground, for headings.
 * - `tile`: the game-select tile, for the launch switch. Cropped to its upper half by `object-cover`.
 */
export function GameMark({ game, size = "chip", className = "" }: { game: unknown; size?: "chip" | "logo" | "tile"; className?: string }) {
  const info = GAME_INFO[gameOr(game)];
  const [failed, setFailed] = useState(false);
  const { accent } = info.art;
  if (size === "chip") {
    return (
      <span
        role="img"
        aria-label={info.label}
        data-game-mark={info.id}
        className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold leading-none text-space-950 ${className}`}
        style={{ backgroundColor: accent }}
      >
        {info.short}
      </span>
    );
  }
  const fallback = (
    <span role="img" aria-label={info.label} data-game-mark={info.id} data-game-mark-fallback className={`flex h-full w-full items-center justify-center px-2 text-center text-sm font-bold text-space-950 ${className}`} style={{ backgroundColor: accent }}>
      {info.short}
    </span>
  );
  if (size === "logo") {
    return (
      <span className={`inline-flex h-10 items-center rounded-lg bg-space-900 px-3 ${failed ? "" : "py-1"}`} data-game-mark={info.id}>
        {failed ? fallback : (
          <Image src={info.art.logo} alt={info.label} width={120} height={44} onError={() => setFailed(true)} className={`h-full w-auto object-contain ${className}`} />
        )}
      </span>
    );
  }
  return (
    <span className={`relative block aspect-[470/333] w-full overflow-hidden rounded-xl ${className}`} data-game-mark={info.id}>
      {failed ? fallback : (
        <Image src={info.art.tile} alt={info.label} fill sizes="(min-width: 640px) 320px, 45vw" onError={() => setFailed(true)} className="object-cover object-top" />
      )}
    </span>
  );
}
