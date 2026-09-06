"use client";

import { useTransition } from "react";
import { chooseSkin } from "@/app/arena/actions";
import type { ArenaSkin } from "@/lib/arena/skin";

/**
 * Night table or anime sky, from the board itself.
 *
 * A cookie rather than `localStorage`, unlike the buzz and sound toggles
 * beside it: a re-skin read on the client would flash the night board on
 * every load, so the server reads the cookie and sends the right markup.
 * The button names the skin you would switch *to*, as the old board toggle did.
 */
export function SkinToggle({ gameId, skin }: { gameId: number; skin: ArenaSkin }) {
  const [pending, start] = useTransition();
  const next: ArenaSkin = skin === "anime" ? "night" : "anime";
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => chooseSkin(gameId, next))}
      className="tap whitespace-nowrap uppercase tracking-widest text-space-600 hover:text-ki-400 disabled:opacity-50"
      title={`Switch to the ${next === "anime" ? "anime sky" : "night table"}`}
    >
      {next === "anime" ? "anime sky" : "night table"}
    </button>
  );
}
