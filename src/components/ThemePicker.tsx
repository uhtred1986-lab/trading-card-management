"use client";
import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ARENA_SKINS, SKIN_COOKIE, SKIN_LABELS, skinFrom, type ArenaSkin } from "@/lib/arena/skin";
const subscribe = (notify: () => void) => { window.addEventListener("dbs-theme-change", notify); return () => window.removeEventListener("dbs-theme-change", notify); };
const snapshot = () => skinFrom(document.documentElement.dataset.skin);
/** Device-only presentation preference: works without an API or database write. */
export function ThemePicker({ skin }: { skin: ArenaSkin }) {
  const router = useRouter();
  useEffect(() => {
    // A cached offline shell cannot read request cookies during its static build.
    const stored = document.cookie.split("; ").find(item => item.startsWith(`${SKIN_COOKIE}=`))?.split("=")[1];
    if (stored && skinFrom(stored) !== document.documentElement.dataset.skin) {
      document.documentElement.dataset.skin = skinFrom(stored);
      window.dispatchEvent(new Event("dbs-theme-change"));
    }
  }, []);
  const chosen = useSyncExternalStore(subscribe, snapshot, () => skin);
  return <label className="ds-theme-picker"><span className="sr-only">Theme</span><select aria-label="Theme" value={chosen} onChange={e => {
    const next = skinFrom(e.target.value);
    document.documentElement.dataset.skin = next;
    document.cookie = `${SKIN_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    window.dispatchEvent(new Event("dbs-theme-change"));
    if (navigator.onLine) router.refresh();
  }}>{ARENA_SKINS.map(key => <option key={key} value={key}>{SKIN_LABELS[key]}</option>)}</select></label>;
}
