import Link from "next/link";
import { GAMES, GAME_INFO, type Game } from "@/lib/catalog/games";

/**
 * "All games / Super / Fusion World" chips, shown above the list on every page
 * that can hold cards from both games.
 *
 * Links rather than a `<select>`: the filter is one tap on a phone, the current
 * choice is readable without opening anything, and every other filter on the
 * page survives because the caller passes its own params straight through.
 *
 * It renders nothing at all when the database only holds one game — the owner
 * who never buys Fusion World should not have to look at a filter for it.
 */
export function GameFilter({
  path,
  params,
  game,
  available: present,
}: {
  path: string;
  /** Every other filter currently applied, re-emitted on each chip. */
  params?: Record<string, string | string[] | number | undefined>;
  game?: Game;
  /** Games this page has anything to show for. Omit to always offer both. */
  available?: readonly Game[];
}) {
  const available = present ? GAMES.filter((g) => present.includes(g)) : [...GAMES];
  if (available.length < 2) return null;

  const href = (next: Game | undefined) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v == null || v === "") continue;
      if (Array.isArray(v)) for (const one of v) p.append(k, String(one));
      else p.set(k, String(v));
    }
    p.delete("game");
    // Changing the game invalidates a set chosen from the other one.
    p.delete("set");
    p.delete("page");
    if (next) p.set("game", next);
    const qs = p.toString();
    return qs ? `${path}?${qs}` : path;
  };

  const chip = (key: Game | undefined, label: string) => {
    const active = game === key;
    return (
      <Link
        key={key ?? "all"}
        href={href(key)}
        aria-current={active}
        className={`tap rounded-lg border px-2.5 py-1 text-sm transition-colors ${
          active ? "border-ki-500 bg-ki-500/10 text-space-50" : "border-space-700 text-space-300 hover:border-space-500"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {chip(undefined, "All games")}
      {available.map((g) => chip(g, GAME_INFO[g].short))}
    </div>
  );
}

/** The same choice as a form control, for the deck settings form. */
export function GameSelect({ name = "game", value, className = "" }: { name?: string; value?: Game; className?: string }) {
  return (
    <select name={name} defaultValue={value ?? "dbs"} className={className}>
      {GAMES.map((g) => (
        <option key={g} value={g}>
          {GAME_INFO[g].short}
        </option>
      ))}
    </select>
  );
}
