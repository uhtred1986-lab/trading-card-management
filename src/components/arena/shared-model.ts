"use client";

import type { PlayerId, Requirement } from "@/lib/arena/engine";
import { sentence } from "@/lib/arena/wording";

/** Whose chair the words are read from: "until the start of your next turn" depends on it. */
export type Narrator = { viewer: PlayerId; them: string };
export const DEFAULT_NARRATOR: Narrator = { viewer: "p1", them: "your opponent" };

/**
 * Card text comes out of the catalog as HTML, so a skill naming a card type
 * arrives as `&lt;Majin Buu&gt;` and would be shown raw.
 */
export function plainText(html: string): string {
  const withBreaks = html.replace(/<br\s*\/?>/gi, "\n");
  let out = "";
  let inTag = false;
  for (const ch of withBreaks) {
    if (ch === "<") {
      inTag = true;
      continue;
    }
    if (ch === ">") {
      inTag = false;
      continue;
    }
    if (!inTag) out += ch;
  }
  return out
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export function shortLabel(label: string): string {
  return label
    .replace(/^Don't /, "No ")
    .replace(/ \(the skill does not resolve\)$/, "")
    .slice(0, 22);
}

/** The one refusal line under the question, when a tap was just refused. */
export function refusalLine(why: Requirement[] | undefined, o: Parameters<typeof sentence>[1]): string | null {
  return why?.length ? sentence(why[0], o) : null;
}
