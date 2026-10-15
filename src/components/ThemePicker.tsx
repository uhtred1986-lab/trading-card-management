"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ARENA_SKINS, SKIN_COOKIE, SKIN_LABELS, skinFrom, type ArenaSkin } from "@/lib/arena/skin";
/** Device-only presentation preference: works without an API or database write. */
export function ThemePicker({ skin }: { skin: ArenaSkin }) {
  const router = useRouter();
  const [chosen, setChosen] = useState(skin);
  useEffect(() => { setChosen(skin); }, [skin]);
  return <label className="ds-theme-picker"><span className="sr-only">Theme</span><select aria-label="Theme" value={chosen} onChange={e => {
    const next = skinFrom(e.target.value);
    setChosen(next);
    document.documentElement.dataset.skin = next;
    document.cookie = `${SKIN_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    window.dispatchEvent(new Event("dbs-theme-change"));
    if (navigator.onLine) router.refresh();
  }}>{ARENA_SKINS.map(key => <option key={key} value={key}>{SKIN_LABELS[key]}</option>)}</select></label>;
}
