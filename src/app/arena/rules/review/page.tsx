import { redirect } from "next/navigation";
import { requireSlPage } from "@/lib/auth";

/**
 * The guided review is the Rules queue now (Rules PR 3): the same cards, one at a
 * time on the Card rules page with ‹ / › walking the queue. Old links and docs
 * land on the queue's *Incomplete* tab, keeping the scope they named.
 */
export default async function ReviewRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireSlPage();
  const sp = await searchParams;
  const p = new URLSearchParams({ health: "incomplete" });
  for (const k of ["deck", "game", "scope", "set", "source", "pattern", "mech", "q"]) {
    const v = Array.isArray(sp[k]) ? sp[k][0] : sp[k];
    if (v) p.set(k, v);
  }
  redirect(`/arena/rules?${p.toString()}`);
}
