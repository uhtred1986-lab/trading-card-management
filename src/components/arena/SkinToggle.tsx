"use client";
import { useTransition } from "react";
import { ARENA_SKINS, SKIN_LABELS, skinFrom, type ArenaSkin } from "@/lib/arena/skin";
/** All worlds are reachable from the board, preserving its existing action boundary. */
export function SkinToggle({ skin, onChoose }: { skin: ArenaSkin; onChoose: (skin: ArenaSkin) => Promise<void> }) {
  const [pending, start] = useTransition();
  return <label className="ds-theme-picker"><span className="sr-only">Board theme</span><select aria-label="Board theme" disabled={pending} value={skin} onChange={e => { const next = skinFrom(e.target.value); start(() => onChoose(next)); }}>{ARENA_SKINS.map(key => <option key={key} value={key}>{SKIN_LABELS[key]}</option>)}</select></label>;
}
